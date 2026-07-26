import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPanelImport, type FigmaPanelBundle } from "./import-figma-panel.js";

function png(width: number, height: number): string {
    const value = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
    value.writeUInt32BE(width, 16);
    value.writeUInt32BE(height, 20);
    return value.toString("base64");
}

test("builds deterministic panel, catalog, and PNG outputs", () => {
    const root = mkdtempSync(join(tmpdir(), "router-panel-"));
    const bundle: FigmaPanelBundle = {
        formatVersion: 1,
        source: {
            fileKey: "file",
            pageId: "0:1",
            pageName: "YAMAHA",
            panelNodeId: "1:1",
            exportedAt: "2026-07-26T00:00:00.000Z",
        },
        panel: { name: "Panel", width: 200, height: 100, sourceScale: 2 },
        parts: [
            {
                name: "Base",
                kind: "background",
                width: 200,
                height: 100,
                variants: [{ state: "base", width: 200, height: 100, data: png(200, 100) }],
            },
            {
                name: "Lamp",
                kind: "led",
                width: 20,
                height: 10,
                variants: [
                    { state: "down", width: 20, height: 10, data: png(20, 10) },
                    { state: "up", width: 20, height: 10, data: png(20, 10) },
                    { state: "warning", width: 20, height: 10, data: png(20, 10) },
                    { state: "error", width: 20, height: 10, data: png(20, 10) },
                ],
            },
        ],
        instances: [
            {
                path: "Base",
                name: "Base",
                component: "Base",
                variant: { state: "base" },
                kind: "background",
                x: 0,
                y: 0,
                width: 200,
                height: 100,
            },
            {
                path: "Lamp/POWER",
                name: "POWER",
                component: "Lamp",
                variant: { state: "down" },
                kind: "led",
                x: 20,
                y: 70,
                width: 20,
                height: 10,
                rotation: 180,
            },
        ],
        labels: [],
        warnings: [],
    };
    const bindings = {
        formatVersion: 1 as const,
        output: { panel: "devices/panels/test.yaml", catalog: "devices/parts/test.yaml" },
        panel: {
            match: "Panel",
            model: "TEST",
            vendor: "test",
            theme: "neutral" as const,
            sourceScale: 2,
            background: { path: "Base", part: "test.background" },
        },
        parts: {
            Base: {
                id: "test.background",
                kind: "background" as const,
                assetDirectory: "web/img/device-panels/test/background",
                stateMap: { unknown: "base" },
            },
            Lamp: {
                id: "test.led",
                kind: "led" as const,
                assetDirectory: "web/img/device-panels/test/led",
                stateMap: {
                    unknown: "down",
                    down: "down",
                    up: "up",
                    warning: "warning",
                    error: "error",
                },
            },
        },
        elements: {
            "Lamp/POWER": { id: "power", label: "POWER", statusSource: "system.power" },
        },
    };

    const result = buildPanelImport(bundle, bindings, root);
    const panel = result.files.get(join(root, "devices/panels/test.yaml"))?.toString();
    const catalog = result.files.get(join(root, "devices/parts/test.yaml"))?.toString();

    assert.match(panel ?? "", /width: 100/);
    assert.match(panel ?? "", /x: 10/);
    assert.match(panel ?? "", /statusSource: "system.power"/);
    assert.match(panel ?? "", /rotation: 180/);
    assert.match(catalog ?? "", /test\.led/);
    assert.ok(result.files.has(join(root, "web/img/device-panels/test/led/up.png")));
    assert.ok(result.files.has(join(root, "web/img/device-panels/test/led/down.png")));
    assert.ok(result.files.has(join(root, "web/img/device-panels/test/led/warning.png")));
    assert.ok(result.files.has(join(root, "web/img/device-panels/test/led/error.png")));
});

test("rejects output paths outside the repository", () => {
    const root = mkdtempSync(join(tmpdir(), "router-panel-"));
    assert.throws(
        () => buildPanelImport({
            formatVersion: 1,
            source: {
                fileKey: null,
                pageId: "0:1",
                pageName: "TEST",
                panelNodeId: "1:1",
                exportedAt: "2026-07-26T00:00:00.000Z",
            },
            panel: { name: "Panel", width: 10, height: 10, sourceScale: 1 },
            parts: [],
            instances: [],
            labels: [],
            warnings: [],
        }, {
            formatVersion: 1,
            output: { panel: "../outside.yaml", catalog: "devices/parts/test.yaml" },
            panel: {
                match: "Panel",
                model: "TEST",
                vendor: "test",
                theme: "neutral",
                sourceScale: 1,
                background: { path: "Base", part: "test.background" },
            },
            parts: {},
            elements: {},
        }, root),
        /escapes the repository/,
    );
});

test("explains when a Figma Raw export is passed by mistake", () => {
    const root = mkdtempSync(join(tmpdir(), "router-panel-"));
    assert.throws(
        () => buildPanelImport({
            $comment: "This is structural design data exported by the Figma Raw plugin.",
            name: "Panel",
        } as unknown as FigmaPanelBundle, {
            formatVersion: 1,
            output: { panel: "devices/panels/test.yaml", catalog: "devices/parts/test.yaml" },
            panel: {
                match: "Panel",
                model: "TEST",
                vendor: "test",
                theme: "neutral",
                sourceScale: 1,
                background: { path: "Base", part: "test.background" },
            },
            parts: {},
            elements: {},
        }, root),
        /Figma Raw plugin.*router-ui Panel Exporter/,
    );
});
