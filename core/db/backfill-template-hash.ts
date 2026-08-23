/**
 * One-shot backfill: give every event that predates `template_hash` one, then
 * ask the rollup job to rebuild history over them.
 *
 * Without this the template rollup only ever covers events ingested after its
 * release, so 7-day and 30-day reads keep taking the raw-text path until 30-day
 * retention rolls the older events out. That is correct but it means the work
 * cannot be *verified* for weeks, which is the actual reason this exists.
 *
 * Usage (inside the app image, which carries the bundle):
 *
 *     node dist/backfill-template-hash.js --dry-run
 *     node dist/backfill-template-hash.js --batch 5000 --sleep 100
 *
 * **Safe to interrupt and re-run.** Work is selected by `template_hash IS NULL`,
 * so a killed run simply leaves rows for the next one. Nothing is destroyed:
 * every write is derived data, and a wrong normaliser is corrected by bumping
 * `NORMALIZER_VERSION` and running this again.
 *
 * ⚠️ It rewrites rows, so it produces dead tuples in proportion to what it
 * touches — roughly one heap row each, ~255 bytes on staging. Autovacuum
 * reclaims them, but on a large table it is worth running off-peak and checking
 * disk headroom first.
 */
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { logger } from "@/core/logger";
import { planBackfill, type BackfillRow } from "@/features/ingest/utils/plan-backfill";
import { markRollupDirty } from "@/features/ingest/services/event-rollup.service";

function numberArg(flag: string, fallback: number): number {
    const i = process.argv.indexOf(flag);
    if (i === -1) return fallback;
    const value = Number(process.argv[i + 1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const BATCH_SIZE = numberArg("--batch", 2000);
const SLEEP_MS = numberArg("--sleep", 50);
const DRY_RUN = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function countRemaining(): Promise<number> {
    const rows = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM events WHERE template_hash IS NULL
    `);
    return Number(rows[0]?.n ?? 0);
}

/**
 * One batch: read, compute, write both tables in a transaction.
 *
 * Ordered by timestamp so batches stay inside as few partitions as possible —
 * an unordered scan would touch every partition in every batch and turn a
 * sequential rewrite into a random one.
 */
async function processBatch(): Promise<number> {
    const rows = await db.execute<{
        id: string;
        timestamp: Date;
        message: string;
        project_id: string;
    }>(sql`
        SELECT id, timestamp, message, project_id
        FROM events
        WHERE template_hash IS NULL
        ORDER BY timestamp
        LIMIT ${BATCH_SIZE}
    `);

    if (rows.length === 0) return 0;

    const batch: BackfillRow[] = rows.map((r) => ({
        id: r.id,
        timestamp: new Date(r.timestamp),
        message: r.message,
        projectId: r.project_id,
    }));
    const { updates, templates } = planBackfill(batch);

    await db.transaction(async (tx) => {
        // A single UPDATE joined against a VALUES list. Row-at-a-time would be
        // one round trip per event; at nine million events that is the
        // difference between minutes and a day.
        //
        // Both halves of the composite key are matched: `events` is partitioned
        // by `timestamp`, so an id-only predicate would scan every partition.
        await tx.execute(sql`
            UPDATE events e
            SET template_hash = v.hash
            FROM (VALUES ${sql.join(
                updates.map(
                    (u) =>
                        sql`(${u.id}::uuid, ${u.timestamp.toISOString()}::timestamptz, ${u.templateHash.toString()}::bigint)`,
                ),
                sql`, `,
            )}) AS v(id, ts, hash)
            WHERE e.id = v.id AND e.timestamp = v.ts
        `);

        await tx.execute(sql`
            INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
            VALUES ${sql.join(
                templates.map(
                    (t) =>
                        sql`(${t.projectId}::uuid, ${t.templateHash.toString()}::bigint, ${t.template}, ${t.normalizerVersion})`,
                ),
                sql`, `,
            )}
            ON CONFLICT (project_id, template_hash) DO NOTHING
        `);
    });

    return updates.length;
}

/**
 * Hand history back to the rollup job.
 *
 * `markRollupDirty` is what ingest already uses to say "an event landed before
 * the watermark", and it is exactly the right lever here: pulling the watermark
 * back to each project's oldest event makes the existing job rebuild forward a
 * day per run, with its existing cap and its existing self-healing. Writing a
 * second rebuild path for this would be a second implementation of the thing
 * most likely to be subtly wrong.
 */
async function requestRebuild(): Promise<void> {
    const rows = await db.execute<{ project_id: string; oldest: Date }>(sql`
        SELECT project_id, MIN(timestamp) AS oldest
        FROM events
        WHERE template_hash IS NOT NULL
        GROUP BY project_id
    `);

    for (const row of rows) {
        await markRollupDirty(row.project_id, new Date(row.oldest));
        logger.info({ projectId: row.project_id, from: row.oldest }, "rollup rebuild requested");
    }
}

async function main(): Promise<void> {
    const remaining = await countRemaining();
    logger.info({ remaining, batchSize: BATCH_SIZE, sleepMs: SLEEP_MS, dryRun: DRY_RUN }, "backfill starting");

    if (DRY_RUN) {
        logger.info({ remaining }, "dry run — nothing written");
        return;
    }

    let done = 0;
    for (;;) {
        const n = await processBatch();
        if (n === 0) break;
        done += n;
        logger.info({ done, remaining: remaining - done }, "backfill progress");
        await sleep(SLEEP_MS);
    }

    logger.info({ done }, "hashes written; requesting rollup rebuild");
    await requestRebuild();
    logger.info({ done }, "backfill complete");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.error({ err }, "backfill failed");
        process.exit(1);
    });
