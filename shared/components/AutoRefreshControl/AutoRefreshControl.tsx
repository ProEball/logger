"use client";

import { useDispatch, useSelector } from "react-redux";
import { useIsHydrated } from "@/shared/hooks/use-is-hydrated";
import { setAutoRefresh, selectAutoRefresh } from "@/core/store/slices/user";
import { updatePreferencesAction } from "@/features/auth/actions/update-preferences.action";
import { t } from "@/core/i18n/t";
import {
    AUTO_REFRESH_VALUES,
    splitAutoRefresh,
    type AutoRefreshValue,
} from "@/shared/types/user-preferences.types";
import { useAutoRefresh } from "@/shared/hooks/use-auto-refresh";
import styles from "./AutoRefreshControl.module.scss";

const OPTIONS = AUTO_REFRESH_VALUES;

/** Renders "Off", "30s", "60s", "5m". Unit handling is in `splitAutoRefresh`. */
function getLabel(v: AutoRefreshValue): string {
    if (v === "off") return t("common.autoRefresh.off");
    const { amount, unit } = splitAutoRefresh(v);
    const key = unit === "m" ? "common.autoRefresh.minutes" : "common.autoRefresh.seconds";
    return t(key).replace("{{n}}", amount);
}

export function AutoRefreshControl() {
    const dispatch = useDispatch();
    const current = useSelector(selectAutoRefresh);

    // TODO: `current` is seeded from Redux's default state and only corrected after
    // OrgHydrator's mount effect dispatches the real preference, so SSR and the first
    // client paint disagree. Proper fix is to seed the store's initial preferences from
    // the server-fetched value instead of a post-mount effect — touches the shared
    // org/project/theme hydrator pattern too, so treat as a separate task. The `mounted`
    // gate below is a quick fix: it renders no option as active until the real
    // preference has landed, so SSR and the first client paint always agree.
    const mounted = useIsHydrated();
    const isActive = (opt: AutoRefreshValue) => mounted && current === opt;

    useAutoRefresh(current);

    const handleChange = async (value: AutoRefreshValue) => {
        dispatch(setAutoRefresh(value));
        await updatePreferencesAction({ autoRefresh: value });
    };

    return (
        <div className={styles.control} role="group" aria-label={t("common.autoRefresh.label")}>
            <span className={styles.label}>{t("common.autoRefresh.label")}</span>
            <div className={styles.options}>
                {OPTIONS.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        className={`${styles.option} ${isActive(opt) ? styles.active : ""}`}
                        onClick={() => handleChange(opt)}
                        aria-pressed={isActive(opt)}
                    >
                        {opt !== "off" && isActive(opt) && (
                            <span className={styles.pulseDot} aria-hidden />
                        )}
                        {getLabel(opt)}
                    </button>
                ))}
            </div>
        </div>
    );
}
