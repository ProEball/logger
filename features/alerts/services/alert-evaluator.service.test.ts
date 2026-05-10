import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure state-machine logic extracted for unit testing without DB
type AlertState = "ok" | "firing";
type Condition = { type: "threshold"; count: number; windowMinutes: number };

function determineNewState(matchCount: number, condition: Condition): AlertState {
    return matchCount >= condition.count ? "firing" : "ok";
}

function shouldNotify(
    newState: AlertState,
    currentState: AlertState,
    notifyOnResolve: boolean,
): boolean {
    if (newState === currentState) return false;
    if (newState === "ok" && !notifyOnResolve) return false;
    return true;
}

describe("alert evaluator state machine", () => {
    const condition: Condition = { type: "threshold", count: 10, windowMinutes: 5 };

    describe("determineNewState", () => {
        it("returns firing when count meets threshold", () => {
            expect(determineNewState(10, condition)).toBe("firing");
        });

        it("returns firing when count exceeds threshold", () => {
            expect(determineNewState(15, condition)).toBe("firing");
        });

        it("returns ok when count is below threshold", () => {
            expect(determineNewState(9, condition)).toBe("ok");
        });

        it("returns ok when count is zero", () => {
            expect(determineNewState(0, condition)).toBe("ok");
        });

        it("handles threshold of 1", () => {
            const cond: Condition = { type: "threshold", count: 1, windowMinutes: 5 };
            expect(determineNewState(1, cond)).toBe("firing");
            expect(determineNewState(0, cond)).toBe("ok");
        });
    });

    describe("shouldNotify", () => {
        it("notifies on ok → firing transition", () => {
            expect(shouldNotify("firing", "ok", true)).toBe(true);
        });

        it("notifies on firing → ok transition when notifyOnResolve is true", () => {
            expect(shouldNotify("ok", "firing", true)).toBe(true);
        });

        it("skips firing → ok notification when notifyOnResolve is false", () => {
            expect(shouldNotify("ok", "firing", false)).toBe(false);
        });

        it("no notification when state does not change (ok → ok)", () => {
            expect(shouldNotify("ok", "ok", true)).toBe(false);
        });

        it("no notification when state does not change (firing → firing)", () => {
            expect(shouldNotify("firing", "firing", true)).toBe(false);
        });
    });
});
