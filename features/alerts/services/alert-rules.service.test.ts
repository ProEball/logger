import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Membership } from "@/shared/permissions/check";
import { createAlertRuleSchema } from "@/features/alerts/utils/alert-schemas";

/** Shape the `.set()` / `.values()` spies receive — a partial column patch. */
type Patch = Record<string, unknown>;

function makeChain(result: unknown) {
    const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        innerJoin: () => chain,
        values: () => chain,
        set: () => chain,
        returning: () => chain,
        then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return chain;
}

const { selectMock, insertMock, updateMock, deleteMock, countMock, assertPermissionMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    countMock: vi.fn(),
    assertPermissionMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
    db: {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        $count: countMock,
    },
}));

vi.mock("@/shared/permissions/guards", () => ({
    assertPermission: assertPermissionMock,
}));

import {
    listAlertRules,
    getAlertRule,
    createAlertRule,
    updateAlertRule,
    deleteAlertRule,
    toggleAlertRule,
    listEnabled,
    listAlertHistory,
} from "./alert-rules.service";

const MEMBERSHIP = {} as Membership;
const PROJECT_ID = "proj-1";
const RULE_ID = "rule-1";

const BASE_RULE = {
    id: RULE_ID,
    projectId: PROJECT_ID,
    name: "High error rate",
    state: "ok",
    enabled: true,
    version: 1,
};

