import { NextResponse } from "next/server";
import { pgClient } from "@/core/db/client";
import { getBoss } from "@/core/worker/worker";
import { clickhouse, pingClickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";

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
    // Asks ClickHouse since Phase 4; the Postgres `events` table is gone.
    // Still a **warning**, never fatal: an install with no traffic in the last
    // hour is idle, not broken, and failing readiness for it would take the app
    // out of the load balancer for being quiet.
    try {
        const result = await clickhouse.query({
            query: `SELECT count() AS n
                    FROM ${EVENTS_TABLE}
                    WHERE timestamp > now64(3, 'UTC') - INTERVAL 1 HOUR`,
            format: "JSONEachRow",
        });
        const [row] = await result.json<{ n: string }>();
        if (Number(row?.n ?? 0) === 0) {
            checks.ingest = "stale";
            warnings.push("No events received in the last hour");
        } else {
            checks.ingest = "ok";
        }
    } catch {
        checks.ingest = "unavailable";
    }

    // ── ClickHouse ping ───────────────────────────────────────────────────────
    // Fatal, like the Postgres check above: from Phase 2 on, an unreachable
    // ClickHouse means ingest drops events and every event view is empty.
    //
    // There is no migration check beside it any more, because there are no
    // migrations. The schema is applied from empty by the one-shot `bootstrap`
    // container and compose gates `app` on its exit code, so an app that is
    // serving at all has already had it succeed.
    try {
        await pingClickhouse();
        checks.clickhouse = "ok";
    } catch {
        checks.clickhouse = "error";
        isHealthy = false;
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
