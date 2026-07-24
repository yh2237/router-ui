import test from "node:test";
import assert from "node:assert/strict";
import { parseOutput } from "./parsers.js";

test("Yamaha environment output is parsed as key/value data", () => {
    const raw = [
        "システムのリビジョン: Rev.14.01.42",
        "CPU の使用量: 12%",
        "メモリの使用量: 38%",
    ].join("\n");

    const result = parseOutput(raw, "yamaha_system");

    assert.equal(result.type, "keyvalue");
    assert.equal(result.data?.["システムのリビジョン"], "Rev.14.01.42");
    assert.equal(result.data?.["CPU の使用量"], "12%");
});
