import { NextResponse } from "next/server";
import { pgClient } from "@/core/db/client";
import { getBoss } from "@/core/worker/worker";
import journal from "@/core/db/migrations/meta/_journal.json";

const EXPECTED_MIGRATION_COUNT = journal.entries.length;

export async function GET() {
    const checks: Record<string, string> = {};
    const warnings: string[] = [];
    let isHealthy = true;

    // ── DB ping ───────────────────────────────────────────────────────────────
    try {
        await pgClient`SELECT 1`;
        checks.db = "ok";
    } catch {
        checks.db = "error";
        isHealthy = false;
    }

    // ── pg-boss alive ─────────────────────────────────────────────────────────
    const boss = getBoss();
    if (boss === null) {
        checks.pgboss = "not_running_in_process";
    } else {
        try {
            await pgClient`SELECT 1 FROM pgboss.version LIMIT 1`;
            checks.pgboss = "ok";
        } catch {
            checks.pgboss = "error";
            isHealthy = false;
        }
    }

    // ── Last event ingest within 1h ───────────────────────────────────────────
    try {
        const [row] = await pgClient`
            SELECT EXISTS(
                SELECT 1 FROM events
                WHERE timestamp > NOW() - INTERVAL '1 hour'
            ) AS has_recent
        `;
        if (!row.has_recent) {
            checks.ingest = "stale";
            warnings.push("No events received in the last hour");
        } else {
            checks.ingest = "ok";
        }
    } catch {
        checks.ingest = "unavailable";
    }

    // ── Migrations up to date ─────────────────────────────────────────────────
    try {
        const [row] = await pgClient`
            SELECT COUNT(*) AS cnt FROM "__drizzle_migrations"
        `;
        const applied = parseInt(String(row.cnt), 10);
        if (applied < EXPECTED_MIGRATION_COUNT) {
            checks.migrations = `behind: applied=${applied}, expected=${EXPECTED_MIGRATION_COUNT}`;
            isHealthy = false;
        } else {
            checks.migrations = "ok";
        }
    } catch {
        checks.migrations = "unavailable";
    }

    const headers: Record<string, string> = {};
    if (warnings.length > 0) {
        headers["X-Health-Warn"] = warnings.join("; ");
    }

    return NextResponse.json(
        { status: isHealthy ? "ok" : "error", checks },
        { status: isHealthy ? 200 : 503, headers },
    );
}
