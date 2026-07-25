import { Hono } from "hono";
import { executeCommand, getConnection } from "../lib/connection.js";
import { parseOutput, type ParsedResult } from "../lib/parsers.js";
import { renderDevicePanel, type PanelRuntimeState } from "../lib/device-panel.js";
import type { ResolvedConfig } from "../lib/types.js";

const dashboard = new Hono();

const CARD_DEFS: { key: string; label: string }[] = [
    { key: "system", label: "システム情報" },
    { key: "resource", label: "リソース情報" },
    { key: "traffic", label: "トラフィック情報" },
    { key: "interface", label: "インターフェース情報" },
    { key: "routing", label: "ルーティング情報" },
];

interface TrafficSample {
    at: number;
    transmittedOctets: number;
    receivedOctets: number;
}

const trafficHistory = new Map<string, TrafficSample[]>();

dashboard.get("/api/device/:connId/dashboard", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    const cards = CARD_DEFS
        .map((def) => `
            <div class="dashboard-card dashboard-card--${def.key}">
                <div class="dashboard-card-header">
                    <h3>${def.label}</h3>
                    <span id="dash-spin-${def.key}" class="spinner htmx-indicator"></span>
                    <button class="btn-refresh" aria-label="${def.label}を更新" hx-post="/api/device/${connId}/dashboard/card/${def.key}" hx-target="#dash-body-${def.key}" hx-indicator="#dash-spin-${def.key}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7"/></svg></button>
                </div>
                <div class="dashboard-card-body" id="dash-body-${def.key}"
                    hx-post="/api/device/${connId}/dashboard/card/${def.key}"
                    hx-trigger="${def.key === "traffic" ? "load, every 5s" : "load"}" hx-target="this" hx-indicator="#dash-spin-${def.key}">
                    <div class="dash-loading">読み込み中...</div>
                </div>
            </div>
        `)
        .join("");

    return c.html(`<div class="dashboard-grid">${cards}</div>`);
});