describe("alert-rules.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("listAlertRules", () => {
        it("asserts alerts.read", async () => {
            selectMock.mockReturnValue(makeChain([BASE_RULE]));
            await listAlertRules(PROJECT_ID, MEMBERSHIP);
            expect(assertPermissionMock).toHaveBeenCalledWith(MEMBERSHIP, "alerts.read");
        });

        it("returns the rows from the query", async () => {
            selectMock.mockReturnValue(makeChain([BASE_RULE]));
            const rows = await listAlertRules(PROJECT_ID, MEMBERSHIP);
            expect(rows).toEqual([BASE_RULE]);
        });
    });

    describe("getAlertRule", () => {
        it("returns null when no rule matches", async () => {
            selectMock.mockReturnValue(makeChain([]));
            const rule = await getAlertRule(PROJECT_ID, RULE_ID, MEMBERSHIP);
            expect(rule).toBeNull();
        });

        it("returns the rule when found", async () => {
            selectMock.mockReturnValue(makeChain([BASE_RULE]));
            const rule = await getAlertRule(PROJECT_ID, RULE_ID, MEMBERSHIP);
            expect(rule).toEqual(BASE_RULE);
        });
    });

    describe("createAlertRule", () => {
        // The service takes already-parsed input, so every schema default is
        // resolved by the time it is called — `notifyOnResolve` included.
        const input = {
            name: "New rule",
            filter: { range: { type: "preset" as const, value: "1h" as const } },
            condition: { type: "threshold" as const, count: 5, windowMinutes: 10 },
            channels: [{ type: "webhook" as const, url: "https://example.com" }],
            notifyOnResolve: true,
        };

        it("asserts alerts.manage", async () => {
            insertMock.mockReturnValue(makeChain([BASE_RULE]));
            await createAlertRule(PROJECT_ID, input, "user-1", MEMBERSHIP);
            expect(assertPermissionMock).toHaveBeenCalledWith(MEMBERSHIP, "alerts.manage");
        });

        it("defaults notifyOnResolve to true when the caller omits it", () => {
            const { notifyOnResolve: _omitted, ...withoutFlag } = input;
            expect(createAlertRuleSchema.parse(withoutFlag).notifyOnResolve).toBe(true);
        });

        it("forwards notifyOnResolve: true with version 1", async () => {
            const valuesSpy = vi.fn((_values: Patch) => makeChain([BASE_RULE]));
            insertMock.mockReturnValue({ values: valuesSpy });
            await createAlertRule(PROJECT_ID, input, "user-1", MEMBERSHIP);
            expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ notifyOnResolve: true, version: 1 }));
        });

        it("respects an explicit notifyOnResolve: false", async () => {
            const valuesSpy = vi.fn((_values: Patch) => makeChain([BASE_RULE]));
            insertMock.mockReturnValue({ values: valuesSpy });
            await createAlertRule(PROJECT_ID, { ...input, notifyOnResolve: false }, "user-1", MEMBERSHIP);
            expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ notifyOnResolve: false }));
        });

        it("returns the inserted rule", async () => {
            insertMock.mockReturnValue(makeChain([BASE_RULE]));
            const result = await createAlertRule(PROJECT_ID, input, "user-1", MEMBERSHIP);
            expect(result).toEqual(BASE_RULE);
        });
    });

    describe("updateAlertRule", () => {
        it("asserts alerts.manage", async () => {
            updateMock.mockReturnValue(makeChain([BASE_RULE]));
            await updateAlertRule(PROJECT_ID, { id: RULE_ID, name: "Renamed" }, MEMBERSHIP);
            expect(assertPermissionMock).toHaveBeenCalledWith(MEMBERSHIP, "alerts.manage");
        });

        it("throws when the rule does not exist", async () => {
            updateMock.mockReturnValue(makeChain([]));
            await expect(
                updateAlertRule(PROJECT_ID, { id: RULE_ID, name: "Renamed" }, MEMBERSHIP),
            ).rejects.toThrow(`Alert rule ${RULE_ID} not found`);
        });

        it("returns the updated rule on success", async () => {
            const updated = { ...BASE_RULE, name: "Renamed" };
            updateMock.mockReturnValue(makeChain([updated]));
            const result = await updateAlertRule(PROJECT_ID, { id: RULE_ID, name: "Renamed" }, MEMBERSHIP);
            expect(result).toEqual(updated);
        });

        it("resets state to ok when the filter changes, to avoid a stale firing state", async () => {
            const setSpy = vi.fn((_patch: Patch) => makeChain([BASE_RULE]));
            updateMock.mockReturnValue({ set: setSpy });
            await updateAlertRule(
                PROJECT_ID,
                { id: RULE_ID, filter: { range: { type: "preset", value: "1h" } } },
                MEMBERSHIP,
            );
            const patch = setSpy.mock.calls[0]![0];
            expect(patch.state).toBe("ok");
            expect(patch.stateChangedAt).toBeInstanceOf(Date);
        });

        it("does not touch state when only name/description change", async () => {
            const setSpy = vi.fn((_patch: Patch) => makeChain([BASE_RULE]));
            updateMock.mockReturnValue({ set: setSpy });
            await updateAlertRule(PROJECT_ID, { id: RULE_ID, name: "Renamed" }, MEMBERSHIP);
            const patch = setSpy.mock.calls[0]![0];
            expect(patch).not.toHaveProperty("state");
            expect(patch).not.toHaveProperty("stateChangedAt");
        });

        it("always bumps version", async () => {
            const setSpy = vi.fn((_patch: Patch) => makeChain([BASE_RULE]));
            updateMock.mockReturnValue({ set: setSpy });
            await updateAlertRule(PROJECT_ID, { id: RULE_ID, name: "Renamed" }, MEMBERSHIP);
            const patch = setSpy.mock.calls[0]![0];
            expect(patch.version).toBeDefined();
        });
    });

    describe("deleteAlertRule", () => {
        it("asserts alerts.manage", async () => {
            deleteMock.mockReturnValue(makeChain(undefined));
            await deleteAlertRule(PROJECT_ID, RULE_ID, MEMBERSHIP);
            expect(assertPermissionMock).toHaveBeenCalledWith(MEMBERSHIP, "alerts.manage");
        });

        it("calls db.delete", async () => {
            deleteMock.mockReturnValue(makeChain(undefined));
            await deleteAlertRule(PROJECT_ID, RULE_ID, MEMBERSHIP);
            expect(deleteMock).toHaveBeenCalledTimes(1);
        });
    });

    describe("toggleAlertRule", () => {
        it("asserts alerts.manage", async () => {
            updateMock.mockReturnValue(makeChain([BASE_RULE]));
            await toggleAlertRule(PROJECT_ID, RULE_ID, false, MEMBERSHIP);
            expect(assertPermissionMock).toHaveBeenCalledWith(MEMBERSHIP, "alerts.manage");
        });

        it("throws when the rule does not exist", async () => {
            updateMock.mockReturnValue(makeChain([]));
            await expect(toggleAlertRule(PROJECT_ID, RULE_ID, false, MEMBERSHIP)).rejects.toThrow(
                `Alert rule ${RULE_ID} not found`,
            );
        });

        it("returns the toggled rule", async () => {
            const disabled = { ...BASE_RULE, enabled: false };
            updateMock.mockReturnValue(makeChain([disabled]));
            const result = await toggleAlertRule(PROJECT_ID, RULE_ID, false, MEMBERSHIP);
            expect(result).toEqual(disabled);
        });

        it("resets state to ok when disabling, to avoid a spurious resolve on re-enable", async () => {
            const setSpy = vi.fn((_patch: Patch) => makeChain([BASE_RULE]));
            updateMock.mockReturnValue({ set: setSpy });
            await toggleAlertRule(PROJECT_ID, RULE_ID, false, MEMBERSHIP);
            const patch = setSpy.mock.calls[0]![0];
            expect(patch.enabled).toBe(false);
            expect(patch.state).toBe("ok");
        });

        it("does not touch state when enabling", async () => {
            const setSpy = vi.fn((_patch: Patch) => makeChain([BASE_RULE]));
            updateMock.mockReturnValue({ set: setSpy });
            await toggleAlertRule(PROJECT_ID, RULE_ID, true, MEMBERSHIP);
            const patch = setSpy.mock.calls[0]![0];
            expect(patch.enabled).toBe(true);
            expect(patch).not.toHaveProperty("state");
        });
    });

    describe("listEnabled", () => {
        it("unwraps the joined rows to plain AlertRule objects", async () => {
            selectMock.mockReturnValue(makeChain([{ alertRules: BASE_RULE }]));
            const rows = await listEnabled();
            expect(rows).toEqual([BASE_RULE]);
        });

        it("returns an empty array when nothing is enabled", async () => {
            selectMock.mockReturnValue(makeChain([]));
            const rows = await listEnabled();
            expect(rows).toEqual([]);
        });
    });

    describe("listAlertHistory", () => {
        it("throws when the parent rule does not exist", async () => {
            selectMock.mockReturnValue(makeChain([]));
            await expect(listAlertHistory(RULE_ID, PROJECT_ID, MEMBERSHIP)).rejects.toThrow(
                `Alert rule ${RULE_ID} not found`,
            );
        });

        it("returns notifications and total count when the rule exists", async () => {
            // getAlertRule's select resolves first, notification list select resolves second
            selectMock
                .mockReturnValueOnce(makeChain([BASE_RULE]))
                .mockReturnValueOnce(makeChain([{ id: "notif-1" }]));
            countMock.mockResolvedValue(3);

            const result = await listAlertHistory(RULE_ID, PROJECT_ID, MEMBERSHIP);
            expect(result).toEqual({ notifications: [{ id: "notif-1" }], total: 3 });
        });
    });
});
