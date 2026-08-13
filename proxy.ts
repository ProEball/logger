import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { users } from "@/core/db/schema";
import { auth } from "@/core/auth/config";

// Only cache the "done" state. Never cache "not done" — setup can complete at
// any moment and a stale false-negative would redirect the owner away from their
// freshly-created org immediately after the setup action redirects them.
let setupDoneCache = false;
let cacheExpiresAt = 0;
// e2e resets the DB between spec files within a single long-lived server
// process (see playwright.config.ts) — a cached "done" would then survive
// past a reset and misroute the next file's setup flow. `next dev` hardcodes
// NODE_ENV=development regardless of what's passed in, so a dedicated flag
// is used instead of NODE_ENV to detect e2e mode.
const CACHE_TTL_MS = process.env.E2E_MODE === "true" ? 0 : 5_000;

async function checkSetupDone(): Promise<boolean> {
    if (setupDoneCache && Date.now() < cacheExpiresAt) return true;

    const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(users);

    if (count > 0) {
        setupDoneCache = true;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    }

    return count > 0;
}

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Builds the per-request CSP and the nonce it embeds.
 *
 * Next.js parses the `nonce-{value}` out of the request's own CSP header during
 * SSR and stamps it onto every framework/page script tag it emits, so nothing
 * needs to thread the nonce through the component tree by hand.
 *
 * `style-src` deliberately uses `'unsafe-inline'` rather than the nonce: recharts
 * renders SVG with inline `style` attributes, and per the CSP spec a nonce in
 * `style-src` makes the browser *ignore* `'unsafe-inline'` — nonces never apply
 * to style attributes. Nonce-ing styles would blank every chart on the dashboard.
 */
function buildCsp(nonce: string): string {
    return [
        "default-src 'self'",
        // 'unsafe-eval' is dev-only: React uses eval to rebuild server stacks.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_DEV ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        // Would rewrite http://localhost to https:// and break the dev server.
        ...(IS_DEV ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
}

const PUBLIC_PATHS = new Set(["/login", "/forgot-password"]);

function isPublicPath(pathname: string): boolean {
    return (
        PUBLIC_PATHS.has(pathname) ||
        pathname.startsWith("/reset-password/") ||
        pathname.startsWith("/invite/")
    );
}

/** Passes the nonce down to the renderer so Next can stamp its script tags. */
function forward(request: NextRequest, nonce: string, csp: string): NextResponse {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers: requestHeaders } });
}

async function resolveRoute(request: NextRequest, next: () => NextResponse): Promise<Response> {
    const { pathname } = request.nextUrl;

    const done = await checkSetupDone();

    if (pathname === "/setup") {
        if (done) return new Response(null, { status: 404 });
        return next();
    }

    if (!done) {
        return NextResponse.redirect(new URL("/setup", request.url));
    }

    const session = await auth.api.getSession({ headers: request.headers });

    if (isPublicPath(pathname)) {
        // Already authenticated: bounce away from /login
        if (session && pathname === "/login") {
            return NextResponse.redirect(new URL("/", request.url));
        }
        return next();
    }

    if (!session) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return next();
}

export async function proxy(request: NextRequest) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const csp = buildCsp(nonce);

    const response = await resolveRoute(request, () => forward(request, nonce, csp));
    response.headers.set("Content-Security-Policy", csp);

    return response;
}

export const config = {
    matcher: [
        // Skip static assets, image optimisation, and auth API.
        "/((?!_next/static|_next/image|api/|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
    ],
};
