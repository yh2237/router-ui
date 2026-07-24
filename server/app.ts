import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Server } from "node:http";
import devices from "./routes/devices.js";
import commands from "./routes/commands.js";
import dashboard from "./routes/dashboard.js";
import terminal, { initTerminalWs } from "./routes/terminal.js";
import { renderTemplate } from "./lib/template.js";
import { listModels } from "./lib/config.js";

const app = new Hono();

app.route("/", devices);
app.route("/", commands);
app.route("/", dashboard);
app.route("/", terminal);

app.get("/", (c) => {
    const models = listModels();
    const opts = models
        .map((m) => `<div class="model-option" data-value="${escapeHtml(m.model)}" data-transport="${m.transport}">${escapeHtml(m.vendor)} ${escapeHtml(m.model)}</div>`)
        .join("");
    return c.html(renderTemplate("index.html", { modelOptions: opts }));
});

app.use("/js/*", serveStatic({ root: "./web" }));
app.use("/css/*", serveStatic({ root: "./web" }));
app.use("/img/*", serveStatic({ root: "./web" }));

app.notFound((c) => {
    return c.html(
        renderTemplate("error.html", {
            code: "Error 404",
            title: "ページが見つかりません",
            message: "指定されたURLに対応するページがありません。URLを確認してもう一度お試しください。",
        }),
        404,
    );
});

app.onError((err, c) => {
    console.error(err);
    return c.html(
        renderTemplate("error.html", {
            code: "Error 500",
            title: "サーバーエラー",
            message: "内部エラーが発生しました。しばらく経ってからもう一度お試しください。",
        }),
        500,
    );
});

export function setupWebSocket(server: Server): void {
    initTerminalWs(server);
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export default app;
