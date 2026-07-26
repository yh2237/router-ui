import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
    executeCommand,
    getConnection,
    removeFile,
    uploadFile,
} from "../lib/connection.js";
import {
    buildTimeCommands,
    diffConfig,
    redactConfigLine,
    SettingsValidationError,
    type TimeSettingsInput,
} from "../lib/settings.js";
import type { DeviceConnection } from "../lib/types.js";
import {
    findSettingsNavigationItem,
    type SettingsNavigationItem,
} from "../lib/settings-navigation.js";
import {
    buildYamahaSettingCommands,
    buildYamahaLoadCommand,
    type PlannedCommand,
    type SettingFields,
} from "../lib/yamaha-settings.js";

const settings = new Hono();
const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
const MAX_CONFIG_FILE_SIZE = 1024 * 1024;
const pendingPreviews = new Map<string, {
    connId: string;
    section: string;
    commands: PlannedCommand[];
    createdAt: number;
}>();
const pendingConfigImports = new Map<string, {
    connId: string;
    filename: string;
    content: Buffer;
    mode: "difference" | "replace";
    rollbackTimer: number;
    preserveHostKey: boolean;
    createdAt: number;
}>();

settings.get("/api/device/:connId/settings/edit/time", (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("この設定画面は現在YAMAHA RTXのみ対応しています。"), 400);
    return c.html(renderTimeForm(connId, conn.changeToken));
});

settings.get("/api/device/:connId/settings/edit/:sectionKey", (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定変更は現在YAMAHA RTXのみ対応しています。"), 400);

    const item = findSettingsNavigationItem(c.req.param("sectionKey"));
    if (!item) return c.html(renderError("設定項目が見つかりません。"), 404);
    if (item.key === "config-file") {
        return c.html(renderConfigImportForm(connId, conn.changeToken));
    }
    return c.html(renderSectionForm(connId, conn.changeToken, item));
});

settings.post("/api/device/:connId/settings/import/preview", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定ファイル読込は現在YAMAHA RTXのみ対応しています。"), 400);
    if (!conn.transport.uploadFile) {
        return c.html(renderConfigImportError(
            "現在の接続方式ではファイル転送できません。SSH接続と、ルーター側のSFTP許可設定が必要です。",
            connId,
        ));
    }

    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }

    const file = body.configFile;
    if (!(file instanceof File) || file.size === 0) {
        return c.html(renderConfigImportError("読み込む設定ファイルを選択してください。", connId));
    }
    if (file.size > MAX_CONFIG_FILE_SIZE) {
        return c.html(renderConfigImportError("設定ファイルは1MiB以下にしてください。", connId));
    }
    if (file.name.toLowerCase().endsWith(".rtfg")) {
        return c.html(renderConfigImportError("loadコマンドは暗号化された設定ファイルに対応していません。", connId));
    }

    const content = Buffer.from(await file.arrayBuffer());
    if (content.includes(0)) {
        return c.html(renderConfigImportError("バイナリデータを含むファイルは読み込めません。", connId));
    }
    const modeValue = bodyValue(body.mode);
    const mode = modeValue === "replace" ? "replace" : modeValue === "difference" ? "difference" : undefined;
    if (!mode) return c.html(renderConfigImportError("更新方法の指定が正しくありません。", connId));
    const rollbackTimer = Number(bodyValue(body.rollbackTimer));
    if (!Number.isInteger(rollbackTimer) || rollbackTimer < 120 || rollbackTimer > 3600) {
        return c.html(renderConfigImportError("自動ロールバックは120〜3600秒で指定してください。", connId));
    }

    cleanExpiredConfigImports();
    for (const [id, pending] of pendingConfigImports) {
        if (pending.connId === connId) pendingConfigImports.delete(id);
    }
    const importId = randomUUID();
    const createdAt = Date.now();
    pendingConfigImports.set(importId, {
        connId,
        filename: file.name,
        content,
        mode,
        rollbackTimer,
        preserveHostKey: bodyValue(body.preserveHostKey) === "on",
        createdAt,
    });
    setTimeout(() => {
        const pending = pendingConfigImports.get(importId);
        if (pending?.createdAt === createdAt) pendingConfigImports.delete(importId);
    }, PREVIEW_LIFETIME_MS).unref();

    return c.html(renderConfigImportPreview(
        connId,
        conn.changeToken,
        importId,
        file.name,
        content,
        mode,
        rollbackTimer,
        bodyValue(body.preserveHostKey) === "on",
    ));
});

settings.post("/api/device/:connId/settings/import/apply", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定ファイル読込は現在YAMAHA RTXのみ対応しています。"), 400);

    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }
    const importId = bodyValue(body.importId);
    const pending = pendingConfigImports.get(importId);
    pendingConfigImports.delete(importId);
    if (!pending || pending.connId !== connId || Date.now() - pending.createdAt > PREVIEW_LIFETIME_MS) {
        return c.html(renderConfigImportError("プレビューの有効期限が切れています。ファイルを選び直してください。", connId));
    }
    const expectedConfirmation = pending.mode === "replace" ? "REPLACE" : "LOAD";
    if (bodyValue(body.confirmation) !== expectedConfirmation) {
        return c.html(renderConfigImportError(`確認欄へ ${expectedConfirmation} と入力してください。`, connId));
    }

    const remotePath = `/router-ui-import-${randomUUID()}.txt`;
    try {
        const before = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(before)) {
            return c.html(renderConfigImportError(
                "現在設定を取得できないため、読込を中止しました。管理ユーザー権限を確認してください。",
                connId,
            ));
        }
        await uploadFile(connId, remotePath, pending.content);
        const loadCommand = buildYamahaLoadCommand(
            remotePath,
            pending.mode,
            pending.rollbackTimer,
            pending.preserveHostKey,
        );
        const output = await executeCommand(connId, loadCommand);
        if (looksLikeYamahaError(output)) {
            return c.html(renderConfigImportExecutionError(output, connId));
        }
        const after = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(after)) {
            return c.html(renderConfigImportError(
                `読込後の設定を取得できませんでした。confirmやsaveを実行せず、${pending.rollbackTimer}秒の自動ロールバックを待ってください。`,
                connId,
            ));
        }
        return c.html(renderConfigImportResult(
            connId,
            conn.changeToken,
            pending,
            output,
            diffConfig(before, after),
        ));
    } catch (error) {
        return c.html(renderConfigImportError(
            `設定ファイル読込の応答を確認できませんでした。設定が反映されている可能性があります。${pending.rollbackTimer}秒間はconfirmやsaveを実行せず、自動ロールバックを待ってから接続状態を確認してください。${error instanceof Error ? ` ${error.message}` : ""}`,
            connId,
        ));
    } finally {
        try {
            await removeFile(connId, remotePath);
        } catch {
            // A load can intentionally change or disconnect the management interface.
        }
    }
});

settings.post("/api/device/:connId/settings/import/confirm", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }
    if (bodyValue(body.confirmation) !== "CONFIRM") {
        return c.html(renderError("ロールバックを停止するには CONFIRM と入力してください。"));
    }
    try {
        const output = await executeCommand(connId, "confirm");
        if (looksLikeYamahaError(output)) {
            return c.html(`${renderError("機器がconfirmコマンドにエラーを返しました。")}<pre class="terminal-output">${escapeHtml(output)}</pre>`);
        }
        return c.html(`
            <div class="settings-notice settings-notice--success">
                <strong>自動ロールバックを停止しました</strong>
                <p>起動設定にはまだ保存していません。必要な場合は別途saveを実行してください。</p>
            </div>
            <pre class="terminal-output">${escapeHtml(output)}</pre>
        `);
    } catch (error) {
        return c.html(renderError(`confirmの実行に失敗しました。${error instanceof Error ? ` ${error.message}` : ""}`));
    }
});

