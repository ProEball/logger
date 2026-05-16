"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import type { TimeRange, TimeRangePreset } from "@/features/events/utils/event-filters.types";
import styles from "./TimeRangePicker.module.scss";

const DEFAULT_PRESETS: TimeRangePreset[] = ["15m", "1h", "6h", "24h", "7d", "30d"];

interface TimeRangePickerProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    presets?: TimeRangePreset[];
}

function CalendarIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}

export function TimeRangePicker({ value, onChange, presets = DEFAULT_PRESETS }: TimeRangePickerProps) {
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [open, setOpen] = useState(false);

    const applyCustom = () => {
        const from = new Date(customFrom);
        const to = new Date(customTo);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
        onChange({ type: "custom", from: from.toISOString(), to: to.toISOString() });
        setOpen(false);
    };

    const isCustomActive = value.type === "custom";

    const calendarTrigger = (
        <button
            type="button"
            className={`${styles.option} ${isCustomActive ? styles.active : ""}`}
            title={t("events.timeRange.custom")}
        >
            <CalendarIcon />
        </button>
    );

    return (
        <div className={styles.picker}>
            {presets.map((preset) => (
                <button
                    key={preset}
                    type="button"
                    className={`${styles.option} ${value.type === "preset" && value.value === preset ? styles.active : ""}`}
                    onClick={() => onChange({ type: "preset", value: preset })}
                >
                    {preset}
                </button>
            ))}
            <Popover
                trigger={calendarTrigger}
                open={open}
                onOpenChange={setOpen}
                title={t("events.timeRange.custom")}
                width={280}
                placement="bottom-end"
            >
                <div className={styles.custom}>
                    <div className={styles.customField}>
                        <label className={styles.customLabel}>{t("events.timeRange.from")}</label>
                        <Input
                            type="datetime-local"
                            value={customFrom}
                            onChange={(e) => setCustomFrom(e.target.value)}
                        />
                    </div>
                    <div className={styles.customField}>
                        <label className={styles.customLabel}>{t("events.timeRange.to")}</label>
                        <Input
                            type="datetime-local"
                            value={customTo}
                            onChange={(e) => setCustomTo(e.target.value)}
                        />
                    </div>
                    <Button
                        variant="primary"
                        onClick={applyCustom}
                        disabled={!customFrom || !customTo}
                    >
                        {t("events.filters.apply")}
                    </Button>
                </div>
            </Popover>
        </div>
    );
}
