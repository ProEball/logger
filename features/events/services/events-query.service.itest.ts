import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { clickhouse } from "@/core/clickhouse/client";
import { messageTokens } from "@/core/clickhouse/search-query";
import { uuidv7 } from "@/shared/utils/uuidv7";
import { listEvents, getEventById, getFacetCounts } from "./events-query.service";
import type { EventFilters } from "@/features/events/utils/event-filters.types";

/**
 * The events read path against a real server.
 *
 * **This is the test the unit tests cannot be.** `filter-compiler.test.ts`
 * proves the shape of the SQL; nothing in it can know whether ClickHouse
 * accepts that SQL, and the write path already spent a day on exactly that gap
 * — three type assumptions that failed at the wire and nowhere else (§12.2).
 * There is no Drizzle dialect here and therefore no query builder to assert
 * against, which is the case PROJECT.md §11 reserves an integration test for.
 *
 * Two properties are only checkable here at all:
 *
 * - **`messageTokens` agrees with ClickHouse's tokenizer.** A disagreement is
 *   not a wrong answer, it is `BAD_ARGUMENTS` and a 500 on the events page, and
 *   the only authority on the rule is the server.
 * - **Every filter combination is executable.** A clause that parses in
 *   TypeScript and is rejected by the server looks identical in a unit test.
 *
 * The corpus is enumerated, per PROJECT.md §11: every row below exists for a
 * named case and every expected number is countable by hand from this file.
 * The range is always `custom`, so nothing here depends on the clock.
 */

const ORG = "cccccccc-0000-4000-8000-000000000001";

/**
 * Fresh per run.
 *
 * Nothing removes rows from the ClickHouse side of `logger_itest` between runs:
 * `seedCorpus` wipes the Postgres corpus, and truncating the shared `events`
 * table would race `clickhouse-ingest.service.itest.ts`, which runs in
 * parallel. Minting the project ids each run makes the two suites independent
 * of each other and of the previous run — the same approach that file already
 * takes.
 */
const PROJECT = uuidv7();
const OTHER_PROJECT = uuidv7();
const DELETED_PROJECT = uuidv7();
const BULK_PROJECT = uuidv7();

const BASE = Date.parse("2026-08-26T10:00:00.000Z");

/** A window comfortably around every timestamp below. */
const WINDOW: EventFilters["range"] = {
    type: "custom",
    from: "2026-08-26T09:00:00.000Z",
    to: "2026-08-26T11:00:00.000Z",
};

function filters(patch: Partial<EventFilters> = {}): EventFilters {
    return { range: WINDOW, ...patch };
}

function at(minutes: number): string {
    return new Date(BASE + minutes * 60_000).toISOString().replace("T", " ").replace("Z", "");
}

interface SeedRow {
    project_id: string;
    timestamp: string;
    id: string;
    level: string;
    message: string;
    source?: string;
    environment?: string;
    release?: string;
    error_type?: string;
    user_id?: string;
    session_id?: string;
    request_id?: string;
    trace_id?: string;
    stack_trace?: string;
    user_agent?: string;
    ip?: string;
    template_hash?: string;
    attributes?: Record<string, unknown>;
    context?: string;
}

function seed(row: SeedRow): Record<string, unknown> {
    return {
        source: "",
        environment: "",
        release: "",
        error_type: "",
        user_id: "",
        session_id: "",
        request_id: "",
        trace_id: "",
        stack_trace: "",
        user_agent: "",
        ip: "::",
        template_hash: "0",
        attributes: {},
        context: "{}",
        ...row,
    };
}

/**
 * Five events, each carrying one case.
 *
 * 1. the only one whose message contains the phrase "connection refused"
 * 2. and 3. share a message, so a search on it must return both
 * 3. is the only one outside `production`
 * 4. is blank in every optional field — the `(unset)` facet, and the attribute
 *    stored as an empty string rather than absent
 * 5. carries a numeric attribute, which the Postgres filter could never match
 */
