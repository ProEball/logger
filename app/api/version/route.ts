import { NextResponse } from "next/server";

const nextVersion = (() => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return (require("next/package.json") as { version: string }).version;
    } catch {
        return "unknown";
    }
})();

export function GET() {
    return NextResponse.json({
        // `||`, not `??`: these are inlined by `next build`, and a build that
        // did not pass the args inlines an empty string rather than leaving the
        // variable undefined. `??` only catches the latter, so a plain
        // `docker compose build` reported `"sha": ""` instead of `"dev"`.
        sha: process.env.NEXT_PUBLIC_BUILD_SHA || "dev",
        builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
        nodeVersion: process.version,
        nextVersion,
    });
}
