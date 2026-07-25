import type {
    DevicePanelConfig,
    PanelElement,
    PanelLedElement,
    PanelPortDefinition,
    PanelPortElement,
    PanelPortGroupElement,
    PanelState,
} from "./types.js";

export interface PanelRuntimeValue {
    status: PanelState;
    detail?: string;
}

export type PanelRuntimeState = Record<string, PanelRuntimeValue>;

export function renderDevicePanel(panel: DevicePanelConfig, state: PanelRuntimeState): string {
    const elements = panel.elements.map((element) => renderElement(element, state)).join("");
    const title = `${panel.brand ? `${panel.brand} ` : ""}${panel.model} 前面パネル`;

    return `
        <figure class="device-panel device-panel--${escapeAttr(panel.theme)}">
            <svg class="device-panel-svg" viewBox="0 0 ${panel.width} ${panel.height}"
                role="img" aria-labelledby="device-panel-title device-panel-desc">
                <title id="device-panel-title">${escapeHtml(title)}</title>
                <desc id="device-panel-desc">各ポートとランプの状態を実機の配置に合わせて表示します。</desc>
                <rect class="panel-chassis" x="1" y="1" width="${panel.width - 2}" height="${panel.height - 2}" rx="8" />
                <rect class="panel-face" x="14" y="14" width="${panel.width - 28}" height="${panel.height - 28}" rx="3" />
                ${elements}
            </svg>
            <figcaption class="device-panel-legend">
                <span><i class="panel-legend-dot panel-state-up"></i>リンクアップ</span>
                <span><i class="panel-legend-dot panel-state-down"></i>リンクダウン</span>
                <span><i class="panel-legend-dot panel-state-warning"></i>警告</span>
                <span><i class="panel-legend-dot panel-state-unknown"></i>未取得</span>
            </figcaption>
        </figure>
    `;
}

function renderElement(element: PanelElement, state: PanelRuntimeState): string {
    switch (element.type) {
        case "port-group":
            return renderPortGroup(element, state);
        case "port":
            return renderPort(element, state);
        case "led":
            return renderLed(element, state);
        case "label":
            return `<text class="panel-label panel-label--${element.size ?? "sm"}" x="${element.x}" y="${element.y}" text-anchor="${element.align ?? "start"}">${escapeHtml(element.text)}</text>`;
    }
}

function renderPortGroup(group: PanelPortGroupElement, state: PanelRuntimeState): string {
    const gapX = group.gapX ?? 6;
    const gapY = group.gapY ?? 6;
    const rows = Math.ceil(group.ports.length / group.columns);
    const width = group.columns * group.portWidth + Math.max(0, group.columns - 1) * gapX;
    const height = rows * group.portHeight + Math.max(0, rows - 1) * gapY;
    const ports = group.ports.map((port, index) => {
        const column = index % group.columns;
        const row = Math.floor(index / group.columns);
        const x = group.x + column * (group.portWidth + gapX);
        const y = group.y + row * (group.portHeight + gapY);
        return renderSocket(port, x, y, group.portWidth, group.portHeight, state);
    }).join("");

    return `
        <g class="panel-port-group" data-panel-element="${escapeAttr(group.id)}">
            ${group.label ? `<text class="panel-group-label" x="${group.x + width / 2}" y="${group.y - 9}" text-anchor="middle">${escapeHtml(group.label)}</text>` : ""}
            <rect class="panel-group-frame" x="${group.x - 6}" y="${group.y - 5}" width="${width + 12}" height="${height + 10}" rx="3" />
            ${ports}
        </g>
    `;
}

