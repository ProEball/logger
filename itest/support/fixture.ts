import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

/**
 * The integration-test corpus.
 *
 * **Enumerated, not generated.** Every row below exists to exercise a named
 * case, and every number asserted in a test is derivable by hand from this
 * file. A randomised corpus would force each test to *compute* its expected
 * value, and the only way to compute it would be to re-implement the query in
 * TypeScript — at which point the test compares the code against a copy of
 * itself. That failure mode is not hypothetical here: `build-payload.test.ts`
 * did exactly that until 2026-08-20, and deleting a field from the production
 * module broke no test.
 *
 * Volume belongs to a different corpus. Nothing here reproduces a slow query,
 * and nothing here should try to: `PLAN.md` §16.1 Stage C needs a large,
 * high-cardinality dataset for measurement, and its requirements are the
 * opposite of these.
 */

// ── identities ───────────────────────────────────────────────────────────────

export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
export const BETA = "aaaaaaaa-0000-4000-8000-000000000002";
export const QUIET = "aaaaaaaa-0000-4000-8000-000000000003";
export const OTHER_ORG_PROJECT = "bbbbbbbb-0000-4000-8000-000000000001";

/** The projects a test normally passes to the service. */
export const ORG_A_PROJECTS = [ALPHA, BETA, QUIET];

// ── time ─────────────────────────────────────────────────────────────────────

/**
 * Every timestamp is relative to an anchor, because two queries measure
 * against `NOW()` (`getOrgEnvironments` hardcodes a 30-day window) — a corpus
 * pinned to absolute dates would silently fall out of that window overnight.
 *
 * The anchor is written into the data as a marker event rather than shared
 * through a module constant: the seed runs in vitest's setup process and the
 * tests run in workers, so module state does not survive the trip. Reading it
 * back from the database also means the tests assert against the timestamps
 * that were really inserted, not the ones the seed intended to insert.
 */
export const ANCHOR_MARKER = "itest anchor marker";

/** Anchor: an exact hour boundary, two hours in the past. */
function computeAnchor(): Date {
    const hour = 3_600_000;
    return new Date(Math.floor((Date.now() - 2 * hour) / hour) * hour);
}

/**
 * The range most tests use: one hour starting at the anchor. Chosen so that
 * `from` and `to` both land on real event timestamps, which is what makes the
 * inclusive/exclusive boundary testable at all.
 */
export function canonicalRange(anchor: Date): { from: Date; to: Date } {
    return { from: anchor, to: new Date(anchor.getTime() + 60 * 60_000) };
}

// ── message fixtures ─────────────────────────────────────────────────────────

/**
 * Two messages identical through character 200 and differing after it.
 * `getOrgTopErrors` groups on `SUBSTRING(message, 1, 200)`, so these must
 * collapse into a single row.
 */
const LONG_PREFIX = "L".repeat(200);
export const LONG_MESSAGE_A = `${LONG_PREFIX}-tail-A`;
export const LONG_MESSAGE_B = `${LONG_PREFIX}-tail-B`;
export const LONG_MESSAGE_GROUPED = LONG_PREFIX;

/**
 * An environment name containing a comma — accepted by the ingest schema,
 * which validates `environment` only as `z.string().max(128)`.
 * `getProjectSummaries` joins environments with `STRING_AGG(…, ',')` and then
 * splits the result on "," in TypeScript, so this one value arrives as two.
 */
export const COMMA_ENVIRONMENT = "eu,prod";

// ── the corpus ───────────────────────────────────────────────────────────────

interface EventSpec {
    project: string;
    count: number;
    level: string;
    message: string;
    /** Minutes after the anchor; negative is before it. */
    offsetMinutes: number;
    environment?: string | null;
    /** What this row is here to prove. Not decoration — read it before editing counts. */
    why: string;
}

const DAY = 24 * 60;

