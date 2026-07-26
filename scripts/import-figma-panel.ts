import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import type {
    DevicePanelConfig,
    PanelElement,
    PanelPartCatalog,
    PanelPartDefinition,
    PanelState,
} from "../server/lib/types.js";

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const STATES: PanelState[] = ["unknown", "down", "up", "warning", "error"];

export interface FigmaPanelBundle {
    formatVersion: 1;
    source: {
        fileKey: string | null;
        pageId: string;
        pageName: string;
        panelNodeId: string;
        exportedAt: string;
    };
    panel: {
        name: string;
        width: number;
        height: number;
        sourceScale: number;
    };
    parts: FigmaPanelPart[];
    instances: FigmaPanelInstance[];
    labels: FigmaPanelLabel[];
    warnings: string[];
}

interface FigmaPanelPart {
    name: string;
    kind: string;
    width: number;
    height: number;
    variants: {
        state: string;
        width: number;
        height: number;
        data: string;
    }[];
}

interface FigmaPanelInstance {
    path: string;
    name: string;
    component: string;
    variant: { state: string };
    kind: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
}

interface FigmaPanelLabel {
    path: string;
    name: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number | null;
    fontFamily: string | null;
    fontStyle: string | null;
    color: string | null;
}

interface PanelBindings {
    formatVersion: 1;
    output: {
        panel: string;
        catalog: string;
    };
    panel: {
        match: string;
        model: string;
        brand?: string;
        vendor: string;
        theme: "yamaha" | "nec" | "neutral";
        sourceScale: number;
        background: {
            path: string;
            part: string;
        };
    };
    parts: Record<string, {
        id: string;
        kind: PanelPartDefinition["kind"];
        assetDirectory: string;
        stateMap: Partial<Record<PanelState, string>>;
    }>;
    elements: Record<string, {
        id: string;
        label: string;
        statusSource: string;
        rotation?: number;
    }>;
}

export interface ImportResult {
    files: Map<string, Buffer>;
    warnings: string[];
}

