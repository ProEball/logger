"use client";
import { useState } from "react";
import { FilterBar } from "@/shared/components/FilterBar/FilterBar";
import { FilterChip } from "@/shared/components/FilterBar/FilterChip";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import { LevelFilter } from "@/features/events/components/filters/LevelFilter/LevelFilter";
import { StringListFilter } from "@/features/events/components/filters/StringListFilter/StringListFilter";
import { MessageFilter } from "@/features/events/components/filters/MessageFilter/MessageFilter";
import { AddFilterDropdown } from "@/features/events/components/filters/AddFilterDropdown/AddFilterDropdown";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import type { EventLevel } from "@/features/ingest/utils/event-schema";
import styles from "./FilterBuilder.module.scss";

type ActiveFilter = "level" | "environment" | "source" | "release" | "errorType" | "message";

interface FilterBuilderProps {
    value: EventFilters;
    onChange: (filters: EventFilters) => void;
}

const DEFAULT_RANGE: EventFilters["range"] = { type: "preset", value: "1h" };

export function FilterBuilder({ value, onChange }: FilterBuilderProps) {
    const [openFilters, setOpenFilters] = useState<Set<ActiveFilter>>(new Set());

    const showFilter = (type: string) => {
        if (["level", "environment", "source", "release", "errorType", "message"].includes(type)) {
            setOpenFilters((prev) => new Set([...prev, type as ActiveFilter]));
        }
    };

    const update = (patch: Partial<EventFilters>) => {
        onChange({ ...value, ...patch });
    };

    const shouldShow = (type: ActiveFilter): boolean => {
        if (openFilters.has(type)) return true;
        switch (type) {
            case "level": return !!value.levels?.length;
            case "environment": return !!value.environments?.length;
            case "source": return !!value.sources?.length;
            case "release": return !!value.releases?.length;
            case "errorType": return !!value.errorTypes?.length;
            case "message": return !!value.message;
        }
    };

    const hasAny = !!(
        value.levels?.length ||
        value.environments?.length ||
        value.sources?.length ||
        value.releases?.length ||
        value.errorTypes?.length ||
        value.message
    );

    return (
        <div className={styles.wrapper}>
            <p className={styles.label}>{t("alerts.editor.filterTitle")}</p>
            <FilterBar>
                {value.levels?.length ? (
                    <FilterChip
                        filterKey={t("events.filters.level")}
                        value={value.levels.join(", ")}
                        onRemove={() => update({ levels: undefined })}
                    />
                ) : null}

                {value.environments?.length ? (
                    <FilterChip
                        filterKey={t("events.filters.environment")}
                        value={value.environments.join(", ")}
                        onRemove={() => update({ environments: undefined })}
                    />
                ) : null}

                {value.sources?.length ? (
                    <FilterChip
                        filterKey={t("events.filters.source")}
                        value={value.sources.join(", ")}
                        onRemove={() => update({ sources: undefined })}
                    />
                ) : null}

                {value.releases?.length ? (
                    <FilterChip
                        filterKey={t("events.filters.release")}
                        value={value.releases.join(", ")}
                        onRemove={() => update({ releases: undefined })}
                    />
                ) : null}

                {value.errorTypes?.length ? (
                    <FilterChip
                        filterKey={t("events.filters.errorType")}
                        value={value.errorTypes.join(", ")}
                        onRemove={() => update({ errorTypes: undefined })}
                    />
                ) : null}

                {value.message ? (
                    <FilterChip
                        filterKey={t("events.filters.message")}
                        value={value.message}
                        onRemove={() => update({ message: undefined })}
                    />
                ) : null}

                {shouldShow("level") && !value.levels?.length ? (
                    <LevelFilter
                        value={value.levels ?? []}
                        onChange={(levels: EventLevel[]) => update({ levels })}
                    />
                ) : null}

                {shouldShow("environment") && !value.environments?.length ? (
                    <StringListFilter
                        labelKey="events.filters.environment"
                        value={value.environments ?? []}
                        onChange={(environments) => update({ environments })}
                    />
                ) : null}

                {shouldShow("source") && !value.sources?.length ? (
                    <StringListFilter
                        labelKey="events.filters.source"
                        value={value.sources ?? []}
                        onChange={(sources) => update({ sources })}
                    />
                ) : null}

                {shouldShow("release") && !value.releases?.length ? (
                    <StringListFilter
                        labelKey="events.filters.release"
                        value={value.releases ?? []}
                        onChange={(releases) => update({ releases })}
                    />
                ) : null}

                {shouldShow("errorType") && !value.errorTypes?.length ? (
                    <StringListFilter
                        labelKey="events.filters.errorType"
                        value={value.errorTypes ?? []}
                        onChange={(errorTypes) => update({ errorTypes })}
                    />
                ) : null}

                {shouldShow("message") && !value.message ? (
                    <MessageFilter value={value.message} onChange={(message) => update({ message })} />
                ) : null}

                <AddFilterDropdown activeFilters={value} onSelect={showFilter} />

                {hasAny && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange({ range: DEFAULT_RANGE })}
                    >
                        {t("events.clearFilters")}
                    </Button>
                )}
            </FilterBar>
        </div>
    );
}
