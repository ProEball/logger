"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { EventFilters } from "@/features/events/utils/event-filters.types";
import styles from "./AddFilterDropdown.module.scss";

type FilterType = "level" | "environment" | "source" | "release" | "errorType" | "correlation" | "attribute" | "message";

interface AddFilterDropdownProps {
    activeFilters: EventFilters;
    onSelect: (type: FilterType) => void;
}

const FILTER_OPTIONS: { type: FilterType; labelKey: Parameters<typeof t>[0] }[] = [
    { type: "level", labelKey: "events.filters.level" },
    { type: "environment", labelKey: "events.filters.environment" },
    { type: "source", labelKey: "events.filters.source" },
    { type: "release", labelKey: "events.filters.release" },
    { type: "errorType", labelKey: "events.filters.errorType" },
    { type: "correlation", labelKey: "events.filters.correlation" },
    { type: "attribute", labelKey: "events.filters.attribute" },
    { type: "message", labelKey: "events.filters.message" },
];

export function AddFilterDropdown({ onSelect }: AddFilterDropdownProps) {
    const [open, setOpen] = useState(false);

    const trigger = (
        <Button variant="ghost" size="sm">
            + {t("events.filters.addFilter")}
        </Button>
    );

    return (
        <Popover trigger={trigger} open={open} onOpenChange={setOpen} width={200}>
            <div className={styles.list}>
                {FILTER_OPTIONS.map(({ type, labelKey }) => (
                    <button
                        key={type}
                        type="button"
                        className={styles.item}
                        onClick={() => { onSelect(type); setOpen(false); }}
                    >
                        {t(labelKey)}
                    </button>
                ))}
            </div>
        </Popover>
    );
}
