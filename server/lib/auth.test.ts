import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../app.js";

test("security middleware issues a session, enforces CSRF, and adds hardening headers", async () => {
    const page = await app.fetch(new Request("http://localhost/"));
    const html = await page.text();
    const cookie = sessionCookie(page);
    const csrf = html.match(/name="router-ui-csrf" content="([^"]+)"/)?.[1];
    assert.equal(page.status, 200);
    assert.ok(cookie);
    assert.ok(csrf);
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.doesNotMatch(html, /unpkg|fonts\.googleapis|fonts\.gstatic/);

    const rejected = await app.fetch(new Request("http://localhost/api/saved-connections/999", {
        method: "DELETE",
        headers: { Cookie: cookie },
    }));
    assert.equal(rejected.status, 403);

    const accepted = await app.fetch(new Request("http://localhost/api/saved-connections/999", {
        method: "DELETE",
        headers: {
            Cookie: cookie,
            "X-CSRF-Token": csrf!,
        },
    }));
    assert.equal(accepted.status, 200);

    const wrongOrigin = await app.fetch(new Request("http://localhost/api/saved-connections/999", {
        method: "DELETE",
        headers: {
            Cookie: cookie,
            Origin: "https://attacker.example",
            "X-CSRF-Token": csrf!,
        },
    }));
    assert.equal(wrongOrigin.status, 403);
});

test("rejects private-key authentication over Telnet before opening a connection", async () => {
    const page = await app.fetch(new Request("http://localhost/"));
    const html = await page.text();
    const cookie = sessionCookie(page);
    const csrf = html.match(/name="router-ui-csrf" content="([^"]+)"/)?.[1];
    const body = new URLSearchParams({
        model: "IX2215",
        host: "192.0.2.1",
        port: "23",
        transport: "telnet",
        username: "admin",
        auth_method: "key",
        private_key: "not-a-real-key",
    });

    const response = await app.fetch(new Request("http://localhost/api/connect", {
        method: "POST",
        headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrf!,
        },
        body,
    }));

    assert.equal(response.status, 400);
    assert.match(await response.text(), /入力内容を確認してください/);
});

function sessionCookie(response: Response): string {
    return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

test("serves every local asset referenced by the connection and error pages", async () => {
    const page = await app.fetch(new Request("http://localhost/"));
    const html = await page.text();
    const missing = await Promise.all([
        "/img/logo_blue.png",
        "/css/app.css",
        "/js/connect.js",
        "/js/app-shell.js",
        "/js/settings-navigation.js",
        "/js/settings-editor.js",
        "/js/terminal.js",
        "/vendor/htmx/htmx.min.js",
        "/vendor/fonts/ibm-plex-sans-jp/400.css",
    ].map(async (path) => ({ path, status: (await app.fetch(new Request(`http://localhost${path}`))).status })))
        .then((results) => results.filter(({ status }) => status !== 200));

    assert.match(html, /href="\/img\/logo_blue\.png"/);
    assert.deepEqual(missing, []);

    const notFound = await app.fetch(new Request("http://localhost/does-not-exist"));
    const errorHtml = await notFound.text();
    assert.equal(notFound.status, 404);
    assert.match(errorHtml, /href="\/img\/logo_blue\.png"/);
});
