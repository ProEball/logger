"use client";

import { useDispatch, useSelector } from "react-redux";
import { setAutoRefresh, selectAutoRefresh } from "@/core/store/slices/user";
import { updatePreferencesAction } from "@/features/auth/actions/update-preferences.action";
import { t } from "@/core/i18n/t";
import type { AutoRefreshValue } from "@/shared/types/user-preferences.types";
import { useAutoRefresh } from "@/features/events/hooks/use-auto-refresh";
import styles from "./AutoRefreshControl.module.scss";

const OPTIONS: AutoRefreshValue[] = ["off", "10s", "30s", "60s"];

function getLabel(v: AutoRefreshValue): string {
    if (v === "off") return t("events.autoRefresh.off");
    return t("events.autoRefresh.seconds").replace("{{n}}", v.replace("s", ""));
}

export function AutoRefreshControl() {
    const dispatch = useDispatch();
    const current = useSelector(selectAutoRefresh);

    useAutoRefresh(current);

    const handleChange = async (value: AutoRefreshValue) => {
        dispatch(setAutoRefresh(value));
        await updatePreferencesAction({ autoRefresh: value });
    };

    return (
        <div className={styles.control} role="group" aria-label={t("events.autoRefresh.label")}>
            <span className={styles.label}>{t("events.autoRefresh.label")}</span>
            <div className={styles.options}>
                {OPTIONS.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        className={`${styles.option} ${current === opt ? styles.active : ""}`}
                        onClick={() => handleChange(opt)}
                        aria-pressed={current === opt}
                    >
                        {opt !== "off" && current === opt && (
                            <span className={styles.pulseDot} aria-hidden />
                        )}
                        {getLabel(opt)}
                    </button>
                ))}
            </div>
        </div>
    );
}
