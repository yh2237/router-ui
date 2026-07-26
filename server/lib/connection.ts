import { randomUUID } from "node:crypto";
import { createTransport, type TransportType } from "../../transports/index.js";
import { resolveConfig } from "./config.js";
import type { DeviceConnection, TransportOptions } from "./types.js";

const connections = new Map<string, DeviceConnection>();
const commandTails = new Map<string, Promise<void>>();

function generateId(): string {
    return randomUUID();
}

export interface ConnectParams {
    model: string;
    host: string;
    port?: number;
    transport?: TransportType;
    username: string;
    password?: string;
    privateKey?: string;
}

export async function connect(params: ConnectParams): Promise<string> {
    const config = resolveConfig(params.model);
    const transportType = params.transport ?? config.transport;
    const port = params.port ?? (transportType === "ssh" ? 22 : 23);
    const transport = createTransport(transportType);
    const opts: TransportOptions = {
        username: params.username,
        password: params.password,
        privateKey: params.privateKey,
    };
    await transport.connect(params.host, port, opts);
    const id = generateId();
    connections.set(id, {
        model: params.model,
        host: params.host,
        port,
        changeToken: randomUUID(),
        transport,
        config,
    });
    commandTails.set(id, Promise.resolve());
    return id;
}

export function getConnection(id: string): DeviceConnection | undefined {
    return connections.get(id);
}

export function executeCommand(id: string, cmd: string): Promise<string> {
    const conn = connections.get(id);
    if (!conn) return Promise.reject(new Error("Not connected"));
    return queueConnectionTask(id, () => conn.transport.exec(cmd, conn.config.prompt_regex));
}

export function uploadFile(id: string, remotePath: string, content: Buffer): Promise<void> {
    const conn = connections.get(id);
    if (!conn) return Promise.reject(new Error("Not connected"));
    if (!conn.transport.uploadFile) {
        return Promise.reject(new Error("この接続方式はファイル転送に対応していません。SSH/SFTP接続を使用してください。"));
    }
    return queueConnectionTask(id, () => conn.transport.uploadFile!(remotePath, content));
}

export function removeFile(id: string, remotePath: string): Promise<void> {
    const conn = connections.get(id);
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

export function getAllConnections(): { id: string; model: string; host: string; vendor: string }[] {
    return Array.from(connections.entries()).map(([id, conn]) => ({
        id,
        model: conn.model,
        host: conn.host,
        vendor: conn.config.vendor,
    }));
}

export async function disconnect(id: string): Promise<boolean> {
    const conn = connections.get(id);
    if (!conn) return false;
    await conn.transport.close();
    connections.delete(id);
    commandTails.delete(id);
    return true;
}

const savedConnections: { model: string; host: string; port: number; username: string; label: string }[] = [];
export function saveConnection(params: ConnectParams): void {
    const port = params.port ?? (params.transport === "telnet" ? 23 : 22);
    const label = `${params.model} @ ${params.host}`;
    savedConnections.unshift({ model: params.model, host: params.host, port, username: params.username, label });
    if (savedConnections.length > 10) savedConnections.length = 10;
}
export function getSavedConnections() { return savedConnections; }
export function removeSavedConnection(index: number): boolean {
    if (index >= 0 && index < savedConnections.length) {
        savedConnections.splice(index, 1);
        return true;
    }
    return false;
}
