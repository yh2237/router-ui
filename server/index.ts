import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import app from "./app.js";
import { cleanupExpiredSessions } from "./lib/auth.js";
import {
    closeAllConnections,
    closeIdleConnections,
    disconnectOwnedConnections,
} from "./lib/connection.js";
import { getRuntimeConfig } from "./lib/runtime.js";

const config = getRuntimeConfig();

const server = serve(
    { fetch: app.fetch, port: config.port, hostname: config.host },
    (info) => {
        console.log(`Router-UI started on http://${config.host}:${info.port}`);
    },
) as unknown as Server;

const cleanupTimer = setInterval(async () => {
    const expiredOwners = cleanupExpiredSessions();
    await Promise.all(expiredOwners.map((owner) => disconnectOwnedConnections(owner)));
    await closeIdleConnections();
}, 60_000);
cleanupTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
        clearInterval(cleanupTimer);
        await closeAllConnections();
        server.close(() => process.exit(0));
    });
}
