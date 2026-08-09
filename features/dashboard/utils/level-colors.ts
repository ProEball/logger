/**
 * Chart colour for each log level.
 * Intentionally uses literal colour values (not CSS variables) because Recharts
 * renders to SVG/Canvas and cannot resolve CSS custom properties.
 */
export const LEVEL_COLOR: Record<string, string> = {
    debug: "#6272a4",
    info:  "#8be9fd",
    warn:  "#ffb86c",
    error: "#ff5555",
    fatal: "#ff79c6",
};

/** Ordered list of known levels (used for stacking). */
export const KNOWN_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

/** Fallback colour for unknown levels. */
export const LEVEL_COLOR_FALLBACK = "#6b7280";

export function levelColor(level: string): string {
    return LEVEL_COLOR[level] ?? LEVEL_COLOR_FALLBACK;
}
