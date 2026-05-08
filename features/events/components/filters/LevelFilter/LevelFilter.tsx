"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Checkbox } from "@/shared/components/Checkbox/Checkbox";
import { Button } from "@/shared/components/Button/Button";
import { LevelBadge } from "@/shared/components/LevelBadge/LevelBadge";
import { t } from "@/core/i18n/t";
import { VALID_LEVELS, type EventLevel } from "@/features/ingest/utils/event-schema";
import styles from "../MultiSelectFilter/MultiSelectFilter.module.scss";

interface LevelFilterProps {
    value: EventLevel[];
    onChange: (levels: EventLevel[]) => void;
}

export function LevelFilter({ value, onChange }: LevelFilterProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<EventLevel[]>(value);

    const handleOpenChange = (next: boolean) => {
        if (next) setDraft(value);
        setOpen(next);
    };

    const toggle = (level: EventLevel) => {
        setDraft((prev) =>
            prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
        );
    };

    const apply = () => {
        onChange(draft);
        setOpen(false);
    };

    const trigger = (
        <Button variant="ghost" size="sm">
            {t("events.filters.level")}
        </Button>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={handleOpenChange}
            title={t("events.filters.level")}
            width={200}
        >
            <div className={styles.content}>
                {VALID_LEVELS.map((level) => (
                    <label key={level} className={styles.option}>
                        <Checkbox
                            checked={draft.includes(level)}
                            onChange={() => toggle(level)}
                        />
                        <LevelBadge level={level} size="sm" />
                    </label>
                ))}
                <div className={styles.footer}>
                    <Button size="sm" variant="primary" onClick={apply}>
                        {t("events.filters.apply")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
