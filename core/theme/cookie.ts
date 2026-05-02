import type { ThemeValue } from "@/core/store/slices/theme";

const COOKIE_NAME = "logger_theme";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function getThemeFromCookie(): Promise<ThemeValue> {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const value = store.get(COOKIE_NAME)?.value;

    if (value === "dark" || value === "light" || value === "system") {
        return value;
    }

    return "dark";
}

export function setThemeCookie(value: ThemeValue): void {
    document.cookie = `${COOKIE_NAME}=${value}; max-age=${MAX_AGE}; path=/; SameSite=Lax`;
}
