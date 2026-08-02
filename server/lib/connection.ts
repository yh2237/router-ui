import { randomUUID } from "node:crypto";
import { createTransport, type TransportType } from "../../transports/index.js";
import { resolveConfig } from "./config.js";
import { createHostKeyVerifier } from "./host-keys.js";
import { readDataFile, writeDataFile } from "./persistence.js";
import { getRuntimeConfig } from "./runtime.js";
import type { DeviceConnection, Transport, TransportOptions } from "./types.js";

const connections = new Map<string, DeviceConnection>();
const commandTails = new Map<string, Promise<void>>();
const connectionCleanupHandlers = new Set<(id: string) => void>();

function generateId(): string {
    return randomUUID();
}

export interface ConnectParams {
    ownerSessionId: string;
    model: string;
    host: string;
    port?: number;
    transport?: TransportType;
    username: string;
    password?: string;
    privateKey?: string;
}

export async function connect(
    params: ConnectParams,
    transportFactory: (type: TransportType) => Transport = createTransport,
): Promise<string> {
    const config = resolveConfig(params.model);
    const transportType = params.transport ?? config.transport;
    const port = params.port ?? (transportType === "ssh" ? 22 : 23);
    const transport = transportFactory(transportType);
    const opts: TransportOptions = {
        username: params.username,
        password: params.password,
        privateKey: params.privateKey,
        hostKeyVerifier: transportType === "ssh" ? createHostKeyVerifier(params.host, port) : undefined,
    };
    await transport.connect(params.host, port, opts);
    const id = generateId();
    connections.set(id, {
        ownerSessionId: params.ownerSessionId,
        model: params.model,
        host: params.host,
        port,
        changeToken: randomUUID(),
        lastActivityAt: Date.now(),
        transport,
        config,
    });
    commandTails.set(id, Promise.resolve());
    return id;
}

export function getConnection(id: string, ownerSessionId: string): DeviceConnection | undefined {
    const conn = connections.get(id);
    if (!conn || conn.ownerSessionId !== ownerSessionId) return undefined;
    conn.lastActivityAt = Date.now();
    return conn;
}

export function executeCommand(id: string, ownerSessionId: string, cmd: string): Promise<string> {
    const conn = getConnection(id, ownerSessionId);
    if (!conn) return Promise.reject(new Error("Not connected"));
    return queueConnectionTask(id, () => conn.transport.exec(cmd, conn.config.prompt_regex));
}

export function uploadFile(id: string, ownerSessionId: string, remotePath: string, content: Buffer): Promise<void> {
    const conn = getConnection(id, ownerSessionId);
    if (!conn) return Promise.reject(new Error("Not connected"));
    if (!conn.transport.uploadFile) {
        return Promise.reject(new Error("この接続方式はファイル転送に対応していません。SSH/SFTP接続を使用してください。"));
    }
    return queueConnectionTask(id, () => conn.transport.uploadFile!(remotePath, content));
}

export function removeFile(id: string, ownerSessionId: string, remotePath: string): Promise<void> {
    const conn = getConnection(id, ownerSessionId);
    if (!conn) return Promise.reject(new Error("Not connected"));
    if (!conn.transport.removeFile) return Promise.resolve();
    return queueConnectionTask(id, () => conn.transport.removeFile!(remotePath));
}

function queueConnectionTask<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = commandTails.get(id) ?? Promise.resolve();
    const execution = previous.then(task);
    commandTails.set(id, execution.then(() => undefined, () => undefined));
    return execution;
}

export function getAllConnections(ownerSessionId: string): { id: string; model: string; host: string; vendor: string }[] {
    return Array.from(connections.entries()).map(([id, conn]) => ({
        id,
        model: conn.model,
        host: conn.host,
        vendor: conn.config.vendor,
    })).filter((connection) => connections.get(connection.id)?.ownerSessionId === ownerSessionId);
}

export async function disconnect(id: string, ownerSessionId: string): Promise<boolean> {
    const conn = connections.get(id);
    if (!conn || conn.ownerSessionId !== ownerSessionId) return false;
    return closeConnection(id, conn);
}

export async function disconnectOwnedConnections(ownerSessionId: string): Promise<number> {
    const owned = Array.from(connections.entries()).filter(([, conn]) => conn.ownerSessionId === ownerSessionId);
    await Promise.allSettled(owned.map(([id, conn]) => closeConnection(id, conn)));
    return owned.length;
}

export async function closeIdleConnections(now = Date.now()): Promise<number> {
    const idleMs = getRuntimeConfig().connectionIdleMs;
    const idle = Array.from(connections.entries()).filter(([, conn]) => now - conn.lastActivityAt > idleMs);
    await Promise.allSettled(idle.map(([id, conn]) => closeConnection(id, conn)));
    return idle.length;
}

export async function closeAllConnections(): Promise<void> {
    const active = Array.from(connections.entries());
    await Promise.allSettled(active.map(([id, conn]) => closeConnection(id, conn)));
}

async function closeConnection(id: string, conn: DeviceConnection): Promise<boolean> {
    try {
        await conn.transport.close();
    } finally {
        connections.delete(id);
        commandTails.delete(id);
        for (const handler of connectionCleanupHandlers) handler(id);
    }
    return true;
}

export function registerConnectionCleanup(handler: (id: string) => void): () => void {
    connectionCleanupHandlers.add(handler);
    return () => connectionCleanupHandlers.delete(handler);
}

export interface SavedConnection {
    model: string;
    host: string;
    port: number;
    transport: TransportType;
    username: string;
    label: string;
}

const savedConnections = loadSavedConnections();

export function saveConnection(params: ConnectParams): void {
    const transport = params.transport ?? resolveConfig(params.model).transport;
    const port = params.port ?? (transport === "telnet" ? 23 : 22);
    const label = `${params.model} @ ${params.host}`;
    const duplicate = savedConnections.findIndex(
        (saved) =>
            saved.model === params.model
            && saved.host === params.host
            && saved.port === port
            && saved.username === params.username
            && saved.transport === transport,
    );
    if (duplicate >= 0) savedConnections.splice(duplicate, 1);
    savedConnections.unshift({
        model: params.model,
        host: params.host,
        port,
        transport,
        username: params.username,
        label,
    });
    if (savedConnections.length > 10) savedConnections.length = 10;
    writeDataFile("connections.json", savedConnections);
}

export function getSavedConnections(): readonly SavedConnection[] {
    return savedConnections;
}

export function removeSavedConnection(index: number): boolean {
    if (index >= 0 && index < savedConnections.length) {
        savedConnections.splice(index, 1);
        writeDataFile("connections.json", savedConnections);
        return true;
    }
    return false;
}

function loadSavedConnections(): SavedConnection[] {
    const stored = readDataFile<unknown>("connections.json", []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isSavedConnection).slice(0, 10);
}

function isSavedConnection(value: unknown): value is SavedConnection {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<SavedConnection>;
    return typeof item.model === "string"
        && typeof item.host === "string"
        && Number.isInteger(item.port)
        && (item.transport === "ssh" || item.transport === "telnet")
        && typeof item.username === "string"
        && typeof item.label === "string";
}
