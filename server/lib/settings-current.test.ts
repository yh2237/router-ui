import assert from "node:assert/strict";
import test from "node:test";
import {
    extractCurrentSettings,
    parseDnsSetting,
    parseDhcpSetting,
    parseInterfaceAddressSettings,
    parseNatDescriptors,
    parseStaticRoutes,
} from "./settings-current.js";
import {
    renderDhcpOverview,
    renderDnsOverview,
    renderInterfaceOverview,
    renderNatOverview,
    renderNatEditForm,
    renderRoutingOverview,
    renderRoutingEditForm,
    renderDhcpScopeForm,
} from "../routes/settings.js";

test("extracts only settings related to the selected section", () => {
    const config = [
        "ip lan1 address 192.168.10.1/24",
        "ipv6 lan2 address ra-prefix@lan2::1/64",
        "dns server 1.1.1.1 8.8.8.8",
        "dhcp service server",
    ].join("\n");

    assert.deepEqual(extractCurrentSettings(config, "interfaces"), {
        state: "configured",
        lines: [
            "ip lan1 address 192.168.10.1/24",
            "ipv6 lan2 address ra-prefix@lan2::1/64",
        ],
        message: "2件の関連設定を取得しました。",
    });
});

test("distinguishes device defaults from an unavailable snapshot", () => {
    assert.deepEqual(extractCurrentSettings("dns server 192.0.2.53", "upnp"), {
        state: "default",
        lines: [],
        message: "明示設定はありません。機器の既定値で動作しています。",
    });
    assert.equal(extractCurrentSettings("", "config-file").state, "unavailable");
});

test("redacts credentials in the current provider and SNMP settings", () => {
    const provider = extractCurrentSettings("pp auth myname user@example.jp secret", "provider");
    const snmp = extractCurrentSettings("snmp host 192.0.2.1 public", "snmp");

    assert.equal(provider.lines[0], "pp auth myname user@example.jp ••••••••");
    assert.equal(snmp.lines[0], "snmp host 192.0.2.1 ••••••••");
});

test("parses interface address modes into fixed overview rows", () => {
    const rows = parseInterfaceAddressSettings([
        "ip lan1 address 192.168.10.1/24",
        "ipv6 lan1 address auto",
        "ip lan2 address dhcp",
        "ipv6 lan2 address 2001:db8::1/64",
    ].join("\n"));

    assert.deepEqual(rows[0], {
        name: "lan1",
        ipv4Mode: "static",
        ipv4Address: "192.168.10.1/24",
        ipv6Mode: "auto",
        ipv6Address: "",
    });
    assert.equal(rows[1].ipv4Mode, "dhcp");
    assert.equal(rows[1].ipv6Address, "2001:db8::1/64");
    assert.equal(rows[2].ipv4Mode, "unconfigured");
});

test("parses DNS servers and private-address spoof setting", () => {
    assert.deepEqual(parseDnsSetting([
        "dns server 1.1.1.1 8.8.8.8",
        "dns private address spoof on",
    ].join("\n")), {
        servers: ["1.1.1.1", "8.8.8.8"],
        privateAddressSpoof: "on",
    });
    assert.deepEqual(parseDnsSetting(""), { servers: [], privateAddressSpoof: "default" });
});

test("renders current interface values before row-level edit actions", () => {
    const html = renderInterfaceOverview("connection-id", parseInterfaceAddressSettings(
        "ip lan1 address 192.168.10.1/24\nipv6 lan1 address auto",
    ));

    assert.match(html, /LAN1[\s\S]*?192\.168\.10\.1\/24/);
    assert.match(html, /interface=lan1&amp;family=ipv4/);
    assert.match(html, /interface=lan1&amp;family=ipv6/);
});

test("renders DNS current values separately from its edit action", () => {
    const html = renderDnsOverview("connection-id", {
        servers: ["1.1.1.1", "8.8.8.8"],
        privateAddressSpoof: "on",
    });

    assert.match(html, /1\.1\.1\.1[\s\S]*?8\.8\.8\.8/);
    assert.match(html, /ルーターでNXDomainを返す/);
    assert.match(html, /settings\/edit\/dns/);
    assert.doesNotMatch(html, /<form/);
});

