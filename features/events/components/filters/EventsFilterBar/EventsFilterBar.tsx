"use client";

import { useState } from "react";
import { FilterChip } from "@/shared/components/FilterBar/FilterChip";
import { t } from "@/core/i18n/t";
import { LevelFilter } from "../LevelFilter/LevelFilter";
import { StringListFilter } from "../StringListFilter/StringListFilter";
import { CorrelationFilter } from "../CorrelationFilter/CorrelationFilter";
import { AttributeFilter } from "../AttributeFilter/AttributeFilter";
import { MessageFilter } from "../MessageFilter/MessageFilter";
import { TimeRangePicker } from "../TimeRangePicker/TimeRangePicker";
import { AddFilterDropdown } from "../AddFilterDropdown/AddFilterDropdown";
import type { EventFilters } from "@/features/events/utils/event-filters.types";
import type { EventLevel } from "@/features/ingest/utils/event-schema";
import styles from "./EventsFilterBar.module.scss";

type ActiveFilter = "level" | "environment" | "source" | "release" | "errorType" | "correlation" | "attribute" | "message";

interface EventsFilterBarProps {
    filters: EventFilters;
    onSetLevels: (levels: EventLevel[]) => void;
    onSetEnvironments: (envs: string[]) => void;
    onSetSources: (sources: string[]) => void;
    onSetReleases: (releases: string[]) => void;
    onSetErrorTypes: (types: string[]) => void;
    onSetMessage: (msg: string | undefined) => void;
    onSetTimeRange: (range: EventFilters["range"]) => void;
    onSetCorrelation: (key: "userId" | "sessionId" | "requestId" | "traceId", value: string | undefined) => void;
    onAddAttribute: (attr: { key: string; value: string }) => void;
    onRemoveAttribute: (key: string) => void;
    onRemoveFilter: (key: keyof EventFilters) => void;
    onClearAll: () => void;
    eventCount?: number;
    hasMore?: boolean;
}

