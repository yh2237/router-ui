import { Hono } from "hono";
import { listModels } from "../lib/config.js";
import { connect, disconnect, saveConnection, getSavedConnections, removeSavedConnection } from "../lib/connection.js";
import { renderTemplate } from "../lib/template.js";

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
                    <div style="display:flex;gap:4px">
                        <button class="btn-use" type="button" onclick="document.getElementById('host').value='${escJs(s.host)}';document.getElementById('port').value='${s.port}';document.getElementById('username').value='${escJs(s.username)}';window.setModel('${escJs(s.model)}', false)">使う</button>
                        <button class="btn-use" type="button" style="color:var(--status-down)" hx-delete="/api/saved-connections/${i}" hx-target="closest .saved-item" hx-swap="outerHTML">削除</button>
                    </div>
                </div>
            `,
        )
        .join("");
    return c.html(`<div class="saved-label">保存済みの接続</div>${items}`);
});

function escJs(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function escAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

devices.delete("/api/saved-connections/:index", (c) => {
    const index = parseInt(c.req.param("index"), 10);
    removeSavedConnection(index);
    return c.newResponse(null, { status: 200 });
});

devices.post("/api/connect", async (c) => {
    const body = await c.req.parseBody();
    const rawModel = (body.model as string || "").trim();
    const model = resolveModel(rawModel);
    const host = body.host as string;
    const port = body.port ? parseInt(body.port as string) : undefined;
    const username = body.username as string;
    const password = body.password as string;
    const authMethod = body.auth_method as string | undefined;
    const privateKey = body.private_key as string | undefined;
    const transport = body.transport as string | undefined;

    if (!model || !host || !username || (!Number.isInteger(port) && body.port) || (authMethod === "key" && !privateKey)) {
        return c.html(renderTemplate("connect-error.html", { error: "入力内容を確認してください" }), 400);
    }

    try {
        const connId = await connect({
            model, host, port,
            transport: transport as "ssh" | "telnet" | undefined,
            username,
            password: authMethod === "key" ? undefined : password,
            privateKey: authMethod === "key" ? privateKey : undefined,
        });
        saveConnection({ model, host, port, transport: transport as "ssh" | "telnet" | undefined, username });
        return c.html(renderTemplate("shell.html", { connId, model: escapeHtml(model), host: escapeHtml(host) }));
    } catch (err) {
        const msg = escapeHtml((err as Error).message);
        return c.html(renderTemplate("connect-error.html", { error: msg }), 500);
    }
});

devices.delete("/api/device/:connId", async (c) => {
    await disconnect(c.req.param("connId"));
    return c.html(renderTemplate("disconnected.html", {}));
});

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default devices;
