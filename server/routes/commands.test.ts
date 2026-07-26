import assert from "node:assert/strict";
import test from "node:test";
import { settingsNavigation } from "../lib/settings-navigation.js";
import { renderTemplate } from "../lib/template.js";
import { renderSettingsNavigation, renderSettingsView } from "./commands.js";

test("main navigation replaces older requests targeting the content area", () => {
    const html = renderTemplate("shell.html", {
        connId: "connection-id",
        model: "RTX1210",
        host: "192.0.2.1",
    });

    const synchronizedRequests = html.match(/hx-sync="#tab-content:replace"/g) ?? [];
    assert.equal(synchronizedRequests.length, 4);
    assert.match(html, /id="tab-content"[\s\S]*?hx-sync="this:replace"/);
});

test("replaces the complete settings sidebar so HTMX processes inserted controls", () => {
    const html = renderSettingsView("<button>項目</button>", "/settings/initial");

    assert.match(
        html,
        /id="settings-secondary-sidebar"[\s\S]*?hx-swap-oob="outerHTML"/,
    );
    assert.match(html, /id="settings-content"[\s\S]*?hx-get="\/settings\/initial"/);
});

test("renders every settings navigation item for delegated navigation", () => {
    const html = renderSettingsNavigation("connection-id");
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];

    for (const item of settingsNavigation) {
        const button = buttons.find((candidate) =>
            candidate.includes(`/settings/edit/${item.key}"`),
        );
        assert.ok(button, `${item.key} navigation button is missing`);
        assert.match(button, /type="button"/);
        assert.match(
            button,
            new RegExp(
                `data-settings-url="/api/device/connection-id/settings/edit/${item.key}"`,
            ),
        );
    }
});
