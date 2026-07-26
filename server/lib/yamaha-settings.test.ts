import assert from "node:assert/strict";
import test from "node:test";
import { SettingsValidationError } from "./settings.js";
import { buildYamahaLoadCommand, buildYamahaSettingCommands } from "./yamaha-settings.js";

function commands(section: string, fields: Record<string, string>): string[] {
    return buildYamahaSettingCommands(section, fields).map((item) => item.command);
}

test("builds interface and LAN mode commands", () => {
    assert.deepEqual(commands("interfaces", {
        action: "static",
        interface: "lan1",
        address: "192.168.10.1/24",
    }), ["ip lan1 address 192.168.10.1/24"]);
    assert.deepEqual(commands("interfaces", {
        action: "static-v6",
        interface: "lan2",
        address: "2001:db8::1/64",
    }), ["ipv6 lan2 address 2001:db8::1/64"]);

    assert.deepEqual(commands("lan-mode", {
        action: "set",
        interface: "lan1",
        speed: "auto",
        port: "2",
        mtu: "1500",
        separation: "off",
    }), ["lan type lan1 auto 2 mtu=1500 port-based-option=off"]);
});

test("builds static route and NAT descriptor commands", () => {
    assert.deepEqual(commands("routing", {
        action: "add",
        network: "default",
        gatewayType: "address",
        gateway: "192.0.2.1",
        gatewayInterface: "",
        gatewayNumber: "",
        metric: "2",
        hide: "on",
    }), ["ip route default gateway 192.0.2.1 metric 2 hide"]);

    assert.deepEqual(commands("nat", {
        action: "configure",
        descriptor: "1",
        type: "masquerade",
        outer: "ipcp",
        inner: "auto",
        attachInterface: "lan2",
    }), [
        "nat descriptor type 1 masquerade",
        "nat descriptor address outer 1 ipcp",
        "nat descriptor address inner 1 auto",
        "ip lan2 nat descriptor 1",
    ]);
});

test("builds DNS and DHCP commands", () => {
    assert.deepEqual(commands("dns", {
        serverAction: "set",
        servers: "1.1.1.1, 8.8.8.8",
        privateSpoof: "on",
    }), [
        "dns server 1.1.1.1 8.8.8.8",
        "dns private address spoof on",
    ]);

    assert.deepEqual(commands("dhcp", {
        service: "server",
        scopeAction: "set",
        scope: "1",
        startAddress: "192.168.10.100",
        endAddress: "192.168.10.200",
        prefix: "24",
        gateway: "192.168.10.1",
        expire: "72:00",
    }), [
        "dhcp service server",
        "dhcp scope 1 192.168.10.100-192.168.10.200/24 gateway 192.168.10.1 expire 72:00",
    ]);
});

test("builds IP and URL filter definitions and applications", () => {
    assert.deepEqual(commands("ip-filter", {
        action: "define",
        number: "1000",
        kind: "pass",
        source: "192.168.10.0/24",
        destination: "*",
        protocol: "tcp",
        sourcePort: "*",
        destinationPort: "443",
        interface: "lan1",
        direction: "in",
        filterList: "",
    }), ["ip filter 1000 pass 192.168.10.0/24 * tcp * 443"]);

    assert.deepEqual(commands("url-filter", {
        action: "apply",
        number: "",
        kind: "pass",
        keyword: "",
        source: "",
        interface: "lan2",
        direction: "out",
        filterList: "1000,1001",
    }), ["url lan2 filter out 1000 1001"]);
});

test("builds PPPoE and IPsec plans while masking secrets in previews", () => {
    const provider = buildYamahaSettingCommands("provider", {
        action: "configure",
        peer: "1",
        interface: "lan2",
        username: "user@example.jp",
        password: "secret-pass",
        mru: "1454",
        alwaysOn: "on",
    });
    assert.equal(provider[4].command, "pp auth myname user@example.jp secret-pass");
    assert.equal(provider[4].preview, "pp auth myname user@example.jp ••••••••");
    assert.equal(provider.at(-1)?.command, "pp select none");

    const vpn = buildYamahaSettingCommands("vpn", {
        action: "configure",
        tunnel: "1",
        policy: "1",
        gatewayId: "1",
        remote: "vpn.example.jp",
        preSharedKey: "vpn-secret",
        encryption: "aes256-cbc",
        authentication: "sha256-hmac",
    });
    assert.equal(vpn[5].preview, "ipsec ike pre-shared-key 1 text ••••••••");
    assert.equal(vpn.at(-1)?.command, "tunnel select none");
});

