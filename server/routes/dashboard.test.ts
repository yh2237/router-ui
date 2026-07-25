import test from "node:test";
import assert from "node:assert/strict";
import { detectInterfaceStatus, parsePhysicalPortStates, parseTrafficCounters } from "./dashboard.js";

test("parses RTX LAN octet counters", () => {
    const result = parseTrafficCounters([
        "Transmitted:                    634714322 packets (531184471869 octets)",
        "Received:                       341654254 packets (140312770538 octets)",
    ].join("\n"));
    assert.deepEqual(result, { transmittedOctets: 531184471869, receivedOctets: 140312770538 });
});

test("maps Yamaha link text and physical ports to panel states", () => {
    assert.equal(detectInterfaceStatus("リンクアップ 1000BASE-T Full Duplex"), "up");
    assert.equal(detectInterfaceStatus("リンクダウン"), "down");

    const states = parsePhysicalPortStates("lan1", [
        "ポート1: 1000BASE-T Full Duplex",
        "ポート2: リンクダウン",
    ].join("\n"));

    assert.equal(states["interface.lan1.port.1"].status, "up");
    assert.equal(states["interface.lan1.port.2"].status, "down");
});
