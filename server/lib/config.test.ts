import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "./config.js";

test("RTX1210 uses documented Yamaha commands", () => {
    const config = resolveConfig("RTX1210");

    assert.equal(config.transport, "ssh");
    assert.equal(config.commands.show_system.cmd, "show environment");
    assert.equal(config.commands.show_route.cmd, "show ip route");
});
