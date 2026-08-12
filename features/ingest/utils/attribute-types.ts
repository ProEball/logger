export type AttributeValueType = "string" | "number" | "boolean";

export interface AttributeTypeConflict {
    index: number;
    key: string;
    message: string;
}

export class AttributeTypeConflictError extends Error {
    conflicts: AttributeTypeConflict[];

    constructor(conflicts: AttributeTypeConflict[]) {
        super("Attribute type conflict.");
        this.name = "AttributeTypeConflictError";
        this.conflicts = conflicts;
    }
}

/**
 * Maps a JSON attribute value to its type label. `null` carries no type —
 * it never establishes or violates a key's registered type.
 */
export function inferAttributeType(value: unknown): AttributeValueType | null {
    if (typeof value === "string") {
        return "string";
    }
    if (typeof value === "number") {
        return "number";
    }
    if (typeof value === "boolean") {
        return "boolean";
    }
    return null;
}

/**
 * First-occurrence-wins map of key -> type across a list of attribute bags,
 * used as the candidate rows for the type-registry upsert.
 */
export function collectCandidateTypes(
    attributesList: Array<Record<string, unknown>>,
): Map<string, AttributeValueType> {
    const candidates = new Map<string, AttributeValueType>();
    for (const attributes of attributesList) {
        for (const [key, value] of Object.entries(attributes)) {
            const type = inferAttributeType(value);
            if (type !== null && !candidates.has(key)) {
                candidates.set(key, type);
            }
        }
    }
    return candidates;
}

/**
 * Checks every attribute bag against the resolved (authoritative) type per
 * key, flagging any event whose value type disagrees.
 */
export function findAttributeTypeConflicts(
    attributesList: Array<Record<string, unknown>>,
    resolvedTypes: Map<string, AttributeValueType>,
): AttributeTypeConflict[] {
    const conflicts: AttributeTypeConflict[] = [];
    attributesList.forEach((attributes, index) => {
        for (const [key, value] of Object.entries(attributes)) {
            const type = inferAttributeType(value);
            const resolved = resolvedTypes.get(key);
            if (type !== null && resolved !== undefined && type !== resolved) {
                conflicts.push({
                    index,
                    key,
                    message: `Attribute "${key}" expected type "${resolved}" but received "${type}".`,
                });
            }
        }
    });
    return conflicts;
}
