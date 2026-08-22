/**
 * The **one** place each preference's allowed values are written down.
 *
 * They used to be written down four times — here, in `parseAutoRefresh`, in
 * `AutoRefreshControl`'s option list, and again as a Zod enum in
 * `update-preferences.action.ts` — and on 2026-08-20 those copies drifted:
 * `5m` was added to the type and the UI but not to the Zod enum, so choosing it
 * failed validation server-side while Redux updated optimistically. The setting
 * appeared to work and reverted on the next load, and nothing caught it because
 * the action takes `data: unknown`, so no type error was possible.
 *
 * Deriving the type from the array is what makes that drift impossible rather
 * than merely unlikely: a value added here reaches the type, the parser, the
 * control and the schema at once.
 */
export const AUTO_REFRESH_VALUES = ["off", "30s", "60s", "5m"] as const;

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
export type AutoRefreshValue = (typeof AUTO_REFRESH_VALUES)[number];

export const THEME_VALUES = ["dark", "light", "system"] as const;

export type ThemeValue = (typeof THEME_VALUES)[number];

/** Stored values that no longer exist, mapped to the nearest survivor. */
const LEGACY_AUTO_REFRESH: Record<string, AutoRefreshValue> = {
    "10s": "30s",
};

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
        theme: THEME_VALUES.includes(obj.theme as ThemeValue)
            ? (obj.theme as ThemeValue)
            : DEFAULT_PREFERENCES.theme,
        autoRefresh: parseAutoRefresh(obj.autoRefresh),
    };
}

/**
 * Reads a stored auto-refresh preference.
 *
 * A retired value is translated rather than discarded: falling back to the
 * default would silently switch auto-refresh **off** for everyone who had
 * chosen 10s, which reads as the feature breaking rather than as a setting
 * changing. Note the asymmetry with the write path — `10s` is accepted *from
 * storage* and rejected *from a client*, because nothing emits it any more.
 */
export function parseAutoRefresh(raw: unknown): AutoRefreshValue {
    if (typeof raw !== "string") return DEFAULT_PREFERENCES.autoRefresh;
    if (raw in LEGACY_AUTO_REFRESH) return LEGACY_AUTO_REFRESH[raw];
    return AUTO_REFRESH_VALUES.includes(raw as AutoRefreshValue)
        ? (raw as AutoRefreshValue)
        : DEFAULT_PREFERENCES.autoRefresh;
}

/**
 * Splits an interval value into the parts a label needs: `"30s"` → amount
 * `"30"`, unit `"s"`; `"5m"` → `"5"`, `"m"`.
 *
 * Trivial, and it exists because the version that was not trivial enough to
 * extract got it wrong. `AutoRefreshControl` used to strip `"s"` from the
 * value and append it back from a seconds-only template — correct while every
 * option was in seconds, and printing **"5ms"** from the moment `5m` was
 * added on 2026-08-20. Nothing failed, because a label built inline in a
 * component is a branch no test can reach.
 */
export function splitAutoRefresh(value: Exclude<AutoRefreshValue, "off">): {
    amount: string;
    unit: "s" | "m";
} {
    return {
        amount: value.slice(0, -1),
        unit: value.endsWith("m") ? "m" : "s",
    };
}
