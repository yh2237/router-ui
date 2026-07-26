import { SettingsValidationError } from "./settings.js";
import { isIP } from "node:net";

export interface PlannedCommand {
    command: string;
    preview: string;
}

export type SettingFields = Record<string, string>;

export function buildYamahaLoadCommand(
    remotePath: string,
    mode: "difference" | "replace",
    rollbackTimer: number,
    preserveHostKey: boolean,
): string {
    if (!/^\/router-ui-import-[0-9a-f-]+\.txt$/.test(remotePath)) {
        throw new SettingsValidationError(["一時ファイル名が正しくありません。"]);
    }
    if (!Number.isInteger(rollbackTimer) || rollbackTimer < 120 || rollbackTimer > 3600) {
        throw new SettingsValidationError(["自動ロールバックは120〜3600秒で指定してください。"]);
    }
    return [
        `load file ${remotePath}`,
        mode === "difference" ? "difference" : "",
        "silent",
        preserveHostKey ? "no-key-generate" : "",
        `rollback-timer=${rollbackTimer}`,
    ].filter(Boolean).join(" ");
}

export function buildYamahaSettingCommands(section: string, fields: SettingFields): PlannedCommand[] {
    switch (section) {
        case "interfaces":
            return buildInterfaceCommands(fields);
        case "lan-mode":
            return buildLanModeCommands(fields);
        case "routing":
            return buildRoutingCommands(fields);
        case "nat":
            return buildNatCommands(fields);
        case "dns":
            return buildDnsCommands(fields);
        case "dhcp":
            return buildDhcpCommands(fields);
        case "ip-filter":
            return buildIpFilterCommands(fields);
        case "url-filter":
            return buildUrlFilterCommands(fields);
        case "provider":
            return buildProviderCommands(fields);
        case "vpn":
            return buildVpnCommands(fields);
        case "logging":
            return buildLoggingCommands(fields);
        case "snmp":
            return buildSnmpCommands(fields);
        case "upnp":
            return buildUpnpCommands(fields);
        default:
            throw new SettingsValidationError(["未対応の設定項目です。"]);
    }
}

function buildInterfaceCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(
        fields.action,
        ["static", "dhcp", "remove", "static-v6", "auto-v6", "dhcp-v6", "remove-v6"],
        "操作",
    );
    const iface = interfaceName(fields.interface);
    if (action === "dhcp") return plan(`ip ${iface} address dhcp`);
    if (action === "remove") return plan(`no ip ${iface} address`);
    if (action === "static-v6") return plan(`ipv6 ${iface} address ${ipv6Cidr(fields.address, "IPv6アドレス")}`);
    if (action === "auto-v6") return plan(`ipv6 ${iface} address auto`);
    if (action === "dhcp-v6") return plan(`ipv6 ${iface} address dhcp`);
    if (action === "remove-v6") return plan(`no ipv6 ${iface} address`);
    return plan(`ip ${iface} address ${ipv4Cidr(fields.address, "IPv4アドレス")}`);
}

function buildLanModeCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["set", "reset"], "操作");
    const iface = interfaceName(fields.interface);
    if (action === "reset") return plan(`no lan type ${iface}`);

    const speed = oneOf(
        fields.speed,
        ["auto", "1000-fdx", "100-fdx", "100-hdx", "10-fdx", "10-hdx"],
        "速度・二重化方式",
    );
    const port = optionalInteger(fields.port, 1, 8, "ポート番号");
    if (port && iface !== "lan1") {
        throw new SettingsValidationError(["RTX1210で物理ポート番号を指定できるのはLAN1です。"]);
    }
    const mtu = optionalInteger(fields.mtu, 64, 1500, "MTU");
    const separation = oneOf(fields.separation, ["unchanged", "off", "divide-network"], "LAN分割");
    const command = [
        `lan type ${iface}`,
        speed,
        port,
        mtu ? `mtu=${mtu}` : "",
        separation !== "unchanged" ? `port-based-option=${separation}` : "",
    ].filter(Boolean).join(" ");
    return plan(command);
}

function buildRoutingCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["add", "remove"], "操作");
    const network = fields.network === "default" ? "default" : ipv4Cidr(fields.network, "宛先ネットワーク");
    if (action === "remove") return plan(`no ip route ${network}`);

    const gatewayType = oneOf(fields.gatewayType, ["address", "dhcp", "pp", "tunnel", "null"], "ゲートウェイ種別");
    let gateway: string;
    if (gatewayType === "address") gateway = ipv4(fields.gateway, "ゲートウェイ");
    else if (gatewayType === "dhcp") gateway = `dhcp ${interfaceName(fields.gatewayInterface)}`;
    else if (gatewayType === "pp") gateway = `pp ${integer(fields.gatewayNumber, 1, 2147483647, "PP番号")}`;
    else if (gatewayType === "tunnel") gateway = `tunnel ${integer(fields.gatewayNumber, 1, 2147483647, "トンネル番号")}`;
    else gateway = "null";

    const metric = optionalInteger(fields.metric, 1, 15, "メトリック");
    return plan([
        `ip route ${network} gateway ${gateway}`,
        metric ? `metric ${metric}` : "",
        fields.hide === "on" ? "hide" : "",
    ].filter(Boolean).join(" "));
}

function buildNatCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["configure", "remove"], "操作");
    const descriptor = integer(fields.descriptor, 1, 2147483647, "NATディスクリプター番号");
    if (action === "remove") return plan(`no nat descriptor type ${descriptor}`);

    const type = oneOf(fields.type, ["none", "nat", "masquerade", "nat-masquerade"], "NAT動作タイプ");
    const commands = plan(`nat descriptor type ${descriptor} ${type}`);
    if (fields.outer) {
        const outer = ["ipcp", "primary", "secondary"].includes(fields.outer)
            ? fields.outer
            : ipv4OrRange(fields.outer, "外側アドレス");
        commands.push(...plan(`nat descriptor address outer ${descriptor} ${outer}`));
    }
    if (fields.inner) {
        const inner = fields.inner === "auto" ? "auto" : ipv4OrRange(fields.inner, "内側アドレス");
        commands.push(...plan(`nat descriptor address inner ${descriptor} ${inner}`));
    }
    if (fields.attachInterface) {
        const iface = interfaceName(fields.attachInterface);
        commands.push(...plan(`ip ${iface} nat descriptor ${descriptor}`));
    }
    return commands;
}

function buildDnsCommands(fields: SettingFields): PlannedCommand[] {
    const serverAction = oneOf(fields.serverAction, ["unchanged", "set", "remove"], "DNSサーバー操作");
    const spoof = oneOf(fields.privateSpoof, ["unchanged", "on", "off"], "プライベートアドレス応答");
    const commands: PlannedCommand[] = [];
    if (serverAction === "set") {
        const servers = splitList(fields.servers);
        if (servers.length < 1 || servers.length > 4) {
            throw new SettingsValidationError(["DNSサーバーは1〜4個指定してください。"]);
        }
        commands.push(...plan(`dns server ${servers.map((value) => ipv4(value, "DNSサーバー")).join(" ")}`));
    } else if (serverAction === "remove") {
        commands.push(...plan("no dns server"));
    }
    if (spoof !== "unchanged") commands.push(...plan(`dns private address spoof ${spoof}`));
    return requireCommands(commands);
}

function buildDhcpCommands(fields: SettingFields): PlannedCommand[] {
    const service = oneOf(fields.service, ["unchanged", "server", "relay", "off"], "DHCP動作");
    const scopeAction = oneOf(fields.scopeAction, ["unchanged", "set", "remove"], "DHCPスコープ操作");
    const commands: PlannedCommand[] = [];
    if (service === "off") commands.push(...plan("no dhcp service"));
    else if (service !== "unchanged") commands.push(...plan(`dhcp service ${service}`));

    if (scopeAction !== "unchanged") {
        const scope = integer(fields.scope, 1, 65535, "スコープ番号");
        if (scopeAction === "remove") {
            commands.push(...plan(`no dhcp scope ${scope}`));
        } else {
            const start = ipv4(fields.startAddress, "配布開始アドレス");
            const end = ipv4(fields.endAddress, "配布終了アドレス");
            const prefix = integer(fields.prefix, 0, 32, "プレフィックス長");
            const gateway = fields.gateway ? ` gateway ${ipv4(fields.gateway, "ゲートウェイ")}` : "";
            const expire = fields.expire ? ` expire ${leaseTime(fields.expire)}` : "";
            commands.push(...plan(`dhcp scope ${scope} ${start}-${end}/${prefix}${gateway}${expire}`));
        }
    }
    return requireCommands(commands);
}

function buildIpFilterCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["define", "remove", "apply", "unapply"], "操作");
    if (action === "define") {
        const number = integer(fields.number, 1, 21474836, "フィルター番号");
        const kind = oneOf(
            fields.kind,
            ["pass", "pass-log", "pass-nolog", "reject", "reject-log", "reject-nolog", "restrict"],
            "フィルター動作",
        );
        const source = ipv4FilterAddress(fields.source, "送信元");
        const destination = ipv4FilterAddress(fields.destination, "宛先");
        const protocol = oneOf(fields.protocol, ["*", "tcp", "udp", "icmp"], "プロトコル");
        const sourcePort = portExpression(fields.sourcePort, "送信元ポート");
        const destinationPort = portExpression(fields.destinationPort, "宛先ポート");
        return plan(`ip filter ${number} ${kind} ${source} ${destination} ${protocol} ${sourcePort} ${destinationPort}`);
    }
    if (action === "remove") {
        return plan(`no ip filter ${integer(fields.number, 1, 21474836, "フィルター番号")}`);
    }
    const iface = interfaceName(fields.interface);
    const direction = oneOf(fields.direction, ["in", "out"], "方向");
    if (action === "unapply") return plan(`no ip ${iface} secure filter ${direction}`);
    return plan(`ip ${iface} secure filter ${direction} ${filterNumberList(fields.filterList)}`);
}

function buildUrlFilterCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["define", "remove", "apply", "unapply"], "操作");
    if (action === "define") {
        const number = integer(fields.number, 1, 21474836, "URLフィルター番号");
        const kind = oneOf(
            fields.kind,
            ["pass", "pass-log", "pass-nolog", "reject", "reject-log", "reject-nolog"],
            "フィルター動作",
        );
        const keyword = safeToken(fields.keyword, 255, "URLキーワード");
        const source = fields.source ? ` ${ipv4FilterAddress(fields.source, "送信元")}` : "";
        return plan(`url filter ${number} ${kind} ${keyword}${source}`);
    }
    if (action === "remove") {
        return plan(`no url filter ${integer(fields.number, 1, 21474836, "URLフィルター番号")}`);
    }
    const iface = interfaceName(fields.interface);
    const direction = oneOf(fields.direction, ["in", "out"], "方向");
    if (action === "unapply") return plan(`no url ${iface} filter ${direction}`);
    return plan(`url ${iface} filter ${direction} ${filterNumberList(fields.filterList)}`);
}

function buildProviderCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["configure", "disable"], "操作");
    const peer = integer(fields.peer, 1, 2147483647, "PP番号");
    if (action === "disable") return plan(`no pp enable ${peer}`);

    const iface = interfaceName(fields.interface);
    const username = safeCredential(fields.username, "接続ユーザー名");
    const password = safeCredential(fields.password, "接続パスワード");
    const mru = integer(fields.mru || "1454", 1280, 1792, "MRU");
    const alwaysOn = oneOf(fields.alwaysOn, ["on", "off"], "常時接続");
    const natDescriptor = fields.natDescriptor
        ? integer(fields.natDescriptor, 1, 2147483647, "NATディスクリプター番号")
        : "";
    return [
        ...plan(`no pp enable ${peer}`),
        ...plan(`pp select ${peer}`),
        ...plan(`pppoe use ${iface}`),
        ...plan("pp auth accept pap chap"),
        { command: `pp auth myname ${username} ${password}`, preview: `pp auth myname ${username} ••••••••` },
        ...plan(`ppp lcp mru on ${mru}`),
        ...plan("ppp ipcp ipaddress on"),
        ...(natDescriptor ? plan(`ip pp nat descriptor ${natDescriptor}`) : []),
        ...plan(`pp always-on ${alwaysOn}`),
        ...plan(`pp enable ${peer}`),
        ...plan("pp select none"),
    ];
}