const CORPUS: SeedRow[] = [
    {
        project_id: PROJECT,
        timestamp: at(0),
        id: uuidv7(BASE),
        level: "info",
        message: "Connection refused by upstream",
        source: "api",
        environment: "production",
        release: "v1",
        user_id: "u_1",
        session_id: "s_1",
        request_id: "r_1",
        trace_id: "t_1",
        ip: "::ffff:203.0.113.7",
        user_agent: "sdk/2.0",
        attributes: { order_id: "o_1", retries: 2 },
        context: '{"path":"/login"}',
    },
    {
        project_id: PROJECT,
        timestamp: at(1),
        id: uuidv7(BASE + 60_000),
        level: "error",
        message: "Timeout after 30s",
        source: "worker",
        environment: "production",
        release: "v1",
        error_type: "TimeoutError",
        user_id: "u_1",
        attributes: { order_id: "o_2" },
    },
    {
        project_id: PROJECT,
        timestamp: at(2),
        id: uuidv7(BASE + 120_000),
        level: "error",
        message: "Timeout after 30s",
        source: "api",
        environment: "staging",
        release: "v2",
        error_type: "TimeoutError",
        user_id: "u_2",
    },
    {
        project_id: PROJECT,
        timestamp: at(3),
        id: uuidv7(BASE + 180_000),
        level: "debug",
        message: "debug noise",
        attributes: { order_id: "" },
    },
    {
        project_id: PROJECT,
        timestamp: at(4),
        id: uuidv7(BASE + 240_000),
        level: "warn",
        message: "user_id lookup failed",
        source: "api",
        environment: "production",
        release: "v2",
        user_id: "u_2",
        template_hash: "18446744073709551615",
        attributes: { retries: 0 },
    },
    // Tenant isolation: same window, same shape, different project.
    {
        project_id: OTHER_PROJECT,
        timestamp: at(1),
        id: uuidv7(BASE + 60_000),
        level: "error",
        message: "Timeout after 30s",
        environment: "production",
    },
    // Owned by a soft-deleted project.
    {
        project_id: DELETED_PROJECT,
        timestamp: at(1),
        id: uuidv7(BASE + 60_000),
        level: "error",
        message: "Timeout after 30s",
    },
];

/** 60 events, so the 50-row page and its cursor have something to walk. */
const BULK: SeedRow[] = Array.from({ length: 60 }, (_, i) => ({
    project_id: BULK_PROJECT,
    timestamp: at(i),
    id: uuidv7(BASE + i * 60_000),
    level: "info",
    message: `bulk event ${i}`,
}));

