import test from "node:test";
import assert from "node:assert/strict";
import {
    detectInterfaceStatus,
    ifaceRowHtml,
    parsePhysicalPortStates,
    parseTrafficCounters,
    renderInterfaceOverview,
} from "./dashboard.js";

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

test("renders interface information as labelled panel and table regions", () => {
    const row = ifaceRowHtml("LAN1", "up", "192.0.2.1/24", "1000BASE-T");
    const html = renderInterfaceOverview("<figure class=\"device-panel\"></figure>", [row]);

    assert.match(html, /interface-panel-region/);
    assert.match(html, /論理インターフェース/);
    assert.match(html, /1件/);
    assert.match(html, /role="table"/);
    assert.match(html, /リンクアップ/);
    assert.match(html, /192\.0\.2\.1\/24/);
});

test("omits the front-panel region when the model has no panel definition", () => {
    const html = renderInterfaceOverview("", [
        ifaceRowHtml("<LAN>", "unknown", "-", "-", true),
    ]);

    assert.doesNotMatch(html, /interface-panel-region/);
    assert.match(html, /interface-workbench--list-only/);
    assert.match(html, /&lt;LAN&gt;/);
    assert.match(html, /取得失敗/);
});
