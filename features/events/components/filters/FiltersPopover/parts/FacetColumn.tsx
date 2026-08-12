"use client";

import { Checkbox } from "@/shared/components/Checkbox/Checkbox";
import { LevelBadge, type LogLevel } from "@/shared/components/LevelBadge/LevelBadge";
import type { FacetOption } from "@/features/events/utils/event-filters.types";
import styles from "../FiltersPopover.module.scss";

interface FacetColumnProps<T extends string> {
    title: string;
    options: FacetOption[];
    selected: T[];
    query: string;
    isLevel?: boolean;
    onToggle: (value: T) => void;
}

export function FacetColumn<T extends string>({
    title,
    options,
    selected,
    query,
    isLevel,
    onToggle,
}: FacetColumnProps<T>) {
    const q = query.trim().toLowerCase();
    const visible = q ? options.filter((o) => o.value.toLowerCase().includes(q)) : options;

    if (q && visible.length === 0) return null;

    return (
        <div className={styles.facetColumn}>
            <div className={styles.facetTitle}>{title}</div>
            {visible.map((option) => {
                // Options come from a query scoped to this facet's own column, so the
                // value is guaranteed to be a valid T for the caller's field.
                const value = option.value as T;
                return (
                    <label key={option.value} className={styles.facetOption}>
                        <Checkbox
                            checked={selected.includes(value)}
                            onChange={() => onToggle(value)}
                        />
                        <span className={styles.facetLabel}>
                            {isLevel ? <LevelBadge level={option.value as LogLevel} size="sm" /> : option.value}
                        </span>
                        <span className={styles.facetCount}>{option.count.toLocaleString()}</span>
                    </label>
                );
            })}
        </div>
    );
}
