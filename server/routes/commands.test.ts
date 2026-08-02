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
    const html = renderSettingsView("<button>項目</button>");

    assert.match(
        html,
        /id="settings-secondary-sidebar"[\s\S]*?hx-swap-oob="outerHTML"/,
    );
    assert.match(html, /id="settings-content"[\s\S]*?設定項目を選択してください/);
    assert.doesNotMatch(html, /id="settings-content"[^>]*hx-get=/);
});

test("renders every settings navigation item for delegated navigation", () => {
    const html = renderSettingsNavigation("connection-id");
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];

    for (const item of settingsNavigation) {
        const mode = ["interfaces", "routing", "nat", "dns", "dhcp"].includes(item.key) ? "view" : "edit";
        const button = buttons.find((candidate) =>
            candidate.includes(`/settings/${mode}/${item.key}"`),
        );
        assert.ok(button, `${item.key} navigation button is missing`);
        assert.match(button, /type="button"/);
        assert.match(
            button,
            new RegExp(
                `data-settings-url="/api/device/connection-id/settings/${mode}/${item.key}"`,
            ),
        );
        assert.doesNotMatch(button, /class="[^"]*\bactive\b/);
    }
});

test("loads the interface overview before showing an edit form", () => {
    const html = renderSettingsView("<button>項目</button>", "connection-id");
    assert.match(html, /hx-get="\/api\/device\/connection-id\/settings\/view\/interfaces"/);
    assert.doesNotMatch(html, /settings\/edit\/interfaces/);
});
