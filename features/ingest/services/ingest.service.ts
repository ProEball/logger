import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import { enrichEvent, type RequestContext } from "../utils/enrich-event";
import type { IngestEvent } from "../utils/event-schema";
import { AttributeTypeConflictError } from "../utils/attribute-types";
import { checkAttributeTypeConflicts } from "./attribute-type-registry.service";

export interface SingleIngestResult {
    id: string;
}

export interface BatchIngestResult {
    accepted: number;
    errors: Array<{ index: number; message: string }>;
}

export async function ingestSingle(
    rawEvent: IngestEvent,
    ctx: RequestContext,
): Promise<SingleIngestResult> {
    const conflicts = await checkAttributeTypeConflicts([rawEvent], ctx.projectId);
    if (conflicts.length > 0) {
        throw new AttributeTypeConflictError(conflicts);
    }

    const row = enrichEvent(rawEvent, ctx);
    await db.insert(events).values(row);
    return { id: row.id };
}

export async function ingestBatch(
    rawEvents: IngestEvent[],
    ctx: RequestContext,
): Promise<BatchIngestResult> {
    const conflicts = await checkAttributeTypeConflicts(rawEvents, ctx.projectId);
    const messagesByIndex = new Map<number, string[]>();
    for (const c of conflicts) {
        const messages = messagesByIndex.get(c.index) ?? [];
        messages.push(c.message);
        messagesByIndex.set(c.index, messages);
    }

    const acceptedEvents = rawEvents.filter((_, index) => !messagesByIndex.has(index));
    const validRows = acceptedEvents.map((e) => enrichEvent(e, ctx));
    if (validRows.length > 0) {
        await db.insert(events).values(validRows);
    }

    const errors = Array.from(messagesByIndex, ([index, messages]) => ({
        index,
        message: messages.join(" "),
    }));
    return { accepted: validRows.length, errors };
}
