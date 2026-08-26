import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PgBoss } from "pg-boss";
import type { AlertRule } from "@/core/db/schema";

/**
 * This file used to test a copy of the evaluator rather than the evaluator.
 *
 * It declared its own `determineNewState` and `shouldNotify` beside the real
 * ones and asserted on those — the same defect PROJECT.md §11 records for
 * `aggregations.service.test.ts`, and one the Stop hook cannot see, because a
 * test that imports nothing satisfies "a sibling test exists". The threshold
 * and notification rules below are the same cases, asked of the real
 * `evaluateOne`.
 *
 * Rewritten in Phase 3 of the ClickHouse migration, when the match count moved
 * to a second store and the old file could not have noticed either way.
 *
 * Only the two databases and pg-boss are mocked; all three are real system
 * boundaries. `compileFilters` runs for real, which is what makes the "counts
 * with the rule's own filter" case worth anything.
 */

const { updateMock, insertMock, chQueryMock, updates, inserts } = vi.hoisted(() => ({
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    chQueryMock: vi.fn(),
    updates: [] as Record<string, unknown>[],
    inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/core/db/client", () => ({ db: { update: updateMock, insert: insertMock } }));
vi.mock("@/core/clickhouse/client", () => ({ clickhouse: { query: chQueryMock } }));

import { evaluateOne } from "@/features/alerts/services/alert-evaluator.service";

/** How many events the mocked ClickHouse reports for the next evaluation. */
let matchCount = 0;
/** Rows the optimistic-concurrency `UPDATE … RETURNING` gives back. */
let updateReturns: unknown[] = [];
/** The last WHERE clause and parameters the evaluator sent to ClickHouse. */
let lastQuery: { query: string; query_params: Record<string, unknown> } | null = null;

const sendMock = vi.fn();

// `evaluateOne` uses exactly one method of pg-boss. Constructing a real PgBoss
// would open a database connection, so the stub is asserted against instead —
// the `as` is confined to this line and the shape is one method wide.
const boss = { send: sendMock } as unknown as PgBoss;

function thenable(rows: unknown[]): Record<string, unknown> {
    return { then: (resolve: (value: unknown) => void) => resolve(rows) };
}

beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    inserts.length = 0;
    matchCount = 0;
    updateReturns = [{ id: "rule-1" }];
    lastQuery = null;

    chQueryMock.mockImplementation(async (args: { query: string; query_params: Record<string, unknown> }) => {
        lastQuery = args;
        return { json: async () => [{ n: String(matchCount) }] };
    });

    updateMock.mockImplementation(() => {
        const chain: Record<string, unknown> = {
            set: (values: Record<string, unknown>) => {
                updates.push(values);
                return chain;
            },
            where: () => chain,
            returning: () => thenable(updateReturns),
            then: (resolve: (value: unknown) => void) => resolve([]),
        };
        return chain;
    });

    insertMock.mockImplementation(() => {
        const chain: Record<string, unknown> = {
            values: (values: Record<string, unknown>) => {
                inserts.push(values);
                return chain;
            },
            returning: () => thenable([{ id: "notification-1" }]),
            then: (resolve: (value: unknown) => void) => resolve([]),
        };
        return chain;
    });
});

function rule(patch: Partial<AlertRule> = {}): AlertRule {
    return {
        id: "rule-1",
        projectId: "11111111-1111-4111-8111-111111111111",
        name: "Errors",
        enabled: true,
        state: "ok",
        version: 3,
        notifyOnResolve: true,
        condition: { type: "threshold", count: 10, windowMinutes: 5 },
        filter: { range: { type: "preset", value: "1h" } },
        channels: [{ type: "webhook", url: "https://example.test/hook" }],
        ...patch,
    } as AlertRule;
}

/** The state the evaluator wrote, or undefined when it wrote no transition. */
function writtenState(): unknown {
    return updates.find((values) => "state" in values)?.state;
}

describe("the threshold", () => {
    it("fires when the count meets it", async () => {
        matchCount = 10;
        await evaluateOne(rule(), boss);
        expect(writtenState()).toBe("firing");
    });

    it("fires when the count exceeds it", async () => {
        matchCount = 15;
        await evaluateOne(rule(), boss);
        expect(writtenState()).toBe("firing");
    });

    it("stays ok one below it", async () => {
        matchCount = 9;
        await evaluateOne(rule(), boss);
        expect(writtenState()).toBeUndefined();
        expect(updates[0].lastMatchCount).toBe(9);
    });

    it("stays ok at zero", async () => {
        await evaluateOne(rule(), boss);
        expect(writtenState()).toBeUndefined();
    });

    it("fires at one when the threshold is one", async () => {
        matchCount = 1;
        await evaluateOne(rule({ condition: { type: "threshold", count: 1, windowMinutes: 5 } }), boss);
        expect(writtenState()).toBe("firing");
    });

    it("resolves when a firing rule drops below it", async () => {
        matchCount = 0;
        await evaluateOne(rule({ state: "firing" }), boss);
        expect(writtenState()).toBe("ok");
    });

    it("records the count without a transition when the state is unchanged", async () => {
        matchCount = 12;
        await evaluateOne(rule({ state: "firing" }), boss);

        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatchObject({ lastMatchCount: 12 });
        expect(updates[0]).not.toHaveProperty("state");
        expect(sendMock).not.toHaveBeenCalled();
    });
});

describe("notification", () => {
    it("enqueues one delivery per webhook channel on a transition to firing", async () => {
        matchCount = 10;
        await evaluateOne(
            rule({
                channels: [
                    { type: "webhook", url: "https://a.test/hook" },
                    { type: "webhook", url: "https://b.test/hook" },
                ],
            }),
            boss,
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(sendMock.mock.calls[0][0]).toBe("alert-delivery");
        expect(sendMock.mock.calls[0][1]).toMatchObject({ channelUrl: "https://a.test/hook" });
        expect(sendMock.mock.calls[1][1]).toMatchObject({ channelUrl: "https://b.test/hook" });
    });

    it("skips a channel that is not a webhook", async () => {
        matchCount = 10;
        await evaluateOne(
            rule({
                channels: [
                    { type: "email", url: "someone@example.test" },
                    { type: "webhook", url: "https://a.test/hook" },
                ],
            }),
            boss,
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(sendMock.mock.calls[0][1]).toMatchObject({ channelUrl: "https://a.test/hook" });
    });

    it("notifies on resolve when the rule asks for it", async () => {
        await evaluateOne(rule({ state: "firing", notifyOnResolve: true }), boss);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("stays silent on resolve when the rule does not", async () => {
        await evaluateOne(rule({ state: "firing", notifyOnResolve: false }), boss);

        expect(writtenState()).toBe("ok");
        expect(sendMock).not.toHaveBeenCalled();
        expect(inserts).toHaveLength(0);
    });

    it("records the notification before enqueueing the delivery", async () => {
        matchCount = 10;
        await evaluateOne(rule(), boss);

        expect(inserts[0]).toMatchObject({
            alertRuleId: "rule-1",
            state: "firing",
            channelType: "webhook",
            channelTarget: "https://example.test/hook",
            deliveryStatus: "pending",
        });
    });
});

describe("the optimistic concurrency guard", () => {
    it("does nothing further when the version moved under it", async () => {
        // The rule was edited between `listEnabled` and this write. The next
        // tick sees the new version; sending a notification for a rule that no
        // longer exists in that shape would be worse than waiting one tick.
        matchCount = 10;
        updateReturns = [];

        await evaluateOne(rule(), boss);

        expect(inserts).toHaveLength(0);
        expect(sendMock).not.toHaveBeenCalled();
    });
});

describe("the match count", () => {
    it("asks ClickHouse, scoped to the project", async () => {
        await evaluateOne(rule(), boss);

        expect(chQueryMock).toHaveBeenCalledTimes(1);
        expect(lastQuery?.query).toContain("count()");
        expect(lastQuery?.query).toContain("FROM events");
        expect(Object.values(lastQuery?.query_params ?? {})).toContain(
            "11111111-1111-4111-8111-111111111111",
        );
    });

    it("uses the condition's window, not the range stored on the filter", async () => {
        // The filter carries a `range` because it is an `EventFilters`; the
        // window that matters is the condition's. A rule with a 5-minute window
        // and a 30-day filter range must look at five minutes.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));

        await evaluateOne(
            rule({
                condition: { type: "threshold", count: 1, windowMinutes: 5 },
                filter: { range: { type: "preset", value: "30d" } },
            }),
            boss,
        );

        const bounds = Object.values(lastQuery?.query_params ?? {}).filter(
            (value): value is Date => value instanceof Date,
        );
        expect(bounds).toHaveLength(2);
        expect(bounds[0].toISOString()).toBe("2026-08-26T09:55:00.000Z");
        expect(bounds[1].toISOString()).toBe("2026-08-26T10:00:00.000Z");

        vi.useRealTimers();
    });

    it("keeps the window half-open, as it has always been", async () => {
        await evaluateOne(rule(), boss);
        expect(lastQuery?.query).toContain("timestamp < {");
        expect(lastQuery?.query).not.toContain("timestamp <= {");
    });

    it("compiles the rule's own filter into the count", async () => {
        await evaluateOne(
            rule({
                filter: {
                    range: { type: "preset", value: "1h" },
                    levels: ["error", "fatal"],
                    environments: ["production"],
                    message: "timeout",
                },
            }),
            boss,
        );

        expect(lastQuery?.query).toContain("level IN ");
        expect(lastQuery?.query).toContain("environment IN ");
        expect(lastQuery?.query).toContain("hasToken(message_lower, ");
        expect(Object.values(lastQuery?.query_params ?? {})).toContainEqual(["error", "fatal"]);
        expect(Object.values(lastQuery?.query_params ?? {})).toContain("timeout");
    });

    it("reads a count that arrives as a string, as UInt64 always does", async () => {
        matchCount = 10;
        await evaluateOne(rule(), boss);
        expect(updates[0].lastMatchCount).toBe(10);
    });

    it("treats an empty result as zero rather than NaN", async () => {
        chQueryMock.mockImplementation(async () => ({ json: async () => [] }));
        await evaluateOne(rule({ state: "firing" }), boss);

        expect(writtenState()).toBe("ok");
        expect(updates.find((values) => "lastMatchCount" in values)?.lastMatchCount).toBe(0);
    });
});