export const CORPUS: EventSpec[] = [
    // ALPHA — inside the canonical range.
    {
        project: ALPHA, count: 1, level: "info", message: ANCHOR_MARKER,
        offsetMinutes: 0, environment: "production",
        why: "the anchor itself, and the `timestamp >= from` inclusive boundary",
    },
    {
        project: ALPHA, count: 12, level: "info", message: "alpha routine",
        offsetMinutes: 5, environment: "production",
        why: "bulk non-error volume",
    },
    {
        project: ALPHA, count: 10, level: "error", message: "alpha boom",
        offsetMinutes: 5, environment: "production",
        why: "10 against BETA's 9 — the pair that separates numeric from lexicographic ordering",
    },
    {
        project: ALPHA, count: 1, level: "fatal", message: "alpha meltdown",
        offsetMinutes: 10, environment: "staging",
        why: "fatal counts as an error; also the 6th distinct group, dropped by LIMIT 5",
    },
    {
        project: ALPHA, count: 1, level: "info", message: "alpha comma env",
        offsetMinutes: 15, environment: COMMA_ENVIRONMENT,
        why: "environment containing the separator STRING_AGG uses",
    },
    {
        project: ALPHA, count: 2, level: "error", message: LONG_MESSAGE_A,
        offsetMinutes: 20, environment: "production",
        why: "groups with LONG_MESSAGE_B under SUBSTRING(message, 1, 200)",
    },
    {
        project: ALPHA, count: 2, level: "error", message: LONG_MESSAGE_B,
        offsetMinutes: 20, environment: "production",
        why: "differs from LONG_MESSAGE_A only past character 200",
    },
    {
        project: ALPHA, count: 3, level: "error", message: "alpha rare A",
        offsetMinutes: 25, environment: "production",
        why: "pads the distinct-message count to 6 so LIMIT 5 has something to cut",
    },
    {
        project: ALPHA, count: 2, level: "error", message: "alpha rare B",
        offsetMinutes: 25, environment: "production",
        why: "as above",
    },

    // ALPHA — outside the canonical range, on purpose.
    {
        project: ALPHA, count: 1, level: "info", message: "alpha at upper bound",
        offsetMinutes: 60, environment: "production",
        why: "exactly at `to`, which is exclusive — must NOT be counted",
    },
    {
        project: ALPHA, count: 3, level: "warn", message: "alpha later",
        offsetMinutes: 70, environment: null,
        why: "a second hour bucket, and a NULL environment",
    },
    {
        project: ALPHA, count: 1, level: "info", message: "alpha archived",
        offsetMinutes: -20 * DAY, environment: "archive",
        why: "inside getOrgEnvironments' 30-day window but outside every range preset",
    },
    {
        project: ALPHA, count: 1, level: "info", message: "alpha ancient",
        offsetMinutes: -40 * DAY, environment: "legacy",
        why: "outside the 30-day window — 'legacy' must never be offered as a filter",
    },

    // BETA.
    {
        project: BETA, count: 9, level: "error", message: "beta boom",
        offsetMinutes: 5, environment: "staging",
        why: "9 against ALPHA's 10 (see above)",
    },
    {
        project: BETA, count: 6, level: "info", message: "beta routine",
        offsetMinutes: 5, environment: null,
        why: "NULL environment is excluded from a project's environment list",
    },
    {
        project: BETA, count: 2, level: "warn", message: "beta warning",
        offsetMinutes: 5, environment: null,
        why: "a level that is neither info nor an error",
    },

    // QUIET has no events at all — a project must still appear, with zeros.

    // Another organization entirely.
    {
        project: OTHER_ORG_PROJECT, count: 50, level: "fatal", message: "other org noise",
        offsetMinutes: 5, environment: "production",
        why: "loud enough to dominate every aggregate if project scoping ever leaks",
    },
];

// ── seeding ──────────────────────────────────────────────────────────────────

export async function seedCorpus(sql: Sql): Promise<void> {
    const anchor = computeAnchor();

    // Idempotent: the suite is read-only, but a re-run must not double counts.
    await sql`DELETE FROM project_environments`;
    await sql`DELETE FROM events`;
    await sql`DELETE FROM projects`;
    await sql`DELETE FROM organizations`;

    await sql`
        INSERT INTO organizations (id, name, slug) VALUES
            (${ORG_A}::uuid, 'Itest Org A', 'itest-org-a'),
            (${ORG_B}::uuid, 'Itest Org B', 'itest-org-b')
    `;

    await sql`
        INSERT INTO projects (id, organization_id, name, slug) VALUES
            (${ALPHA}::uuid, ${ORG_A}::uuid, 'Alpha', 'alpha'),
            (${BETA}::uuid,  ${ORG_A}::uuid, 'Beta',  'beta'),
            (${QUIET}::uuid, ${ORG_A}::uuid, 'Quiet', 'quiet'),
            (${OTHER_ORG_PROJECT}::uuid, ${ORG_B}::uuid, 'Other', 'other')
    `;

    // `events.id` has no database default — the ingest service generates it —
    // so the fixture has to supply one per row.
    const rows = CORPUS.flatMap((spec) =>
        Array.from({ length: spec.count }, () => ({
            id: randomUUID(),
            project_id: spec.project,
            // ISO string, not a Date: postgres.js cannot infer a column type
            // for the multi-row insert helper and would send the Date as raw
            // text. Postgres parses the ISO form into timestamptz itself.
            timestamp: new Date(anchor.getTime() + spec.offsetMinutes * 60_000).toISOString(),
            level: spec.level,
            message: spec.message,
            environment: spec.environment ?? null,
        })),
    );

    // One statement: postgres.js expands the array into a multi-row INSERT.
    await sql`
        INSERT INTO events ${sql(rows, "id", "project_id", "timestamp", "level", "message", "environment")}
    `;

    // The environment registry is maintained at ingest, and this fixture writes
    // to `events` directly — so it has to derive the registry itself. This is
    // deliberately the *same* statement migration 0007 uses to backfill an
    // existing install, so the tests exercise that derivation rather than a
    // second, hand-written version of it that could disagree.
    await sql`
        INSERT INTO project_environments (project_id, environment, first_seen_at, last_seen_at)
        SELECT project_id, environment, MIN(timestamp), MAX(timestamp)
        FROM events
        GROUP BY project_id, environment
        ON CONFLICT ON CONSTRAINT project_environments_project_env_unique DO NOTHING
    `;
}