function buildVpnCommands(fields: SettingFields): PlannedCommand[] {
    const action = oneOf(fields.action, ["configure", "disable"], "操作");
    const tunnel = integer(fields.tunnel, 1, 2147483647, "トンネル番号");
    if (action === "disable") return plan(`no tunnel enable ${tunnel}`);

    const policy = integer(fields.policy, 1, 2147483647, "ポリシーID");
    const gateway = integer(fields.gatewayId, 1, 2147483647, "ゲートウェイID");
    const remote = hostOrIpv4(fields.remote, "対向ゲートウェイ");
    const psk = safeCredential(fields.preSharedKey, "事前共有鍵");
    const encryption = oneOf(fields.encryption, ["aes-cbc", "aes256-cbc", "3des-cbc"], "暗号アルゴリズム");
    const authentication = oneOf(fields.authentication, ["sha-hmac", "sha256-hmac"], "認証アルゴリズム");
    return [
        ...plan(`no tunnel enable ${tunnel}`),
        ...plan(`tunnel select ${tunnel}`),
        ...plan("tunnel encapsulation ipsec"),
        ...plan(`ipsec tunnel ${policy}`),
        ...plan(`ipsec sa policy ${policy} ${gateway} esp ${encryption} ${authentication}`),
        { command: `ipsec ike pre-shared-key ${gateway} text ${psk}`, preview: `ipsec ike pre-shared-key ${gateway} text ••••••••` },
        ...plan(`ipsec ike remote address ${gateway} ${remote}`),
        ...plan(`tunnel enable ${tunnel}`),
        ...plan("tunnel select none"),
    ];
}

function buildLoggingCommands(fields: SettingFields): PlannedCommand[] {
    const hostAction = oneOf(fields.hostAction, ["unchanged", "set", "remove"], "SYSLOG転送先操作");
    const info = oneOf(fields.info, ["unchanged", "on", "off"], "INFOログ");
    const notice = oneOf(fields.notice, ["unchanged", "on", "off"], "NOTICEログ");
    const debug = oneOf(fields.debug, ["unchanged", "on", "off"], "DEBUGログ");
    const facility = oneOf(
        fields.facility,
        ["unchanged", "user", "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7"],
        "SYSLOG facility",
    );
    const format = oneOf(fields.format, ["unchanged", "yamaha", "rfc3164", "rfc5424"], "SYSLOG形式");
    const localAddressAction = oneOf(
        fields.localAddressAction,
        ["unchanged", "set", "remove"],
        "SYSLOG送信元アドレス操作",
    );
    const commands: PlannedCommand[] = [];

    if (hostAction === "set") {
        const hosts = splitList(fields.hosts);
        if (hosts.length < 1 || hosts.length > 4) {
            throw new SettingsValidationError(["SYSLOG転送先は1〜4個指定してください。"]);
        }
        commands.push(...plan(`syslog host ${hosts.map((value) => ipOrHost(value, "SYSLOG転送先")).join(" ")}`));
    } else if (hostAction === "remove") {
        commands.push(...plan("no syslog host"));
    }
    if (info !== "unchanged") commands.push(...plan(`syslog info ${info}`));
    if (notice !== "unchanged") commands.push(...plan(`syslog notice ${notice}`));
    if (debug !== "unchanged") commands.push(...plan(`syslog debug ${debug}`));
    if (facility !== "unchanged") commands.push(...plan(`syslog facility ${facility}`));
    if (format !== "unchanged") commands.push(...plan(`syslog format type ${format}`));
    if (localAddressAction === "set") {
        commands.push(...plan(`syslog local address ${ipAddress(fields.localAddress, "SYSLOG送信元アドレス")}`));
    } else if (localAddressAction === "remove") {
        commands.push(...plan("no syslog local address"));
    }
    return requireCommands(commands);
}

function buildSnmpCommands(fields: SettingFields): PlannedCommand[] {
    const accessAction = oneOf(fields.accessAction, ["unchanged", "set", "remove"], "SNMPアクセス操作");
    const trapAction = oneOf(fields.trapAction, ["unchanged", "set", "remove"], "SNMP Trap操作");
    const commands: PlannedCommand[] = [];

    if (accessAction === "set") {
        const host = snmpAccessHost(fields.accessHost);
        if (host === "none") {
            commands.push(...plan("snmp host none"));
        } else {
            const community = snmpCommunity(fields.readCommunity, "読み取りコミュニティ名");
            commands.push({
                command: `snmp host ${host} ${community}`,
                preview: `snmp host ${host} ••••••••`,
            });
        }
    } else if (accessAction === "remove") {
        const host = fields.accessHost ? ` ${snmpAccessHost(fields.accessHost)}` : "";
        commands.push(...plan(`no snmp host${host}`));
    }

    if (trapAction === "set") {
        const host = ipAddress(fields.trapHost, "Trap送信先");
        const community = snmpCommunity(fields.trapCommunity, "Trapコミュニティ名");
        commands.push({
            command: `snmp trap host ${host} ${community}`,
            preview: `snmp trap host ${host} ••••••••`,
        });
    } else if (trapAction === "remove") {
        commands.push(...plan(`no snmp trap host ${ipAddress(fields.trapHost, "Trap送信先")}`));
    }

    appendSnmpMetadata(commands, "sysname", "sysName", fields.sysNameAction, fields.sysName);
    appendSnmpMetadata(commands, "syslocation", "sysLocation", fields.sysLocationAction, fields.sysLocation);
    appendSnmpMetadata(commands, "syscontact", "sysContact", fields.sysContactAction, fields.sysContact);
    return requireCommands(commands);
}

