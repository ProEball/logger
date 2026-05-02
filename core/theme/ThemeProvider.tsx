"use client";

import { useEffect } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/core/store";
import { setThemeCookie } from "@/core/theme/cookie";
import type { ThemeValue } from "@/core/store/slices/theme";

function resolveTheme(value: ThemeValue): "dark" | "light" {
    if (value !== "system") {
        return value;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

interface Props {
    children: React.ReactNode;
}

export default function ThemeProvider({ children }: Props) {
    const themeValue = useSelector((state: RootState) => state.theme.value);

    useEffect(() => {
        const apply = (value: ThemeValue) => {
            const resolved = resolveTheme(value);
            document.documentElement.dataset.theme = resolved;
            setThemeCookie(value);
        };

        apply(themeValue);

        if (themeValue !== "system") {
            return;
        }

        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = () => apply("system");
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [themeValue]);

    return <>{children}</>;
}
