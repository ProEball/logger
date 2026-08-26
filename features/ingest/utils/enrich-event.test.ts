import { describe, it, expect, vi, afterEach } from "vitest";
import { enrichEvent, extractRequestContext, type RequestContext } from "./enrich-event";
import { fingerprintMessage } from "./normalize-message";
import type { IngestEvent } from "./event-schema";

/**
 * `enrich-event.ts` had no test at all until 2026-08-26, which is the shape of
 * gap `PROJECT.md` §11's colocation rule exists to make visible — nine actions
 * beside nine tests, and this one file quietly alone. It became load-bearing in
 * Phase 2 of the ClickHouse migration: it mints the id whose *version* the
 * storage estimate depends on, and it is the only place the idempotency header
 * is read.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";

const ctx: RequestContext = {
    userAgent: "vitest/1.0",
    ip: "1.2.3.4",
    projectId: PROJECT,
    dedupToken: null,
};

function event(patch: Partial<IngestEvent> = {}): IngestEvent {
    return { level: "info", message: "hello", attributes: {}, context: {}, ...patch } as IngestEvent;
}

afterEach(() => {
    vi.useRealTimers();
});

describe("enrichEvent", () => {
    it("mints a UUIDv7, not the v4 randomUUID would give", async () => {
        // Not cosmetic: Phase 0 measured `id` at compression ratio 1.0 and a
        // fifth of the whole ClickHouse table. A v4 here would store and read
        // back perfectly and cost ~58 GB at 3.65B rows.
        expect(enrichEvent(event(), ctx).id.charAt(14)).toBe("7");
    });

    it("gives every event its own id", async () => {
        const ids = new Set(Array.from({ length: 100 }, () => enrichEvent(event(), ctx).id));
        expect(ids.size).toBe(100);
    });

    it("copies the project id from the context, never from the payload", async () => {
        // The project is resolved by the API-key authorization path. A client
        // able to name its own would be writing into another tenant.
        const row = enrichEvent(event({ project_id: "22222222-2222-4222-8222-222222222222" } as never), ctx);
        expect(row.projectId).toBe(PROJECT);
    });

    it("overrides any client-supplied user agent and ip with the server's", async () => {
        const row = enrichEvent(
            event({ user_agent: "spoofed", ip: "9.9.9.9" } as never),
            ctx,
        );
        expect(row.userAgent).toBe("vitest/1.0");
        expect(row.ip).toBe("1.2.3.4");
    });

    it("maps every absent optional field to null for Postgres", async () => {
        const row = enrichEvent(event(), ctx);
        expect(row.source).toBeNull();
        expect(row.environment).toBeNull();
        expect(row.release).toBeNull();
        expect(row.userId).toBeNull();
        expect(row.sessionId).toBeNull();
        expect(row.requestId).toBeNull();
        expect(row.traceId).toBeNull();
        expect(row.errorType).toBeNull();
        expect(row.stackTrace).toBeNull();
    });

    it("renames the snake_case wire fields to the schema's camelCase", async () => {
        const row = enrichEvent(
            event({
                user_id: "u_1",
                session_id: "s_1",
                request_id: "r_1",
                trace_id: "t_1",
                error_type: "TimeoutError",
                stack_trace: "at foo()",
            }),
            ctx,
        );

        expect(row.userId).toBe("u_1");
        expect(row.sessionId).toBe("s_1");
        expect(row.requestId).toBe("r_1");
        expect(row.traceId).toBe("t_1");
        expect(row.errorType).toBe("TimeoutError");
        expect(row.stackTrace).toBe("at foo()");
    });

    it("defaults the timestamp to now when the client sent none", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
        expect(enrichEvent(event(), ctx).timestamp.toISOString()).toBe("2026-08-26T10:00:00.000Z");
    });

    it("keeps a client timestamp inside the retention window", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
        const row = enrichEvent(event({ timestamp: "2026-08-25T09:00:00.000Z" }), ctx);
        expect(row.timestamp.toISOString()).toBe("2026-08-25T09:00:00.000Z");
    });

    it("fingerprints the message template, not the message", async () => {
        // Two messages differing only in their variable parts must share a
        // fingerprint — that is what makes §8's semantic search cost
        // proportional to vocabulary rather than to volume.
        const first = enrichEvent(event({ message: "User u_1 signed in" }), ctx);
        const second = enrichEvent(event({ message: "User u_2 signed in" }), ctx);

        expect(first.templateHash).toBe(second.templateHash);
        expect(first.templateHash).toBe(fingerprintMessage("User u_1 signed in").hash);
    });

    it("carries the template text beside the hash", () => {
        // Both are needed at read time and neither can be derived in SQL, so an
        // event that reaches the table without one is a group that can never be
        // named. Phase 4 moved the text from a registry table onto the row.
        const row = enrichEvent(event({ message: "User u_487 signed in" }), ctx);
        expect(row.messageTemplate).toBe("User *** signed in");
        expect(row.templateHash).toBe(fingerprintMessage("User u_487 signed in").hash);
    });

    it("gives different templates different fingerprints", async () => {
        const signIn = enrichEvent(event({ message: "User u_1 signed in" }), ctx);
        const signOut = enrichEvent(event({ message: "User u_1 signed out" }), ctx);
        expect(signIn.templateHash).not.toBe(signOut.templateHash);
    });
});

describe("extractRequestContext", () => {
    function request(headers: Record<string, string> = {}): Request {
        return new Request("https://example.test/api/ingest", { method: "POST", headers });
    }

    it("takes the first hop from X-Forwarded-For", async () => {
        const ctxFromReq = extractRequestContext(
            request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }),
            PROJECT,
        );
        expect(ctxFromReq.ip).toBe("203.0.113.7");
    });

    it("reports no ip when the header is absent", async () => {
        expect(extractRequestContext(request(), PROJECT).ip).toBeNull();
    });

    it("carries the user agent through", async () => {
        const ctxFromReq = extractRequestContext(request({ "user-agent": "sdk/2.0" }), PROJECT);
        expect(ctxFromReq.userAgent).toBe("sdk/2.0");
    });

    it("builds a project-scoped deduplication token from an idempotency key", async () => {
        const ctxFromReq = extractRequestContext(request({ "idempotency-key": "batch-7" }), PROJECT);
        expect(ctxFromReq.dedupToken).toBe(`${PROJECT}:batch-7`);
    });

    it("leaves the token null when no idempotency key was sent", async () => {
        // Which is the common case, and must mean "do not deduplicate" rather
        // than "deduplicate against an empty token".
        expect(extractRequestContext(request(), PROJECT).dedupToken).toBeNull();
    });
});