settings.post("/api/device/:connId/settings/edit/:sectionKey/generic-preview", async (c) => {
    const connId = c.req.param("connId");
    const section = c.req.param("sectionKey");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定変更は現在YAMAHA RTXのみ対応しています。"), 400);

    const item = findSettingsNavigationItem(section);
    if (!item || section === "time") return c.html(renderError("設定項目が見つかりません。"), 404);
    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }

    try {
        const commands = buildYamahaSettingCommands(section, stringFields(body));
        cleanExpiredPreviews();
        const previewId = randomUUID();
        const createdAt = Date.now();
        pendingPreviews.set(previewId, { connId, section, commands, createdAt });
        setTimeout(() => {
            const preview = pendingPreviews.get(previewId);
            if (preview?.createdAt === createdAt) pendingPreviews.delete(previewId);
        }, PREVIEW_LIFETIME_MS).unref();
        return c.html(renderGenericPreview(connId, conn.changeToken, item, previewId, commands));
    } catch (error) {
        if (error instanceof SettingsValidationError) {
            return c.html(renderGenericValidationErrors(error.issues, connId, section));
        }
        throw error;
    }
});

settings.post("/api/device/:connId/settings/edit/:sectionKey/generic-apply", async (c) => {
    const connId = c.req.param("connId");
    const section = c.req.param("sectionKey");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定変更は現在YAMAHA RTXのみ対応しています。"), 400);

    const item = findSettingsNavigationItem(section);
    if (!item || section === "time") return c.html(renderError("設定項目が見つかりません。"), 404);
    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }

    const previewId = bodyValue(body.previewId);
    const pending = pendingPreviews.get(previewId);
    pendingPreviews.delete(previewId);
    if (
        !pending
        || pending.connId !== connId
        || pending.section !== section
        || Date.now() - pending.createdAt > PREVIEW_LIFETIME_MS
    ) {
        return c.html(renderGenericValidationErrors(
            ["プレビューの有効期限が切れています。もう一度内容を確認してください。"],
            connId,
            section,
        ));
    }

    const results: { command: string; preview: string; output: string }[] = [];
    try {
        const before = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(before)) {
            return c.html(renderError("現在設定を取得できないため、設定変更を中止しました。管理ユーザー権限を確認してください。"));
        }
        let commandSucceeded = true;
        for (const command of pending.commands) {
            const result = {
                command: command.command,
                preview: command.preview,
                output: await executeCommand(connId, command.command),
            };
            results.push(result);
            if (looksLikeYamahaError(result.output)) {
                commandSucceeded = false;
                break;
            }
        }
        if (!commandSucceeded) await restoreGlobalCommandContext(connId, section);
        const after = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(after)) commandSucceeded = false;
        return c.html(renderGenericApplyResult(
            connId,
            conn.changeToken,
            item,
            results,
            diffConfig(before, after),
            commandSucceeded,
        ));
    } catch (error) {
        await restoreGlobalCommandContext(connId, section);
        return c.html(renderError(
            `設定の適用中に処理を継続できなくなりました。機器の現在状態を確認してください。${error instanceof Error ? ` ${error.message}` : ""}`,
        ));
    }
});

settings.post("/api/device/:connId/settings/edit/time/preview", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("この設定画面は現在YAMAHA RTXのみ対応しています。"), 400);

    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }

    const input = parseTimeInput(body);
    try {
        const commands = buildTimeCommands(input);
        return c.html(renderTimePreview(connId, conn.changeToken, input, commands));
    } catch (error) {
        if (error instanceof SettingsValidationError) {
            return c.html(renderValidationErrors(error.issues, connId));
        }
        throw error;
    }
});

settings.post("/api/device/:connId/settings/edit/time/apply", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("この設定画面は現在YAMAHA RTXのみ対応しています。"), 400);

    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }

    let commands: string[];
    try {
        commands = buildTimeCommands(parseTimeInput(body));
    } catch (error) {
        if (error instanceof SettingsValidationError) {
            return c.html(renderValidationErrors(error.issues, connId));
        }
        throw error;
    }

    try {
        const before = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(before)) {
            return c.html(renderError("現在設定を取得できないため、設定変更を中止しました。管理ユーザー権限を確認してください。"));
        }
        const results: { command: string; output: string }[] = [];
        let commandSucceeded = true;
        for (const command of commands) {
            const result = { command, output: await executeCommand(connId, command) };
            results.push(result);
            if (looksLikeYamahaError(result.output)) {
                commandSucceeded = false;
                break;
            }
        }
        const after = await executeCommand(connId, "show config");
        if (looksLikeYamahaError(after)) commandSucceeded = false;
        return c.html(renderApplyResult(
            connId,
            conn.changeToken,
            results,
            diffConfig(before, after),
            commandSucceeded,
        ));
    } catch (error) {
        return c.html(
            renderError(
                `設定の適用中に処理を継続できなくなりました。機器の現在状態を確認してください。${error instanceof Error ? ` ${error.message}` : ""}`,
            ),
        );
    }
});

settings.post("/api/device/:connId/settings/save", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(renderError("機器との接続が見つかりません。"), 404);
    if (!isYamaha(conn)) return c.html(renderError("設定保存は現在YAMAHA RTXのみ対応しています。"), 400);

    const body = await c.req.parseBody();
    if (!hasValidChangeToken(conn, bodyValue(body.changeToken))) {
        return c.html(renderError("操作トークンが無効です。画面を再読み込みしてください。"), 403);
    }
    if (bodyValue(body.confirmation) !== "SAVE") {
        return c.html(renderError("保存するには確認欄へ SAVE と入力してください。"));
    }

    try {
        const output = await executeCommand(connId, "save");
        if (looksLikeYamahaError(output)) {
            return c.html(`
                ${renderError("機器が保存コマンドにエラーを返しました。応答を確認してください。")}
                <pre class="terminal-output">${escapeHtml(output)}</pre>
            `);
        }
        return c.html(`
            <div class="settings-notice settings-notice--success">
                <strong>保存コマンドを実行しました</strong>
                <p>機器からの応答を確認してください。</p>
            </div>
            <pre class="terminal-output">${escapeHtml(output)}</pre>
        `);
    } catch (error) {
        return c.html(renderError(`保存に失敗しました。${error instanceof Error ? ` ${error.message}` : ""}`));
    }
});

