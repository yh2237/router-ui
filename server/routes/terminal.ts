import { Hono } from "hono";
import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import { executeCommand, getConnection } from "../lib/connection.js";

let wss: WebSocketServer | null = null;

export function initTerminalWs(server: Server): void {
    wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "", "http://localhost");
        const match = url.pathname.match(/^\/ws\/terminal\/(.+)$/);
        if (!match) { socket.destroy(); return; }
        const connId = match[1];
        const conn = getConnection(connId);
        if (!conn) { socket.destroy(); return; }

        wss!.handleUpgrade(request, socket, head, (ws) => {
            ws.on("message", async (data) => {
                const cmd = data.toString().trim();
                if (!cmd) return;
                try {
                    const output = await executeCommand(connId, cmd);
                    ws.send(output);
                } catch (err) {
                    ws.send(`Error: ${(err as Error).message}`);
                }
            });
        });
    });
}

const terminal = new Hono();

terminal.get("/api/device/:connId/terminal", (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    return c.html(`
    <div class="terminal-container">
        <div id="terminal-output" class="terminal-output-area"></div>
        <div class="terminal-input-line">
            <span class="terminal-prefix">
                <span class="status-dot up"></span>
                <span>></span>
            </span>
            <input type="text" id="terminal-input" class="terminal-input" placeholder="コマンドを入力..." autofocus>
        </div>
    </div>
    <script>
        (function(){
            var connId = "${connId}";
            var output = document.getElementById('terminal-output');
            var input = document.getElementById('terminal-input');
            var history = [];
            var historyIndex = -1;
            function appendLine(text, cls){
                var div = document.createElement('div');
                div.className = 'terminal-line ' + cls;
                div.textContent = text;
                output.appendChild(div);
                output.scrollTop = output.scrollHeight;
            }
            input.addEventListener('keydown', function(e){
                if(e.key === 'Enter' && input.value.trim() && !input.disabled){
                    var command = input.value;
                    history.push(command);
                    historyIndex = history.length;
                    appendLine('> ' + command, 'prompt');
                    input.value = '';
                    input.disabled = true;
                    appendLine('[実行中…]', 'system');
                    fetch('/api/device/' + connId + '/terminal/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ cmd: command })
                    }).then(function(response){ return response.text(); }).then(function(text){
                        output.lastChild && output.lastChild.remove();
                        appendLine(text, 'output');
                    }).catch(function(error){
                        output.lastChild && output.lastChild.remove();
                        appendLine('Error: ' + error.message, 'system');
                    }).finally(function(){ input.disabled = false; input.focus(); });
                } else if (e.key === 'ArrowUp' && history.length) {
                    e.preventDefault();
                    historyIndex = Math.max(0, historyIndex - 1);
                    input.value = history[historyIndex];
                } else if (e.key === 'ArrowDown' && history.length) {
                    e.preventDefault();
                    historyIndex = Math.min(history.length, historyIndex + 1);
                    input.value = historyIndex === history.length ? '' : history[historyIndex];
                }
            });
            window.routerUiTerminalCleanup = function(){
                window.routerUiTerminalCleanup = null;
            };
            appendLine('[接続済み]', 'system');
            input.disabled = false;
            input.focus();
        })();
    </script>
    `);
});

terminal.post("/api/device/:connId/terminal/execute", async (c) => {
    const connId = c.req.param("connId");
    if (!getConnection(connId)) return c.text("Error: Device not connected", 404);
    const body = await c.req.parseBody();
    const cmd = (body.cmd as string | undefined)?.trim();
    if (!cmd) return c.text("Error: Command is required", 400);
    try {
        return c.text(await executeCommand(connId, cmd));
    } catch (err) {
        return c.text(`Error: ${(err as Error).message}`, 500);
    }
});

export default terminal;