dashboard.post("/api/device/:connId/dashboard/card/:category", async (c) => {
    const connId = c.req.param("connId");
    const category = c.req.param("category");
    const conn = getConnection(connId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`);

    try {
        switch (category) {
            case "system":
                return await renderSystemCard(conn.config, connId);
            case "interface":
                return await renderInterfaceCard(conn.config, connId);
            case "routing":
                return await renderRoutingCard(conn.config, connId);
            case "resource":
                return await renderResourceCard(conn.config, connId);
            case "traffic":
                return await renderTrafficCard(conn.config, connId);
            default:
                return c.html(`<div class="error-message">不明なカテゴリです</div>`);
        }
    } catch (err) {
        return c.html(
            `<div class="error-message">取得に失敗しました<span class="error-detail">機器からの応答: ${escapeHtml((err as Error).message)}</span></div>`,
        );
    }
});

async function execAndCache(config: ResolvedConfig, connId: string, cmdKey: string): Promise<ParsedResult> {
    const cmdConfig = config.commands[cmdKey];
    if (!cmdConfig) throw new Error(`Unknown command: ${cmdKey}`);
    const raw = await executeCommand(connId, cmdConfig.cmd);
    return parseOutput(raw, cmdConfig.parse);
}

async function renderSystemCard(config: ResolvedConfig, connId: string): Promise<Response> {
    const sysCmds = Object.entries(config.commands).filter(([, cmd]) => cmd.category === "system");
    if (sysCmds.length === 0) return noDataHtml();

    for (const [cmdKey] of sysCmds) {
        try {
            const parsed = await execAndCache(config, connId, cmdKey);
            if (parsed.type === "keyvalue" && parsed.data && Object.keys(parsed.data).length > 0) {
                const d = parsed.data;
                const rows = [
                    { label: "モデル", value: pick(d, ["Model", "モデル", "機種", "Product Name", "Machine", "Product"]) },
                    { label: "シリアルNo.", value: pick(d, ["Serial Number", "Serial No.", "シリアル番号", "Serial", "S/N"]) },
                    { label: "ファームウェア", value: pick(d, ["Firmware Revision", "Rev", "Firmware version", "Firmware Rev.", "F/W Rev", "Firmware", "システムのリビジョン"]) },
                    { label: "MACアドレス", value: pick(d, ["MAC Address", "MACアドレス", "MAC"]) },
                    { label: "稼働時間", value: pick(d, ["Uptime", "起動時間", "Up Time", "Uptime", "System up time"]) },
                    { label: "CPU", value: pick(d, ["CPU", "CPU Load", "CPU使用率", "CPU load", "CPU utilization", "CPU の使用量"]) },
                    { label: "メモリ", value: pick(d, ["Memory", "メモリ", "Memory Usage", "Memory utilization", "Mem", "メモリの使用量"]) },
                ];
                const items = rows
                    .filter((r): r is { label: string; value: string } => !!r.value)
                    .map((r) => `<div class="kv-row"><span class="kv-key">${r.label}</span><span class="kv-val">${escapeHtml(r.value)}</span></div>`)
                    .join("");
                if (items) return cHtml(`<div class="dash-system-info">${items}</div>`);
            }
            return cHtml(`<pre class="terminal-dash">${escapeHtml(parsed.raw)}</pre>`);
        } catch {
            // try next fallback command
        }
    }

    return noDataHtml("システム情報を取得できませんでした");
}

async function renderInterfaceCard(config: ResolvedConfig, connId: string): Promise<Response> {
    const ifaceCmds = Object.entries(config.commands).filter(([, cmd]) => cmd.category === "interface");
    if (ifaceCmds.length === 0) return noDataHtml();

    const items: string[] = [];
    const panelState: PanelRuntimeState = {
        "system.power": { status: "up", detail: "接続中" },
    };
    for (const [key] of ifaceCmds) {
        try {
            const parsed = await execAndCache(config, connId, key);
            const sourceName = key.replace(/^show_status_?/, "").toLowerCase();

            if (parsed.type === "table" && parsed.rows && parsed.rows.length > 0) {
                const nameCol = (parsed.columns ?? []).find(
                    (c) => /interface|iface|lan|port/i.test(c),
                ) || (parsed.columns?.[0] ?? "IF");
                for (const row of parsed.rows) {
                    const name = row[nameCol] || row[parsed.columns?.[0] ?? ""] || "?";
                    const rawStatus = (row["Status"] || row["状態"] || row["status"] || "").toLowerCase();
                    const status = rawStatus.includes("up") ? "up" : rawStatus.includes("down") ? "down" : "unknown";
                    const ipAddr = row["IP Address"] || row["IPアドレス"] || "-";
                    const speed = row["Speed"] || row["速度"] || "-";
                    panelState[`interface.${name.toLowerCase()}`] = {
                        status,
                        detail: [ipAddr, speed].filter((value) => value && value !== "-").join(" · "),
                    };
                    items.push(ifaceRowHtml(name, status, ipAddr, speed));
                }
            } else {
                const ifaceName = key.replace(/^show_status_?/, "").toUpperCase() || "STATUS";
                let status: "up" | "down" | "warning" | "unknown" = "unknown";
                let ipAddr = "-";
                let speed = "-";

                if (parsed.type === "keyvalue" && parsed.data) {
                    const d = parsed.data;
                    const rawStatus = pick(d, ["Status", "状態", "Link", "Link Status", "リンク状態", "リンク"]) || "";
                    status = detectInterfaceStatus(rawStatus);
                    ipAddr = pick(d, ["IP Address", "IPアドレス", "ip address"]) || "-";
                    speed = pick(d, ["Speed", "速度"]) || "-";
                }

                if (status === "unknown") status = detectInterfaceStatus(parsed.raw);
                panelState[`interface.${sourceName}`] = {
                    status,
                    detail: [ipAddr, speed].filter((value) => value && value !== "-").join(" · "),
                };
                Object.assign(panelState, parsePhysicalPortStates(sourceName, parsed.raw));
                items.push(ifaceRowHtml(ifaceName, status, ipAddr, speed));
            }
        } catch {
            const name = key.replace(/^show_status_?/, "").toUpperCase() || "?";
            panelState[`interface.${name.toLowerCase()}`] = { status: "error", detail: "取得失敗" };
            items.push(ifaceRowHtml(name, "unknown", "エラー", "-", true));
        }
    }

    const panel = config.panel ? renderDevicePanel(config.panel, panelState) : "";
    return cHtml(`${panel}<div class="dash-iface-list">${items.join("")}</div>`);
}

async function renderRoutingCard(config: ResolvedConfig, connId: string): Promise<Response> {
    const cmdEntry = Object.entries(config.commands).find(([, cmd]) => cmd.category === "routing");
    if (!cmdEntry) return noDataHtml();

    const parsed = await execAndCache(config, connId, cmdEntry[0]);

    if (parsed.type === "table" && parsed.columns && parsed.rows) {
        const thead = `<thead><tr>${parsed.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
        const tbody = parsed.rows
            .slice(0, 20)
            .map((row) => `<tr>${parsed.columns!.map((col) => `<td>${escapeHtml(row[col] ?? "")}</td>`).join("")}</tr>`)
            .join("");
        const extra = parsed.rows.length > 20 ? `<div class="dash-more">...他 ${parsed.rows.length - 20} 件</div>` : "";
        return cHtml(`<table class="result-table dash-route-table">${thead}${tbody}</table>${extra}`);
    }

    if (parsed.type === "keyvalue" && parsed.data) {
        const rows = Object.entries(parsed.data)
            .map(([k, v]) => `<tr><td class="kv-key">${escapeHtml(k)}</td><td class="kv-val">${escapeHtml(v)}</td></tr>`)
            .join("");
        return cHtml(`<table class="result-table"><tbody>${rows}</tbody></table>`);
    }

    return cHtml(`<pre class="terminal-dash">${escapeHtml(parsed.raw)}</pre>`);
}

async function renderResourceCard(config: ResolvedConfig, connId: string): Promise<Response> {
    const systemCmd = Object.entries(config.commands).find(([, cmd]) => cmd.category === "system");

    let d: Record<string, string> | null = null;

    if (systemCmd) {
        try {
            const parsed = await execAndCache(config, connId, systemCmd[0]);
            if (parsed.type === "keyvalue" && parsed.data && Object.keys(parsed.data).length > 0) {
                d = parsed.data;
            }
        } catch {
            // おおなとき
        }
    }

    if (!d) {
        const resourceCmd = Object.entries(config.commands).find(([, cmd]) => cmd.category === "resource");
        if (!resourceCmd) return noDataHtml("リソース情報はこの機種では利用できません");
        try {
            const parsed = await execAndCache(config, connId, resourceCmd[0]);
            if (parsed.type !== "keyvalue" || !parsed.data) {
                return cHtml(`<pre class="terminal-dash">${escapeHtml(parsed.raw)}</pre>`);
            }
            d = parsed.data;
        } catch {
            return noDataHtml("リソース情報はこの機種では利用できません");
        }
    }

    if (!d) return noDataHtml("リソース情報はこの機種では利用できません");

    const cpuRaw = pick(d, ["CPU", "CPU Load", "CPU使用率", "CPU load", "CPU utilization", "CPU の使用量", "cpu"]);
    const memRaw = pick(d, ["Memory", "メモリ", "Memory Usage", "Memory utilization", "Mem", "メモリの使用量", "memory"]);

    const cpuPercent = extractPercent(cpuRaw);
    const memPercent = extractPercent(memRaw);

    const items: string[] = [];

    if (cpuPercent !== null) {
        items.push(`
            <div class="meter-row">
                <span class="meter-label">CPU</span>
                <span class="meter-value">${cpuPercent}%</span>
                <div class="meter-bar"><div class="meter-fill" style="width:${cpuPercent}%"></div></div>
            </div>
        `);
    } else if (cpuRaw) {
        items.push(`
            <div class="kv-row"><span class="kv-key">CPU</span><span class="kv-val">${escapeHtml(cpuRaw!)}</span></div>
        `);
    }

    if (memPercent !== null) {
        items.push(`
            <div class="meter-row">
                <span class="meter-label">メモリ</span>
                <span class="meter-value">${memPercent}%</span>
                <div class="meter-bar"><div class="meter-fill" style="width:${memPercent}%"></div></div>
            </div>
        `);
    } else if (memRaw) {
        items.push(`
            <div class="kv-row"><span class="kv-key">メモリ</span><span class="kv-val">${escapeHtml(memRaw!)}</span></div>
        `);
    }

    if (items.length > 0) {
        return cHtml(`<div class="dash-resource">${items.join("")}</div>`);
    }

    const uptime = pick(d, ["Uptime", "起動時間", "Up Time", "System up time"]);
    if (uptime) {
        return cHtml(`<div class="kv-row"><span class="kv-key">稼働時間</span><span class="kv-val">${escapeHtml(uptime)}</span></div>`);
    }

    return noDataHtml("リソース情報はこの機種では利用できません");
}

async function renderTrafficCard(config: ResolvedConfig, connId: string): Promise<Response> {
    const command = config.commands.show_status_lan1;
    if (!command) return noDataHtml("トラフィック情報はこの機種では利用できません");

    const raw = await executeCommand(connId, command.cmd);
    const counters = parseTrafficCounters(raw);
    if (!counters) return noDataHtml("LAN1の送受信カウンタを取得できませんでした");

    const samples = trafficHistory.get(connId) ?? [];
    samples.push({ at: Date.now(), ...counters });
    while (samples.length > 60) samples.shift();
    trafficHistory.set(connId, samples);

    const rates = samples.slice(1).map((sample, index) => {
        const previous = samples[index];
        const elapsedSeconds = (sample.at - previous.at) / 1000;
        return {
            at: sample.at,
            tx: elapsedSeconds > 0 ? Math.max(0, (sample.transmittedOctets - previous.transmittedOctets) * 8 / elapsedSeconds) : 0,
            rx: elapsedSeconds > 0 ? Math.max(0, (sample.receivedOctets - previous.receivedOctets) * 8 / elapsedSeconds) : 0,
        };
    });

    if (rates.length === 0) {
        return cHtml(`<div class="traffic-wait">最初のサンプルを取得しました。5秒後に転送量を表示します。</div>`);
    }

    const max = Math.max(1, ...rates.flatMap((rate) => [rate.tx, rate.rx]));
    const makePoints = (key: "tx" | "rx") => rates.map((rate, index) => {
        const x = rates.length === 1 ? 0 : (index / (rates.length - 1)) * 100;
        const y = 100 - (rate[key] / max) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    const latest = rates[rates.length - 1];

    return cHtml(`
        <div class="traffic-summary">
            <span><i class="traffic-key traffic-rx"></i>受信 <strong>${formatBitRate(latest.rx)}</strong></span>
            <span><i class="traffic-key traffic-tx"></i>送信 <strong>${formatBitRate(latest.tx)}</strong></span>
        </div>
        <svg class="traffic-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="LAN1の送受信トラフィック履歴">
            <path class="traffic-grid" d="M0 25H100M0 50H100M0 75H100" />
            <polyline class="traffic-line traffic-line-rx" points="${makePoints("rx")}" />
            <polyline class="traffic-line traffic-line-tx" points="${makePoints("tx")}" />
        </svg>
        <div class="traffic-scale">直近 ${rates.length * 5}秒 · 最大 ${formatBitRate(max)}</div>
    `);
}

export function parseTrafficCounters(raw: string): { transmittedOctets: number; receivedOctets: number } | null {
    const transmitted = raw.match(/^Transmitted:\s+\d+ packets \((\d+) octets\)/m);
    const received = raw.match(/^Received:\s+\d+ packets \((\d+) octets\)/m);
    if (!transmitted || !received) return null;
    return { transmittedOctets: Number(transmitted[1]), receivedOctets: Number(received[1]) };
}

function formatBitRate(bitsPerSecond: number): string {
    const units = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"];
    let value = bitsPerSecond;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index++;
    }
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function noDataHtml(msg = "データがありません"): Response {
    return cHtml(`<div class="dash-empty-state">${msg}</div>`);
}

function pick(d: Record<string, string>, keys: string[]): string | undefined {
    for (const k of keys) {
        const lower = k.toLowerCase();
        const found = Object.keys(d).find((dk) => dk.toLowerCase() === lower);
        if (found) return d[found];
    }
    return undefined;
}

function extractPercent(raw: string | undefined): number | null {
    if (!raw) return null;
    const m = raw.match(/(\d+)\s*%/);
    return m ? parseInt(m[1], 10) : null;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cHtml(html: string, status = 200): Response {
    return new Response(html, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

function ifaceRowHtml(name: string, status: string, ip: string, speed: string, isError = false): string {
    const ipSpan = isError
        ? `<span class="iface-ip iface-ip-muted">${escapeHtml(ip)}</span>`
        : `<span class="iface-ip">${escapeHtml(ip)}</span>`;
    return `
        <div class="iface-row">
            <span class="iface-name"><span class="status-dot ${status}"></span> ${escapeHtml(name)}</span>
            ${ipSpan}
            <span class="iface-speed">${escapeHtml(speed)}</span>
        </div>
    `;
}

export function detectInterfaceStatus(value: string): "up" | "down" | "warning" | "unknown" {
    const normalized = value.toLowerCase();
    if (/(?:\bdown\b|link\s*down|リンクダウン|未接続|切断)/i.test(normalized)) return "down";
    if (/(?:error|alarm|異常|障害)/i.test(normalized)) return "warning";
    if (/(?:\bup\b|link\s*up|リンクアップ|接続中|(?:10|100|1000|2500|5000|10g)base|full.duplex|half.duplex|全二重|半二重)/i.test(normalized)) {
        return "up";
    }
    return "unknown";
}

export function parsePhysicalPortStates(interfaceName: string, raw: string): PanelRuntimeState {
    const result: PanelRuntimeState = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/(?:port|ポート)\s*([0-9]+)/i);
        if (!match) continue;
        result[`interface.${interfaceName}.port.${match[1]}`] = {
            status: detectInterfaceStatus(line),
            detail: line.trim(),
        };
    }
    return result;
}

export default dashboard;
