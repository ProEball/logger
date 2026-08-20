/**
 * `10s` was dropped on 2026-08-20 for its **cost**, not because it showed
 * nothing new: six page loads a minute per viewer, when nobody acts on the
 * difference between ten seconds and thirty.
 *
 * Note it *would* have shown something new. Rollup-backed reads union the
 * summary with a raw tail of `events`, so freshness is not gated by the
 * once-a-minute rebuild — an earlier version of this comment claimed it was,
 * and was wrong. `5m` was added at the other end for a dashboard left open on
 * a wall.
 */
export type AutoRefreshValue = "off" | "30s" | "60s" | "5m";

/** Stored values that no longer exist, mapped to the nearest survivor. */
const LEGACY_AUTO_REFRESH: Record<string, AutoRefreshValue> = {
    "10s": "30s",
};
export type ThemeValue = "dark" | "light" | "system";

export type UserPreferences = {
    theme: ThemeValue;
    autoRefresh: AutoRefreshValue;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
    theme: "dark",
    autoRefresh: "off",
};

export function parsePreferences(raw: unknown): UserPreferences {
    const obj = (raw ?? {}) as Record<string, unknown>;
    return {
        theme: (["dark", "light", "system"].includes(obj.theme as string)
            ? obj.theme
            : DEFAULT_PREFERENCES.theme) as ThemeValue,
        autoRefresh: parseAutoRefresh(obj.autoRefresh),
    };
}

/**
 * Reads a stored auto-refresh preference.
 *
 * A retired value is translated rather than discarded: falling back to the
 * default would silently switch auto-refresh **off** for everyone who had
 * chosen 10s, which reads as the feature breaking rather than as a setting
 * changing.
 */
export function parseAutoRefresh(raw: unknown): AutoRefreshValue {
    if (typeof raw !== "string") return DEFAULT_PREFERENCES.autoRefresh;
    if (raw in LEGACY_AUTO_REFRESH) return LEGACY_AUTO_REFRESH[raw];
    return (["off", "30s", "60s", "5m"] as const).includes(raw as AutoRefreshValue)
        ? (raw as AutoRefreshValue)
        : DEFAULT_PREFERENCES.autoRefresh;
}
