import { createHash } from "node:crypto";
import { readDataFile, writeDataFile } from "./persistence.js";

type KnownHosts = Record<string, { fingerprint: string; firstSeenAt: string }>;

let knownHosts: KnownHosts | undefined;

export function createHostKeyVerifier(host: string, port: number): (key: Buffer) => boolean {
    const endpoint = `${normalizeHost(host)}:${port}`;
    return (key: Buffer): boolean => {
        const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
        const hosts = loadKnownHosts();
        const known = hosts[endpoint];
        if (known) {
            if (known.fingerprint === fingerprint) return true;
            throw new Error(
                `SSHホスト鍵が保存済みの値と一致しません (${endpoint})。`
                + ` 保存済み: ${known.fingerprint} / 接続先: ${fingerprint}`,
            );
        }

        hosts[endpoint] = { fingerprint, firstSeenAt: new Date().toISOString() };
        if (!writeDataFile("known-hosts.json", hosts)) {
            delete hosts[endpoint];
            throw new Error("SSHホスト鍵を安全に保存できないため、接続を中止しました。");
        }
        return true;
    };
}

export function listKnownHosts(): KnownHosts {
    return structuredClone(loadKnownHosts());
}

export function forgetKnownHost(endpoint: string): boolean {
    const hosts = loadKnownHosts();
    if (!hosts[endpoint]) return false;
    const previous = hosts[endpoint];
    delete hosts[endpoint];
    if (!writeDataFile("known-hosts.json", hosts)) {
        hosts[endpoint] = previous;
        return false;
    }
    return true;
}

export function resetKnownHostsForTests(): void {
    knownHosts = undefined;
}

function loadKnownHosts(): KnownHosts {
    if (!knownHosts) knownHosts = readDataFile<KnownHosts>("known-hosts.json", {});
    return knownHosts;
}

function normalizeHost(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
