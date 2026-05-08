"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { t } from "@/core/i18n/t";
import styles from "./AttributesList.module.scss";

interface AttributesListProps {
    attributes: Record<string, unknown>;
}

export function AttributesList({ attributes }: AttributesListProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const entries = Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b));

    if (entries.length === 0) {
        return <p className={styles.empty}>{t("events.detail.noAttributes")}</p>;
    }

    const filterBy = (key: string, value: unknown) => {
        const strVal = String(value);
        const params = new URLSearchParams(searchParams.toString());
        params.set(`attribute.${key}`, strVal);
        // Close drawer
        params.delete("event");
        params.delete("event_ts");
        params.delete("tab");
        // Reset cursor
        params.delete("before_ts");
        params.delete("before_id");
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <div className={styles.list}>
            {entries.map(([key, value]) => (
                <div key={key} className={styles.row}>
                    <span className={styles.key}>{key}</span>
                    <span className={styles.value}>{String(value ?? "")}</span>
                    <button
                        type="button"
                        className={styles.filterBtn}
                        onClick={() => filterBy(key, value)}
                        title={t("events.filters.filterBy")}
                    >
                        {t("events.filters.filterBy")}
                    </button>
                </div>
            ))}
        </div>
    );
}
