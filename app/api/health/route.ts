import { NextResponse } from "next/server";

export function GET() {
    return NextResponse.json({
        status: "ok",
        uptime: process.uptime(),
        version: process.env.npm_package_version ?? "unknown",
    });
}
