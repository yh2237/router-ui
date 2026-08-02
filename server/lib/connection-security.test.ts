import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    connect,
    closeIdleConnections,
    disconnect,
    executeCommand,
    getConnection,
    getSavedConnections,
    removeSavedConnection,
    saveConnection,
} from "./connection.js";
import { createHostKeyVerifier, resetKnownHostsForTests } from "./host-keys.js";
import { resetRuntimeConfigForTests } from "./runtime.js";
import type { Transport } from "./types.js";

test("device connections are accessible only to their owning browser session", async () => {
    let closed = false;
    const fakeTransport: Transport = {
        async connect() {},
        async exec(command) {
            return `ran:${command}`;
        },
        async close() {
            closed = true;
        },
    };
    const id = await connect({
        ownerSessionId: "owner-a",
        model: "RTX1210",
        host: "192.0.2.1",
        username: "admin",
        password: "secret",
    }, () => fakeTransport);

    assert.ok(getConnection(id, "owner-a"));
    assert.equal(getConnection(id, "owner-b"), undefined);
    await assert.rejects(executeCommand(id, "owner-b", "show config"), /Not connected/);
    assert.equal(await executeCommand(id, "owner-a", "show environment"), "ran:show environment");
    assert.equal(await disconnect(id, "owner-b"), false);
    assert.equal(await disconnect(id, "owner-a"), true);
    assert.equal(closed, true);
});

test("idle device connections are closed and removed", async () => {
    let closed = false;
    const id = await connect({
        ownerSessionId: "idle-owner",
        model: "RTX1210",
        host: "192.0.2.2",
        username: "admin",
    }, () => ({
        async connect() {},
        async exec() {
            return "";
        },
        async close() {
            closed = true;
        },
    }));

    assert.equal(await closeIdleConnections(Date.now() + 31 * 60_000), 1);
    assert.equal(closed, true);
    assert.equal(getConnection(id, "idle-owner"), undefined);
});

test("SSH TOFU stores the first fingerprint and rejects a changed host key", () => {
    const directory = mkdtempSync(join(tmpdir(), "router-ui-hostkeys-"));
    const previousDataDir = process.env.ROUTER_UI_DATA_DIR;
    process.env.ROUTER_UI_DATA_DIR = directory;
    resetRuntimeConfigForTests();
    resetKnownHostsForTests();

    try {
        const verify = createHostKeyVerifier("192.0.2.1", 22);
        assert.equal(verify(Buffer.from("first-key")), true);
        assert.equal(verify(Buffer.from("first-key")), true);
        assert.throws(() => verify(Buffer.from("changed-key")), /SSHホスト鍵が保存済みの値と一致しません/);

        const stored = JSON.parse(readFileSync(join(directory, "known-hosts.json"), "utf8")) as Record<string, unknown>;
        assert.ok(stored["192.0.2.1:22"]);
    } finally {
        if (previousDataDir === undefined) delete process.env.ROUTER_UI_DATA_DIR;
        else process.env.ROUTER_UI_DATA_DIR = previousDataDir;
        resetRuntimeConfigForTests();
        resetKnownHostsForTests();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("saved connection history persists without authentication secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "router-ui-history-"));
    const previousDataDir = process.env.ROUTER_UI_DATA_DIR;
    process.env.ROUTER_UI_DATA_DIR = directory;
    resetRuntimeConfigForTests();

    try {
        saveConnection({
            ownerSessionId: "owner-a",
            model: "RTX1210",
            host: "192.0.2.1",
            port: 22,
            transport: "ssh",
            username: "admin",
            password: "must-not-be-stored",
            privateKey: "must-not-be-stored",
        });
        const raw = readFileSync(join(directory, "connections.json"), "utf8");
        assert.doesNotMatch(raw, /must-not-be-stored|password|privateKey/);
        assert.match(raw, /RTX1210/);
        assert.equal(getSavedConnections()[0]?.host, "192.0.2.1");
        removeSavedConnection(0);
    } finally {
        if (previousDataDir === undefined) delete process.env.ROUTER_UI_DATA_DIR;
        else process.env.ROUTER_UI_DATA_DIR = previousDataDir;
        resetRuntimeConfigForTests();
        rmSync(directory, { recursive: true, force: true });
    }
});
