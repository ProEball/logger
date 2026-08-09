// NOTE: NOT multi-instance safe. A multi-replica deployment requires a
// Redis-backed limiter. See feature 08 open questions.

const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN ?? "1000", 10);
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

interface WindowEntry {
    count: number;
    windowStart: number;
}

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

export class RollingWindowLimiter {
    private readonly store = new Map<string, WindowEntry>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private readonly limitPerMin: number;

    constructor(limitPerMin: number = DEFAULT_LIMIT) {
        this.limitPerMin = limitPerMin;
    }

    take(apiKeyId: string, count = 1, limitOverride?: number): RateLimitResult {
        this.ensureCleanupStarted();

        const limit = limitOverride ?? this.limitPerMin;
        const now = Date.now();
        const entry = this.store.get(apiKeyId);

        if (!entry || now - entry.windowStart >= WINDOW_MS) {
            this.store.set(apiKeyId, { count, windowStart: now });
            return { allowed: true, retryAfterSeconds: 0 };
        }

        if (entry.count + count > limit) {
            const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
            return { allowed: false, retryAfterSeconds };
        }

        entry.count += count;
        return { allowed: true, retryAfterSeconds: 0 };
    }

    private ensureCleanupStarted(): void {
        if (this.cleanupTimer !== null) return;
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.store.entries()) {
                if (now - entry.windowStart >= WINDOW_MS) {
                    this.store.delete(key);
                }
            }
        }, CLEANUP_INTERVAL_MS);
        // Unref so the timer doesn't keep the Node process alive
        if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
            (this.cleanupTimer as NodeJS.Timeout).unref();
        }
    }

    /** Exposed for testing only */
    _getStore(): Map<string, WindowEntry> {
        return this.store;
    }
}

// Module-level singleton
export const rateLimiter = new RollingWindowLimiter();
