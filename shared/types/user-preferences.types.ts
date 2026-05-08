export type AutoRefreshValue = "off" | "10s" | "30s" | "60s";
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
        autoRefresh: (["off", "10s", "30s", "60s"].includes(obj.autoRefresh as string)
            ? obj.autoRefresh
            : DEFAULT_PREFERENCES.autoRefresh) as AutoRefreshValue,
    };
}
