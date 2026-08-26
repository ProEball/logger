import { describe, it, expect } from "vitest";
import {
    normalizeMessage,
    templateHash,
    fingerprintMessage,
    NORMALIZER_RULES,
    NORMALIZER_VERSION,
} from "./normalize-message";

describe("normalizeMessage", () => {
    describe("identifiers", () => {
        it.each([
            ["User u_487 signed in", "User *** signed in"],
            ["Session sess_ai6h2q expired", "Session *** expired"],
            ["request req-9f2 rejected", "request *** rejected"],
            ["Payment d6ffe13f authorized", "Payment *** authorized"],
            [
                "trace 550e8400-e29b-41d4-a716-446655440000 closed",
                "trace *** closed",
            ],
        ])("collapses %s", (input, expected) => {
            expect(normalizeMessage(input)).toBe(expected);
        });

        it("leaves ordinary underscored words alone", () => {
            // No digit, so not an identifier — `read_only` is vocabulary.
            expect(normalizeMessage("mode read_only enabled")).toBe("mode read_only enabled");
        });
    });

    describe("numbers", () => {
        it("removes a number carrying a unit", () => {
            expect(normalizeMessage("finished in 2417ms")).toBe("finished in ***");
        });

        it("removes a long bare number", () => {
            expect(normalizeMessage("uploaded 2109565 bytes")).toBe("uploaded *** bytes");
        });

        /**
         * The deliberate under-collapse. 503 and 500 are different problems, not
         * two instances of one, so short bare numbers survive.
         */
        it("keeps a short bare number", () => {
            expect(normalizeMessage("Third-party API returned 503")).toBe(
                "Third-party API returned 503",
            );
        });

        it("keeps a number that is part of a name", () => {
            expect(normalizeMessage("upgraded to HTTP/2")).toBe("upgraded to HTTP/2");
        });
    });

    describe("structured shapes", () => {
        it.each([
            ["mail to a.b+tag@example.com bounced", "mail to *** bounced"],
            ["peer 10.0.14.203 disconnected", "peer *** disconnected"],
            ["fetching https://api.partner.io/v1/x?y=1 failed", "fetching *** failed"],
            ["GET /users/4821/orders", "GET /users***/orders"],
            ["at 2026-08-22T14:53:07Z the job started", "at *** the job started"],
        ])("collapses %s", (input, expected) => {
            expect(normalizeMessage(input)).toBe(expected);
        });
    });

    /**
     * The property that matters for a multi-tenant install: the rules match
     * shapes, so an identifier is found the same way whatever surrounds it.
     */
    describe("script independence", () => {
        it("finds an identifier inside Cyrillic prose", () => {
            expect(normalizeMessage("Пользователь u_487 вошёл")).toBe("Пользователь *** вошёл");
        });

        it("finds a measure written with a non-Latin unit", () => {
            expect(normalizeMessage("запрос занял 872мс")).toBe("запрос занял ***");
        });

        it("finds an identifier inside text with no spaces at all", () => {
            expect(normalizeMessage("ユーザー u_487 がログイン")).toBe("ユーザー *** がログイン");
        });

        it("leaves non-Latin words untouched", () => {
            expect(normalizeMessage("Соединение разорвано")).toBe("Соединение разорвано");
        });
    });

    /**
     * These are not bugs to fix later — they are the boundary of what a shape
     * matcher can do, asserted so that nobody assumes otherwise and so that a
     * future rule change that pretends to solve them shows up as a failure here.
     */
    describe("what it cannot collapse, by construction", () => {
        it("cannot collapse a name", () => {
            expect(normalizeMessage("User Alice signed in")).toBe("User Alice signed in");
            expect(normalizeMessage("User Bob signed in")).toBe("User Bob signed in");
        });

        it("cannot collapse a hostname or a role word", () => {
            expect(normalizeMessage("Connection to primary failed")).toBe(
                "Connection to primary failed",
            );
        });

        it("cannot collapse free text in quotes", () => {
            expect(normalizeMessage('Search "red boots" found nothing')).toBe(
                'Search "red boots" found nothing',
            );
        });

        it("keeps two retries apart, which is the wrong answer and the cheaper mistake", () => {
            expect(normalizeMessage("Retry 1 of 3")).not.toBe(normalizeMessage("Retry 2 of 3"));
        });
    });

    describe("mechanics", () => {
        it("is idempotent — normalising a template changes nothing", () => {
            const once = normalizeMessage("User u_487 signed in at 2417ms");
            expect(normalizeMessage(once)).toBe(once);
        });

        it("truncates to the length grouping actually uses", () => {
            expect(normalizeMessage("x".repeat(500))).toHaveLength(200);
        });

        it.each([[""], [" "], ["***"]])("survives the degenerate input %o", (input) => {
            expect(typeof normalizeMessage(input)).toBe("string");
        });

        /**
         * Order is load-bearing: a digit rule ahead of the UUID rule eats a UUID
         * piecemeal and the UUID rule never matches again. This asserts the
         * contract rather than the outcome, so reordering the list fails here
         * before it fails in production.
         */
        it("applies the longest shapes first", () => {
            const uuid = NORMALIZER_RULES.indexOf("uuid");
            expect(uuid).toBeLessThan(NORMALIZER_RULES.indexOf("hex"));
            expect(NORMALIZER_RULES.indexOf("hex")).toBeLessThan(
                NORMALIZER_RULES.indexOf("long-number"),
            );
            expect(NORMALIZER_RULES.indexOf("id-token")).toBeLessThan(
                NORMALIZER_RULES.indexOf("measure"),
            );
        });

        it("has a version, because hashes from different rule sets are not comparable", () => {
            expect(NORMALIZER_VERSION).toBeGreaterThan(0);
        });
    });
});

