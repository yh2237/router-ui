import { Hono } from "hono";
import { executeCommand, getConnection, registerConnectionCleanup } from "../lib/connection.js";
import { parseOutput, type ParsedResult } from "../lib/parsers.js";
import { renderDevicePanel, type PanelRuntimeState } from "../lib/device-panel.js";
import type { ResolvedConfig } from "../lib/types.js";
import { getBrowserSession } from "../lib/auth.js";

const dashboard = new Hono();

const CARD_DEFS: { key: string; label: string; refreshSeconds?: number }[] = [
    { key: "system", label: "システム情報" },
    { key: "resource", label: "リソース情報", refreshSeconds: 5 },
    { key: "traffic", label: "トラフィック情報", refreshSeconds: 5 },
    { key: "interface", label: "インターフェース情報" },
    { key: "routing", label: "ルーティング情報" },
];

interface TrafficSample {
    at: number;
    transmittedOctets: number;
    receivedOctets: number;
}

const trafficHistory = new Map<string, TrafficSample[]>();
const commandCache = new Map<string, { expiresAt: number; promise: Promise<ParsedResult> }>();
registerConnectionCleanup((id) => {
    trafficHistory.delete(id);
    for (const key of commandCache.keys()) {
        if (key.startsWith(`${id}:`)) commandCache.delete(key);
    }
});