function renderTimeForm(connId: string, changeToken: string): string {
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">SYSTEM / TIME</span>
                    <h2>時刻設定</h2>
                    <p>入力内容をコマンドとして確認してから機器へ適用します。</p>
                </div>
                <span class="settings-stage">1 / 3 入力</span>
            </header>
            <div class="settings-notice">
                この画面から適用しても起動設定には自動保存しません。日付・時刻とNTP同期は実行直後から動作へ反映されます。設定変更には管理ユーザー権限が必要です。
            </div>
            <form class="settings-form"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/edit/time/preview"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">

                <fieldset class="settings-fieldset">
                    <legend>タイムゾーン</legend>
                    <div class="settings-grid">
                        <div class="form-field">
                            <label for="timezone-mode">指定方法</label>
                            <select class="form-input" id="timezone-mode" name="timezoneMode">
                                <option value="unchanged" selected>変更しない</option>
                                <option value="jst">日本標準時（JST）</option>
                                <option value="utc">協定世界時（UTC）</option>
                                <option value="custom">時差を指定</option>
                            </select>
                        </div>
                        <div class="form-field">
                            <label for="timezone-offset">UTCからの時差</label>
                            <input class="form-input" id="timezone-offset" name="timezoneOffset"
                                   inputmode="text" placeholder="+09:00" pattern="[+-][0-9]{2}:[0-9]{2}">
                            <span class="field-help">「時差を指定」を選んだ場合のみ使用します（-12:00〜+11:59）。</span>
                        </div>
                    </div>
                </fieldset>

                <fieldset class="settings-fieldset">
                    <legend>手動設定</legend>
                    <div class="settings-grid">
                        <div class="form-field">
                            <label for="system-date">日付</label>
                            <input class="form-input" id="system-date" type="date" name="date">
                            <span class="field-help">空欄の場合は変更しません。</span>
                        </div>
                        <div class="form-field">
                            <label for="system-time">時刻</label>
                            <input class="form-input" id="system-time" type="time" step="1" name="time">
                            <span class="field-help">空欄の場合は変更しません。</span>
                        </div>
                    </div>
                </fieldset>

                <fieldset class="settings-fieldset">
                    <legend>NTP</legend>
                    <div class="settings-grid">
                        <div class="form-field">
                            <label for="ntp-source-mode">送信元アドレス</label>
                            <select class="form-input" id="ntp-source-mode" name="ntpSourceMode">
                                <option value="unchanged" selected>変更しない</option>
                                <option value="set">指定する</option>
                                <option value="remove">現在の指定を削除</option>
                            </select>
                        </div>
                        <div class="form-field">
                            <label for="ntp-source-address">IPv4アドレス</label>
                            <input class="form-input" id="ntp-source-address" name="ntpSourceAddress"
                                   inputmode="decimal" autocomplete="off" placeholder="192.0.2.1">
                        </div>
                        <div class="form-field">
                            <label for="ntp-server">NTPサーバー</label>
                            <input class="form-input" id="ntp-server" name="ntpServer"
                                   autocomplete="off" placeholder="ntp.example.jp">
                        </div>
                        <div class="form-field settings-checks">
                            <label><input type="checkbox" name="syncNtp" value="on"> 入力したNTPサーバーと同期する</label>
                            <label><input type="checkbox" name="ntpSyslog" value="on"> 同期結果をSYSLOGへ記録する</label>
                        </div>
                    </div>
                </fieldset>

                <div class="settings-actions">
                    <span class="settings-action-note">この段階では機器へコマンドを送りません。</span>
                    <button class="btn-primary" type="submit">コマンドを確認</button>
                </div>
            </form>
        </section>
    `;
}

function renderConfigImportForm(connId: string, changeToken: string): string {
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">CONFIG FILE / LOAD</span>
                    <h2>設定ファイル読込</h2>
                    <p>PC上の設定ファイルを一時転送し、YAMAHAのloadコマンドで反映します。</p>
                </div>
                <span class="settings-stage">1 / 3 選択</span>
            </header>
            <div class="settings-notice settings-notice--warning">
                設定全体や管理IPが変わり、接続が切れる可能性があります。SSH/SFTPが許可された管理ユーザーと、別の復旧経路が必要です。
            </div>
            <form class="settings-form"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/import/preview"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button"
                  hx-encoding="multipart/form-data"
                  enctype="multipart/form-data">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                <fieldset class="settings-fieldset">
                    <legend>読込ファイル</legend>
                    <div class="settings-grid">
                        <div class="form-field settings-grid-span">
                            <label for="config-file">設定ファイル</label>
                            <input class="form-input settings-file-input" id="config-file" name="configFile"
                                   type="file" accept=".txt,.cfg,.conf,text/plain" required>
                            <span class="field-help">暗号化されていない1MiB以下の設定ファイル。内容はプレビュー画面へ表示しません。</span>
                        </div>
                        ${selectField("更新方法", "mode", [
                            ["difference", "差分更新（推奨）"],
                            ["replace", "現在設定を置換"],
                        ])}
                        <div class="form-field">
                            <label for="config-rollback-timer">自動ロールバック</label>
                            <input class="form-input" id="config-rollback-timer" name="rollbackTimer"
                                   type="number" min="120" max="3600" value="300" required>
                            <span class="field-help">120〜3600秒。接続確認前のconfirm／saveは避けてください。</span>
                        </div>
                        <div class="form-field settings-checks settings-grid-span">
                            <label>
                                <input type="checkbox" name="preserveHostKey" value="on" checked>
                                SSHホスト鍵を再生成しない（no-key-generate）
                            </label>
                            <span class="field-help">RTX1210 Rev.14.01.28以降。古いリビジョンではチェックを外してください。</span>
                        </div>
                    </div>
                </fieldset>
                <div class="settings-actions">
                    <span class="settings-action-note">プレビューではルーターへファイルを転送しません。</span>
                    <button class="btn-primary" type="submit">読込内容を確認</button>
                </div>
            </form>
        </section>
    `;
}

