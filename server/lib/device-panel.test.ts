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

test("renders PNG parts from a v2 catalog and switches their state asset", () => {
    const imagePanel: DevicePanelConfig = {
        schemaVersion: 2,
        model: "IMAGE",
        width: 200,
        height: 100,
        theme: "yamaha",
        background: { part: "background", x: 0, y: 0, width: 200, height: 100 },
        partCatalog: {
            schemaVersion: 1,
            vendor: "test",
            parts: {
                background: {
                    kind: "background",
                    size: [200, 100],
                    states: { unknown: "/img/background.png" },
                },
                lamp: {
                    kind: "led",
                    size: [20, 8],
                    states: {
                        unknown: "/img/lamp-off.png",
                        down: "/img/lamp-off.png",
                        up: "/img/lamp-on.png",
                    },
                },
            },
        },
        elements: [{
            type: "led",
            id: "power",
            label: "POWER",
            part: "lamp",
            x: 20,
            y: 70,
            width: 20,
            height: 8,
            rotation: 180,
            statusSource: "system.power",
        }],
    };

    const html = renderDevicePanel(imagePanel, {
        "system.power": { status: "up" },
    });

    assert.match(html, /href="\/img\/background\.png"/);
    assert.match(html, /href="\/img\/lamp-on\.png"/);
    assert.match(html, /transform="rotate\(180 30 74\)"/);
    assert.match(html, /data-panel-element="power"/);
    assert.doesNotMatch(html, /panel-chassis/);
});
