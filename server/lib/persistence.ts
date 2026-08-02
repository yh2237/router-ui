import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getRuntimeConfig } from "./runtime.js";

export function readDataFile<T>(name: string, fallback: T): T {
    try {
        return JSON.parse(readFileSync(dataPath(name), "utf8")) as T;
    } catch {
        return fallback;
    }
}

export function writeDataFile(name: string, value: unknown): boolean {
    const path = dataPath(name);
    const temporary = `${path}.tmp`;
    try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
        return true;
    } catch (error) {
        console.error(`データファイルを保存できませんでした: ${path}`, error);
        return false;
    }
}

function dataPath(name: string): string {
    return join(getRuntimeConfig().dataDir, name);
}
