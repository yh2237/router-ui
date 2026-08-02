import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { getRuntimeConfig } from "./runtime.js";

const SESSION_COOKIE = "router_ui_session";

export interface BrowserSession {
    id: string;
    csrfToken: string;
    createdAt: number;
    lastSeenAt: number;
}

const sessions = new Map<string, BrowserSession>();
const requestSessions = new WeakMap<object, BrowserSession>();

export async function securityAndSessionMiddleware(c: Context, next: Next): Promise<Response | void> {
    applySecurityHeaders(c);

    const path = new URL(c.req.url).pathname;
    if (isPublicAsset(path)) {
        c.header("Cache-Control", "public, max-age=3600");
        await next();
        return;
    }

    const session = getOrCreateBrowserSession(c);
    if (isUnsafeMethod(c.req.method)) {
        const rejection = validateSameOriginRequest(c, session);
        if (rejection) return rejection;
    }

    await next();
}

export function getBrowserSession(c: Context): BrowserSession {
    return requestSessions.get(c) ?? getOrCreateBrowserSession(c);
}

export function cleanupExpiredSessions(now = Date.now()): string[] {
    const expiredOwners: string[] = [];
    const lifetime = getRuntimeConfig().sessionLifetimeMs;
    for (const [id, session] of sessions) {
        if (now - session.lastSeenAt <= lifetime) continue;
        sessions.delete(id);
        expiredOwners.push(id);
    }
    return expiredOwners;
}

export function applySecurityHeaders(c: Context): void {
    c.header(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "base-uri 'self'",
            "connect-src 'self'",
            "font-src 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "img-src 'self' data:",
            "object-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
        ].join("; "),
    );
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Cache-Control", "no-store");
}

function getOrCreateBrowserSession(c: Context): BrowserSession {
    const existing = requestSessions.get(c) ?? sessionFromCookie(c);
    if (existing) {
        existing.lastSeenAt = Date.now();
        requestSessions.set(c, existing);
        return existing;
    }

    const session = createSession();
    sessions.set(session.id, session);
    requestSessions.set(c, session);
    setSessionCookie(c, session.id);
    return session;
}

function sessionFromCookie(c: Context): BrowserSession | undefined {
    const id = getCookie(c, SESSION_COOKIE);
    if (!id) return undefined;
    const session = sessions.get(id);
    if (!session) return undefined;
    if (Date.now() - session.lastSeenAt > getRuntimeConfig().sessionLifetimeMs) {
        sessions.delete(id);
        return undefined;
    }
    return session;
}

function createSession(): BrowserSession {
    const now = Date.now();
    return {
        id: randomUUID(),
        csrfToken: randomUUID(),
        createdAt: now,
        lastSeenAt: now,
    };
}

function setSessionCookie(c: Context, id: string): void {
    setCookie(c, SESSION_COOKIE, id, {
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
        maxAge: Math.floor(getRuntimeConfig().sessionLifetimeMs / 1000),
    });
}

function validateSameOriginRequest(c: Context, session: BrowserSession): Response | undefined {
    const fetchSite = c.req.header("Sec-Fetch-Site");
    if (fetchSite === "cross-site") {
        return c.text("Cross-site request denied", 403);
    }

    const origin = c.req.header("Origin");
    if (origin) {
        let originHost = "";
        try {
            originHost = new URL(origin).host;
        } catch {
            return c.text("Invalid Origin", 403);
        }
        const requestHost = c.req.header("Host") ?? new URL(c.req.url).host;
        if (originHost !== requestHost) return c.text("Origin mismatch", 403);
    }

    const csrf = c.req.header("X-CSRF-Token");
    if (!csrf || !safeEqual(csrf, session.csrfToken)) {
        return c.text("CSRF token mismatch", 403);
    }
    return undefined;
}

function isPublicAsset(path: string): boolean {
    return path.startsWith("/css/")
        || path.startsWith("/js/")
        || path.startsWith("/img/")
        || path.startsWith("/vendor/");
}

function isUnsafeMethod(method: string): boolean {
    return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function safeEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
