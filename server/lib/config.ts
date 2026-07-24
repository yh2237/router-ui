import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { deepMerge } from "./merge.js";
import type { SeriesConfig, ModelEntry, ResolvedConfig, TransportType } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVICES_DIR = resolve(__dirname, "../../devices");

function loadYaml<T>(filePath: string): T {
    const raw = readFileSync(filePath, "utf-8");
    return yaml.load(raw) as T;
}

export function loadModels(): ModelEntry[] {
    const path = resolve(DEVICES_DIR, "models.yaml");
    return loadYaml<ModelEntry[]>(path);
}

export function loadSeries(name: string): SeriesConfig {
    const path = resolve(DEVICES_DIR, "series", `${name}.yaml`);
    if (!existsSync(path)) {
        throw new Error(`Series config not found: ${name}`);
    }
    return loadYaml<SeriesConfig>(path);
}

export function resolveConfig(model: string): ResolvedConfig {
    const models = loadModels();
    const entry = models.find((m) => m.model === model);
    if (!entry) {
        throw new Error(`Unknown model: ${model}`);
    }
    const series = loadSeries(entry.series);
    const config = entry.overrides
        ? deepMerge(series as unknown as Record<string, unknown>, entry.overrides as unknown as Record<string, unknown>)
        : { ...series };
    return { ...config, model } as unknown as ResolvedConfig;
}

export function listModels(): { model: string; series: string; vendor: string; transport: TransportType }[] {
    const models = loadModels();
    const seen = new Set<string>();
    const result: { model: string; series: string; vendor: string; transport: TransportType }[] = [];
    for (const entry of models) {
        if (seen.has(entry.model)) continue;
        seen.add(entry.model);
        const series = loadSeries(entry.series);
        result.push({ model: entry.model, series: entry.series, vendor: series.vendor, transport: series.transport });
    }
    return result;
}

export function groupBySeries(): { series: string; vendor: string; models: { model: string }[] }[] {
    const models = loadModels();
    const groups = new Map<string, { vendor: string; models: { model: string }[] }>();
    for (const entry of models) {
        const series = loadSeries(entry.series);
        if (!groups.has(entry.series)) {
            groups.set(entry.series, { vendor: series.vendor, models: [] });
        }
        groups.get(entry.series)!.models.push({ model: entry.model });
    }
    return Array.from(groups.entries()).map(([series, data]) => ({
        series,
        vendor: data.vendor,
        models: data.models,
    }));
}