function appendSnmpMetadata(
    commands: PlannedCommand[],
    commandName: string,
    label: string,
    actionValue: string,
    value: string,
): void {
    const action = oneOf(actionValue, ["unchanged", "set", "remove"], `${label}操作`);
    if (action === "set") {
        commands.push(...plan(`snmp ${commandName} ${quotedText(value, 255, label)}`));
    } else if (action === "remove") {
        commands.push(...plan(`no snmp ${commandName}`));
    }
}

function buildUpnpCommands(fields: SettingFields): PlannedCommand[] {
    const use = oneOf(fields.use, ["unchanged", "on", "off"], "UPnP動作");
    const externalType = oneOf(
        fields.externalType,
        ["unchanged", "default", "lan1", "lan2", "lan3", "pp"],
        "外側アドレス参照先",
    );
    const timerType = oneOf(fields.timerType, ["unchanged", "normal", "arp"], "消去タイマー種別");
    const timerAction = oneOf(fields.timerAction, ["unchanged", "set", "off", "reset"], "消去タイマー操作");
    const syslog = oneOf(fields.syslog, ["unchanged", "on", "off"], "UPnP SYSLOG");
    const commands: PlannedCommand[] = [];

    if (use !== "unchanged") commands.push(...plan(`upnp use ${use}`));
    if (externalType === "pp") {
        commands.push(...plan(`upnp external address refer pp ${integer(fields.peer, 1, 2147483647, "PP番号")}`));
    } else if (externalType !== "unchanged") {
        commands.push(...plan(`upnp external address refer ${externalType}`));
    }
    if (timerType !== "unchanged") commands.push(...plan(`upnp port mapping timer type ${timerType}`));
    if (timerAction === "set") {
        commands.push(...plan(`upnp port mapping timer ${integer(fields.timer, 600, 21474836, "消去タイマー")}`));
    } else if (timerAction === "off") {
        commands.push(...plan("upnp port mapping timer off"));
    } else if (timerAction === "reset") {
        commands.push(...plan("no upnp port mapping timer"));
    }
    if (syslog !== "unchanged") commands.push(...plan(`upnp syslog ${syslog}`));
    return requireCommands(commands);
}

function plan(command: string): PlannedCommand[] {
    return [{ command, preview: command }];
}

function requireCommands(commands: PlannedCommand[]): PlannedCommand[] {
    if (commands.length === 0) throw new SettingsValidationError(["変更する項目を1つ以上指定してください。"]);
    return commands;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
    if (!allowed.includes(value as T)) throw new SettingsValidationError([`${label}の指定が正しくありません。`]);
    return value as T;
}

function integer(value: string, min: number, max: number, label: string): string {
    if (!/^[1-9]\d*$|^0$/.test(value)) throw new SettingsValidationError([`${label}は整数で入力してください。`]);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        throw new SettingsValidationError([`${label}は${min}〜${max}の範囲で入力してください。`]);
    }
    return String(number);
}

function optionalInteger(value: string, min: number, max: number, label: string): string {
    return value ? integer(value, min, max, label) : "";
}

function interfaceName(value: string): string {
    return oneOf(value.toLowerCase(), ["lan1", "lan2", "lan3"], "インターフェース");
}

function ipv4(value: string, label: string): string {
    const parts = value.split(".");
    if (
        parts.length !== 4
        || !parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
    ) {
        throw new SettingsValidationError([`${label}には有効なIPv4アドレスを入力してください。`]);
    }
    return value;
}

function ipAddress(value: string, label: string): string {
    if (isIP(value) === 0) {
        throw new SettingsValidationError([`${label}には有効なIPv4またはIPv6アドレスを入力してください。`]);
    }
    return value;
}

function ipOrHost(value: string, label: string): string {
    if (isIP(value) !== 0) return value;
    return hostOrIpv4(value, label);
}

