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

export interface PanelPortDefinition {
    id: string;
    label: string;
    statusSource: string;
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
    portType: "rj45" | "console" | "usb" | "sfp" | "other";
    x: number;
    y: number;
    width: number;
    height: number;
    statusSource: string;
}

export interface PanelLedElement {
    type: "led";
    id: string;
    label: string;
    x: number;
    y: number;
    statusSource: string;
    align?: "top" | "right" | "bottom" | "left";
}

export interface PanelLabelElement {
    type: "label";
    id: string;
    text: string;
    x: number;
    y: number;
    size?: "sm" | "md" | "lg";
    align?: "start" | "middle" | "end";
}

export type PanelElement =
    | PanelPortGroupElement
    | PanelPortElement
    | PanelLedElement
    | PanelLabelElement;

export interface DevicePanelConfig {
    model: string;
    width: number;
    height: number;
    theme: "yamaha" | "nec" | "neutral";
    brand?: string;
    elements: PanelElement[];
}

export interface Transport {
    connect(host: string, port: number, opts: TransportOptions): Promise<void>;
    exec(cmd: string, promptRegex: string): Promise<string>;
    close(): Promise<void>;
}

export interface TransportOptions {
    username: string;
    password?: string;
    privateKey?: string;
}

export interface DeviceConnection {
    model: string;
    host: string;
    port: number;
    transport: Transport;
    config: ResolvedConfig;
}