function renderConfigImportPreview(
    connId: string,
    changeToken: string,
    importId: string,
    filename: string,
    content: Buffer,
    mode: "difference" | "replace",
    rollbackTimer: number,
    preserveHostKey: boolean,
): string {
    const digest = createHash("sha256").update(content).digest("hex");
    const lineCount = content.length === 0 ? 0 : content.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 1);
    const confirmation = mode === "replace" ? "REPLACE" : "LOAD";
    const previewCommand = [
        "load file <一時ファイル>",
        mode === "difference" ? "difference" : "",
        "silent",
        preserveHostKey ? "no-key-generate" : "",
        `rollback-timer=${rollbackTimer}`,
    ].filter(Boolean).join(" ");

    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">CONFIG FILE / LOAD</span>
                    <h2>設定ファイル読込 — 確認</h2>
                    <p>ファイルの内容は機密情報を含む可能性があるため画面へ表示しません。</p>
                </div>
                <span class="settings-stage">2 / 3 確認</span>
            </header>
            <div class="settings-notice settings-notice--warning">
                ${mode === "replace"
                    ? "置換更新では現在の設定をいったん消去してファイル内容へ置き換えます。管理接続が失われる可能性が特に高い操作です。"
                    : "差分更新でも管理IP、経路、フィルターなどが変更されると接続が切れる可能性があります。"}
            </div>
            <dl class="config-import-summary">
                <div><dt>ファイル名</dt><dd>${escapeHtml(filename)}</dd></div>
                <div><dt>サイズ</dt><dd>${content.length.toLocaleString("ja-JP")} bytes</dd></div>
                <div><dt>行数</dt><dd>${lineCount.toLocaleString("ja-JP")}</dd></div>
                <div><dt>SHA-256</dt><dd><code>${digest}</code></dd></div>
                <div><dt>更新方法</dt><dd>${mode === "difference" ? "差分更新" : "置換更新"}</dd></div>
                <div><dt>自動ロールバック</dt><dd>${rollbackTimer}秒</dd></div>
            </dl>
            <ol class="settings-command-preview">
                <li><code>SFTP: &lt;一時ファイル&gt;へ転送</code></li>
                <li><code>${escapeHtml(previewCommand)}</code></li>
                <li><code>SFTP: 一時ファイルを削除</code></li>
            </ol>
            <form class="settings-form"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/import/apply"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button"
                  hx-confirm="設定ファイルをルーターへ転送して反映します。続行しますか？">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                <input type="hidden" name="importId" value="${escapeAttribute(importId)}">
                <div class="form-field">
                    <label for="config-import-confirmation">確認のため ${confirmation} と入力</label>
                    <input class="form-input" id="config-import-confirmation" name="confirmation"
                           autocomplete="off" pattern="${confirmation}" required>
                </div>
                <div class="settings-actions">
                    <button class="btn-use" type="button"
                            hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/config-file"
                            hx-target="#settings-content">ファイル選択へ戻る</button>
                    <button class="btn-danger" type="submit">設定ファイルを読み込む</button>
                </div>
            </form>
        </section>
    `;
}

function renderConfigImportResult(
    connId: string,
    changeToken: string,
    pending: {
        filename: string;
        mode: "difference" | "replace";
        rollbackTimer: number;
    },
    output: string,
    diff: { added: string[]; removed: string[] },
): string {
    const diffRows = [
        ...diff.removed.map((line) => `<li class="config-diff-removed"><span>−</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
        ...diff.added.map((line) => `<li class="config-diff-added"><span>+</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
    ].join("");
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">CONFIG FILE / LOAD</span>
                    <h2>設定ファイル読込 — 適用結果</h2>
                    <p>${escapeHtml(pending.filename)}を${pending.mode === "difference" ? "差分更新" : "置換更新"}で読み込みました。</p>
                </div>
                <span class="settings-stage settings-stage--done">3 / 3 読込</span>
            </header>
            <div class="settings-notice settings-notice--warning">
                <strong>自動ロールバックはまだ有効です</strong>
                <p>${pending.rollbackTimer}秒以内に接続と通信を確認してください。問題がある場合は何も確定せず、自動復元を待ってください。</p>
            </div>
            <details class="settings-command-result">
                <summary>loadコマンドの応答</summary>
                <pre class="terminal-output">${escapeHtml(output)}</pre>
            </details>
            <section class="config-diff">
                <h3>実行前後の設定差分</h3>
                ${diffRows ? `<ul>${diffRows}</ul>` : `<p class="empty-note">設定ファイル上の差分は検出されませんでした。</p>`}
            </section>
            <section class="config-import-confirm">
                <div>
                    <span class="section-label">STOP ROLLBACK</span>
                    <h3>動作中の設定だけを確定</h3>
                    <p>confirmは自動ロールバックを停止しますが、起動設定へは保存しません。</p>
                </div>
                <form hx-post="/api/device/${escapeAttribute(connId)}/settings/import/confirm"
                      hx-target="#config-import-final-result"
                      hx-disabled-elt="find button"
                      hx-confirm="接続と通信が正常であることを確認しましたか？">
                    <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                    <div class="form-field">
                        <label for="rollback-confirmation">確認のため CONFIRM と入力</label>
                        <input class="form-input" id="rollback-confirmation" name="confirmation"
                               autocomplete="off" pattern="CONFIRM" required>
                    </div>
                    <button class="btn-primary" type="submit">ロールバックを停止</button>
                </form>
            </section>
            ${renderSaveSection(connId, changeToken)}
            <div id="config-import-final-result"></div>
        </section>
    `;
}

function renderConfigImportExecutionError(output: string, connId: string): string {
    return `
        ${renderError("機器がloadコマンドにエラーを返しました。設定は確定・保存していません。")}
        <pre class="terminal-output">${escapeHtml(output)}</pre>
        <button class="btn-use" type="button"
                hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/config-file"
                hx-target="#settings-content">ファイル選択へ戻る</button>
    `;
}

function renderConfigImportError(message: string, connId: string): string {
    return `
        ${renderError(message)}
        <button class="btn-use" type="button"
                hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/config-file"
                hx-target="#settings-content">設定ファイル読込へ戻る</button>
    `;
}

