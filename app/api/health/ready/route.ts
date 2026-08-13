import { NextResponse } from "next/server";
import { pgClient } from "@/core/db/client";
import { getBoss } from "@/core/worker/worker";
import { getMigrationStatus } from "@/core/db/migration-status";

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
        const { applied, expected, isUpToDate } = await getMigrationStatus(pgClient);
        if (isUpToDate) {
            checks.migrations = "ok";
        } else {
            checks.migrations = `behind: applied=${applied}, expected=${expected}`;
            isHealthy = false;
        }
    } catch {
        // Reaching the table can fail legitimately — the database is up but has
        // never been migrated. Not fatal on its own; the `db` check above is
        // what decides whether Postgres itself is reachable.
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
