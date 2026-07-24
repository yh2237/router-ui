import { connect, disconnect, executeCommand, getConnection } from "../server/lib/connection.js";

type Args = {
    model: string;
    host: string;
    username: string;
    password?: string;
    port?: number;
    transport?: "ssh" | "telnet";
    repeat: number;
    commands?: string[];
};

function parseArgs(argv: string[]): Args {
    const map = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
        map.set(key, value);
    }

    const model = map.get("model") ?? "";
    const host = map.get("host") ?? "";
    const username = map.get("username") ?? "";
    const password = map.get("password");
    const transport = map.get("transport") as "ssh" | "telnet" | undefined;
    const port = map.get("port") ? parseInt(map.get("port")!, 10) : undefined;
    const repeat = map.get("repeat") ? parseInt(map.get("repeat")!, 10) : 10;
    const commands = map.get("commands")
        ? map.get("commands")!.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    if (!model || !host || !username) {
        throw new Error(
            "Usage: npm run probe:device -- --model RTX1210 --host 192.168.100.1 --username admin --password xxxx [--repeat 20] [--commands show_system,show_route]",
        );
    }

    return { model, host, username, password, transport, port, repeat, commands };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const connId = await connect({
        model: args.model,
        host: args.host,
        username: args.username,
        password: args.password,
        transport: args.transport,
        port: args.port,
    });

    const conn = getConnection(connId);
    if (!conn) throw new Error("Failed to resolve connection");

    const commandKeys = args.commands && args.commands.length > 0
        ? args.commands
        : Object.keys(conn.config.commands);

    const stats = new Map<string, { ok: number; ng: number; totalMs: number; empty: number }>();
    for (const key of commandKeys) {
        stats.set(key, { ok: 0, ng: 0, totalMs: 0, empty: 0 });
    }

    console.log(
        `[probe] model=${args.model} host=${args.host} transport=${conn.config.transport} repeat=${args.repeat} commands=${commandKeys.join(",")}`,
    );

    try {
        for (let i = 1; i <= args.repeat; i++) {
            console.log(`\n[loop ${i}/${args.repeat}]`);
            for (const key of commandKeys) {
                const stat = stats.get(key)!;
                const cmdConfig = conn.config.commands[key];
                if (!cmdConfig) {
                    stat.ng += 1;
                    console.log(`  - ${key}: NG (unknown command key)`);
                    continue;
                }

                const started = Date.now();
                try {
                    const raw = await executeCommand(connId, cmdConfig.cmd);
                    const elapsed = Date.now() - started;
                    const output = raw.trim();
                    stat.ok += 1;
                    stat.totalMs += elapsed;
                    if (!output) stat.empty += 1;
                    console.log(`  - ${key}: OK ${elapsed}ms${output ? "" : " (empty output)"}`);
                } catch (err) {
                    const elapsed = Date.now() - started;
                    stat.ng += 1;
                    const msg = (err as Error).message.replace(/\s+/g, " ").trim();
                    console.log(`  - ${key}: NG ${elapsed}ms (${msg})`);
                }
            }
        }
    } finally {
        await disconnect(connId);
    }

    console.log("\n[summary]");
    let totalNg = 0;
    for (const key of commandKeys) {
        const stat = stats.get(key)!;
        totalNg += stat.ng;
        const avgMs = stat.ok > 0 ? Math.round(stat.totalMs / stat.ok) : 0;
        console.log(
            `  - ${key}: ok=${stat.ok} ng=${stat.ng} empty=${stat.empty} avg=${avgMs}ms`,
        );
    }

    if (totalNg > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(`[probe] failed: ${(err as Error).message}`);
    process.exit(1);
});
