import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExecOutput } from "./ssh.js";

test("normalizeExecOutput trims and normalizes newlines", () => {
    const raw = "line1\r\nline2\r\n";
    assert.equal(normalizeExecOutput(raw), "line1\nline2");
});

test("normalizeExecOutput removes ansi escapes", () => {
    const raw = "\u001b[32mOK\u001b[0m\r\n";
    assert.equal(normalizeExecOutput(raw), "OK");
});
