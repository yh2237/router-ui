import test from "node:test";
import assert from "node:assert/strict";
import { renderDevicePanel } from "./device-panel.js";
import type { DevicePanelConfig } from "./types.js";

const panel: DevicePanelConfig = {
    model: "TEST",
    width: 320,
    height: 160,
    theme: "neutral",
    elements: [
        {
            type: "port",
            id: "lan1",
            label: "LAN1",
            portType: "rj45",
            x: 40,
            y: 50,
            width: 60,
            height: 60,
            statusSource: "interface.lan1",
        },
        {
            type: "led",
            id: "alarm",
            label: "ALARM",
            x: 180,
            y: 80,
            align: "left",
            statusSource: "system.alarm",
        },
    ],
};

test("renders panel elements at model-defined coordinates", () => {
    const html = renderDevicePanel(panel, {
        "interface.lan1": { status: "up", detail: "1 Gbit/s" },
        "system.alarm": { status: "warning" },
    });

    assert.match(html, /viewBox="0 0 320 160"/);
    assert.match(html, /data-panel-element="lan1"/);
    assert.match(html, /panel-state-up/);
    assert.match(html, /data-panel-element="alarm"/);
    assert.match(html, /panel-state-warning/);
    assert.match(html, /x="165"/);
});

test("does not claim a physical switch-port state from only an aggregate interface state", () => {
    const grouped: DevicePanelConfig = {
        ...panel,
        elements: [{
            type: "port-group",
            id: "switch",
            x: 20,
            y: 20,
            columns: 1,
            portWidth: 50,
            portHeight: 40,
            ports: [{ id: "lan1.1", label: "1", statusSource: "interface.lan1.port.1" }],
        }],
    };
    const html = renderDevicePanel(grouped, {
        "interface.lan1": { status: "up" },
    });

    assert.match(html, /panel-state-unknown/);
    assert.doesNotMatch(html, /panel-state-up[^"]*"[^>]*data-panel-element="lan1\.1"/);
});