export function buildPanelImport(
    bundle: FigmaPanelBundle,
    bindings: PanelBindings,
    repositoryRoot: string,
): ImportResult {
    validateBundle(bundle);
    validateBindings(bundle, bindings);

    const scale = bindings.panel.sourceScale;
    const files = new Map<string, Buffer>();
    const warnings = [...bundle.warnings];
    const panelPath = safeRepositoryPath(repositoryRoot, bindings.output.panel);
    const catalogPath = safeRepositoryPath(repositoryRoot, bindings.output.catalog);
    const existingCatalog = existsSync(catalogPath)
        ? yaml.load(readFileSync(catalogPath, "utf8")) as PanelPartCatalog
        : { schemaVersion: 1 as const, vendor: bindings.panel.vendor, parts: {} };
    const catalog: PanelPartCatalog = {
        schemaVersion: 1,
        vendor: bindings.panel.vendor,
        parts: { ...existingCatalog.parts },
    };

    for (const [figmaName, binding] of Object.entries(bindings.parts)) {
        const sourcePart = bundle.parts.find((part) => part.name === figmaName);
        if (!sourcePart) throw new Error(`Figma part not found: ${figmaName}`);

        const states: Partial<Record<PanelState, string>> & { unknown: string } = {
            unknown: "",
        };
        for (const state of STATES) {
            const variantName = binding.stateMap[state];
            if (!variantName) continue;
            const variant = sourcePart.variants.find((item) => item.state === variantName);
            if (!variant) {
                throw new Error(`${figmaName}: variant '${variantName}' required by '${state}' is missing`);
            }
            const assetName = variantName === "base" ? "base.png" : `${safeSlug(variantName)}.png`;
            const assetRelative = `${binding.assetDirectory}/${assetName}`;
            const assetPath = safeRepositoryPath(repositoryRoot, assetRelative);
            const bytes = decodePng(variant.data, `${figmaName}/${variantName}`);
            const dimensions = pngDimensions(bytes);
            if (dimensions.width !== Math.round(variant.width) || dimensions.height !== Math.round(variant.height)) {
                warnings.push(
                    `${figmaName}/${variantName}: PNG ${dimensions.width}x${dimensions.height}, component ${variant.width}x${variant.height}`,
                );
            }
            files.set(assetPath, bytes);
            states[state] = webAssetUrl(assetRelative);
        }
        if (!states.unknown) throw new Error(`${figmaName}: unknown state mapping is required`);
        for (const state of ["warning", "error"] as const) {
            if (binding.stateMap[state] === binding.stateMap.unknown) {
                warnings.push(`${figmaName}: ${state} falls back to the unknown variant`);
            }
        }
        catalog.parts[binding.id] = {
            kind: binding.kind,
            size: [round(sourcePart.width / scale), round(sourcePart.height / scale)],
            states,
        };
    }

    const backgroundInstance = bundle.instances.find(
        (instance) => instance.path === bindings.panel.background.path,
    );
    if (!backgroundInstance) {
        throw new Error(`Background instance not found: ${bindings.panel.background.path}`);
    }

    const elements: PanelElement[] = [];
    for (const instance of bundle.instances) {
        if (instance.path === bindings.panel.background.path) continue;
        const semantic = bindings.elements[instance.path];
        if (!semantic) throw new Error(`Binding not found for instance: ${instance.path}`);
        const partBinding = bindings.parts[instance.component];
        if (!partBinding) throw new Error(`Part binding not found: ${instance.component}`);
        const common = {
            id: semantic.id,
            label: semantic.label,
            part: partBinding.id,
            x: round(instance.x / scale),
            y: round(instance.y / scale),
            width: round(instance.width / scale),
            height: round(instance.height / scale),
            ...(normalizeRotation(instance.rotation ?? semantic.rotation) === 0
                ? {}
                : { rotation: normalizeRotation(instance.rotation ?? semantic.rotation) }),
            statusSource: semantic.statusSource,
        };
        elements.push(instance.kind === "led"
            ? { type: "led", ...common }
            : { type: "port", ...common });
    }

    const labelIds = new Set<string>();
    for (const label of bundle.labels) {
        let id = `label-${safeSlug(label.name)}`;
        let suffix = 2;
        while (labelIds.has(id)) id = `label-${safeSlug(label.name)}-${suffix++}`;
        labelIds.add(id);
        elements.push({
            type: "label",
            id,
            text: label.text,
            x: round(label.x / scale),
            y: round(label.y / scale),
            width: round(label.width / scale),
            height: round(label.height / scale),
            fontSize: label.fontSize ? round(label.fontSize / scale) : undefined,
            fontFamily: label.fontFamily ?? undefined,
            fontWeight: fontWeight(label.fontStyle),
            color: label.color ?? undefined,
        });
    }

    const panel: DevicePanelConfig = {
        schemaVersion: 2,
        model: bindings.panel.model,
        width: round(bundle.panel.width / scale),
        height: round(bundle.panel.height / scale),
        theme: bindings.panel.theme,
        brand: bindings.panel.brand,
        background: {
            part: bindings.panel.background.part,
            x: round(backgroundInstance.x / scale),
            y: round(backgroundInstance.y / scale),
            width: round(backgroundInstance.width / scale),
            height: round(backgroundInstance.height / scale),
        },
        elements,
    };

    files.set(
        panelPath,
        Buffer.from(dumpYaml(panel)),
    );
    files.set(catalogPath, Buffer.from(dumpYaml(catalog)));
    return { files, warnings };
}

export function importPanelBundle(options: {
    bundlePath: string;
    bindingsPath: string;
    repositoryRoot: string;
    write: boolean;
}): ImportResult {
    const bundleFile = readFileSync(options.bundlePath);
    if (bundleFile.byteLength > MAX_BUNDLE_BYTES) {
        throw new Error(`Bundle is larger than ${MAX_BUNDLE_BYTES} bytes`);
    }
    const bundle = JSON.parse(bundleFile.toString("utf8")) as FigmaPanelBundle;
    const bindings = yaml.load(readFileSync(options.bindingsPath, "utf8")) as PanelBindings;
    const result = buildPanelImport(bundle, bindings, options.repositoryRoot);

    for (const [path, content] of result.files) {
        const changed = !existsSync(path) || !readFileSync(path).equals(content);
        console.log(`${changed ? "update" : "unchanged"} ${relative(options.repositoryRoot, path)}`);
        if (options.write && changed) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, content);
        }
    }
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    return result;
}

function validateBundle(bundle: FigmaPanelBundle): void {
    if (bundle.formatVersion !== 1) {
        const unknown = bundle as unknown as Record<string, unknown>;
        if (
            typeof unknown.$comment === "string"
            && unknown.$comment.includes("Figma Raw plugin")
        ) {
            throw new Error(
                "このファイルはFigma Raw pluginの出力で、必要な座標とPNG素材が含まれていません。"
                + "tools/figma-panel-exporter/manifest.jsonをDevelopment pluginとして読み込み、"
                + "完成パネルFrameを選択して「router-ui Panel Exporter」から書き出してください。",
            );
        }
        throw new Error(`Unsupported bundle version: ${String(bundle.formatVersion)}`);
    }
    if (!bundle.panel || !Array.isArray(bundle.parts) || !Array.isArray(bundle.instances)) {
        throw new Error("Invalid router panel bundle");
    }
    for (const value of [
        bundle.panel.width,
        bundle.panel.height,
        bundle.panel.sourceScale,
    ]) {
        if (!Number.isFinite(value) || value <= 0) throw new Error("Panel dimensions and scale must be positive");
    }
    assertUnique(bundle.parts.map((part) => part.name), "part");
    assertUnique(bundle.instances.map((instance) => instance.path), "instance path");
    for (const instance of bundle.instances) {
        for (const value of [instance.x, instance.y, instance.width, instance.height]) {
            if (!Number.isFinite(value)) throw new Error(`${instance.path}: invalid geometry`);
        }
        const rotation = normalizeRotation(instance.rotation);
        if (rotation !== 0 && rotation !== 180) {
            throw new Error(`${instance.path}: only 0 and 180 degree rotations are supported`);
        }
        if (
            instance.x < 0
            || instance.y < 0
            || instance.x + instance.width > bundle.panel.width
            || instance.y + instance.height > bundle.panel.height
        ) {
            throw new Error(`${instance.path}: element is outside the panel bounds`);
        }
    }
}

