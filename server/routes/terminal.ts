import { Hono } from "hono";
import { executeCommand, getConnection } from "../lib/connection.js";
import { getBrowserSession } from "../lib/auth.js";

const terminal = new Hono();

terminal.get("/api/device/:connId/terminal", (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId, getBrowserSession(c).id);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    return c.html(`
    <div class="terminal-container" data-terminal data-conn-id="${escapeAttribute(connId)}">
        <div id="terminal-output" class="terminal-output-area"></div>
        <div class="terminal-input-line">
            <span class="terminal-prefix">
                <span class="status-dot up"></span>
                <span>></span>
            </span>
            <input type="text" id="terminal-input" class="terminal-input" placeholder="コマンドを入力..." autofocus>
        </div>
    </div>
    `);
});

terminal.post("/api/device/:connId/terminal/execute", async (c) => {
    const connId = c.req.param("connId");
    const ownerSessionId = getBrowserSession(c).id;
    if (!getConnection(connId, ownerSessionId)) return c.text("Error: Device not connected", 404);
    const body = await c.req.parseBody();
    const cmd = (body.cmd as string | undefined)?.trim();
    if (!cmd) return c.text("Error: Command is required", 400);
    try {
        return c.text(await executeCommand(connId, ownerSessionId, cmd));
    } catch (err) {
        return c.text(`Error: ${(err as Error).message}`, 500);
    }
});

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default terminal;
