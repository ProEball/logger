import { normalizeMessage, templateHashForStorage, NORMALIZER_VERSION } from "./normalize-message";

export interface BackfillRow {
    id: string;
    timestamp: Date;
    message: string;
    projectId: string;
}

export interface HashUpdate {
    id: string;
    timestamp: Date;
    templateHash: bigint;
}

export interface TemplateUpsert {
    projectId: string;
    templateHash: bigint;
    template: string;
    normalizerVersion: number;
}

export interface BackfillPlan {
    updates: HashUpdate[];
    templates: TemplateUpsert[];
}

/**
 * Turns a batch of un-fingerprinted events into the two writes the backfill
 * needs: a hash per row, and one registry row per distinct template.
 *
 * Pure, and separated from the script for that reason — the loop around it is
 * cursor arithmetic and sleeps, while *this* is the part that can be wrong in a
 * way nobody notices: a hash that disagrees with the one ingest computes would
 * split every backfilled template away from its live counterpart, and the two
 * would never be summed together again.
 *
 * Templates are deduplicated per `(project, hash)` within the batch. A project
 * boundary in the key matters even though the hash does not depend on it:
 * `message_templates` is keyed per project, so two projects sending the same
 * shape need a row each.
 */
export function planBackfill(rows: BackfillRow[]): BackfillPlan {
    const updates: HashUpdate[] = [];
    const templates = new Map<string, TemplateUpsert>();

    for (const row of rows) {
        const templateHash = templateHashForStorage(row.message);
        updates.push({ id: row.id, timestamp: row.timestamp, templateHash });

        const key = `${row.projectId}:${templateHash.toString()}`;
        if (templates.has(key)) continue;
        templates.set(key, {
            projectId: row.projectId,
            templateHash,
            template: normalizeMessage(row.message),
            normalizerVersion: NORMALIZER_VERSION,
        });
    }

    return { updates, templates: Array.from(templates.values()) };
}
