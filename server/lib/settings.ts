export interface TimeSettingsInput {
    timezoneMode: "unchanged" | "jst" | "utc" | "custom";
    timezoneOffset: string;
    date: string;
    time: string;
    ntpServer: string;
    ntpSyslog: boolean;
    ntpSourceMode: "unchanged" | "set" | "remove";
    ntpSourceAddress: string;
    syncNtp: boolean;
}

export interface ConfigDiff {
    added: string[];
    removed: string[];
}

export class SettingsValidationError extends Error {
    constructor(public readonly issues: string[]) {
        super(issues.join("\n"));
        this.name = "SettingsValidationError";
    }
}

export function buildTimeCommands(input: TimeSettingsInput): string[] {
    const issues: string[] = [];
    const commands: string[] = [];

    if (input.timezoneMode === "unchanged") {
        // No command is generated unless the user explicitly selects a timezone.
    } else if (input.timezoneMode === "jst" || input.timezoneMode === "utc") {
        commands.push(`timezone ${input.timezoneMode}`);
    } else if (input.timezoneMode === "custom") {
        if (!isValidTimezoneOffset(input.timezoneOffset)) {
            issues.push("タイムゾーンの時差は -12:00〜+11:59 の範囲で入力してください。");
        } else {
            commands.push(`timezone ${input.timezoneOffset}`);
        }
    } else {
        issues.push("タイムゾーンの指定が正しくありません。");
    }

    if (input.date) {
        if (!isValidDate(input.date)) {
            issues.push("日付は実在する日を YYYY-MM-DD 形式で入力してください。");
        } else {
            commands.push(`date ${input.date}`);
        }
    }

    if (input.time) {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(input.time)) {
            issues.push("時刻は HH:MM:SS 形式で入力してください。");
        } else {
            commands.push(`time ${input.time}`);
        }
    }

    if (input.ntpSourceMode === "set") {
        if (!isValidIpv4Address(input.ntpSourceAddress)) {
            issues.push("NTP送信元には有効なIPv4アドレスを入力してください。");
        } else {
            commands.push(`ntp local address ${input.ntpSourceAddress}`);
        }
    } else if (input.ntpSourceMode === "remove") {
        commands.push("no ntp local address");
    } else if (input.ntpSourceMode !== "unchanged") {
        issues.push("NTP送信元の操作が正しくありません。");
    }

    if (input.syncNtp) {
        if (!isValidNtpServer(input.ntpServer)) {
            issues.push("NTPサーバーにはIPアドレスまたはホスト名を入力してください。");
        } else {
            commands.push(`ntpdate ${input.ntpServer}${input.ntpSyslog ? " syslog" : ""}`);
        }
    }

    if (commands.length === 0 && issues.length === 0) {
        issues.push("変更する項目を1つ以上指定してください。");
    }
    if (issues.length > 0) throw new SettingsValidationError(issues);
    return commands;
}

export function diffConfig(before: string, after: string): ConfigDiff {
    const beforeLines = normalizeConfigLines(before);
    const afterLines = normalizeConfigLines(after);
    const beforeCounts = countLines(beforeLines);
    const afterCounts = countLines(afterLines);

    return {
        added: consumeDifference(afterLines, beforeCounts),
        removed: consumeDifference(beforeLines, afterCounts),
    };
}

export function redactConfigLine(line: string): string {
    return line
        .replace(/^(\s*pp auth myname\s+\S+\s+).+$/i, "$1••••••••")
        .replace(/^(\s*ipsec ike pre-shared-key\s+\S+\s+(?:text\s+)?).+$/i, "$1••••••••")
        .replace(/^(\s*snmp host\s+\S+\s+).+$/i, "$1••••••••")
        .replace(/^(\s*snmp trap host\s+\S+\s+).+$/i, "$1••••••••")
        .replace(/^(\s*(?:login|administrator) password(?: encrypted)?\s+).+$/i, "$1••••••••");
}

function isValidTimezoneOffset(value: string): boolean {
    const match = /^([+-])(\d{2}):([0-5]\d)$/.exec(value);
    if (!match) return false;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    const signedMinutes = match[1] === "-" ? -minutes : minutes;
    return signedMinutes >= -12 * 60 && signedMinutes <= 11 * 60 + 59;
}

function isValidDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
    );
}

function isValidIpv4Address(value: string): boolean {
    const parts = value.split(".");
    return parts.length === 4
        && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function isValidNtpServer(value: string): boolean {
    if (value.length < 1 || value.length > 253) return false;
    if (/^[0-9.]+$/.test(value)) return isValidIpv4Address(value);
    return value
        .split(".")
        .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function normalizeConfigLines(value: string): string[] {
    return value
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
}

function countLines(lines: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
}

function consumeDifference(lines: string[], available: Map<string, number>): string[] {
    const remaining = new Map(available);
    const difference: string[] = [];
    for (const line of lines) {
        const count = remaining.get(line) ?? 0;
        if (count > 0) {
            remaining.set(line, count - 1);
        } else {
            difference.push(line);
        }
    }
    return difference;
}
