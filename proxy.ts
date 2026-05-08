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
const CACHE_TTL_MS = 5_000;

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

const PUBLIC_PATHS = new Set(["/login", "/forgot-password"]);

function isPublicPath(pathname: string): boolean {
    return (
        PUBLIC_PATHS.has(pathname) ||
        pathname.startsWith("/reset-password/") ||
        pathname.startsWith("/invite/")
    );
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const done = await checkSetupDone();

    if (pathname === "/setup") {
        if (done) return new Response(null, { status: 404 });
        return NextResponse.next();
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
        return NextResponse.next();
    }

    if (!session) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        // Skip static assets, image optimisation, and auth API.
        "/((?!_next/static|_next/image|api/|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
    ],
};