function renderSectionForm(
    connId: string,
    changeToken: string,
    item: SettingsNavigationItem,
): string {
    const fields = renderSectionFields(item.key);
    const riskNotice = settingsRiskNotice(item.key);
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">${escapeHtml(item.key.toUpperCase())}</span>
                    <h2>${escapeHtml(item.label)}</h2>
                    <p>${escapeHtml(item.description)}</p>
                </div>
                <span class="settings-stage">1 / 3 入力</span>
            </header>
            <div class="settings-notice${riskNotice ? " settings-notice--warning" : ""}">
                ${riskNotice
                    ? riskNotice
                    : "適用しても起動設定には自動保存しません。生成コマンドを次の画面で確認できます。"}
            </div>
            <form class="settings-form"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/edit/${escapeAttribute(item.key)}/generic-preview"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                ${fields}
                <div class="settings-actions">
                    <span class="settings-action-note">この段階では機器へコマンドを送りません。</span>
                    <button class="btn-primary" type="submit">コマンドを確認</button>
                </div>
            </form>
        </section>
    `;
}

function renderSectionFields(section: string): string {
    switch (section) {
        case "interfaces":
            return fieldset("IPv4アドレス", `
                ${selectField("操作", "action", [
                    ["static", "固定IPv4アドレスを設定"],
                    ["dhcp", "DHCPクライアントに設定"],
                    ["remove", "IPv4アドレス設定を削除"],
                    ["static-v6", "固定IPv6アドレスを設定"],
                    ["auto-v6", "RAからIPv6アドレスを生成"],
                    ["dhcp-v6", "DHCPv6からIPv6アドレスを生成"],
                    ["remove-v6", "IPv6アドレス設定を削除"],
                ])}
                ${interfaceField()}
                ${textField("IPアドレス", "address", "192.168.10.1/24", "固定IPv4／IPv6アドレス設定時に使用します。")}
            `);
        case "lan-mode":
            return fieldset("LANポート動作", `
                ${selectField("操作", "action", [["set", "設定"], ["reset", "初期値へ戻す"]])}
                ${interfaceField()}
                ${selectField("速度・二重化方式", "speed", [
                    ["auto", "自動判別"],
                    ["1000-fdx", "1000BASE-T 全二重"],
                    ["100-fdx", "100BASE-TX 全二重"],
                    ["100-hdx", "100BASE-TX 半二重"],
                    ["10-fdx", "10BASE-T 全二重"],
                    ["10-hdx", "10BASE-T 半二重"],
                ])}
                ${textField("物理ポート番号", "port", "", "空欄ならインターフェース内の全ポートへ適用します。", "number")}
                ${textField("MTU", "mtu", "1500", "RTX1210では64〜1500。空欄なら変更しません。", "number")}
                ${selectField("LAN分割", "separation", [
                    ["unchanged", "変更しない"],
                    ["off", "無効"],
                    ["divide-network", "LAN分割を有効"],
                ])}
            `);
        case "routing":
            return fieldset("IPv4静的経路", `
                ${selectField("操作", "action", [["add", "追加・更新"], ["remove", "削除"]])}
                ${textField("宛先ネットワーク", "network", "default または 192.0.2.0/24")}
                ${selectField("ゲートウェイ種別", "gatewayType", [
                    ["address", "IPv4アドレス"],
                    ["dhcp", "DHCP取得"],
                    ["pp", "PPインターフェース"],
                    ["tunnel", "トンネル"],
                    ["null", "NULLインターフェース"],
                ])}
                ${textField("ゲートウェイIPv4", "gateway", "192.0.2.1")}
                ${interfaceField("DHCP取得インターフェース", "gatewayInterface")}
                ${textField("PP／トンネル番号", "gatewayNumber", "1", "", "number")}
                ${textField("メトリック", "metric", "1", "1〜15。空欄なら省略します。", "number")}
                ${checkboxField("hide", "接続中だけ経路を有効にする（hide）")}
            `);
        case "nat":
            return fieldset("NATディスクリプター", `
                ${selectField("操作", "action", [["configure", "追加・更新"], ["remove", "動作タイプを解除"]])}
                ${textField("ディスクリプター番号", "descriptor", "1", "", "number")}
                ${selectField("動作タイプ", "type", [
                    ["masquerade", "IPマスカレード"],
                    ["nat", "動的・静的NAT"],
                    ["nat-masquerade", "NAT＋マスカレード"],
                    ["none", "変換しない"],
                ])}
                ${textField("外側アドレス", "outer", "ipcp", "ipcp、primary、secondary、IPv4またはIPv4範囲。空欄なら変更しません。")}
                ${textField("内側アドレス", "inner", "auto", "auto、IPv4またはIPv4範囲。空欄なら変更しません。")}
                ${selectField("LANへの適用", "attachInterface", [
                    ["", "この画面では適用しない"],
                    ["lan1", "LAN1へ適用"],
                    ["lan2", "LAN2へ適用"],
                    ["lan3", "LAN3へ適用"],
                ])}
            `);
        case "dns":
            return fieldset("DNSサーバー", `
                ${selectField("DNSサーバー操作", "serverAction", [
                    ["unchanged", "変更しない"],
                    ["set", "追加・更新"],
                    ["remove", "設定を削除"],
                ])}
                ${textField("DNSサーバー", "servers", "1.1.1.1, 8.8.8.8", "IPv4アドレスを最大4個、空白またはカンマで区切ります。")}
                ${selectField("プライベートアドレスPTR問い合わせ", "privateSpoof", [
                    ["unchanged", "変更しない"],
                    ["on", "ルーターでNXDomainを返す"],
                    ["off", "上位DNSへ転送する"],
                ])}
            `);
        case "dhcp":
            return `
                ${fieldset("DHCP動作", `
                    ${selectField("動作", "service", [
                        ["unchanged", "変更しない"],
                        ["server", "DHCPサーバー"],
                        ["relay", "DHCPリレー"],
                        ["off", "DHCP機能を無効化"],
                    ])}
                `)}
                ${fieldset("DHCPスコープ", `
                    ${selectField("スコープ操作", "scopeAction", [
                        ["unchanged", "変更しない"],
                        ["set", "追加・更新"],
                        ["remove", "削除"],
                    ])}
                    ${textField("スコープ番号", "scope", "1", "", "number")}
                    ${textField("配布開始アドレス", "startAddress", "192.168.10.100")}
                    ${textField("配布終了アドレス", "endAddress", "192.168.10.200")}
                    ${textField("プレフィックス長", "prefix", "24", "", "number")}
                    ${textField("通知するゲートウェイ", "gateway", "192.168.10.1", "空欄ならルーター自身のアドレスを通知します。")}
                    ${textField("リース期間", "expire", "72:00", "分、時間:分、または infinity。空欄なら初期値です。")}
                `)}
            `;
        case "ip-filter":
            return fieldset("IPv4静的フィルター", `
                ${selectField("操作", "action", [
                    ["define", "フィルターを定義"],
                    ["remove", "フィルター定義を削除"],
                    ["apply", "インターフェースへ適用"],
                    ["unapply", "インターフェースから解除"],
                ])}
                ${textField("フィルター番号", "number", "1000", "", "number")}
                ${selectField("動作", "kind", [
                    ["pass", "許可"],
                    ["pass-log", "許可して記録"],
                    ["reject", "拒否して記録"],
                    ["reject-nolog", "拒否して記録しない"],
                    ["restrict", "回線接続中のみ許可"],
                ])}
                ${textField("送信元", "source", "*", "IPv4、IPv4/プレフィックス、または *。")}
                ${textField("宛先", "destination", "*", "IPv4、IPv4/プレフィックス、または *。")}
                ${selectField("プロトコル", "protocol", [["*", "すべて"], ["tcp", "TCP"], ["udp", "UDP"], ["icmp", "ICMP"]])}
                ${textField("送信元ポート", "sourcePort", "*", "番号、範囲、カンマ区切り、または *。")}
                ${textField("宛先ポート", "destinationPort", "*", "番号、範囲、カンマ区切り、または *。")}
                ${interfaceField()}
                ${selectField("適用方向", "direction", [["in", "受信"], ["out", "送信"]])}
                ${textField("適用するフィルター番号", "filterList", "1000 1001", "評価順に空白またはカンマで区切ります。")}
            `);
        case "url-filter":
            return fieldset("HTTP URLフィルター", `
                ${selectField("操作", "action", [
                    ["define", "フィルターを定義"],
                    ["remove", "フィルター定義を削除"],
                    ["apply", "インターフェースへ適用"],
                    ["unapply", "インターフェースから解除"],
                ])}
                ${textField("フィルター番号", "number", "1000", "", "number")}
                ${selectField("動作", "kind", [
                    ["pass", "許可"],
                    ["pass-log", "許可して記録"],
                    ["reject", "拒否して記録"],
                    ["reject-nolog", "拒否して記録しない"],
                ])}
                ${textField("URLキーワード", "keyword", "example.com", "空白や引用符を含まないURLの全部または一部。")}
                ${textField("送信元", "source", "*", "IPv4、IPv4/プレフィックス、*、または空欄。")}
                ${interfaceField()}
                ${selectField("適用方向", "direction", [["in", "受信"], ["out", "送信"]])}
                ${textField("適用するフィルター番号", "filterList", "1000 1001", "評価順に空白またはカンマで区切ります。")}
            `);
        case "provider":
            return fieldset("PPPoE接続", `
                ${selectField("操作", "action", [["configure", "追加・更新"], ["disable", "接続を無効化"]])}
                ${textField("PP番号", "peer", "1", "", "number")}
                ${interfaceField("PPPoE回線インターフェース")}
                ${textField("接続ユーザー名", "username", "user@example.jp", "", "text", "username")}
                ${textField("接続パスワード", "password", "", "プレビューでは伏せ字になります。", "password", "current-password")}
                ${textField("MRU", "mru", "1454", "1280〜1792。", "number")}
                ${textField("NATディスクリプター番号", "natDescriptor", "", "空欄ならPPインターフェースへNATを適用しません。", "number")}
                ${selectField("常時接続", "alwaysOn", [["on", "有効"], ["off", "無効"]])}
            `);
        case "vpn":
            return fieldset("IPsecサイト間トンネル", `
                ${selectField("操作", "action", [["configure", "追加・更新"], ["disable", "トンネルを無効化"]])}
                ${textField("トンネル番号", "tunnel", "1", "", "number")}
                ${textField("SAポリシーID", "policy", "1", "", "number")}
                ${textField("セキュリティゲートウェイID", "gatewayId", "1", "", "number")}
                ${textField("対向ゲートウェイ", "remote", "vpn.example.jp", "IPv4アドレス、ホスト名、または any。")}
                ${textField("事前共有鍵", "preSharedKey", "", "プレビューでは伏せ字になります。", "password", "new-password")}
                ${selectField("暗号", "encryption", [
                    ["aes-cbc", "AES128-CBC"],
                    ["aes256-cbc", "AES256-CBC"],
                    ["3des-cbc", "3DES-CBC"],
                ])}
                ${selectField("認証", "authentication", [
                    ["sha-hmac", "HMAC-SHA-1"],
                    ["sha256-hmac", "HMAC-SHA2-256"],
                ])}
            `);
        case "logging":
            return `
                ${fieldset("SYSLOG転送先", `
                    ${selectField("転送先操作", "hostAction", [
                        ["unchanged", "変更しない"],
                        ["set", "追加・更新"],
                        ["remove", "すべて削除"],
                    ])}
                    ${textField("転送先", "hosts", "192.0.2.10 log.example.jp", "IPv4、IPv6またはホスト名を最大4個、空白かカンマで区切ります。")}
                `)}
                ${fieldset("出力レベル", `
                    ${selectField("INFO", "info", [
                        ["unchanged", "変更しない"],
                        ["on", "内部保存して転送する"],
                        ["off", "内部保存のみ"],
                    ])}
                    ${selectField("NOTICE", "notice", [
                        ["unchanged", "変更しない"],
                        ["on", "出力する"],
                        ["off", "出力しない"],
                    ])}
                    ${selectField("DEBUG", "debug", [
                        ["unchanged", "変更しない"],
                        ["on", "出力する"],
                        ["off", "出力しない"],
                    ])}
                    <p class="field-help settings-grid-span">DEBUGを有効にすると大量のログが発生します。調査後は無効へ戻してください。</p>
                `)}
                ${fieldset("送信形式", `
                    ${selectField("Facility", "facility", [
                        ["unchanged", "変更しない"],
                        ["user", "user"],
                        ["local0", "local0"],
                        ["local1", "local1"],
                        ["local2", "local2"],
                        ["local3", "local3"],
                        ["local4", "local4"],
                        ["local5", "local5"],
                        ["local6", "local6"],
                        ["local7", "local7"],
                    ])}
                    ${selectField("パケット形式", "format", [
                        ["unchanged", "変更しない"],
                        ["yamaha", "YAMAHA従来形式"],
                        ["rfc3164", "RFC 3164"],
                        ["rfc5424", "RFC 5424"],
                    ])}
                    ${selectField("送信元アドレス操作", "localAddressAction", [
                        ["unchanged", "変更しない"],
                        ["set", "設定"],
                        ["remove", "削除"],
                    ])}
                    ${textField("送信元IPアドレス", "localAddress", "192.0.2.1", "IPv4またはIPv6アドレス。")}
                `)}
            `;
        case "snmp":
            return `
                ${fieldset("読み取り専用アクセス", `
                    ${selectField("アクセス設定", "accessAction", [
                        ["unchanged", "変更しない"],
                        ["set", "許可元を追加・更新"],
                        ["remove", "許可元を削除"],
                    ])}
                    ${textField("アクセス元", "accessHost", "192.0.2.10", "IPアドレス、IPv4範囲、lan1〜lan3、any、none。削除時は空欄ですべて解除します。")}
                    ${textField("読み取りコミュニティ名", "readCommunity", "", "16文字以内。プレビューと設定差分では伏せ字になります。", "password", "new-password")}
                `)}
                ${fieldset("SNMPv1 Trap", `
                    ${selectField("Trap設定", "trapAction", [
                        ["unchanged", "変更しない"],
                        ["set", "送信先を追加・更新"],
                        ["remove", "送信先を削除"],
                    ])}
                    ${textField("Trap送信先", "trapHost", "192.0.2.20", "IPv4またはIPv6アドレス。")}
                    ${textField("Trapコミュニティ名", "trapCommunity", "", "16文字以内。プレビューと設定差分では伏せ字になります。", "password", "new-password")}
                `)}
                ${fieldset("機器識別情報", `
                    ${selectField("sysName操作", "sysNameAction", [
                        ["unchanged", "変更しない"],
                        ["set", "設定"],
                        ["remove", "削除"],
                    ])}
                    ${textField("sysName", "sysName", "router-edge-01", "255文字以内。")}
                    ${selectField("sysLocation操作", "sysLocationAction", [
                        ["unchanged", "変更しない"],
                        ["set", "設定"],
                        ["remove", "削除"],
                    ])}
                    ${textField("sysLocation", "sysLocation", "サーバー室", "255文字以内。")}
                    ${selectField("sysContact操作", "sysContactAction", [
                        ["unchanged", "変更しない"],
                        ["set", "設定"],
                        ["remove", "削除"],
                    ])}
                    ${textField("sysContact", "sysContact", "network@example.jp", "255文字以内。")}
                `)}
            `;
        case "upnp":
            return `
                ${fieldset("UPnP動作", `
                    ${selectField("UPnP", "use", [
                        ["unchanged", "変更しない"],
                        ["on", "有効"],
                        ["off", "無効"],
                    ])}
                    ${selectField("外側アドレス参照先", "externalType", [
                        ["unchanged", "変更しない"],
                        ["default", "デフォルトルート"],
                        ["lan1", "LAN1"],
                        ["lan2", "LAN2"],
                        ["lan3", "LAN3"],
                        ["pp", "PPインターフェース"],
                    ])}
                    ${textField("PP番号", "peer", "1", "PPインターフェースを選んだ場合に使用します。", "number")}
                    ${selectField("UPnPのDEBUGログ", "syslog", [
                        ["unchanged", "変更しない"],
                        ["on", "出力する"],
                        ["off", "出力しない"],
                    ])}
                `)}
                ${fieldset("ポートマッピング消去", `
                    ${selectField("消去条件", "timerType", [
                        ["unchanged", "変更しない"],
                        ["arp", "ARP情報を参照する"],
                        ["normal", "ARP情報を参照しない"],
                    ])}
                    ${selectField("タイマー操作", "timerAction", [
                        ["unchanged", "変更しない"],
                        ["set", "秒数を設定"],
                        ["off", "時間では消去しない"],
                        ["reset", "初期値へ戻す"],
                    ])}
                    ${textField("消去までの秒数", "timer", "3600", "600〜21474836秒。", "number")}
                    <p class="field-help settings-grid-span">消去条件をARPにすると、時間による消去を無効にしてもARPのタイムアウト時に削除されます。</p>
                `)}
            `;
        default:
            return `<div class="error-message">この設定項目は未実装です。</div>`;
    }
}

function settingsRiskNotice(section: string): string {
    if (["interfaces", "lan-mode", "routing", "nat", "provider", "vpn", "ip-filter", "url-filter"].includes(section)) {
        return "この設定は通信や管理接続を切断する可能性があります。コンソールなど別の復旧経路を確保してから適用してください。";
    }
    if (section === "snmp") {
        return "アクセス元にanyを指定するとSNMPを広く公開します。管理ネットワークのIPアドレスへ限定してください。読み書き可能なSNMPアクセスはこの画面では設定しません。";
    }
    if (section === "upnp") {
        return "UPnPを有効にすると、LAN内の機器がポートマッピングを作成できるようになります。必要なネットワークだけで使用してください。";
    }
    return "";
}

function fieldset(legend: string, content: string): string {
    return `<fieldset class="settings-fieldset"><legend>${escapeHtml(legend)}</legend><div class="settings-grid">${content}</div></fieldset>`;
}

function textField(
    label: string,
    name: string,
    placeholder: string,
    help = "",
    type = "text",
    autocomplete = "off",
): string {
    return `
        <div class="form-field">
            <label for="setting-${escapeAttribute(name)}">${escapeHtml(label)}</label>
            <input class="form-input" id="setting-${escapeAttribute(name)}" name="${escapeAttribute(name)}"
                   type="${escapeAttribute(type)}" autocomplete="${escapeAttribute(autocomplete)}"
                   placeholder="${escapeAttribute(placeholder)}">
            ${help ? `<span class="field-help">${escapeHtml(help)}</span>` : ""}
        </div>
    `;
}

function selectField(label: string, name: string, options: [string, string][]): string {
    return `
        <div class="form-field">
            <label for="setting-${escapeAttribute(name)}">${escapeHtml(label)}</label>
            <select class="form-input" id="setting-${escapeAttribute(name)}" name="${escapeAttribute(name)}">
                ${options.map(([value, text]) => `<option value="${escapeAttribute(value)}">${escapeHtml(text)}</option>`).join("")}
            </select>
        </div>
    `;
}

function interfaceField(label = "インターフェース", name = "interface"): string {
    return selectField(label, name, [["lan1", "LAN1"], ["lan2", "LAN2"], ["lan3", "LAN3"]]);
}

function checkboxField(name: string, label: string): string {
    return `
        <div class="form-field settings-checks">
            <label><input type="checkbox" name="${escapeAttribute(name)}" value="on"> ${escapeHtml(label)}</label>
        </div>
    `;
}

function renderTimePreview(
    connId: string,
    changeToken: string,
    input: TimeSettingsInput,
    commands: string[],
): string {
    const commandRows = commands
        .map((command) => `<li><code>${escapeHtml(command)}</code></li>`)
        .join("");
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">SYSTEM / TIME</span>
                    <h2>実行内容の確認</h2>
                    <p>次のコマンドを表示順に実行します。</p>
                </div>
                <span class="settings-stage">2 / 3 確認</span>
            </header>
            <div class="settings-notice settings-notice--warning">
                適用すると実行中の設定が変わります。起動設定への保存はまだ行いません。
            </div>
            <ol class="settings-command-preview">${commandRows}</ol>
            <form class="settings-actions"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/edit/time/apply"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button"
                  hx-confirm="表示中のコマンドを機器へ適用します。続行しますか？">
                ${renderTimeHiddenInputs(changeToken, input)}
                <button class="btn-use" type="button"
                        hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/time"
                        hx-target="#settings-content">入力へ戻る</button>
                <button class="btn-primary" type="submit">この内容を適用</button>
            </form>
        </section>
    `;
}

