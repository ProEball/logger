"use client";

import { useDispatch, useSelector } from "react-redux";
import { cx } from "@/shared/utils/cx";
import type { RootState } from "@/core/store";
import { setTheme, type ThemeValue } from "@/core/store/slices/theme";
import { updatePreferencesAction } from "@/features/auth/actions/update-preferences.action";
import styles from "./ThemeSwitcher.module.scss";

const OPTIONS: { value: ThemeValue; label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
];

export function ThemeSwitcher() {
    const dispatch = useDispatch();
    const current = useSelector((state: RootState) => state.theme.value);

    const handleChange = async (value: ThemeValue) => {
        dispatch(setTheme(value));
        // Awaited (not fire-and-forget) so the save isn't dropped if the tab
        // closes right after switching — the visible theme would then no
        // longer match what's persisted for the next login.
        const result = await updatePreferencesAction({ theme: value });
        if (result.error) {
            console.error("Failed to save theme preference:", result.error);
        }
    };

    return (
        <div className={styles.root} role="group" aria-label="Theme">
            {OPTIONS.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className={cx(styles.option, current === opt.value && styles.optionActive)}
                    onClick={() => handleChange(opt.value)}
                    aria-pressed={current === opt.value}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
