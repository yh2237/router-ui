import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "./config.js";

test("RTX1210 uses documented Yamaha commands", () => {
    const config = resolveConfig("RTX1210");

    assert.equal(config.transport, "ssh");
    assert.equal(config.commands.show_system.cmd, "show environment");
    assert.equal(config.commands.show_route.cmd, "show ip route");
    assert.equal(config.commands.show_arp.cmd, "show arp");
    assert.equal(config.commands.show_status_dhcp.cmd, "show status dhcp");
    assert.equal(config.commands.show_dns_cache.cmd, "show dns cache");
    assert.equal(config.commands.show_ip_connection.cmd, "show ip connection");
    assert.equal(config.commands.show_ipsec_sa.cmd, "show ipsec sa");
    assert.equal(config.commands.show_config_difference.cmd, "show config difference");
    assert.equal(config.panel?.model, "RTX1210");
    assert.equal(config.panel?.theme, "yamaha");
    assert.ok(config.panel?.elements.some((element) => element.type === "port-group" && element.id === "lan1"));
    assert.ok(config.panel?.elements.some((element) => element.type === "led" && element.id === "power"));
});
