import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { attributeKeyTypes } from "@/core/db/schema";
import type { IngestEvent } from "../utils/event-schema";
import {
    collectCandidateTypes,
    findAttributeTypeConflicts,
    type AttributeTypeConflict,
    type AttributeValueType,
} from "../utils/attribute-types";

/**
 * Upserts candidate (key -> type) rows and returns the authoritative type per
 * key — either the pre-existing registered type, or the candidate's type if
 * this is the first time the key has been seen for this project. The `SET`
 * is a no-op self-reference so `RETURNING` always reflects the winning row,
 * and the row lock on the conflict target serializes concurrent first-writers.
 */
export async function resolveAttributeTypes(
    candidates: Map<string, AttributeValueType>,
    projectId: string,
): Promise<Map<string, AttributeValueType>> {
    if (candidates.size === 0) {
        return new Map();
    }

    const rows = await db
        .insert(attributeKeyTypes)
        .values(
            Array.from(candidates, ([key, type]) => ({ projectId, key, type })),
        )
        .onConflictDoUpdate({
            target: [attributeKeyTypes.projectId, attributeKeyTypes.key],
            set: { type: sql`${attributeKeyTypes.type}` },
        })
        .returning({ key: attributeKeyTypes.key, type: attributeKeyTypes.type });

    return new Map(rows.map((r) => [r.key, r.type as AttributeValueType]));
}

/**
 * Resolves authoritative types for every attribute key present in `events`
 * and returns the list of events whose attribute values disagree with them.
 */
export async function checkAttributeTypeConflicts(
    events: IngestEvent[],
    projectId: string,
): Promise<AttributeTypeConflict[]> {
    const attributesList = events.map((e) => e.attributes);
    const candidates = collectCandidateTypes(attributesList);
    const resolvedTypes = await resolveAttributeTypes(candidates, projectId);
    return findAttributeTypeConflicts(attributesList, resolvedTypes);
}