dashboard.get("/api/device/:connId/dashboard", async (c) => {
    const connId = c.req.param("connId");
    const conn = getConnection(connId, getBrowserSession(c).id);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`, 404);

    return c.html(renderDashboardCards(connId));
});

export function renderDashboardCards(connId: string): string {
    const cards = CARD_DEFS
        .map((def) => `
            <div class="dashboard-card dashboard-card--${def.key}">
                <div class="dashboard-card-header">
                    <h3>${def.label}</h3>
                    <span id="dash-spin-${def.key}" class="spinner htmx-indicator"></span>
                    <button class="btn-refresh" aria-label="${def.label}を更新" hx-post="/api/device/${connId}/dashboard/card/${def.key}" hx-target="#dash-body-${def.key}" hx-sync="#dash-body-${def.key}:replace" hx-indicator="#dash-spin-${def.key}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7"/></svg></button>
                </div>
                <div class="dashboard-card-body" id="dash-body-${def.key}"
                    hx-post="/api/device/${connId}/dashboard/card/${def.key}"
                    hx-trigger="${def.refreshSeconds ? `load, every ${def.refreshSeconds}s` : "load"}" hx-target="this" hx-sync="this:replace" hx-indicator="#dash-spin-${def.key}">
                    <div class="dash-loading">読み込み中...</div>
                </div>
            </div>
        `)
        .join("");

    return `<div class="dashboard-grid">${cards}</div>`;
}

dashboard.post("/api/device/:connId/dashboard/card/:category", async (c) => {
    const connId = c.req.param("connId");
    const category = c.req.param("category");
    const ownerSessionId = getBrowserSession(c).id;
    const conn = getConnection(connId, ownerSessionId);
    if (!conn) return c.html(`<div class="error-message">Device not connected</div>`);

    try {
        switch (category) {
            case "system":
                return await renderSystemCard(conn.config, connId, ownerSessionId);
            case "interface":
                return await renderInterfaceCard(conn.config, connId, ownerSessionId);
            case "routing":
                return await renderRoutingCard(conn.config, connId, ownerSessionId);
            case "resource":
                return await renderResourceCard(conn.config, connId, ownerSessionId);
            case "traffic":
                return await renderTrafficCard(conn.config, connId, ownerSessionId);
            default:
                return c.html(`<div class="error-message">不明なカテゴリです</div>`);
        }
    } catch (err) {
        return c.html(
            `<div class="error-message">取得に失敗しました<span class="error-detail">機器からの応答: ${escapeHtml((err as Error).message)}</span></div>`,
        );
    }
});

async function execAndCache(
    config: ResolvedConfig,
    connId: string,
    ownerSessionId: string,
    cmdKey: string,
): Promise<ParsedResult> {
    const cmdConfig = config.commands[cmdKey];
    if (!cmdConfig) throw new Error(`Unknown command: ${cmdKey}`);
    const cacheKey = `${connId}:${cmdKey}`;
    const existing = commandCache.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;

    const entry = {
        expiresAt: Number.POSITIVE_INFINITY,
        promise: executeCommand(connId, ownerSessionId, cmdConfig.cmd)
            .then((raw) => parseOutput(raw, cmdConfig.parse)),
    };
    commandCache.set(cacheKey, entry);
    entry.promise.then(
        () => {
            if (commandCache.get(cacheKey) === entry) entry.expiresAt = Date.now() + 1_000;
        },
        () => {
            if (commandCache.get(cacheKey) === entry) commandCache.delete(cacheKey);
        },
    );
    return entry.promise;
}

async function renderSystemCard(config: ResolvedConfig, connId: string, ownerSessionId: string): Promise<Response> {
    const environment = await tryDashboardCommand(config, connId, ownerSessionId, "show_system");
    const boot = await tryDashboardCommand(config, connId, ownerSessionId, "show_status_boot");
    const lanStates = await Promise.all(
        ["show_status_lan1", "show_status_lan2", "show_status_lan3"]
            .map((key) => tryDashboardCommand(config, connId, ownerSessionId, key)),
    );
    if (!environment && !boot && lanStates.every((state) => !state)) {
        return noDataHtml("システム情報を取得できませんでした");
    }

    const environmentData = environment?.data ?? {};
    const bootData = boot?.data ?? {};
    const rows = [
        {
            label: "ファームウェアRev",
            value: pick(environmentData, ["システムのリビジョン", "Firmware Revision", "Revision"])
                ?? extractFirmwareRevision(environment?.raw),
        },
        {
            label: "シリアルNo.",
            value: pick(environmentData, ["シリアル番号", "Serial Number", "Serial"])
                ?? extractSerialNumber(environment?.raw),
        },
        ...lanStates.map((state, index) => ({
            label: `LAN${index + 1} MACアドレス`,
            value: extractMacAddress(state),
        })),
        {
            label: "ファームウェア",
            value: pick(environmentData, [
                "動作しているファームウェア", "実行中のファームウェア", "Firmware",
            ]),
        },
        {
            label: "シリアルボーレート",
            value: pick(environmentData, [
                "シリアルポートのボーレート", "シリアルボーレート", "Serial Baud Rate", "Baud Rate",
            ]),
        },
        {
            label: "システム時刻",
            value: pick(environmentData, ["システム時刻", "現在時刻", "Current Time", "System Time"]),
        },
        {
            label: "起動時刻",
            value: pick(environmentData, ["起動時刻", "起動日時", "Boot Time"])
                ?? pick(bootData, ["起動時刻", "起動日時", "Boot Time"]),
        },
        {
            label: "起動理由",
            value: pick(bootData, ["起動理由", "起動要因", "Boot Reason", "Boot Cause", "Cause"]),
        },
    ];
    const items = rows
        .map(({ label, value }) => `
            <div class="kv-row">
                <span class="kv-key">${label}</span>
                <span class="kv-val${value ? "" : " kv-val--unavailable"}">${value ? escapeHtml(value) : "取得できません"}</span>
            </div>
        `)
        .join("");
    return cHtml(`<div class="dash-system-info">${items}</div>`);
}

async function tryDashboardCommand(
    config: ResolvedConfig,
    connId: string,
    ownerSessionId: string,
    commandKey: string,
): Promise<ParsedResult | undefined> {
    if (!config.commands[commandKey]) return undefined;
    try {
        return await execAndCache(config, connId, ownerSessionId, commandKey);
    } catch {
        return undefined;
    }
}

function extractFirmwareRevision(raw: string | undefined): string | undefined {
    return raw?.match(/\bRev\.[0-9.]+/i)?.[0];
}

function extractSerialNumber(raw: string | undefined): string | undefined {
    return raw?.match(/\bserial\s*=\s*([^\s,]+)/i)?.[1];
}

function extractMacAddress(parsed: ParsedResult | undefined): string | undefined {
    if (!parsed) return undefined;
    const fromData = parsed.data
        ? pick(parsed.data, [
            "MAC Address", "MACアドレス", "Ethernet Address", "イーサネットアドレス", "物理アドレス",
        ])
        : undefined;
    const source = fromData ?? parsed.raw;
    return source.match(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i)?.[0];
}

async function renderInterfaceCard(config: ResolvedConfig, connId: string, ownerSessionId: string): Promise<Response> {
    const ifaceCmds = Object.entries(config.commands).filter(([, cmd]) => cmd.category === "interface");
    if (ifaceCmds.length === 0) return noDataHtml();

    const items: string[] = [];
    const panelState: PanelRuntimeState = {
        "system.power": { status: "up", detail: "接続中" },
    };
    for (const [key] of ifaceCmds) {
        try {
            const parsed = await execAndCache(config, connId, ownerSessionId, key);
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
    return cHtml(renderInterfaceOverview(panel, items));
}

async function renderRoutingCard(config: ResolvedConfig, connId: string, ownerSessionId: string): Promise<Response> {
    const cmdEntry = Object.entries(config.commands).find(([, cmd]) => cmd.category === "routing");
    if (!cmdEntry) return noDataHtml();

    const parsed = await execAndCache(config, connId, ownerSessionId, cmdEntry[0]);

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

async function renderResourceCard(config: ResolvedConfig, connId: string, ownerSessionId: string): Promise<Response> {
    const systemCmd = Object.entries(config.commands).find(([, cmd]) => cmd.category === "system");

    let d: Record<string, string> | null = null;

    if (systemCmd) {
        try {
            const parsed = await execAndCache(config, connId, ownerSessionId, systemCmd[0]);
            if (parsed.type === "keyvalue" && parsed.data && Object.keys(parsed.data).length > 0) {
                d = parsed.data;
            }
        } catch {
            // Try the model-specific resource command below.
        }
    }

    if (!d) {
        const resourceCmd = Object.entries(config.commands).find(([, cmd]) => cmd.category === "resource");
        if (!resourceCmd) return noDataHtml("リソース情報はこの機種では利用できません");
        try {
            const parsed = await execAndCache(config, connId, ownerSessionId, resourceCmd[0]);
            if (parsed.type !== "keyvalue" || !parsed.data) {
                return cHtml(`<pre class="terminal-dash">${escapeHtml(parsed.raw)}</pre>`);
            }
            d = parsed.data;
        } catch {
            return noDataHtml("リソース情報はこの機種では利用できません");
        }
    }

    if (!d) return noDataHtml("リソース情報はこの機種では利用できません");

    const metrics = extractResourceMetrics(d);
    const items = [
        renderResourceMetric("CPU", metrics.cpuRaw, metrics.cpuPercent),
        renderResourceMetric("メモリ", metrics.memoryRaw, metrics.memoryPercent),
    ];
    if (metrics.packetBufferRaw) {
        items.push(renderResourceMetric(
            "パケットバッファ",
            metrics.packetBufferRaw,
            metrics.packetBufferPercent,
        ));
    }

    return cHtml(`
        <div class="dash-resource">
            ${items.join("")}
            <p class="dashboard-updated-at">最終更新 ${formatUpdateTime(new Date())}</p>
        </div>
    `);
}

export interface ResourceMetrics {
    cpuRaw?: string;
    cpuPercent: number | null;
    memoryRaw?: string;
    memoryPercent: number | null;
    packetBufferRaw?: string;
    packetBufferPercent: number | null;
}

export function extractResourceMetrics(data: Record<string, string>): ResourceMetrics {
    const cpuRaw = pick(data, [
        "CPU", "CPU Load", "CPU使用率", "CPU load", "CPU utilization", "CPU の使用量", "cpu",
    ]);
    const memoryRaw = pick(data, [
        "Memory", "メモリ", "Memory Usage", "Memory utilization", "Mem", "メモリの使用量", "memory",
    ]);
    const packetBufferRaw = pick(data, [
        "パケットバッファの使用量", "パケットバッファ使用量", "Packet Buffer Usage", "Packet Buffer",
    ]);
    return {
        cpuRaw,
        cpuPercent: extractPercent(cpuRaw),
        memoryRaw,
        memoryPercent: extractPercent(memoryRaw),
        packetBufferRaw,
        packetBufferPercent: extractPercent(packetBufferRaw),
    };
}

function renderResourceMetric(label: string, raw: string | undefined, percent: number | null): string {
    if (percent !== null) {
        return `
            <div class="meter-row">
                <span class="meter-label">${escapeHtml(label)}</span>
                <span class="meter-value">${percent}%</span>
                ${renderPercentMeter(percent, `${label}使用率`)}
            </div>
        `;
    }
    return `
        <div class="meter-row meter-row--unavailable">
            <span class="meter-label">${escapeHtml(label)}</span>
            <span class="meter-value">${raw ? escapeHtml(raw) : "取得できません"}</span>
        </div>
    `;
}

function renderPercentMeter(value: number, label: string): string {
    return `
        <svg class="meter-bar" viewBox="0 0 100 10" preserveAspectRatio="none"
            role="img" aria-label="${escapeHtml(label)} ${value}%">
            <rect class="meter-track" x="0" y="0" width="100" height="10"></rect>
            <rect class="meter-fill" x="0" y="0" width="${value}" height="10"></rect>
        </svg>
    `;
}

async function renderTrafficCard(config: ResolvedConfig, connId: string, ownerSessionId: string): Promise<Response> {
    const command = config.commands.show_status_lan1;
    if (!command) return noDataHtml("トラフィック情報はこの機種では利用できません");

    const raw = await executeCommand(connId, ownerSessionId, command.cmd);
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
    const entries = Object.entries(d);
    for (const key of keys) {
        const normalized = normalizeLabel(key);
        const found = entries.find(([candidate]) => normalizeLabel(candidate) === normalized);
        if (found) return found[1];
    }
    for (const key of keys) {
        const normalized = normalizeLabel(key);
        if (normalized.length < 3) continue;
        const found = entries.find(([candidate]) => normalizeLabel(candidate).includes(normalized));
        if (found) return found[1];
    }
    return undefined;
}

function extractPercent(raw: string | undefined): number | null {
    if (!raw) return null;
    const match = raw.match(/(\d+(?:\.\d+)?)\s*[%％]/);
    if (!match) return null;
    return Math.min(100, Math.max(0, Number(match[1])));
}

function normalizeLabel(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/[\s_.:/()［\]【】-]+/g, "");
}

function formatUpdateTime(date: Date): string {
    return new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(date);
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

export function renderInterfaceOverview(panel: string, items: string[]): string {
    const panelRegion = panel
        ? `
            <section class="interface-panel-region" aria-labelledby="interface-panel-heading">
                <div class="interface-section-head">
                    <div>
                        <h4 id="interface-panel-heading">前面パネル</h4>
                        <p>物理ポートとランプの状態</p>
                    </div>
                </div>
                <div class="interface-panel-canvas">${panel}</div>
            </section>
        `
        : "";

    return `
        <div class="interface-workbench${panel ? "" : " interface-workbench--list-only"}">
            ${panelRegion}
            <section class="interface-list-region" aria-labelledby="interface-list-heading">
                <div class="interface-section-head">
                    <div>
                        <h4 id="interface-list-heading">論理インターフェース</h4>
                        <p>アドレスとリンク状態</p>
                    </div>
                    <span class="interface-count">${items.length}件</span>
                </div>
                <div class="dash-iface-list" role="table" aria-label="論理インターフェース一覧">
                    <div class="iface-table-head" role="row">
                        <span role="columnheader">インターフェース</span>
                        <span role="columnheader">IPアドレス</span>
                        <span role="columnheader">リンク</span>
                    </div>
                    ${items.join("")}
                </div>
            </section>
        </div>
    `;
}

export function ifaceRowHtml(name: string, status: string, ip: string, speed: string, isError = false): string {
    const ipSpan = isError
        ? `<span class="iface-ip iface-ip-muted" role="cell"><span class="iface-mobile-label">IP</span>${escapeHtml(ip)}</span>`
        : `<span class="iface-ip" role="cell"><span class="iface-mobile-label">IP</span>${escapeHtml(ip)}</span>`;
    const statusLabel = interfaceStatusLabel(status, isError);
    return `
        <div class="iface-row" role="row">
            <span class="iface-name" role="cell">
                <span class="status-dot ${status}" aria-hidden="true"></span>
                <span class="iface-identity">
                    <strong>${escapeHtml(name)}</strong>
                    <small>${statusLabel}</small>
                </span>
            </span>
            ${ipSpan}
            <span class="iface-speed" role="cell"><span class="iface-mobile-label">リンク</span>${escapeHtml(speed)}</span>
        </div>
    `;
}

function interfaceStatusLabel(status: string, isError: boolean): string {
    if (isError) return "取得失敗";
    if (status === "up") return "リンクアップ";
    if (status === "down") return "リンクダウン";
    if (status === "warning") return "要確認";
    return "状態不明";
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