/**
 * Frozen because the value is **persisted**: every event row is keyed by it and
 * every "top messages" answer groups on it. Recomputing the expectation at
 * runtime would compare the function with a copy of itself and could never
 * fail.
 *
 * If this test fails, the fingerprint changed. That is not a number to update —
 * it means every stored key just became wrong, and the correct response is a
 * `NORMALIZER_VERSION` bump so the two generations cannot be summed.
 */
const FROZEN_UNSIGNED = "12497911170121219274";

describe("templateHash", () => {
    it("gives two messages of the same shape one key", () => {
        expect(templateHash("User u_487 signed in")).toBe(templateHash("User u_912 signed in"));
    });

    it("gives different shapes different keys", () => {
        expect(templateHash("User u_487 signed in")).not.toBe(
            templateHash("User u_487 signed out"),
        );
    });

    it("matches a frozen value, so a silent algorithm change cannot pass", () => {
        expect(templateHash("User u_487 signed in").toString()).toBe(FROZEN_UNSIGNED);
    });

    it("survives an empty message", () => {
        expect(typeof templateHash("")).toBe("bigint");
    });
});

describe("fingerprintMessage", () => {
    it("returns the template beside the hash of that template", () => {
        const fingerprint = fingerprintMessage("User u_487 signed in");
        expect(fingerprint.template).toBe("User *** signed in");
        expect(fingerprint.hash.toString()).toBe(FROZEN_UNSIGNED);
    });

    it("agrees with templateHash on every input, which is what lets ingest call it once", () => {
        // The hazard this guards is specific: `templateHash` normalises
        // internally and `fingerprintMessage` normalises once and hashes the
        // result. If those ever diverge, the label on a group and the key it is
        // grouped by would describe different things.
        for (const m of ["", "a", "User u_487 signed in", "щ".repeat(300), "Retry 1 of 3"]) {
            expect(fingerprintMessage(m).hash).toBe(templateHash(m));
            expect(fingerprintMessage(m).template).toBe(normalizeMessage(m));
        }
    });

    it("stays inside the unsigned 64-bit range the column holds", () => {
        const MAX = BigInt("18446744073709551615");
        for (const m of ["", "a", "User u_487 signed in", "щ".repeat(200)]) {
            const v = fingerprintMessage(m).hash;
            expect(v >= BigInt(0) && v <= MAX).toBe(true);
        }
    });

    it("keeps distinct templates distinct", () => {
        expect(fingerprintMessage("alpha u_1 done").hash).not.toBe(
            fingerprintMessage("beta u_1 done").hash,
        );
    });
});
