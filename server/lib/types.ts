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
    overrides?: {
        commands?: Record<string, Partial<CommandConfig>>;
        transport?: TransportType;
        prompt_regex?: string;
    };
}

export interface ResolvedConfig extends SeriesConfig {
    model: string;
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