beforeAll(async () => {
    const ping = await clickhouse.ping({ select: true });
    if (!ping.success) throw ping.error;

    // Its own organization, not the shared fixture's: `seedCorpus` deletes
    // every project on each run, and a fourth project in ORG_A would change
    // totals in tests that pass `ORG_A_PROJECTS` around.
    await db.execute(sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${ORG}::uuid, 'Events Read Org', 'events-read-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
        INSERT INTO projects (id, organization_id, name, slug, deleted_at) VALUES
            (${PROJECT}::uuid, ${ORG}::uuid, 'Read', 'read', NULL),
            (${OTHER_PROJECT}::uuid, ${ORG}::uuid, 'Other', 'other-read', NULL),
            (${BULK_PROJECT}::uuid, ${ORG}::uuid, 'Bulk', 'bulk-read', NULL),
            (${DELETED_PROJECT}::uuid, ${ORG}::uuid, 'Gone', 'gone-read', now())
    `);

    await clickhouse.insert({
        table: "events",
        values: [...CORPUS, ...BULK].map(seed),
        format: "JSONEachRow",
        // `async_insert: 0`, and every fixture write in the integration suite
        // does the same. The shared client turns async insert on, which merges
        // rows from concurrent queries into **one block** — and a block's
        // checksum is what `clickhouse-ingest.service.itest.ts` asserts on when
        // it checks that an identical retry is discarded. Running in parallel
        // against this same table, an unsynchronised fixture write made that
        // test fail about one run in three. It looked like flakiness and was
        // two suites sharing a buffer.
        clickhouse_settings: { async_insert: 0 },
    });
});

afterAll(async () => {
    await clickhouse.close();
});

describe("listEvents", () => {
    it("returns the project's events, newest first", async () => {
        const page = await listEvents(PROJECT, filters());

        expect(page.events.map((event) => event.message)).toEqual([
            "user_id lookup failed",
            "debug noise",
            "Timeout after 30s",
            "Timeout after 30s",
            "Connection refused by upstream",
        ]);
        expect(page.hasMore).toBe(false);
    });

    it("returns rows in the shape the events table already reads", async () => {
        const [, , , , oldest] = (await listEvents(PROJECT, filters())).events;

        expect(oldest.message).toBe("Connection refused by upstream");
        expect(oldest.timestamp.toISOString()).toBe("2026-08-26T10:00:00.000Z");
        expect(oldest.level).toBe("info");
        expect(oldest.source).toBe("api");
        expect(oldest.environment).toBe("production");
        expect(oldest.userId).toBe("u_1");
        expect(oldest.traceId).toBe("t_1");
        // Stored v4-mapped by the IPv6 column; the UI must not see that.
        expect(oldest.ip).toBe("203.0.113.7");
        expect(oldest.context).toEqual({ path: "/login" });
        expect(oldest.attributes).toEqual({ order_id: "o_1", retries: 2 });
        // Absent, not "".
        expect(oldest.errorType).toBeNull();
    });

    it("keeps an integer attribute an integer", async () => {
        // Without `output_format_json_quote_64bit_integers = 0` this is the
        // string "2", and the attributes panel would show a quoted number
        // where Postgres showed a bare one.
        const [{ attributes }] = (await listEvents(PROJECT, filters({ userId: "u_1" }))).events.slice(-1);
        expect(attributes).toEqual({ order_id: "o_1", retries: 2 });
    });

    it("folds a UInt64 fingerprint back into the signed range Postgres used", async () => {
        const [newest] = (await listEvents(PROJECT, filters())).events;
        expect(newest.templateHash).toBe(BigInt(-1));
    });

    it("never returns another project's events", async () => {
        const page = await listEvents(PROJECT, filters());
        expect(page.events.every((event) => event.projectId === PROJECT)).toBe(true);
        expect(page.events).toHaveLength(5);
    });

    it("returns nothing for a soft-deleted project, though the rows are still there", async () => {
        // The `projects` join could not follow the events into ClickHouse; this
        // is the assertion that the property survived the move anyway.
        expect(await listEvents(DELETED_PROJECT, filters())).toEqual({ events: [], hasMore: false });
    });

    it("respects the window", async () => {
        const narrow = await listEvents(
            PROJECT,
            filters({
                range: { type: "custom", from: "2026-08-26T10:01:00.000Z", to: "2026-08-26T10:03:00.000Z" },
            }),
        );

        expect(narrow.events.map((event) => event.message)).toEqual([
            "debug noise",
            "Timeout after 30s",
            "Timeout after 30s",
        ]);
    });

    it("includes both ends of the window", async () => {
        const exact = await listEvents(
            PROJECT,
            filters({
                range: { type: "custom", from: "2026-08-26T10:00:00.000Z", to: "2026-08-26T10:04:00.000Z" },
            }),
        );
        expect(exact.events).toHaveLength(5);
    });
});

describe("pagination", () => {
    it("returns a full page and reports there is more", async () => {
        const page = await listEvents(BULK_PROJECT, filters());

        expect(page.events).toHaveLength(50);
        expect(page.hasMore).toBe(true);
        expect(page.events[0].message).toBe("bulk event 59");
    });

    it("walks to the next page from the last row of the first", async () => {
        const first = await listEvents(BULK_PROJECT, filters());
        const last = first.events[first.events.length - 1];

        const second = await listEvents(BULK_PROJECT, filters(), {
            beforeTs: last.timestamp.toISOString(),
            beforeId: last.id,
        });

        expect(second.events).toHaveLength(10);
        expect(second.hasMore).toBe(false);
        expect(second.events[0].message).toBe("bulk event 9");
        // No overlap and no gap: 50 + 10 distinct ids over 60 rows.
        const ids = new Set([...first.events, ...second.events].map((event) => event.id));
        expect(ids.size).toBe(60);
    });

    it("breaks a timestamp tie by id, so no row is served twice or skipped", async () => {
        // Three rows on the same millisecond is what the `id` in the sort key
        // exists for. The assertion is deliberately not about *which* order
        // ClickHouse puts them in — it compares UUIDs its own way — but that
        // the cursor and the `ORDER BY` agree on whatever that order is. That
        // agreement is the whole correctness of keyset pagination.
        const project = uuidv7();
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${project}::uuid, ${ORG}::uuid, 'Tie', ${`tie-${project.slice(0, 8)}`})
        `);
        const ids = [uuidv7(BASE), uuidv7(BASE), uuidv7(BASE)];
        await clickhouse.insert({
            table: "events",
            // Synchronous, for the reason given at the top of this file.
            clickhouse_settings: { async_insert: 0 },
            values: ids.map((id, i) =>
                seed({
                    project_id: project,
                    timestamp: at(0),
                    id,
                    level: "info",
                    message: `tie ${i}`,
                }),
            ),
            format: "JSONEachRow",
        });

        const all = await listEvents(project, filters());
        expect(all.events).toHaveLength(3);
        expect(new Set(all.events.map((event) => event.id))).toEqual(new Set(ids));

        const after = await listEvents(project, filters(), {
            beforeTs: all.events[0].timestamp.toISOString(),
            beforeId: all.events[0].id,
        });

        expect(after.events.map((event) => event.id)).toEqual(
            all.events.slice(1).map((event) => event.id),
        );
    });
});

