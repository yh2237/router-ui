export type TransportType = "ssh" | "telnet";

export interface CommandConfig {
    cmd: string;
    label?: string;
    description?: string;
    parse?: string;
    fields?: string[];
    category?: string;
}

export interface SeriesConfig {
    vendor: string;
    transport: TransportType;
    prompt_regex: string;
    commands: Record<string, CommandConfig>;
}

export interface ModelEntry {
    model: string;
    series: string;
    panel?: string;
    overrides?: {
        commands?: Record<string, Partial<CommandConfig>>;
        transport?: TransportType;
        prompt_regex?: string;
    };
}

export interface ResolvedConfig extends SeriesConfig {
    model: string;
    panel?: DevicePanelConfig;
}

export type PanelState = "up" | "down" | "warning" | "error" | "unknown";

export interface PanelPartDefinition {
    kind: "background" | "port" | "led" | "button" | "other";
    size: [number, number];
    states: Partial<Record<PanelState, string>> & { unknown: string };
}

export interface PanelPartCatalog {
    schemaVersion: 1;
    vendor: string;
    parts: Record<string, PanelPartDefinition>;
}

export interface PanelBackgroundElement {
    part: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PanelPortDefinition {
    id: string;
    label: string;
    statusSource: string;
    part?: string;
    rotation?: number;
}

export interface PanelPortGroupElement {
    type: "port-group";
    id: string;
    label?: string;
    x: number;
    y: number;
    columns: number;
    portWidth: number;
    portHeight: number;
    gapX?: number;
    gapY?: number;
    ports: PanelPortDefinition[];
}

export interface PanelPortElement {
    type: "port";
    id: string;
    label: string;
    portType?: "rj45" | "console" | "usb" | "sfp" | "other";
    part?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    statusSource: string;
}

export interface PanelLedElement {
    type: "led";
    id: string;
    label: string;
    part?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
    statusSource: string;
    align?: "top" | "right" | "bottom" | "left";
}

export interface PanelLabelElement {
    type: "label";
    id: string;
    text: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    color?: string;
    size?: "sm" | "md" | "lg";
    align?: "start" | "middle" | "end";
}

export type PanelElement =
    | PanelPortGroupElement
    | PanelPortElement
    | PanelLedElement
    | PanelLabelElement;

export interface DevicePanelConfig {
    schemaVersion?: 1 | 2;
    model: string;
    width: number;
    height: number;
    theme: "yamaha" | "nec" | "neutral";
    brand?: string;
    background?: PanelBackgroundElement;
    partCatalog?: PanelPartCatalog;
    elements: PanelElement[];
}

export interface Transport {
    connect(host: string, port: number, opts: TransportOptions): Promise<void>;
    exec(cmd: string, promptRegex: string): Promise<string>;
    uploadFile?(remotePath: string, content: Buffer): Promise<void>;
    removeFile?(remotePath: string): Promise<void>;
    close(): Promise<void>;
}

export interface TransportOptions {
    username: string;
    password?: string;
    privateKey?: string;
    hostKeyVerifier?: (key: Buffer) => boolean;
}

export interface DeviceConnection {
    ownerSessionId: string;
    model: string;
    host: string;
    port: number;
    changeToken: string;
    lastActivityAt: number;
    transport: Transport;
    config: ResolvedConfig;
}