function renderGenericPreview(
    connId: string,
    changeToken: string,
    item: SettingsNavigationItem,
    previewId: string,
    commands: PlannedCommand[],
): string {
    const commandRows = commands
        .map(({ preview }) => `<li><code>${escapeHtml(preview)}</code></li>`)
        .join("");
    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">${escapeHtml(item.key.toUpperCase())}</span>
                    <h2>${escapeHtml(item.label)} — 実行内容の確認</h2>
                    <p>次のコマンドを表示順に実行します。</p>
                </div>
                <span class="settings-stage">2 / 3 確認</span>
            </header>
            <div class="settings-notice settings-notice--warning">
                適用すると実行中の設定が変わります。起動設定への保存はまだ行いません。
            </div>
            <ol class="settings-command-preview">${commandRows}</ol>
            <form class="settings-actions"
                  hx-post="/api/device/${escapeAttribute(connId)}/settings/edit/${escapeAttribute(item.key)}/generic-apply"
                  hx-target="#settings-content"
                  hx-disabled-elt="find button"
                  hx-confirm="表示中のコマンドを機器へ適用します。続行しますか？">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                <input type="hidden" name="previewId" value="${escapeAttribute(previewId)}">
                <button class="btn-use" type="button"
                        hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/${escapeAttribute(item.key)}"
                        hx-target="#settings-content">入力へ戻る</button>
                <button class="btn-primary" type="submit">この内容を適用</button>
            </form>
        </section>
    `;
}

function renderApplyResult(
    connId: string,
    changeToken: string,
    results: { command: string; output: string }[],
    diff: { added: string[]; removed: string[] },
    commandSucceeded: boolean,
): string {
    const resultRows = results.map(({ command, output }) => `
        <details class="settings-command-result">
            <summary><code>${escapeHtml(command)}</code></summary>
            <pre class="terminal-output">${escapeHtml(output)}</pre>
        </details>
    `).join("");
    const diffRows = [
        ...diff.removed.map((line) => `<li class="config-diff-removed"><span>−</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
        ...diff.added.map((line) => `<li class="config-diff-added"><span>+</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
    ].join("");

    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">SYSTEM / TIME</span>
                    <h2>適用結果</h2>
                    <p>機器へコマンドを送信しました。応答と設定差分を確認してください。</p>
                </div>
                <span class="settings-stage${commandSucceeded ? " settings-stage--done" : " settings-stage--error"}">3 / 3 ${commandSucceeded ? "適用" : "要確認"}</span>
            </header>
            ${commandSucceeded ? "" : `
                <div class="settings-notice settings-notice--error">
                    機器が少なくとも1つのコマンドにエラーを返しました。起動設定へは保存できません。各応答と機器の現在状態を確認してください。
                </div>
            `}
            <div class="settings-result-list">${resultRows}</div>
            <section class="config-diff">
                <h3>実行前後の設定差分</h3>
                ${diffRows
                    ? `<ul>${diffRows}</ul>`
                    : `<p class="empty-note">設定ファイル上の差分はありません。日付・時刻やNTP同期など、設定行を持たない操作では正常です。</p>`}
            </section>
            ${commandSucceeded ? `<section class="settings-save">
                <div>
                    <span class="section-label">PERSIST CHANGES</span>
                    <h3>起動設定へ保存</h3>
                    <p>再起動後も設定を残す場合だけ実行してください。保存前に上の応答と差分を確認してください。</p>
                </div>
                <form hx-post="/api/device/${escapeAttribute(connId)}/settings/save"
                      hx-target="#save-result"
                      hx-disabled-elt="find button"
                      hx-confirm="現在の設定を起動設定へ保存します。元に戻すには再設定が必要です。続行しますか？">
                    <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                    <div class="form-field">
                        <label for="save-confirmation">確認のため SAVE と入力</label>
                        <input class="form-input" id="save-confirmation" name="confirmation"
                               autocomplete="off" pattern="SAVE" required>
                    </div>
                    <button class="btn-danger" type="submit">起動設定へ保存</button>
                </form>
                <div id="save-result"></div>
            </section>` : ""}
            <div class="settings-actions">
                <button class="btn-use" type="button"
                        hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/time"
                        hx-target="#settings-content">時刻設定へ戻る</button>
            </div>
        </section>
    `;
}

function renderGenericApplyResult(
    connId: string,
    changeToken: string,
    item: SettingsNavigationItem,
    results: { command: string; preview: string; output: string }[],
    diff: { added: string[]; removed: string[] },
    commandSucceeded: boolean,
): string {
    const resultRows = results.map(({ command, preview, output }) => `
        <details class="settings-command-result">
            <summary><code>${escapeHtml(preview)}</code></summary>
            <pre class="terminal-output">${escapeHtml(redactCommandOutput(output, command, preview))}</pre>
        </details>
    `).join("");
    const diffRows = [
        ...diff.removed.map((line) => `<li class="config-diff-removed"><span>−</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
        ...diff.added.map((line) => `<li class="config-diff-added"><span>+</span><code>${escapeHtml(redactConfigLine(line))}</code></li>`),
    ].join("");

    return `
        <section class="settings-editor">
            <header class="settings-editor-header">
                <div>
                    <span class="section-label">${escapeHtml(item.key.toUpperCase())}</span>
                    <h2>${escapeHtml(item.label)} — 適用結果</h2>
                    <p>機器の応答と実行前後の設定差分を確認してください。</p>
                </div>
                <span class="settings-stage${commandSucceeded ? " settings-stage--done" : " settings-stage--error"}">3 / 3 ${commandSucceeded ? "適用" : "要確認"}</span>
            </header>
            ${commandSucceeded ? "" : `
                <div class="settings-notice settings-notice--error">
                    機器が少なくとも1つのコマンドにエラーを返しました。起動設定へは保存できません。
                </div>
            `}
            <div class="settings-result-list">${resultRows}</div>
            <section class="config-diff">
                <h3>実行前後の設定差分</h3>
                ${diffRows
                    ? `<ul>${diffRows}</ul>`
                    : `<p class="empty-note">設定ファイル上の差分はありません。各コマンドの応答も確認してください。</p>`}
            </section>
            ${commandSucceeded ? renderSaveSection(connId, changeToken) : ""}
            <div class="settings-actions">
                <button class="btn-use" type="button"
                        hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/${escapeAttribute(item.key)}"
                        hx-target="#settings-content">${escapeHtml(item.label)}へ戻る</button>
            </div>
        </section>
    `;
}

function renderSaveSection(connId: string, changeToken: string): string {
    return `
        <section class="settings-save">
            <div>
                <span class="section-label">PERSIST CHANGES</span>
                <h3>起動設定へ保存</h3>
                <p>再起動後も設定を残す場合だけ実行してください。保存前に上の応答と差分を確認してください。</p>
            </div>
            <form hx-post="/api/device/${escapeAttribute(connId)}/settings/save"
                  hx-target="#save-result"
                  hx-disabled-elt="find button"
                  hx-confirm="現在の設定を起動設定へ保存します。元に戻すには再設定が必要です。続行しますか？">
                <input type="hidden" name="changeToken" value="${escapeAttribute(changeToken)}">
                <div class="form-field">
                    <label for="save-confirmation-generic">確認のため SAVE と入力</label>
                    <input class="form-input" id="save-confirmation-generic" name="confirmation"
                           autocomplete="off" pattern="SAVE" required>
                </div>
                <button class="btn-danger" type="submit">起動設定へ保存</button>
            </form>
            <div id="save-result"></div>
        </section>
    `;
}

function renderTimeHiddenInputs(changeToken: string, input: TimeSettingsInput): string {
    return [
        hidden("changeToken", changeToken),
        hidden("timezoneMode", input.timezoneMode),
        hidden("timezoneOffset", input.timezoneOffset),
        hidden("date", input.date),
        hidden("time", input.time),
        hidden("ntpServer", input.ntpServer),
        hidden("ntpSourceMode", input.ntpSourceMode),
        hidden("ntpSourceAddress", input.ntpSourceAddress),
        input.ntpSyslog ? hidden("ntpSyslog", "on") : "",
        input.syncNtp ? hidden("syncNtp", "on") : "",
    ].join("");
}

function renderValidationErrors(issues: string[], connId: string): string {
    const rows = issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
    return `
        <div class="error-message">
            入力内容を確認してください。
            <ul>${rows}</ul>
        </div>
        <button class="btn-use" type="button"
                hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/time"
                hx-target="#settings-content">入力へ戻る</button>
    `;
}

function renderGenericValidationErrors(issues: string[], connId: string, section: string): string {
    const rows = issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
    return `
        <div class="error-message">
            入力内容を確認してください。
            <ul>${rows}</ul>
        </div>
        <button class="btn-use" type="button"
                hx-get="/api/device/${escapeAttribute(connId)}/settings/edit/${escapeAttribute(section)}"
                hx-target="#settings-content">入力へ戻る</button>
    `;
}

function renderError(message: string): string {
    return `<div class="error-message">${escapeHtml(message)}</div>`;
}

function parseTimeInput(body: Record<string, string | File>): TimeSettingsInput {
    return {
        timezoneMode: bodyValue(body.timezoneMode) as TimeSettingsInput["timezoneMode"],
        timezoneOffset: bodyValue(body.timezoneOffset).trim(),
        date: bodyValue(body.date).trim(),
        time: bodyValue(body.time).trim(),
        ntpServer: bodyValue(body.ntpServer).trim(),
        ntpSyslog: bodyValue(body.ntpSyslog) === "on",
        ntpSourceMode: bodyValue(body.ntpSourceMode) as TimeSettingsInput["ntpSourceMode"],
        ntpSourceAddress: bodyValue(body.ntpSourceAddress).trim(),
        syncNtp: bodyValue(body.syncNtp) === "on",
    };
}

function bodyValue(value: string | File | undefined): string {
    return typeof value === "string" ? value : "";
}

function stringFields(body: Record<string, string | File>): SettingFields {
    return Object.fromEntries(
        Object.entries(body)
            .filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""]),
    );
}

function cleanExpiredPreviews(): void {
    const now = Date.now();
    for (const [id, preview] of pendingPreviews) {
        if (now - preview.createdAt > PREVIEW_LIFETIME_MS) pendingPreviews.delete(id);
    }
}

function cleanExpiredConfigImports(): void {
    const now = Date.now();
    for (const [id, pending] of pendingConfigImports) {
        if (now - pending.createdAt > PREVIEW_LIFETIME_MS) pendingConfigImports.delete(id);
    }
}

async function restoreGlobalCommandContext(connId: string, section: string): Promise<void> {
    const cleanupCommand = section === "provider"
        ? "pp select none"
        : section === "vpn"
            ? "tunnel select none"
            : "";
    if (!cleanupCommand) return;
    try {
        await executeCommand(connId, cleanupCommand);
    } catch {
        // The original transport error is more useful than a secondary cleanup error.
    }
}

function hasValidChangeToken(conn: DeviceConnection, candidate: string): boolean {
    const expected = Buffer.from(conn.changeToken);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isYamaha(conn: DeviceConnection): boolean {
    return conn.config.vendor.toUpperCase() === "YAMAHA";
}

function hidden(name: string, value: string): string {
    return `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value);
}

function looksLikeYamahaError(output: string): boolean {
    return /(?:^|\n)\s*(?:エラー|error)\s*[:：]/i.test(output)
        || /コマンドが正しくありません/.test(output);
}

function redactCommandOutput(output: string, command: string, preview: string): string {
    if (command === preview) return output;
    const markerIndex = preview.indexOf("••••••••");
    if (markerIndex < 0) return output.replaceAll(command, preview);
    const secret = command.slice(markerIndex);
    return secret ? output.replaceAll(secret, "••••••••") : output;
}

export default settings;