describe("getEventById", () => {
    it("finds one event by its id and timestamp", async () => {
        const [newest] = (await listEvents(PROJECT, filters())).events;
        const found = await getEventById(PROJECT, newest.id, newest.timestamp);

        expect(found?.id).toBe(newest.id);
        expect(found?.message).toBe("user_id lookup failed");
    });

    it("returns null when the timestamp does not match the id", async () => {
        const [newest] = (await listEvents(PROJECT, filters())).events;
        expect(await getEventById(PROJECT, newest.id, new Date(BASE))).toBeNull();
    });

    it("returns null for an event belonging to another project", async () => {
        const [other] = (await listEvents(OTHER_PROJECT, filters())).events;
        expect(await getEventById(PROJECT, other.id, other.timestamp)).toBeNull();
    });

    it("returns null for a soft-deleted project", async () => {
        const [gone] = (await listEvents(OTHER_PROJECT, filters())).events;
        expect(await getEventById(DELETED_PROJECT, gone.id, gone.timestamp)).toBeNull();
    });
});

describe("the filters, against a real table", () => {
    async function messages(patch: Partial<EventFilters>): Promise<string[]> {
        const page = await listEvents(PROJECT, filters(patch));
        return page.events.map((event) => event.message);
    }

    it("filters by level", async () => {
        expect(await messages({ levels: ["error"] })).toEqual([
            "Timeout after 30s",
            "Timeout after 30s",
        ]);
    });

    it("filters by several levels at once", async () => {
        expect(await messages({ levels: ["debug", "warn"] })).toEqual([
            "user_id lookup failed",
            "debug noise",
        ]);
    });

    it("ignores a level that is not in the enum instead of failing", async () => {
        // `parse-filters.ts` validates levels, but the Server Action is a public
        // entry point and an Enum8 comparison against an unknown name must be
        // "no match", not an error.
        expect(await messages({ levels: ["nonsense" as "error"] })).toEqual([]);
    });

    it("filters by environment, source, release and error type", async () => {
        expect(await messages({ environments: ["staging"] })).toEqual(["Timeout after 30s"]);
        expect(await messages({ sources: ["worker"] })).toEqual(["Timeout after 30s"]);
        expect(await messages({ releases: ["v2"] })).toEqual([
            "user_id lookup failed",
            "Timeout after 30s",
        ]);
        expect(await messages({ errorTypes: ["TimeoutError"] })).toHaveLength(2);
    });

    it("filters by each correlation id", async () => {
        expect(await messages({ userId: "u_1" })).toHaveLength(2);
        expect(await messages({ sessionId: "s_1" })).toEqual(["Connection refused by upstream"]);
        expect(await messages({ requestId: "r_1" })).toHaveLength(1);
        expect(await messages({ traceId: "t_1" })).toHaveLength(1);
    });

    it("ANDs unrelated filters", async () => {
        expect(await messages({ levels: ["error"], environments: ["production"] })).toEqual([
            "Timeout after 30s",
        ]);
    });
});