export function EventsFilterBar({
    filters,
    onSetLevels,
    onSetEnvironments,
    onSetSources,
    onSetReleases,
    onSetErrorTypes,
    onSetMessage,
    onSetTimeRange,
    onSetCorrelation,
    onAddAttribute,
    onRemoveAttribute,
    onRemoveFilter,
    onClearAll,
    eventCount,
    hasMore,
}: EventsFilterBarProps) {
    const [openFilters, setOpenFilters] = useState<Set<ActiveFilter>>(new Set());

    const showFilter = (type: ActiveFilter) => {
        setOpenFilters((prev) => new Set([...prev, type]));
    };

    const hideFilter = (type: ActiveFilter) => {
        setOpenFilters((prev) => { const next = new Set(prev); next.delete(type); return next; });
    };

    const KEY_TO_ACTIVE: Partial<Record<keyof EventFilters, ActiveFilter>> = {
        levels: "level",
        environments: "environment",
        sources: "source",
        releases: "release",
        errorTypes: "errorType",
        message: "message",
        attributes: "attribute",
        userId: "correlation",
        sessionId: "correlation",
        requestId: "correlation",
        traceId: "correlation",
    };

    const handleRemoveFilter = (key: keyof EventFilters) => {
        const active = KEY_TO_ACTIVE[key];
        if (active) hideFilter(active);
        onRemoveFilter(key);
    };

    const handleClearAll = () => {
        setOpenFilters(new Set());
        onClearAll();
    };

    const handleCorrelation = (key: "userId" | "sessionId" | "requestId" | "traceId", value: string | undefined) => {
        if (!value) hideFilter("correlation");
        onSetCorrelation(key, value);
    };

    const hasAnyActiveFilter = !!(
        filters.levels?.length ||
        filters.environments?.length ||
        filters.sources?.length ||
        filters.releases?.length ||
        filters.errorTypes?.length ||
        filters.userId ||
        filters.sessionId ||
        filters.requestId ||
        filters.traceId ||
        filters.message ||
        filters.attributes?.length
    );

    const shouldShow = (type: ActiveFilter): boolean => {
        if (openFilters.has(type)) return true;
        switch (type) {
            case "level": return !!filters.levels?.length;
            case "environment": return !!filters.environments?.length;
            case "source": return !!filters.sources?.length;
            case "release": return !!filters.releases?.length;
            case "errorType": return !!filters.errorTypes?.length;
            case "correlation": return !!(filters.userId || filters.sessionId || filters.requestId || filters.traceId);
            case "attribute": return !!filters.attributes?.length;
            case "message": return !!filters.message;
        }
    };

    return (
        <div role="toolbar" aria-label="Filters" className={styles.bar}>
            {/* Time range — always first */}
            <TimeRangePicker value={filters.range} onChange={onSetTimeRange} />

            {/* Active filter chips */}
            {filters.levels?.length ? (
                <FilterChip
                    filterKey={t("events.filters.level")}
                    value={filters.levels.join(", ")}
                    variant="red"
                    onRemove={() => handleRemoveFilter("levels")}
                />
            ) : null}

            {filters.environments?.length ? (
                <FilterChip
                    filterKey={t("events.filters.environment")}
                    value={filters.environments.join(", ")}
                    variant="green"
                    onRemove={() => handleRemoveFilter("environments")}
                />
            ) : null}

            {filters.sources?.length ? (
                <FilterChip
                    filterKey={t("events.filters.source")}
                    value={filters.sources.join(", ")}
                    variant="cyan"
                    onRemove={() => handleRemoveFilter("sources")}
                />
            ) : null}

            {filters.releases?.length ? (
                <FilterChip
                    filterKey={t("events.filters.release")}
                    value={filters.releases.join(", ")}
                    variant="purple"
                    onRemove={() => handleRemoveFilter("releases")}
                />
            ) : null}

            {filters.errorTypes?.length ? (
                <FilterChip
                    filterKey={t("events.filters.errorType")}
                    value={filters.errorTypes.join(", ")}
                    variant="orange"
                    onRemove={() => handleRemoveFilter("errorTypes")}
                />
            ) : null}

            {filters.userId ? (
                <FilterChip
                    filterKey={t("events.filters.userId")}
                    value={filters.userId}
                    variant="cyan"
                    onRemove={() => handleCorrelation("userId", undefined)}
                />
            ) : null}

            {filters.sessionId ? (
                <FilterChip
                    filterKey={t("events.filters.sessionId")}
                    value={filters.sessionId}
                    variant="cyan"
                    onRemove={() => handleCorrelation("sessionId", undefined)}
                />
            ) : null}

            {filters.requestId ? (
                <FilterChip
                    filterKey={t("events.filters.requestId")}
                    value={filters.requestId}
                    variant="cyan"
                    onRemove={() => handleCorrelation("requestId", undefined)}
                />
            ) : null}

            {filters.traceId ? (
                <FilterChip
                    filterKey={t("events.filters.traceId")}
                    value={filters.traceId}
                    variant="cyan"
                    onRemove={() => handleCorrelation("traceId", undefined)}
                />
            ) : null}

            {filters.message ? (
                <FilterChip
                    filterKey={t("events.filters.message")}
                    value={filters.message}
                    onRemove={() => { hideFilter("message"); onSetMessage(undefined); }}
                />
            ) : null}

            {filters.attributes?.map((attr) => (
                <FilterChip
                    key={attr.key}
                    filterKey={`attribute.${attr.key}`}
                    value={attr.value}
                    variant="purple"
                    onRemove={() => onRemoveAttribute(attr.key)}
                />
            ))}

            {/* Inline filter editors */}
            {shouldShow("level") && !filters.levels?.length ? (
                <LevelFilter value={filters.levels ?? []} onChange={onSetLevels} />
            ) : null}

            {shouldShow("environment") && !filters.environments?.length ? (
                <StringListFilter
                    labelKey="events.filters.environment"
                    value={filters.environments ?? []}
                    onChange={onSetEnvironments}
                />
            ) : null}

            {shouldShow("source") && !filters.sources?.length ? (
                <StringListFilter
                    labelKey="events.filters.source"
                    value={filters.sources ?? []}
                    onChange={onSetSources}
                />
            ) : null}

            {shouldShow("release") && !filters.releases?.length ? (
                <StringListFilter
                    labelKey="events.filters.release"
                    value={filters.releases ?? []}
                    onChange={onSetReleases}
                />
            ) : null}

            {shouldShow("errorType") && !filters.errorTypes?.length ? (
                <StringListFilter
                    labelKey="events.filters.errorType"
                    value={filters.errorTypes ?? []}
                    onChange={onSetErrorTypes}
                />
            ) : null}

            {shouldShow("correlation") && !(filters.userId || filters.sessionId || filters.requestId || filters.traceId) ? (
                <CorrelationFilter
                    userId={filters.userId}
                    sessionId={filters.sessionId}
                    requestId={filters.requestId}
                    traceId={filters.traceId}
                    onChange={handleCorrelation}
                />
            ) : null}

            {shouldShow("attribute") && !filters.attributes?.length ? (
                <AttributeFilter onAdd={onAddAttribute} />
            ) : null}

            {shouldShow("message") && !filters.message ? (
                <MessageFilter value={filters.message} onChange={onSetMessage} />
            ) : null}

            {/* Add filter — dashed pill */}
            <AddFilterDropdown activeFilters={filters} onSelect={showFilter} />

            {hasAnyActiveFilter ? (
                <button type="button" className={styles.clearAll} onClick={handleClearAll}>
                    Clear all
                </button>
            ) : null}

            <div className={styles.spacer} />

            {eventCount !== undefined ? (
                <span className={styles.resultCount}>
                    <b>{eventCount}</b>{hasMore ? "+" : ""} events
                </span>
            ) : null}
        </div>
    );
}
