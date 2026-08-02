import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import devices from "./routes/devices.js";
import commands from "./routes/commands.js";
import dashboard from "./routes/dashboard.js";
import terminal from "./routes/terminal.js";
import diagnostics from "./routes/diagnostics.js";
import settings from "./routes/settings.js";
import { renderTemplate } from "./lib/template.js";
import { listModels } from "./lib/config.js";
import { getBrowserSession, securityAndSessionMiddleware } from "./lib/auth.js";
import { getAppVersion } from "./lib/runtime.js";

const app = new Hono();

app.use("*", securityAndSessionMiddleware);
app.route("/", devices);
app.route("/", commands);
app.route("/", dashboard);
app.route("/", terminal);
app.route("/", diagnostics);
app.route("/", settings);

app.get("/", (c) => {
    const session = getBrowserSession(c);
    const models = listModels();
    const opts = models
        .map((m, index) => `<div class="model-option" id="model-option-${index}" role="option" aria-selected="false" tabindex="-1" data-value="${escapeHtml(m.model)}" data-transport="${m.transport}">${escapeHtml(m.vendor)} ${escapeHtml(m.model)}</div>`)
        .join("");
    return c.html(renderTemplate("index.html", {
        modelOptions: opts,
        csrfToken: escapeHtml(session.csrfToken),
        version: escapeHtml(getAppVersion()),
    }));
});

app.use(
    "/vendor/htmx/*",
    serveStatic({
        root: "./node_modules/htmx.org/dist",
        rewriteRequestPath: (path) => path.replace(/^\/vendor\/htmx/, ""),
    }),
);
app.use(
    "/vendor/fonts/*",
    serveStatic({
        root: "./node_modules/@fontsource",
        rewriteRequestPath: (path) => path.replace(/^\/vendor\/fonts/, ""),
    }),
);
app.use("/js/*", serveStatic({ root: "./web" }));
app.use("/css/*", serveStatic({ root: "./web" }));
app.use("/img/*", serveStatic({ root: "./web" }));

app.notFound((c) => {
    return c.html(
        renderTemplate("error.html", {
            code: "Error 404",
            title: "ページが見つかりません",
            message: "指定されたURLに対応するページがありません。URLを確認してもう一度お試しください。",
            version: escapeHtml(getAppVersion()),
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
            version: escapeHtml(getAppVersion()),
        }),
        500,
    );
});

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export default app;
