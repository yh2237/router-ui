import { Hono } from "hono";
import { executeCommand, getConnection } from "../lib/connection.js";

const diagnostics = new Hono();

type DiagnosticKind = "ping" | "traceroute";

diagnostics.get("/api/device/:connId/diagnostics", (c) => {
    const connId = c.req.param("connId");
    if (!getConnection(connId)) {
        return c.html(`<div class="error-message">Device not connected</div>`, 404);
    }

    return c.html(`
        <div class="diagnostics-layout">
            <section class="diagnostic-panel">
                <div class="diagnostic-heading">
                    <h2>ネットワーク診断</h2>
                    <p>ルーター自身から宛先への疎通と経路を確認します。</p>
                </div>
                <form class="diagnostic-form"
                    hx-post="/api/device/${connId}/diagnostics/run"
                    hx-target="#diagnostic-output"
                    hx-indicator="#diagnostic-spinner">
                    <div class="form-field diagnostic-target">
                        <label for="diagnostic-target">宛先</label>
                        <input class="form-input" id="diagnostic-target" name="target"
                            placeholder="192.0.2.1 または example.net"
                            inputmode="url" autocomplete="off" required>
                        <span class="field-help">IPアドレスまたはホスト名を入力してください。</span>
                    </div>
                    <div class="form-field">
                        <label for="diagnostic-kind">診断方法</label>
                        <select class="form-input" id="diagnostic-kind" name="kind">
                            <option value="ping">Ping</option>
                            <option value="traceroute">Traceroute</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label for="diagnostic-count">送信回数</label>
                        <input class="form-input" id="diagnostic-count" name="count"
                            type="number" min="1" max="10" value="4">
                    </div>
                    <button class="btn-primary" type="submit">診断を実行</button>
                    <span id="diagnostic-spinner" class="spinner htmx-indicator" aria-label="診断中"></span>
                </form>
            </section>
            <section class="diagnostic-result" aria-live="polite">
                <div class="diagnostic-result-header">
                    <h2>結果</h2>
                </div>
                <div id="diagnostic-output" class="diagnostic-output">
                    <div class="empty-state">宛先と診断方法を指定して実行してください。</div>
                </div>
            </section>
        </div>
    `);
});

diagnostics.post("/api/device/:connId/diagnostics/run", async (c) => {
    const connId = c.req.param("connId");
    if (!getConnection(connId)) {
        return c.html(`<div class="error-message">Device not connected</div>`, 404);
    }

    const body = await c.req.parseBody();
    const kind = String(body.kind ?? "") as DiagnosticKind;
    const target = String(body.target ?? "").trim();
    const count = Number.parseInt(String(body.count ?? "4"), 10);

    try {
        const command = buildDiagnosticCommand(kind, target, count);
        const output = await executeCommand(connId, command);
        return c.html(`
            <div class="diagnostic-command">$ ${escapeHtml(command)}</div>
            <pre class="terminal-output">${escapeHtml(output)}</pre>
        `);
    } catch (error) {
        const message = error instanceof Error ? error.message : "診断に失敗しました";
        const status = message.startsWith("Invalid") ? 400 : 500;
        return c.html(
            `<div class="error-message">診断を実行できませんでした<span class="error-detail">${escapeHtml(message)}</span></div>`,
            status,
        );
    }
});

export function buildDiagnosticCommand(kind: DiagnosticKind, target: string, count: number): string {
    if (kind !== "ping" && kind !== "traceroute") {
        throw new Error("Invalid diagnostic type");
    }
    if (!isValidDiagnosticTarget(target)) {
        throw new Error("Invalid target. Use an IP address or hostname.");
    }
    if (!Number.isInteger(count) || count < 1 || count > 10) {
        throw new Error("Invalid count. Enter a value from 1 to 10.");
    }
    return kind === "ping" ? `ping -c ${count} ${target}` : `traceroute ${target}`;
}

function isValidDiagnosticTarget(target: string): boolean {
    if (target.length < 1 || target.length > 253) return false;
    if (!/^[A-Za-z0-9.:_-]+$/.test(target)) return false;
    if (target.startsWith("-") || target.endsWith("-")) return false;
    return true;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default diagnostics;
