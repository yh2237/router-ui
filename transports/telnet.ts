import Telnet from "telnet-client";
import type { Transport, TransportOptions } from "../server/lib/types.js";

export class TelnetTransport implements Transport {
    private conn: InstanceType<typeof Telnet> | null = null;

    async connect(host: string, port: number, opts: TransportOptions): Promise<void> {
        const conn = new Telnet();
        conn.on("error", () => { });
        await conn.connect({
            host,
            port,
            username: opts.username,
            password: opts.password,
            timeout: 10000,
        });
        this.conn = conn;
    }

    async exec(cmd: string, promptRegex: string): Promise<string> {
        if (!this.conn) throw new Error("Not connected");
        const res = await this.conn.exec(cmd, {
            prompt: promptRegex,
            timeout: 15000,
            shellPrompt: promptRegex,
        } as never);
        return typeof res === "string" ? res : (res as Buffer).toString();
    }

    async close(): Promise<void> {
        if (this.conn) {
            await this.conn.destroy();
            this.conn = null;
        }
    }
}
