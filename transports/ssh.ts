import { Client, type ClientChannel } from "ssh2";
import type { Transport, TransportOptions } from "../server/lib/types.js";

const ANSI_ESCAPE_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const PAGER_REGEX = /--More--|--\s*More\s*--/gi;

export class SshTransport implements Transport {
    private client: Client | null = null;
    private shell: ClientChannel | null = null;
    private isClosing = false;

    async connect(host: string, port: number, opts: TransportOptions): Promise<void> {
        const client = new Client();
        await new Promise<void>((resolve, reject) => {
            client.on("ready", resolve);
            client.on("error", reject);
            client.connect({
                host,
                port,
                username: opts.username,
                password: opts.password,
                privateKey: opts.privateKey,
                readyTimeout: 10000,
            });
        });
        this.client = client;
        this.isClosing = false;
        client.on("close", () => {
            this.client = null;
            this.shell = null;
        });
        client.on("error", () => {
            this.client = null;
            this.shell = null;
        });
    }

    async exec(cmd: string, promptRegex: string): Promise<string> {
        if (!this.client || this.isClosing) {
            throw new Error("Not connected");
        }

        const shell = await this.ensureShell(promptRegex);
        return await executeInShell(shell, cmd, promptRegex, 30000);
    }

    async close(): Promise<void> {
        this.isClosing = true;
        if (!this.client) return;
        const client = this.client;
        this.client = null;
        this.shell = null;
        await new Promise<void>((resolve) => {
            client.once("close", () => resolve());
            client.end();
            setTimeout(() => resolve(), 1000);
        });
    }

    private async ensureShell(promptRegex: string): Promise<ClientChannel> {
        if (this.shell) return this.shell;
        if (!this.client) throw new Error("Not connected");

        const shell = await openShell(this.client, promptRegex, 10000);
        this.shell = shell;
        shell.on("close", () => {
            if (this.shell === shell) this.shell = null;
        });
        return shell;
    }
}

function openShell(client: Client, promptRegex: string, timeoutMs: number): Promise<ClientChannel> {
    return new Promise<ClientChannel>((resolve, reject) => {
        let shell: ClientChannel | null = null;
        let output = "";
        let settled = false;

        const finish = (err?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (shell) shell.removeListener("data", onData);
            if (err) reject(err);
            else if (shell) resolve(shell);
        };
        const onData = (data: Buffer | string): void => {
            output += data.toString();
            if (hasPromptAtEnd(output, promptRegex)) finish();
        };
        const timer = setTimeout(() => finish(new Error("SSH shell prompt was not received")), timeoutMs);

        client.shell({ term: "vt100", cols: 200, rows: 100 }, (err, channel) => {
            if (err) {
                finish(new Error(`SSH shell start failed: ${err.message}`));
                return;
            }
            shell = channel;
            channel.on("data", onData);
            channel.on("error", (channelErr: Error) => finish(new Error(`SSH shell error: ${channelErr.message}`)));
            channel.on("close", () => finish(new Error("SSH shell closed before the prompt was received")));
        });
    });
}

function executeInShell(shell: ClientChannel, cmd: string, promptRegex: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let output = "";
        let settled = false;

        const finish = (err?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            shell.removeListener("data", onData);
            shell.removeListener("error", onError);
            shell.removeListener("close", onClose);
            if (err) {
                reject(err);
                return;
            }
            resolve(stripShellFrame(output, cmd, promptRegex));
        };
        const onData = (data: Buffer | string): void => {
            const chunk = data.toString();
            output += chunk;
            if (PAGER_REGEX.test(chunk)) {
                PAGER_REGEX.lastIndex = 0;
                shell.write(" ");
            }
            if (hasPromptAtEnd(output, promptRegex)) finish();
        };
        const onError = (err: Error): void => finish(new Error(`SSH shell error: ${err.message}`));
        const onClose = (): void => finish(new Error("SSH shell closed while waiting for command output"));
        const timer = setTimeout(() => finish(new Error(`Command timed out (${timeoutMs / 1000}s): ${cmd}`)), timeoutMs);

        shell.on("data", onData);
        shell.once("error", onError);
        shell.once("close", onClose);
        shell.write(`${cmd}\n`);
    });
}

function hasPromptAtEnd(output: string, promptRegex: string): boolean {
    const normalized = normalizeExecOutput(output);
    return new RegExp(promptRegex).test(normalized);
}

function stripShellFrame(output: string, cmd: string, promptRegex: string): string {
    let normalized = normalizeExecOutput(output).replace(PAGER_REGEX, "");
    normalized = normalized.replace(new RegExp(`^(?:>\\s*)?${escapeRegExp(cmd)}\\s*\\n?`), "");
    normalized = normalized.replace(new RegExp(promptRegex), "");
    return normalized.trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeExecOutput(output: string): string {
    return output
        .replace(ANSI_ESCAPE_REGEX, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}
