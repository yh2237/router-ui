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
            <span class="terminal-prefix" style="display:flex;align-items:center;gap:4px">
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
            var ws = null;
            var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
            function connect(){
                ws = new WebSocket(scheme + '//' + location.host + '/ws/terminal/' + connId);
                ws.onopen = function(){ appendLine('[接続しました]', 'system'); input.disabled = false; input.focus(); };
                ws.onmessage = function(e){ appendLine(e.data, 'output'); };
                ws.onclose = function(){ appendLine('[切断しました]', 'system'); input.disabled = true; setTimeout(connect, 3000); };
                ws.onerror = function(){ ws.close(); };
            }
            function appendLine(text, cls){
                var div = document.createElement('div');
                div.className = 'terminal-line ' + cls;
                div.textContent = text;
                output.appendChild(div);
                output.scrollTop = output.scrollHeight;
            }
            input.addEventListener('keydown', function(e){
                if(e.key === 'Enter' && input.value.trim() && ws && ws.readyState === WebSocket.OPEN){
                    ws.send(input.value);
                    appendLine('> ' + input.value, 'prompt');
                    input.value = '';
                }
            });
            connect();
        })();
    </script>
    `);
});

export default terminal;