function renderPort(port: PanelPortElement, state: PanelRuntimeState): string {
    const value = resolveState(port.statusSource, state);
    const labelY = port.y - 9;
    const title = panelItemTitle(port.label, value);
    const cavityInset = Math.max(7, Math.min(port.width, port.height) * 0.18);

    return `
        <g class="panel-port panel-port--${escapeAttr(port.portType)} panel-state-${value.status}"
            data-panel-element="${escapeAttr(port.id)}" tabindex="0" role="group"
            aria-label="${escapeAttr(title)}">
            <title>${escapeHtml(title)}</title>
            <text class="panel-port-label" x="${port.x + port.width / 2}" y="${labelY}" text-anchor="middle">${escapeHtml(port.label)}</text>
            <rect class="panel-port-shell" x="${port.x}" y="${port.y}" width="${port.width}" height="${port.height}" rx="3" />
            <rect class="panel-port-cavity" x="${port.x + cavityInset}" y="${port.y + cavityInset}"
                width="${Math.max(8, port.width - cavityInset * 2)}" height="${Math.max(8, port.height - cavityInset * 1.55)}" rx="2" />
            <circle class="panel-port-led" cx="${port.x + port.width - 8}" cy="${port.y + 8}" r="4" />
        </g>
    `;
}

function renderSocket(
    port: PanelPortDefinition,
    x: number,
    y: number,
    width: number,
    height: number,
    state: PanelRuntimeState,
): string {
    const value = resolveState(port.statusSource, state);
    const title = panelItemTitle(port.label, value);
    return `
        <g class="panel-port panel-port--switch panel-state-${value.status}"
            data-panel-element="${escapeAttr(port.id)}" tabindex="0" role="group"
            aria-label="${escapeAttr(title)}">
            <title>${escapeHtml(title)}</title>
            <rect class="panel-port-shell" x="${x}" y="${y}" width="${width}" height="${height}" rx="2" />
            <rect class="panel-port-cavity" x="${x + 7}" y="${y + 9}" width="${width - 14}" height="${height - 16}" rx="1" />
            <circle class="panel-port-led" cx="${x + width - 7}" cy="${y + 7}" r="3.5" />
            <text class="panel-port-number" x="${x + width / 2}" y="${y + height / 2 + 5}" text-anchor="middle">${escapeHtml(port.label)}</text>
        </g>
    `;
}

function renderLed(led: PanelLedElement, state: PanelRuntimeState): string {
    const value = resolveState(led.statusSource, state);
    const title = panelItemTitle(led.label, value);
    const label = ledLabelPosition(led);
    return `
        <g class="panel-led panel-state-${value.status}" data-panel-element="${escapeAttr(led.id)}"
            tabindex="0" role="group" aria-label="${escapeAttr(title)}">
            <title>${escapeHtml(title)}</title>
            <circle class="panel-led-bezel" cx="${led.x}" cy="${led.y}" r="9" />
            <circle class="panel-led-light" cx="${led.x}" cy="${led.y}" r="5" />
            <text class="panel-led-label" x="${label.x}" y="${label.y}" text-anchor="${label.anchor}">${escapeHtml(led.label)}</text>
        </g>
    `;
}

function ledLabelPosition(led: PanelLedElement): { x: number; y: number; anchor: string } {
    switch (led.align ?? "top") {
        case "right":
            return { x: led.x + 15, y: led.y + 4, anchor: "start" };
        case "bottom":
            return { x: led.x, y: led.y + 25, anchor: "middle" };
        case "left":
            return { x: led.x - 15, y: led.y + 4, anchor: "end" };
        default:
            return { x: led.x, y: led.y - 16, anchor: "middle" };
    }
}

function resolveState(source: string, state: PanelRuntimeState): PanelRuntimeValue {
    if (state[source]) return state[source];
    return { status: "unknown" };
}

function panelItemTitle(label: string, value: PanelRuntimeValue): string {
    const statusLabels: Record<PanelState, string> = {
        up: "稼働中",
        down: "停止",
        warning: "警告",
        error: "エラー",
        unknown: "未取得",
    };
    return `${label}: ${statusLabels[value.status]}${value.detail ? `、${value.detail}` : ""}`;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
