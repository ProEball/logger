import { NextResponse } from "next/server";
import { pgClient } from "@/core/db/client";

export async function GET() {
    try {
        await pgClient`SELECT 1`;
        return NextResponse.json({ status: "ok" });
    } catch {
        return NextResponse.json(
            { status: "error", message: "Database unreachable" },
            { status: 503 }
        );
    }
}