describe("the message search, against a real table", () => {
    async function messages(query: string): Promise<string[]> {
        const page = await listEvents(PROJECT, filters({ message: query }));
        return page.events.map((event) => event.message);
    }

    it("matches a single word through the index", async () => {
        expect(await messages("timeout")).toHaveLength(2);
    });

    it("is case-insensitive, as the tsvector was", async () => {
        expect(await messages("REFUSED")).toEqual(["Connection refused by upstream"]);
    });

    it("ANDs bare words", async () => {
        expect(await messages("connection upstream")).toEqual(["Connection refused by upstream"]);
        expect(await messages("connection timeout")).toEqual([]);
    });

    it("matches a phrase only where the words are adjacent", async () => {
        expect(await messages('"connection refused"')).toEqual(["Connection refused by upstream"]);
        expect(await messages('"refused connection"')).toEqual([]);
    });

    it("excludes a negated term", async () => {
        expect(await messages("-timeout")).toHaveLength(3);
    });

    it("ORs, with AND binding tighter", async () => {
        // "timeout" matches two, "upstream" one; `debug or timeout` is three.
        expect(await messages("debug or timeout")).toHaveLength(3);
        expect(await messages("connection upstream or debug")).toHaveLength(2);
    });

    it("requires the literal for an underscored identifier", async () => {
        // The deliberate divergence from `websearch_to_tsquery`, which would
        // have accepted "user id lookup" here too.
        expect(await messages("user_id")).toEqual(["user_id lookup failed"]);
        expect(await messages("id_user")).toEqual([]);
    });

    it("matches a token with a digit in it", async () => {
        expect(await messages("30s")).toHaveLength(2);
    });

    it("does not fail on punctuation-only input", async () => {
        expect(await messages("+++")).toEqual([]);
        expect(await messages("-")).toHaveLength(5);
    });

    it("accepts every hostile string a URL can carry", async () => {
        // A rejected needle is BAD_ARGUMENTS, which is a 500 on the events page.
        for (const query of [
            '"',
            '""""',
            "' OR 1=1 --",
            "\\",
            "{p0:String}",
            "a-b-c-d",
            "..",
            "___",
            "\t",
            "привет",
            "café",
            "a\u{1F600}b",
        ]) {
            await expect(listEvents(PROJECT, filters({ message: query }))).resolves.toBeDefined();
        }
    });
});

describe("messageTokens agrees with the server's tokenizer", () => {
    /**
     * The one thing no unit test can establish. `hasToken` rejects a needle
     * containing a separator, so if this rule and ClickHouse's ever disagree,
     * the events page returns 500 rather than the wrong rows.
     */
    const BATTERY = [
        "connection refused",
        "foo_bar",
        "foo-bar",
        "api.users.list",
        "timeout after 30s",
        "a1_b2",
        "a  ,  b",
        "trailing.",
        ".leading",
        "a/b:c+d",
        "привет мир",
        "café",
        "a\u{1F600}b",
        "a\u{2014}b",
        "\u{20AC}100",
        "",
        "+++",
        "   ",
    ];

    it("splits every input the same way", async () => {
        const result = await clickhouse.query({
            query: BATTERY.map(
                (_, i) => `SELECT ${i} AS i, tokens(lowerUTF8({m${i}:String})) AS t`,
            ).join(" UNION ALL "),
            query_params: Object.fromEntries(BATTERY.map((text, i) => [`m${i}`, text])),
            format: "JSONEachRow",
        });

        const server = new Map(
            (await result.json<{ i: number; t: string[] }>()).map((row) => [Number(row.i), row.t]),
        );

        for (const [i, text] of BATTERY.entries()) {
            expect(messageTokens(text), `input ${JSON.stringify(text)}`).toEqual(server.get(i) ?? []);
        }
    });

    it("produces needles hasToken accepts", async () => {
        const needles = BATTERY.flatMap((text) => messageTokens(text));
        expect(needles.length).toBeGreaterThan(20);

        for (const needle of needles) {
            const result = await clickhouse.query({
                query: "SELECT hasToken('x', {n:String}) AS v",
                query_params: { n: needle },
                format: "JSONEachRow",
            });
            await expect(result.json()).resolves.toBeDefined();
        }
    });
});

