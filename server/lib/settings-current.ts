import { redactConfigLine } from "./settings.js";

export interface CurrentSettingsSnapshot {
    state: "configured" | "default" | "unavailable";
    lines: string[];
    message: string;
}

export interface InterfaceAddressSetting {
    name: "lan1" | "lan2" | "lan3";
    ipv4Mode: "static" | "dhcp" | "unconfigured";
    ipv4Address: string;
    ipv6Mode: "static" | "auto" | "dhcp" | "unconfigured";
    ipv6Address: string;
}

export interface DnsSetting {
    servers: string[];
    privateAddressSpoof: "on" | "off" | "default";
}

export interface StaticRouteSetting {
    index: number;
    network: string;
    gatewayType: "address" | "dhcp" | "pp" | "tunnel" | "null" | "unsupported";
    gateway: string;
    metric: string;
    hide: boolean;
    editable: boolean;
    raw: string;
}

export interface NatDescriptorSetting {
    descriptor: string;
    type: string;
    outer: string;
    inner: string;
    interfaces: string[];
    editable: boolean;
}

export interface DhcpScopeSetting {
    scope: string;
    startAddress: string;
    endAddress: string;
    prefix: string;
    gateway: string;
    expire: string;
    editable: boolean;
    raw: string;
}

export interface DhcpSetting {
    service: "server" | "relay" | "off" | "default";
    scopes: DhcpScopeSetting[];
}

const SECTION_PATTERNS: Record<string, readonly RegExp[]> = {
    time: [/^timezone\s/i, /^ntp(?:date|\s)/i],
    interfaces: [/^(?:ip|ipv6)\s+lan\d+\s+address\s/i],
    "lan-mode": [/^lan\s+type\s/i],
    routing: [/^(?:ip|ipv6)\s+route\s/i],
    nat: [/^nat\s+descriptor\s/i, /^ip\s+\S+\s+nat\s+descriptor\s/i],
    dns: [/^dns\s/i],
    dhcp: [/^dhcp\s/i],
    "ip-filter": [
        /^(?:ip|ipv6)\s+filter\s/i,
        /^(?:ip|ipv6)\s+\S+\s+secure\s+filter\s/i,
    ],
    "url-filter": [/^url\s/i],
    provider: [
        /^pp\s+select\s/i,
        /^pppoe\s+/i,
        /^pp\s+auth\s/i,
        /^pp\s+always-on\s/i,
        /^ip\s+pp\s/i,
        /^(?:no\s+)?pp\s+enable\s/i,
    ],
    vpn: [
        /^tunnel\s+select\s/i,
        /^ipsec\s/i,
        /^(?:no\s+)?tunnel\s+enable\s/i,
    ],
    logging: [/^syslog\s/i],
    snmp: [/^snmp\s/i],
    upnp: [/^upnp\s/i],
};

export function extractCurrentSettings(rawConfig: string, section: string): CurrentSettingsSnapshot {
    const patterns = SECTION_PATTERNS[section];
    if (!patterns) {
        return {
            state: "unavailable",
            lines: [],
            message: "この項目は現在設定の抽出にまだ対応していません。",
        };
    }

    const lines = rawConfig
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && patterns.some((pattern) => pattern.test(line)))
        .map(redactConfigLine);

    if (lines.length === 0) {
        return {
            state: "default",
            lines: [],
            message: "明示設定はありません。機器の既定値で動作しています。",
        };
    }

    return {
        state: "configured",
        lines,
        message: `${lines.length}件の関連設定を取得しました。`,
    };
}

export function unavailableCurrentSettings(message = "現在設定を取得できませんでした。"): CurrentSettingsSnapshot {
    return { state: "unavailable", lines: [], message };
}

export function parseInterfaceAddressSettings(rawConfig: string): InterfaceAddressSetting[] {
    const rows: InterfaceAddressSetting[] = (["lan1", "lan2", "lan3"] as const).map((name) => ({
        name,
        ipv4Mode: "unconfigured",
        ipv4Address: "",
        ipv6Mode: "unconfigured",
        ipv6Address: "",
    }));
    const byName = new Map(rows.map((row) => [row.name, row]));

    for (const line of configLines(rawConfig)) {
        const ipv4 = /^ip\s+(lan[1-3])\s+address\s+(.+)$/i.exec(line);
        if (ipv4) {
            const row = byName.get(ipv4[1].toLowerCase() as InterfaceAddressSetting["name"]);
            if (row) {
                row.ipv4Mode = ipv4[2].toLowerCase() === "dhcp" ? "dhcp" : "static";
                row.ipv4Address = row.ipv4Mode === "static" ? ipv4[2] : "";
            }
            continue;
        }

        const ipv6 = /^ipv6\s+(lan[1-3])\s+address\s+(.+)$/i.exec(line);
        if (!ipv6) continue;
        const row = byName.get(ipv6[1].toLowerCase() as InterfaceAddressSetting["name"]);
        if (!row) continue;
        const value = ipv6[2];
        row.ipv6Mode = value.toLowerCase() === "auto"
            ? "auto"
            : value.toLowerCase() === "dhcp"
                ? "dhcp"
                : "static";
        row.ipv6Address = row.ipv6Mode === "static" ? value : "";
    }
    return rows;
}

