import { Hono } from "hono";
import { listModels } from "../lib/config.js";
import { connect, disconnect, saveConnection, getSavedConnections, removeSavedConnection } from "../lib/connection.js";
import { renderTemplate } from "../lib/template.js";
import { getBrowserSession } from "../lib/auth.js";
import { getAppVersion } from "../lib/runtime.js";
import { forgetKnownHost, listKnownHosts } from "../lib/host-keys.js";

const devices = new Hono();

devices.get("/api/models", (c) => {
    const models = listModels();
    if (models.length === 0) {
        return c.html(
            `<div class="error-message">対応機種がありません。devices/models.yaml に機種を追加してください</div>`,
        );
    }
    const opts = models
        .map((m) => `<option value="${m.vendor} ${m.model}">`)
        .join("");
    return c.html(`<datalist id="model-list">${opts}</datalist>`);
});

function resolveModel(input: string): string | null {
    const models = listModels();
    const exact = models.find((m) => m.model === input);
    if (exact) return exact.model;
    const combined = models.find((m) => `${m.vendor} ${m.model}` === input);
    if (combined) return combined.model;
    return null;
}

devices.get("/api/saved-connections", (c) => {
    const saved = getSavedConnections();
    if (saved.length === 0) return c.html("");
    const items = saved
        .map(
            (s, i) => `
                <div class="saved-item">
                    <span class="saved-info">${escAttr(s.label)}<span class="saved-host">${escAttr(s.host)}:${s.port}</span></span>
                    <div class="saved-actions">
                        <button class="btn-use" type="button"
                            data-saved-host="${escAttr(s.host)}"
                            data-saved-port="${s.port}"
                            data-saved-username="${escAttr(s.username)}"
                            data-saved-model="${escAttr(s.model)}"
                            data-saved-transport="${s.transport}">使う</button>
                        <button class="btn-use btn-use--danger" type="button" hx-delete="/api/saved-connections/${i}" hx-target="closest .saved-item" hx-swap="outerHTML">削除</button>
                    </div>
                </div>
            `,
        )
        .join("");
    return c.html(`<div class="saved-label">保存済みの接続</div>${items}`);
});

function escAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

devices.delete("/api/saved-connections/:index", (c) => {
    const index = parseInt(c.req.param("index"), 10);
    removeSavedConnection(index);
    return c.newResponse(null, { status: 200 });
});

devices.get("/api/known-hosts", (c) => {
    const hosts = Object.entries(listKnownHosts());
    if (hosts.length === 0) {
        return c.html(`
            <div class="known-hosts-note">
                SSH接続時にホスト鍵を初回保存し、次回以降の変更を拒否します。
            </div>
        `);
    }
    const rows = hosts.map(([endpoint, known]) => `
        <div class="known-host-item">
            <span>
                <strong>${escAttr(endpoint)}</strong>
                <code>${escAttr(known.fingerprint)}</code>
            </span>
            <form hx-post="/api/known-hosts/forget" hx-target="closest .known-host-item" hx-swap="outerHTML"
                hx-confirm="${escAttr(endpoint)} の保存済みSSHホスト鍵を削除しますか？">
                <input type="hidden" name="endpoint" value="${escAttr(endpoint)}">
                <button class="btn-use btn-use--danger" type="submit">削除</button>
            </form>
        </div>
    `).join("");
    return c.html(`<div class="known-hosts-label">保存済みSSHホスト鍵</div>${rows}`);
});

devices.post("/api/known-hosts/forget", async (c) => {
    const body = await c.req.parseBody();
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint || !forgetKnownHost(endpoint)) {
        return c.html(`<div class="error-message">保存済みホスト鍵が見つかりません。</div>`, 404);
    }
    return c.body(null, 200);
});

devices.post("/api/connect", async (c) => {
    const ownerSessionId = getBrowserSession(c).id;
    const body = await c.req.parseBody();
    const rawModel = (body.model as string || "").trim();
    const model = resolveModel(rawModel);
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = body.port ? parseInt(body.port as string) : undefined;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = body.password as string;
    const authMethod = body.auth_method as string | undefined;
    const privateKey = body.private_key as string | undefined;
    const transport = body.transport as string | undefined;

    if (
        !model
        || !isValidHost(host)
        || !username
        || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
        || (authMethod !== "password" && authMethod !== "key")
        || (authMethod === "key" && !privateKey)
        || (transport !== "ssh" && transport !== "telnet")
        || (transport === "telnet" && authMethod !== "password")
    ) {
        return c.html(renderTemplate("connect-error.html", {
            error: "入力内容を確認してください",
            version: escapeHtml(getAppVersion()),
        }), 400);
    }

    try {
        const connId = await connect({
            ownerSessionId,
            model, host, port,
            transport: transport as "ssh" | "telnet" | undefined,
            username,
            password: authMethod === "key" ? undefined : password,
            privateKey: authMethod === "key" ? privateKey : undefined,
        });
        saveConnection({
            ownerSessionId,
            model,
            host,
            port,
            transport: transport as "ssh" | "telnet" | undefined,
            username,
        });
        return c.html(renderTemplate("shell.html", { connId, model: escapeHtml(model), host: escapeHtml(host) }));
    } catch (err) {
        const msg = escapeHtml((err as Error).message);
        return c.html(renderTemplate("connect-error.html", {
            error: msg,
            version: escapeHtml(getAppVersion()),
        }), 500);
    }
});

devices.delete("/api/device/:connId", async (c) => {
    await disconnect(c.req.param("connId"), getBrowserSession(c).id);
    return c.html(renderTemplate("disconnected.html", { version: escapeHtml(getAppVersion()) }));
});

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isValidHost(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const host = value.trim();
    return host.length > 0
        && host.length <= 253
        && !/[\s"'<>\\/?#]/.test(host);
}

export default devices;
