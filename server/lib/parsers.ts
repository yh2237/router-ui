export interface ParsedResult {
    type: "table" | "keyvalue" | "raw";
    columns?: string[];
    rows?: Record<string, string>[];
    data?: Record<string, string>;
    raw: string;
}

export function parseOutput(raw: string, parserName?: string): ParsedResult {
    switch (parserName) {
        case "raw":
            return { type: "raw", raw };
        case "table":
            return parseTable(raw);
        case "route_table":
            return parseRouteTable(raw);
        case "yamaha_status":
            return parseYamahaStatus(raw);
        case "yamaha_route":
            return parseYamahaRoute(raw);
        case "yamaha_system":
            return parseYamahaSystem(raw);
        default:
            return { type: "raw", raw };
    }
}

function parseTable(raw: string): ParsedResult {
    const lines = raw.trim().split("\n").filter((l) => l.trim());
    if (lines.length < 2) return { type: "raw", raw };
    const columns = lines[0].split(/\s{2,}|\t+/).map((c) => c.trim());
    const rows = lines.slice(1).map((line) => {
        const vals = line.split(/\s{2,}|\t+/).map((v) => v.trim());
        const row: Record<string, string> = {};
        columns.forEach((col, i) => {
            row[col] = vals[i] ?? "";
        });
        return row;
    });
    return { type: "table", columns, rows, raw };
}

function parseRouteTable(raw: string): ParsedResult {
    return parseTable(raw);
}

function parseYamahaStatus(raw: string): ParsedResult {
    const lines = raw.trim().split("\n");
    const data: Record<string, string> = {};
    for (const line of lines) {
        const sep = line.includes(": ") ? ": " : "=";
        const idx = line.indexOf(sep);
        if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + sep.length).trim();
            if (key) data[key] = val;
        }
    }
    return { type: "keyvalue", data, raw };
}

function parseYamahaRoute(raw: string): ParsedResult {
    const lines = raw.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { type: "raw", raw };

    const headerKeywords = ["destination", "gateway", "interface", "nexthop", "flags", "protocol", "type", "network"];
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (headerKeywords.some((kw) => lower.includes(kw))) {
            startIdx = i;
            break;
        }
    }

    const columns = lines[startIdx].split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (columns.length < 2) return { type: "raw", raw };

    const rows: Record<string, string>[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
        const vals = lines[i].split(/\s{2,}|\t+/).map((v) => v.trim()).filter(Boolean);
        if (vals.length === 0) continue;
        const row: Record<string, string> = {};
        columns.forEach((col, ci) => { row[col] = vals[ci] ?? ""; });
        rows.push(row);
    }

    return { type: "table", columns, rows, raw };
}

function parseYamahaSystem(raw: string): ParsedResult {
    const lines = raw.trim().split("\n");
    const data: Record<string, string> = {};
    for (const line of lines) {
        const sep = line.includes(": ") ? ": " : "=";
        const idx = line.indexOf(sep);
        if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + sep.length).trim();
            if (key) data[key] = val;
        }
    }
    return { type: "keyvalue", data, raw };
}
