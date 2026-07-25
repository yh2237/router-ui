import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticCommand } from "./diagnostics.js";

test("builds allowlisted Yamaha diagnostic commands", () => {
    assert.equal(buildDiagnosticCommand("ping", "192.0.2.1", 4), "ping -c 4 192.0.2.1");
    assert.equal(buildDiagnosticCommand("traceroute", "example.net", 4), "traceroute example.net");
});

test("rejects command injection and invalid counts", () => {
    assert.throws(() => buildDiagnosticCommand("ping", "example.net;save", 4), /Invalid target/);
    assert.throws(() => buildDiagnosticCommand("ping", "-c", 4), /Invalid target/);
    assert.throws(() => buildDiagnosticCommand("ping", "example.net", 11), /Invalid count/);
});
