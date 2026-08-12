import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/core/db/client", () => ({
    db: { insert: vi.fn() },
}));

vi.mock("@/core/db/schema", () => ({
    attributeKeyTypes: { projectId: "project_id", key: "key", type: "type" },
}));

import { db } from "@/core/db/client";
import {
    resolveAttributeTypes,
    checkAttributeTypeConflicts,
} from "./attribute-type-registry.service";
import type { IngestEvent } from "../utils/event-schema";

const mockInsert = vi.mocked(db.insert);

function mockInsertReturning(returning: Array<{ key: string; type: string }>) {
    const returningFn = vi.fn().mockResolvedValue(returning);
    const onConflictDoUpdateFn = vi.fn().mockReturnValue({ returning: returningFn });
    const valuesFn = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateFn });
    mockInsert.mockReturnValue({ values: valuesFn } as never);
    return { valuesFn, onConflictDoUpdateFn, returningFn };
}

function event(attributes: Record<string, unknown>): IngestEvent {
    return { level: "info", message: "x", attributes, context: {} } as IngestEvent;
}

describe("resolveAttributeTypes", () => {
    beforeEach(() => {
        mockInsert.mockReset();
    });

    it("makes zero DB calls when there are no candidates", async () => {
        const result = await resolveAttributeTypes(new Map(), "proj-1");
        expect(result.size).toBe(0);
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it("upserts deduped candidate rows and maps the returned authoritative types", async () => {
        const { valuesFn } = mockInsertReturning([{ key: "count", type: "number" }]);
        const result = await resolveAttributeTypes(new Map([["count", "number"]]), "proj-1");

        expect(valuesFn).toHaveBeenCalledWith([{ projectId: "proj-1", key: "count", type: "number" }]);
        expect(result.get("count")).toBe("number");
    });
});

describe("checkAttributeTypeConflicts", () => {
    beforeEach(() => {
        mockInsert.mockReset();
    });

    it("flags an event whose attribute type disagrees with the registered type", async () => {
        mockInsertReturning([{ key: "count", type: "number" }]);
        const conflicts = await checkAttributeTypeConflicts(
            [event({ count: "5" })],
            "proj-1",
        );

        expect(conflicts).toEqual([
            { index: 0, key: "count", message: expect.stringContaining("count") },
        ]);
    });

    it("returns no conflicts when a brand-new key is introduced consistently", async () => {
        mockInsertReturning([{ key: "count", type: "number" }]);
        const conflicts = await checkAttributeTypeConflicts(
            [event({ count: 5 }), event({ count: 10 })],
            "proj-1",
        );

        expect(conflicts).toHaveLength(0);
    });
});