function ipv4Cidr(value: string, label: string): string {
    const match = /^(.+)\/(\d{1,2})$/.exec(value);
    if (!match) throw new SettingsValidationError([`${label}はアドレス/プレフィックス長で入力してください。`]);
    return `${ipv4(match[1], label)}/${integer(match[2], 0, 32, `${label}のプレフィックス長`)}`;
}

function ipv6Cidr(value: string, label: string): string {
    const separator = value.lastIndexOf("/");
    if (separator < 1) throw new SettingsValidationError([`${label}はアドレス/プレフィックス長で入力してください。`]);
    const address = value.slice(0, separator);
    const prefix = value.slice(separator + 1);
    if (isIP(address) !== 6) throw new SettingsValidationError([`${label}には有効なIPv6アドレスを入力してください。`]);
    return `${address}/${integer(prefix, 0, 128, `${label}のプレフィックス長`)}`;
}

function ipv4OrRange(value: string, label: string): string {
    const parts = value.split("-");
    if (parts.length === 1) return ipv4(parts[0], label);
    if (parts.length === 2) return `${ipv4(parts[0], label)}-${ipv4(parts[1], label)}`;
    throw new SettingsValidationError([`${label}の範囲指定が正しくありません。`]);
}

function ipv4FilterAddress(value: string, label: string): string {
    if (value === "*") return value;
    if (value.includes("/")) return ipv4Cidr(value, label);
    return ipv4(value, label);
}

function portExpression(value: string, label: string): string {
    if (value === "*") return value;
    const parts = value.split(",");
    if (parts.length > 32 || parts.some((part) => !/^\d{1,5}(?:-\d{1,5})?$/.test(part))) {
        throw new SettingsValidationError([`${label}はポート番号、範囲、または * で入力してください。`]);
    }
    for (const part of parts) {
        for (const number of part.split("-")) integer(number, 0, 65535, label);
    }
    return value;
}

function filterNumberList(value: string): string {
    const values = splitList(value);
    if (values.length < 1 || values.length > 129) {
        throw new SettingsValidationError(["フィルター番号を1〜129個指定してください。"]);
    }
    return values.map((item) => integer(item, 1, 21474836, "フィルター番号")).join(" ");
}

function splitList(value: string): string[] {
    return value.trim().split(/[\s,]+/).filter(Boolean);
}

function leaseTime(value: string): string {
    if (value === "infinity") return value;
    if (/^\d{1,5}:[0-5]\d$/.test(value)) return value;
    return integer(value, 1, 21474836, "リース期間");
}

function safeToken(value: string, maxLength: number, label: string): string {
    if (!value || value.length > maxLength || !/^[A-Za-z0-9._~:/?@!%+,&=*-]+$/.test(value)) {
        throw new SettingsValidationError([`${label}に空白、引用符、制御文字は使用できません。`]);
    }
    return value;
}

function safeCredential(value: string, label: string): string {
    return safeToken(value, 64, label);
}

function snmpCommunity(value: string, label: string): string {
    return safeToken(value, 16, label);
}

function snmpAccessHost(value: string): string {
    const normalized = value.toLowerCase();
    if (["any", "none", "lan1", "lan2", "lan3"].includes(normalized)) return normalized;
    const range = value.split("-");
    if (range.length === 1) return ipAddress(value, "SNMPアクセス元");
    if (range.length === 2 && range.every((address) => isIP(address) === 4)) {
        return `${range[0]}-${range[1]}`;
    }
    throw new SettingsValidationError(["SNMPアクセス元にはIPアドレス、IPv4範囲、LAN名、any、noneを入力してください。"]);
}

function quotedText(value: string, maxLength: number, label: string): string {
    if (
        !value
        || value.length > maxLength
        || /[\u0000-\u001f\u007f"'\\]/.test(value)
    ) {
        throw new SettingsValidationError([`${label}は${maxLength}文字以内で、引用符・制御文字・バックスラッシュを含めず入力してください。`]);
    }
    return `"${value}"`;
}

function hostOrIpv4(value: string, label: string): string {
    if (value === "any") return value;
    if (/^[0-9.]+$/.test(value)) return ipv4(value, label);
    if (
        value.length < 1
        || value.length > 253
        || !value.split(".").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part))
    ) {
        throw new SettingsValidationError([`${label}にはIPv4アドレスまたはホスト名を入力してください。`]);
    }
    return value;
}
