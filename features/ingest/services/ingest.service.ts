import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import { enrichEvent, type RequestContext } from "../utils/enrich-event";
import type { IngestEvent } from "../utils/event-schema";

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
    const row = enrichEvent(rawEvent, ctx);
    await db.insert(events).values(row);
    return { id: row.id };
}

export async function ingestBatch(
    rawEvents: IngestEvent[],
    ctx: RequestContext,
): Promise<BatchIngestResult> {
    const validRows = rawEvents.map((e) => enrichEvent(e, ctx));
    if (validRows.length > 0) {
        await db.insert(events).values(validRows);
    }
    return { accepted: validRows.length, errors: [] };
}
