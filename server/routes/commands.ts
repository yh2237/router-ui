import { Hono } from "hono";
import { executeCommand, getConnection } from "../lib/connection.js";
import { parseOutput } from "../lib/parsers.js";

const commands = new Hono();

commands.get("/api/device/:connId/settings", (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    const { config } = conn;
    const cats = collectCategories(config.commands);
    const firstCat = cats[0]?.key ?? "";

    const sidebar = cats
        .map(
            (cat, i) => `
                <button class="category-item${i === 0 ? " active" : ""}" hx-get="/api/device/${connId}/settings/category/${cat.key}" hx-target="#settings-content" onclick="this.closest('.settings-sidebar').querySelectorAll('.category-item').forEach(function(item){item.classList.remove('active')});this.classList.add('active')">${cat.label}</button>
            `,
        )
        .join("");

    return c.html(`
        <div class="settings-layout">
            <div class="settings-sidebar">${sidebar}</div>
            <div class="settings-content" id="settings-content" hx-get="/api/device/${connId}/settings/category/${firstCat}" hx-trigger="load">
                <div class="spinner htmx-indicator"></div>
            </div>
        </div>
    `);
});

commands.get("/api/device/:connId/settings/category/:catKey", (c) => {
    const connId = c.req.param("connId");
    const catKey = c.req.param("catKey");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    const matched = Object.entries(conn.config.commands).filter(
        ([, cmd]) => (cmd.category ?? "other") === catKey,
    );

    if (matched.length === 0) {
        return c.html(`<div class="empty-state"><p>このカテゴリにコマンドはありません</p></div>`);
    }

    const cards = matched
        .map(
            ([key, cmd]) => `
                <div class="command-card">
                    <div class="command-card-body">
                        <div class="command-label">${cmd.label ?? key}</div>
                        <div class="command-desc">${cmd.description ?? cmd.cmd}</div>
                    </div>
                    <button class="btn-execute" hx-post="/api/device/${connId}/commands/${key}/execute" hx-target="#cmd-output-${key}" hx-indicator="#cmd-spin-${key}">実行</button>
                    <span id="cmd-spin-${key}" class="spinner htmx-indicator"></span>
                    <div id="cmd-output-${key}" class="command-output"></div>
                </div>
                `,
        )
        .join("");

    return c.html(`<div class="commands-list">${cards}</div>`);
});

commands.post("/api/device/:connId/commands/:cmdKey/execute", async (c) => {
    const connId = c.req.param("connId");
    const cmdKey = c.req.param("cmdKey");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    const cmdConfig = conn.config.commands[cmdKey];
    if (!cmdConfig) return c.html(`<div class="error-message">Unknown command: ${cmdKey}</div>`, 404);

    try {
        const raw = await executeCommand(connId, cmdConfig.cmd);
        const parsed = parseOutput(raw, cmdConfig.parse);
        return c.html(renderResult(raw, parsed));
    } catch (err) {
        return c.html(
            `<div class="error-message">コマンドの実行に失敗しました<span class="error-detail">機器からの応答: ${escapeHtml((err as Error).message)}</span></div>`,
            500,
        );
    }
});

function collectCategories(
    commands: Record<string, { label?: string; category?: string }>,
): { key: string; label: string }[] {
    const catLabels: Record<string, string> = {
        interface: "インターフェース",
        routing: "ルーティング",
        system: "システム",
        resource: "リソース",
        traffic: "トラフィック",
        network: "ARP・近隣情報",
        dhcp_dns: "DHCP・DNS",
        sessions: "セッション・NAT",
        wan_vpn: "WAN・VPN",
        logs: "ログ",
        security: "管理・セキュリティ",
        configuration: "設定確認",
        other: "その他",
    };
    const seen = new Set<string>();
    const result: { key: string; label: string }[] = [];
    for (const cmd of Object.values(commands)) {
        const cat = cmd.category ?? "other";
        if (!seen.has(cat)) {
            seen.add(cat);
            result.push({ key: cat, label: catLabels[cat] ?? cat });
        }
    }
    return result;
}

function renderResult(raw: string, parsed: ReturnType<typeof parseOutput>): string {
    if (parsed.type === "raw") {
        return `<pre class="terminal-output">${escapeHtml(raw)}</pre>`;
    }
    if (parsed.type === "keyvalue" && parsed.data) {
        const rows = Object.entries(parsed.data)
            .map(([k, v]) => `<tr><td class="kv-key">${escapeHtml(k)}</td><td class="kv-val">${escapeHtml(v)}</td></tr>`)
            .join("");
        return `<table class="result-table"><tbody>${rows}</tbody></table>`;
    }
    if (parsed.type === "table" && parsed.columns && parsed.rows) {
        const thead = `<thead><tr>${parsed.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
        const tbody = parsed.rows
            .map(
                (row) =>
                    `<tr>${parsed.columns!.map((col) => `<td>${escapeHtml(row[col] ?? "")}</td>`).join("")}</tr>`,
            )
            .join("");
        return `<table class="result-table">${thead}${tbody}</table>`;
    }
    return `<pre class="terminal-output">${escapeHtml(raw)}</pre>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default commands;
