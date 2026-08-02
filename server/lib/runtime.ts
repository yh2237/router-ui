import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RuntimeConfig {
    host: string;
    port: number;
    dataDir: string;
    connectionIdleMs: number;
    sessionLifetimeMs: number;
}

let cached: RuntimeConfig | undefined;
let cachedVersion: string | undefined;

export function getRuntimeConfig(): RuntimeConfig {
    if (cached) return cached;

    const host = process.env.HOST?.trim() || "127.0.0.1";

    cached = {
        host,
        port: parseInteger(process.env.PORT, 3000, 1, 65535, "PORT"),
        dataDir: resolve(process.env.ROUTER_UI_DATA_DIR?.trim() || "./data"),
        connectionIdleMs:
            parseInteger(process.env.ROUTER_UI_CONNECTION_IDLE_MINUTES, 30, 1, 1440, "ROUTER_UI_CONNECTION_IDLE_MINUTES")
            * 60_000,
        sessionLifetimeMs:
            parseInteger(process.env.ROUTER_UI_SESSION_HOURS, 12, 1, 168, "ROUTER_UI_SESSION_HOURS")
            * 60 * 60_000,
    };
    return cached;
}

export function getAppVersion(): string {
    if (cachedVersion) return cachedVersion;
    try {
        const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
        cachedVersion = pkg.version || "development";
    } catch {
        cachedVersion = "development";
    }
    return cachedVersion;
}

export function resetRuntimeConfigForTests(): void {
    cached = undefined;
}

function parseInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
    name: string,
): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} は ${min}〜${max} の整数で指定してください。`);
    }
    return parsed;
}
