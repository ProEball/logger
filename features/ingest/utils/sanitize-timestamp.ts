const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class EventTimestampOutOfRetentionError extends Error {
    constructor() {
        super("Event timestamp is older than 30-day retention window.");
        this.name = "EventTimestampOutOfRetentionError";
    }
}

/**
 * Sanitizes a client-provided ISO timestamp:
 * - undefined → server now()
 * - future > +5 min → server now() (warn)
 * - past > -30 days → throw EventTimestampOutOfRetentionError
 * - else → parsed date as-is
 */
export function sanitizeTimestamp(input: string | undefined): Date {
    if (input === undefined) {
        return new Date();
    }

    const parsed = new Date(input);
    const now = Date.now();

    if (parsed.getTime() > now + FIVE_MINUTES_MS) {
        console.warn("[ingest] future timestamp coerced to now", { provided: input });
        return new Date();
    }

    if (parsed.getTime() < now - THIRTY_DAYS_MS) {
        throw new EventTimestampOutOfRetentionError();
    }

    return parsed;
}
