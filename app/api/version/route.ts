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
        sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev",
        builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
        nodeVersion: process.version,
        nextVersion,
    });
}