test("builds SYSLOG forwarding and output settings", () => {
    assert.deepEqual(commands("logging", {
        hostAction: "set",
        hosts: "192.0.2.10,log.example.jp",
        info: "on",
        notice: "on",
        debug: "off",
        facility: "local4",
        format: "rfc5424",
        localAddressAction: "set",
        localAddress: "2001:db8::1",
    }), [
        "syslog host 192.0.2.10 log.example.jp",
        "syslog info on",
        "syslog notice on",
        "syslog debug off",
        "syslog facility local4",
        "syslog format type rfc5424",
        "syslog local address 2001:db8::1",
    ]);
});

test("builds read-only SNMP, trap, and identification settings while masking communities", () => {
    const result = buildYamahaSettingCommands("snmp", {
        accessAction: "set",
        accessHost: "192.0.2.10",
        readCommunity: "monitoring",
        trapAction: "set",
        trapHost: "2001:db8::20",
        trapCommunity: "trap-secret",
        sysNameAction: "set",
        sysName: "router edge 01",
        sysLocationAction: "remove",
        sysLocation: "",
        sysContactAction: "unchanged",
        sysContact: "",
    });

    assert.deepEqual(result.map((item) => item.command), [
        "snmp host 192.0.2.10 monitoring",
        "snmp trap host 2001:db8::20 trap-secret",
        "snmp sysname \"router edge 01\"",
        "no snmp syslocation",
    ]);
    assert.equal(result[0].preview, "snmp host 192.0.2.10 ••••••••");
    assert.equal(result[1].preview, "snmp trap host 2001:db8::20 ••••••••");
});

test("builds UPnP usage, external address, and mapping timer settings", () => {
    assert.deepEqual(commands("upnp", {
        use: "on",
        externalType: "pp",
        peer: "1",
        timerType: "normal",
        timerAction: "set",
        timer: "3600",
        syslog: "off",
    }), [
        "upnp use on",
        "upnp external address refer pp 1",
        "upnp port mapping timer type normal",
        "upnp port mapping timer 3600",
        "upnp syslog off",
    ]);
});

test("rejects command injection and unsupported RTX1210 values", () => {
    assert.throws(
        () => commands("url-filter", {
            action: "define",
            number: "1",
            kind: "reject",
            keyword: "example.com;save",
            source: "*",
        }),
        SettingsValidationError,
    );
    assert.throws(
        () => commands("lan-mode", {
            action: "set",
            interface: "lan1",
            speed: "10g-fdx",
            port: "",
            mtu: "9000",
            separation: "unchanged",
        }),
        SettingsValidationError,
    );
    assert.throws(
        () => commands("snmp", {
            accessAction: "set",
            accessHost: "any",
            readCommunity: "public;save",
            trapAction: "unchanged",
            sysNameAction: "unchanged",
            sysLocationAction: "unchanged",
            sysContactAction: "unchanged",
        }),
        SettingsValidationError,
    );
    assert.throws(
        () => commands("logging", {
            hostAction: "set",
            hosts: "log.example.jp;save",
            info: "unchanged",
            notice: "unchanged",
            debug: "unchanged",
            facility: "unchanged",
            format: "unchanged",
            localAddressAction: "unchanged",
        }),
        SettingsValidationError,
    );
});

test("builds a rollback-protected load command for an uploaded config", () => {
    assert.equal(
        buildYamahaLoadCommand(
            "/router-ui-import-123e4567-e89b-12d3-a456-426614174000.txt",
            "difference",
            300,
            true,
        ),
        "load file /router-ui-import-123e4567-e89b-12d3-a456-426614174000.txt difference silent no-key-generate rollback-timer=300",
    );
    assert.equal(
        buildYamahaLoadCommand(
            "/router-ui-import-123e4567-e89b-12d3-a456-426614174000.txt",
            "replace",
            120,
            false,
        ),
        "load file /router-ui-import-123e4567-e89b-12d3-a456-426614174000.txt silent rollback-timer=120",
    );
    assert.throws(
        () => buildYamahaLoadCommand("/config.txt;save", "difference", 300, true),
        SettingsValidationError,
    );
});
