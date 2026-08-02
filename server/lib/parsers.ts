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
    return { type: "keyvalue", data: parseKeyValueLines(raw), raw };
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
    const data = parseKeyValueLines(raw);
    setMatchedValue(data, "CPU", raw, /^\s*CPU\s*:\s*(.*?)(?=\s{2,}Memory\s*:|$)/mi);
    setMatchedValue(data, "Memory", raw, /\bMemory\s*:\s*([^\r\n]+)/i);
    setMatchedValue(data, "Packet Buffer", raw, /^\s*Packet\s+Buffer\s*:\s*([^\r\n]+)/mi);
    setMatchedValue(data, "Serial Number", raw, /\bserial\s*=\s*([^\s,]+)/i);
    setMatchedValue(data, "Firmware", raw, /^\s*Firmware\s*:\s*(\S+)/mi);
    setMatchedValue(data, "Config File", raw, /\bConfig\.\s*file\s*:\s*(\S+)/i);
    setMatchedValue(data, "Default Firmware", raw, /^\s*Default\s+firmware\s*:\s*(\S+)/mi);
    setMatchedValue(data, "Default Config File", raw, /\bDefault\s+config\.\s*file\s*:\s*(\S+)/i);
    setMatchedValue(data, "Serial Baud Rate", raw, /^\s*Serial\s+Baud(?:rate|\s+Rate)\s*:\s*([^\r\n]+)/mi);
    setMatchedValue(data, "Boot Time", raw, /^\s*Boot\s+time\s*:\s*([^\r\n]+)/mi);
    setMatchedValue(data, "Current Time", raw, /^\s*Current\s+time\s*:\s*([^\r\n]+)/mi);
    return { type: "keyvalue", data, raw };
}

function setMatchedValue(
    data: Record<string, string>,
    key: string,
    raw: string,
    pattern: RegExp,
): void {
    const value = raw.match(pattern)?.[1]?.trim();
    if (value) data[key] = value;
}

function parseKeyValueLines(raw: string): Record<string, string> {
    const lines = raw.trim().split("\n");
    const data: Record<string, string> = {};
    for (const line of lines) {
        const separators = [": ", "：", "="];
        const sep = separators
            .map((candidate) => ({ candidate, index: line.indexOf(candidate) }))
            .filter(({ index }) => index >= 0)
            .sort((a, b) => a.index - b.index)[0];
        const idx = sep?.index ?? -1;
        if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + sep!.candidate.length).trim();
            if (key) data[key] = val;
        }
    }
    return data;
}
