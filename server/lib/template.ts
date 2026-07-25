import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compiledTemplatesDir = resolve(__dirname, "../../web/templates");
const sourceTemplatesDir = resolve(__dirname, "../../../web/templates");
const TEMPLATES_DIR = existsSync(compiledTemplatesDir) ? compiledTemplatesDir : sourceTemplatesDir;

const cache = new Map<string, string>();

export function loadTemplate(name: string): string {
    if (cache.has(name)) return cache.get(name)!;
    const path = resolve(TEMPLATES_DIR, name);
    const content = readFileSync(path, "utf-8");
    cache.set(name, content);
    return content;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
    let html = loadTemplate(template);
    for (const [key, val] of Object.entries(vars)) {
        html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }
    return html;
}
