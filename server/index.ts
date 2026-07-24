import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import app, { setupWebSocket } from "./app.js";

const port = parseInt(process.env.PORT || "3000", 10);

const server = serve(
    { fetch: app.fetch, port },
    (info) => {
        console.log(`Router-UI started on http://localhost:${info.port}`);
    },
) as unknown as Server;

setupWebSocket(server);
