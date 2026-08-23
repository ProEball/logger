import { normalizeMessage, templateHashForStorage } from "./normalize-message";

export interface TemplateEntry {
    templateHash: bigint;
    template: string;
}

/**
 * The distinct message templates in a batch, ready for the registry.
 *
 * Deduplicating here rather than letting the database do it: a batch of 500
 * events from one service is usually a handful of templates repeated, so
 * without this the upsert would attempt 500 inserts to write two rows, and
 * `ON CONFLICT DO NOTHING` still costs an index probe for each.
 *
 * Keyed by the hash rather than the text, because the hash is what the rollup
 * joins on — if two texts ever hashed alike, deduplicating by text would insert
 * two rows for one key and the second would be silently dropped, leaving the
 * displayed template dependent on arrival order.
 */
export function distinctTemplates(events: Array<{ message: string }>): TemplateEntry[] {
    const seen = new Map<string, TemplateEntry>();

    for (const event of events) {
        const templateHash = templateHashForStorage(event.message);
        const key = templateHash.toString();
        if (seen.has(key)) continue;
        seen.set(key, { templateHash, template: normalizeMessage(event.message) });
    }

    return Array.from(seen.values());
}
