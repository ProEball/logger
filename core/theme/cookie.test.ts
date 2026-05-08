import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCookieStore = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next/headers", () => ({
    cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

import { getThemeFromCookie, setThemeCookie } from "./cookie";

const COOKIE_NAME = "logger_theme";

describe("getThemeFromCookie", () => {
    beforeEach(() => {
        mockCookieStore.get.mockReset();
    });

    it('returns "dark" when no cookie is present', async () => {
        mockCookieStore.get.mockReturnValue(undefined);
        expect(await getThemeFromCookie()).toBe("dark");
    });

    it('returns "dark" for a dark cookie value', async () => {
        mockCookieStore.get.mockReturnValue({ value: "dark" });
        expect(await getThemeFromCookie()).toBe("dark");
    });

    it('returns "light" for a light cookie value', async () => {
        mockCookieStore.get.mockReturnValue({ value: "light" });
        expect(await getThemeFromCookie()).toBe("light");
    });

    it('returns "system" for a system cookie value', async () => {
        mockCookieStore.get.mockReturnValue({ value: "system" });
        expect(await getThemeFromCookie()).toBe("system");
    });

    it('returns "dark" as fallback for an unrecognised cookie value', async () => {
        mockCookieStore.get.mockReturnValue({ value: "neon-pink" });
        expect(await getThemeFromCookie()).toBe("dark");
    });
});

describe("setThemeCookie", () => {
    it(`writes "${COOKIE_NAME}=light" to document.cookie`, () => {
        setThemeCookie("light");
        expect(document.cookie).toContain(`${COOKIE_NAME}=light`);
    });

    it(`writes "${COOKIE_NAME}=dark" to document.cookie`, () => {
        setThemeCookie("dark");
        expect(document.cookie).toContain(`${COOKIE_NAME}=dark`);
    });

    it(`writes "${COOKIE_NAME}=system" to document.cookie`, () => {
        setThemeCookie("system");
        expect(document.cookie).toContain(`${COOKIE_NAME}=system`);
    });
});