test("parses supported static routes and keeps unsupported gateways visible", () => {
    const routes = parseStaticRoutes([
        "ip route default gateway 192.0.2.1 metric 2 hide",
        "ip route 10.0.0.0/8 gateway tunnel 3",
        "ip route 198.51.100.0/24 gateway 192.0.2.2 filter 100",
    ].join("\n"));
    assert.deepEqual(routes[0], {
        index: 0,
        network: "default",
        gatewayType: "address",
        gateway: "192.0.2.1",
        metric: "2",
        hide: true,
        editable: true,
        raw: "ip route default gateway 192.0.2.1 metric 2 hide",
    });
    assert.equal(routes[1].gatewayType, "tunnel");
    assert.equal(routes[2].editable, false);
});

test("groups NAT descriptor values and LAN attachments", () => {
    assert.deepEqual(parseNatDescriptors([
        "nat descriptor type 1 masquerade",
        "nat descriptor address outer 1 ipcp",
        "nat descriptor address inner 1 auto",
        "ip lan2 nat descriptor 1",
    ].join("\n")), [{
        descriptor: "1",
        type: "masquerade",
        outer: "ipcp",
        inner: "auto",
        interfaces: ["lan2"],
        editable: true,
    }]);
});

test("parses DHCP service and editable scope values", () => {
    const dhcp = parseDhcpSetting([
        "dhcp service server",
        "dhcp scope 1 192.168.10.100-192.168.10.200/24 gateway 192.168.10.1 expire 72:00",
    ].join("\n"));
    assert.equal(dhcp.service, "server");
    assert.deepEqual(dhcp.scopes[0], {
        scope: "1",
        startAddress: "192.168.10.100",
        endAddress: "192.168.10.200",
        prefix: "24",
        gateway: "192.168.10.1",
        expire: "72:00",
        editable: true,
        raw: "dhcp scope 1 192.168.10.100-192.168.10.200/24 gateway 192.168.10.1 expire 72:00",
    });
});

test("renders routing, NAT, and DHCP as current-value list-detail overviews", () => {
    const routeHtml = renderRoutingOverview("connection-id", parseStaticRoutes(
        "ip route default gateway 192.0.2.1",
    ));
    const natHtml = renderNatOverview("connection-id", parseNatDescriptors(
        "nat descriptor type 1 masquerade",
    ));
    const dhcpHtml = renderDhcpOverview("connection-id", parseDhcpSetting(
        "dhcp service server\ndhcp scope 1 192.168.10.100-192.168.10.200/24",
    ));

    assert.match(routeHtml, /default[\s\S]*?192\.0\.2\.1[\s\S]*?routing\?route=0/);
    assert.match(natHtml, /IPマスカレード[\s\S]*?nat\?descriptor=1/);
    assert.match(dhcpHtml, /DHCPサーバー[\s\S]*?192\.168\.10\.100[\s\S]*?dhcp\?scope=1/);
    assert.doesNotMatch(routeHtml + natHtml + dhcpHtml, /<form/);
});

test("prefills targeted edit forms without reselecting the managed object", () => {
    const route = parseStaticRoutes("ip route default gateway 192.0.2.1 metric 2 hide")[0];
    const nat = parseNatDescriptors("nat descriptor type 1 masquerade\nip lan2 nat descriptor 1")[0];
    const scope = parseDhcpSetting("dhcp scope 1 192.168.10.100-192.168.10.200/24").scopes[0];
    const routeForm = renderRoutingEditForm("connection-id", "token", route);
    const natForm = renderNatEditForm("connection-id", "token", nat);
    const scopeForm = renderDhcpScopeForm("connection-id", "token", scope);

    assert.match(routeForm, /name="network"[\s\S]*?value="default"[\s\S]*?readonly/);
    assert.match(routeForm, /name="gateway"[\s\S]*?value="192\.0\.2\.1"/);
    assert.match(natForm, /name="descriptor"[\s\S]*?value="1"[\s\S]*?readonly/);
    assert.match(natForm, /value="" selected>この変更では適用先を変更しない/);
    assert.match(scopeForm, /name="scope"[\s\S]*?value="1"[\s\S]*?readonly/);
});
