export interface SettingsNavigationItem {
    key: string;
    label: string;
    group: "basic" | "network" | "security" | "services";
    description: string;
}

export const settingsNavigation: readonly SettingsNavigationItem[] = [
    {
        key: "time",
        label: "時刻",
        group: "basic",
        description: "タイムゾーン、日付、時刻、NTPを設定します。",
    },
    {
        key: "config-file",
        label: "設定ファイル読込",
        group: "basic",
        description: "PC上の設定ファイルをルーターへ転送し、loadコマンドで反映します。",
    },
    {
        key: "provider",
        label: "プロバイダー接続",
        group: "network",
        description: "PPPoEやIPoEなど、インターネット接続に必要な設定を管理します。",
    },
    {
        key: "interfaces",
        label: "インターフェースIP",
        group: "network",
        description: "LANなど各インターフェースのIPv4・IPv6アドレスを管理します。",
    },
    {
        key: "lan-mode",
        label: "LAN動作モード",
        group: "network",
        description: "LANポートの分割、速度、動作モードなどを管理します。",
    },
    {
        key: "routing",
        label: "ルーティング",
        group: "network",
        description: "静的経路やデフォルト経路を管理します。",
    },
    {
        key: "nat",
        label: "NAT",
        group: "network",
        description: "NATディスクリプター、マスカレード、静的変換を管理します。",
    },
    {
        key: "vpn",
        label: "VPN",
        group: "security",
        description: "IPsecなどのトンネル、認証、接続先を管理します。",
    },
    {
        key: "ip-filter",
        label: "IPフィルター",
        group: "security",
        description: "IPv4・IPv6パケットの許可・拒否ルールを管理します。",
    },
    {
        key: "url-filter",
        label: "URLフィルター",
        group: "security",
        description: "URLフィルターのルールと適用先を管理します。",
    },
    {
        key: "dns",
        label: "DNS",
        group: "services",
        description: "DNSサーバー、問い合わせ、名前解決の動作を管理します。",
    },
    {
        key: "dhcp",
        label: "DHCP",
        group: "services",
        description: "DHCPスコープ、配布アドレス、オプションを管理します。",
    },
    {
        key: "logging",
        label: "ログ・SYSLOG",
        group: "services",
        description: "SYSLOGの転送先、出力レベル、形式、送信元アドレスを管理します。",
    },
    {
        key: "snmp",
        label: "SNMP",
        group: "services",
        description: "SNMPv1の読み取りアクセス、Trap送信先、機器識別情報を管理します。",
    },
    {
        key: "upnp",
        label: "UPnP",
        group: "services",
        description: "UPnPの有効化、外側アドレス、ポートマッピング消去動作を管理します。",
    },
] as const;

export const settingsGroupLabels: Record<SettingsNavigationItem["group"], string> = {
    basic: "基本",
    network: "接続・ネットワーク",
    security: "VPN・フィルター",
    services: "ネットワークサービス",
};

export function findSettingsNavigationItem(key: string): SettingsNavigationItem | undefined {
    return settingsNavigation.find((item) => item.key === key);
}
