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

test("Yamaha environment output accepts full-width separators", () => {
    const result = parseOutput([
        "CPU の使用量： 7%",
        "メモリの使用量： 42%",
        "パケットバッファの使用量： 3%",
    ].join("\n"), "yamaha_system");

    assert.equal(result.data?.["CPU の使用量"], "7%");
    assert.equal(result.data?.["メモリの使用量"], "42%");
    assert.equal(result.data?.["パケットバッファの使用量"], "3%");
});

test("Yamaha environment output extracts inline system values", () => {
    const result = parseOutput([
        "RTX1210 Rev.14.01.42 (Fri Jul 18 10:00:00 2025)",
        "  main: RTX1210 ver=00 serial=S12345678",
        "CPU: 7%(5sec) 5%(1min) 4%(5min)  Memory: 42% used",
        "Firmware: exec0  Config. file: config0",
        "Default firmware: exec0  Default config. file: config0",
        "Serial Baudrate: 9600",
        "Boot time: 2025/07/18 09:00:00 +09:00",
        "Current time: 2025/07/18 10:00:00 +09:00",
    ].join("\n"), "yamaha_system");

    assert.equal(result.data?.["Serial Number"], "S12345678");
    assert.equal(result.data?.CPU, "7%(5sec) 5%(1min) 4%(5min)");
    assert.equal(result.data?.Memory, "42% used");
    assert.equal(result.data?.Firmware, "exec0");
    assert.equal(result.data?.["Serial Baud Rate"], "9600");
    assert.equal(result.data?.["Boot Time"], "2025/07/18 09:00:00 +09:00");
    assert.equal(result.data?.["Current Time"], "2025/07/18 10:00:00 +09:00");
});