describe("the attribute filters, against a real table", () => {
    async function messages(key: string, value: string): Promise<string[]> {
        const page = await listEvents(PROJECT, filters({ attributes: [{ key, value }] }));
        return page.events.map((event) => event.message);
    }

    it("matches a string attribute", async () => {
        expect(await messages("order_id", "o_1")).toEqual(["Connection refused by upstream"]);
    });

    it("matches a numeric attribute against the text from the URL", async () => {
        // Postgres could not: `attributes @> '{"retries":"2"}'` is type-strict,
        // and a query string only ever carries strings, so this filter never
        // matched a numeric attribute at all.
        expect(await messages("retries", "2")).toEqual(["Connection refused by upstream"]);
        expect(await messages("retries", "0")).toEqual(["user_id lookup failed"]);
    });

    it("matches an attribute stored as an empty string", async () => {
        expect(await messages("order_id", "")).toEqual(["debug noise"]);
    });

    it("does not match events that never carried the key", async () => {
        // The case the existence check exists for: `toString` of an absent path
        // is also `''`.
        expect(await messages("never_set", "")).toEqual([]);
    });

    it("returns nothing for a key no event has", async () => {
        expect(await messages("never_set", "x")).toEqual([]);
    });

    it("ANDs several attribute filters", async () => {
        const page = await listEvents(
            PROJECT,
            filters({
                attributes: [
                    { key: "order_id", value: "o_1" },
                    { key: "retries", value: "2" },
                ],
            }),
        );
        expect(page.events).toHaveLength(1);

        const contradiction = await listEvents(
            PROJECT,
            filters({
                attributes: [
                    { key: "order_id", value: "o_1" },
                    { key: "retries", value: "9" },
                ],
            }),
        );
        expect(contradiction.events).toEqual([]);
    });

    it("takes a hostile key without executing any of it", async () => {
        await expect(
            listEvents(PROJECT, filters({ attributes: [{ key: "a') OR 1=1 --", value: "x" }] })),
        ).resolves.toMatchObject({ events: [] });
    });
});

describe("getFacetCounts", () => {
    it("counts each field, most common first", async () => {
        const counts = await getFacetCounts(PROJECT, filters());

        expect(counts.levels).toEqual([
            { value: "error", count: 2 },
            { value: "debug", count: 1 },
            { value: "info", count: 1 },
            { value: "warn", count: 1 },
        ]);
        expect(counts.environments).toEqual([
            { value: "production", count: 3 },
            { value: "(unset)", count: 1 },
            { value: "staging", count: 1 },
        ]);
        expect(counts.sources).toEqual([
            { value: "api", count: 3 },
            { value: "(unset)", count: 1 },
            { value: "worker", count: 1 },
        ]);
    });

    it("labels a blank value rather than dropping it", async () => {
        // Postgres grouped NULL under `(unset)`; the column has no Nullable, so
        // the empty string takes that role.
        const counts = await getFacetCounts(PROJECT, filters());
        expect(counts.errorTypes).toContainEqual({ value: "(unset)", count: 3 });
    });

    it("scopes every facet by the other active filters", async () => {
        const counts = await getFacetCounts(PROJECT, filters({ environments: ["production"] }));

        expect(counts.levels).toEqual([
            { value: "error", count: 1 },
            { value: "info", count: 1 },
            { value: "warn", count: 1 },
        ]);
    });

    it("does not let a field's own selection shrink its own counts", async () => {
        // Selecting one level must leave the other levels' counts visible, or
        // the panel becomes impossible to un-filter.
        const counts = await getFacetCounts(PROJECT, filters({ levels: ["error"] }));
        expect(counts.levels).toHaveLength(4);
        expect(counts.sources).toEqual([
            { value: "api", count: 1 },
            { value: "worker", count: 1 },
        ]);
    });

    it("returns empty lists for a soft-deleted project", async () => {
        expect(await getFacetCounts(DELETED_PROJECT, filters())).toEqual({
            levels: [],
            environments: [],
            sources: [],
            releases: [],
            errorTypes: [],
        });
    });

    it("counts nothing outside the window", async () => {
        const counts = await getFacetCounts(
            PROJECT,
            filters({
                range: { type: "custom", from: "2026-08-26T08:00:00.000Z", to: "2026-08-26T09:00:00.000Z" },
            }),
        );
        expect(counts.levels).toEqual([]);
    });
});