export function parseDnsSetting(rawConfig: string): DnsSetting {
    const result: DnsSetting = { servers: [], privateAddressSpoof: "default" };
    for (const line of configLines(rawConfig)) {
        const servers = /^dns\s+server\s+(.+)$/i.exec(line);
        if (servers) {
            result.servers = servers[1].trim().split(/\s+/).filter(Boolean);
            continue;
        }
        const spoof = /^dns\s+private\s+address\s+spoof\s+(on|off)$/i.exec(line);
        if (spoof) result.privateAddressSpoof = spoof[1].toLowerCase() as "on" | "off";
    }
    return result;
}

export function parseStaticRoutes(rawConfig: string): StaticRouteSetting[] {
    const routes: StaticRouteSetting[] = [];
    for (const line of configLines(rawConfig)) {
        const match = /^ip\s+route\s+(\S+)\s+gateway\s+(.+)$/i.exec(line);
        if (!match) continue;
        let gatewayPart = match[2].trim();
        const hide = /(?:^|\s)hide$/i.test(gatewayPart);
        if (hide) gatewayPart = gatewayPart.replace(/\s+hide$/i, "").trim();
        const metricMatch = /\s+metric\s+(\d+)$/i.exec(gatewayPart);
        const metric = metricMatch?.[1] ?? "";
        if (metricMatch) gatewayPart = gatewayPart.slice(0, metricMatch.index).trim();

        let gatewayType: StaticRouteSetting["gatewayType"] = "unsupported";
        let gateway = gatewayPart;
        if (/^dhcp\s+lan[1-3]$/i.test(gatewayPart)) {
            gatewayType = "dhcp";
            gateway = gatewayPart.split(/\s+/)[1].toLowerCase();
        } else if (/^pp\s+\d+$/i.test(gatewayPart)) {
            gatewayType = "pp";
            gateway = gatewayPart.split(/\s+/)[1];
        } else if (/^tunnel\s+\d+$/i.test(gatewayPart)) {
            gatewayType = "tunnel";
            gateway = gatewayPart.split(/\s+/)[1];
        } else if (/^null$/i.test(gatewayPart)) {
            gatewayType = "null";
            gateway = "";
        } else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(gatewayPart)) {
            gatewayType = "address";
        }
        routes.push({
            index: routes.length,
            network: match[1],
            gatewayType,
            gateway,
            metric,
            hide,
            editable: gatewayType !== "unsupported",
            raw: line,
        });
    }
    return routes;
}

export function parseNatDescriptors(rawConfig: string): NatDescriptorSetting[] {
    const descriptors = new Map<string, NatDescriptorSetting>();
    const ensure = (descriptor: string): NatDescriptorSetting => {
        const existing = descriptors.get(descriptor);
        if (existing) return existing;
        const created = { descriptor, type: "", outer: "", inner: "", interfaces: [], editable: false };
        descriptors.set(descriptor, created);
        return created;
    };
    for (const line of configLines(rawConfig)) {
        const type = /^nat\s+descriptor\s+type\s+(\d+)\s+(\S+)$/i.exec(line);
        if (type) {
            const row = ensure(type[1]);
            row.type = type[2];
            row.editable = ["none", "nat", "masquerade", "nat-masquerade"].includes(type[2]);
            continue;
        }
        const address = /^nat\s+descriptor\s+address\s+(outer|inner)\s+(\d+)\s+(.+)$/i.exec(line);
        if (address) {
            ensure(address[2])[address[1].toLowerCase() as "outer" | "inner"] = address[3];
            continue;
        }
        const attachment = /^ip\s+(lan[1-3])\s+nat\s+descriptor\s+(.+)$/i.exec(line);
        if (attachment) {
            for (const descriptor of attachment[2].trim().split(/\s+/)) {
                if (/^\d+$/.test(descriptor)) ensure(descriptor).interfaces.push(attachment[1].toLowerCase());
            }
        }
    }
    return [...descriptors.values()].sort((a, b) => Number(a.descriptor) - Number(b.descriptor));
}

export function parseDhcpSetting(rawConfig: string): DhcpSetting {
    const result: DhcpSetting = { service: "default", scopes: [] };
    for (const line of configLines(rawConfig)) {
        const service = /^dhcp\s+service\s+(server|relay)$/i.exec(line);
        if (service) {
            result.service = service[1].toLowerCase() as "server" | "relay";
            continue;
        }
        if (/^no\s+dhcp\s+service$/i.test(line)) {
            result.service = "off";
            continue;
        }
        const scope = /^dhcp\s+scope\s+(\d+)\s+(\S+)-(\S+)\/(\d+)(.*)$/i.exec(line);
        if (!scope) continue;
        const tail = scope[5].trim();
        const gateway = /(?:^|\s)gateway\s+(\S+)/i.exec(tail)?.[1] ?? "";
        const expire = /(?:^|\s)expire\s+(\S+)/i.exec(tail)?.[1] ?? "";
        const remaining = tail
            .replace(/(?:^|\s)gateway\s+\S+/i, "")
            .replace(/(?:^|\s)expire\s+\S+/i, "")
            .trim();
        result.scopes.push({
            scope: scope[1],
            startAddress: scope[2],
            endAddress: scope[3],
            prefix: scope[4],
            gateway,
            expire,
            editable: remaining.length === 0,
            raw: line,
        });
    }
    return result;
}

function configLines(rawConfig: string): string[] {
    return rawConfig.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
}