function validateBindings(bundle: FigmaPanelBundle, bindings: PanelBindings): void {
    if (bindings.formatVersion !== 1) {
        throw new Error(`Unsupported bindings version: ${bindings.formatVersion}`);
    }
    if (bundle.panel.name !== bindings.panel.match) {
        throw new Error(`Selected panel '${bundle.panel.name}' does not match '${bindings.panel.match}'`);
    }
    if (bundle.panel.sourceScale !== bindings.panel.sourceScale) {
        throw new Error(
            `Bundle scale ${bundle.panel.sourceScale} does not match bindings scale ${bindings.panel.sourceScale}`,
        );
    }
    const bundlePaths = new Set(bundle.instances.map((instance) => instance.path));
    for (const path of Object.keys(bindings.elements)) {
        if (!bundlePaths.has(path)) throw new Error(`Bindings path not found in bundle: ${path}`);
    }
}

function safeRepositoryPath(root: string, requested: string): string {
    if (!requested || requested.includes("\0")) throw new Error("Invalid output path");
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, requested);
    if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
        throw new Error(`Output path escapes the repository: ${requested}`);
    }
    return target;
}

function decodePng(value: string, label: string): Buffer {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`${label}: invalid base64`);
    const bytes = Buffer.from(value, "base64");
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error(`${label}: PNG exceeds the size limit`);
    pngDimensions(bytes);
    return bytes;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(signature)) {
        throw new Error("Asset is not a PNG");
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webAssetUrl(relativePath: string): string {
    const normalized = relativePath.split("\\").join("/");
    if (!normalized.startsWith("web/")) {
        throw new Error(`Panel assets must be written below web/: ${relativePath}`);
    }
    return `/${normalized.slice(4)}`;
}

function dumpYaml(value: unknown): string {
    return yaml.dump(value, {
        noRefs: true,
        lineWidth: -1,
        noCompatMode: true,
        quotingType: "\"",
        forceQuotes: true,
    });
}

function assertUnique(values: string[], label: string): void {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
        seen.add(value);
    }
}

function safeSlug(value: string): string {
    const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) throw new Error(`Cannot create a file name from '${value}'`);
    return slug;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function normalizeRotation(value: number | undefined): number {
    if (value === undefined) return 0;
    if (!Number.isFinite(value)) throw new Error("Instance rotation must be a finite number");
    const normalized = ((value % 360) + 360) % 360;
    if (Math.abs(normalized) < 0.001 || Math.abs(normalized - 360) < 0.001) return 0;
    if (Math.abs(normalized - 180) < 0.001) return 180;
    return round(normalized);
}

function fontWeight(style: string | null): number | undefined {
    if (!style) return undefined;
    if (/black|heavy/i.test(style)) return 900;
    if (/extra.?bold/i.test(style)) return 800;
    if (/bold/i.test(style)) return 700;
    if (/semi.?bold/i.test(style)) return 600;
    if (/medium/i.test(style)) return 500;
    if (/light/i.test(style)) return 300;
    return 400;
}

function parseArguments(args: string[]): {
    bundlePath: string;
    bindingsPath: string;
    write: boolean;
} {
    let bundlePath = "";
    let bindingsPath = "";
    let write = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--bundle") bundlePath = args[++index] ?? "";
        else if (arg === "--bindings") bindingsPath = args[++index] ?? "";
        else if (arg === "--write") write = true;
        else if (arg === "--check") write = false;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!bundlePath || !bindingsPath) {
        throw new Error("Usage: npm run panel:import -- --bundle <file> --bindings <file> [--check|--write]");
    }
    return { bundlePath, bindingsPath, write };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
    try {
        const args = parseArguments(process.argv.slice(2));
        importPanelBundle({
            ...args,
            repositoryRoot: process.cwd(),
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
