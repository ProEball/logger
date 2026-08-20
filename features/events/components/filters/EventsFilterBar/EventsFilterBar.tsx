"use client";

import { FilterChip } from "@/shared/components/FilterBar/FilterChip";
import { t } from "@/core/i18n/t";
import { FiltersPopover } from "../FiltersPopover/FiltersPopover";
import { TimeRangePicker } from "../TimeRangePicker/TimeRangePicker";
import type { EventFilters } from "@/features/events/utils/event-filters.types";
import styles from "./EventsFilterBar.module.scss";

interface EventsFilterBarProps {
    filters: EventFilters;
    orgSlug: string;
    projectSlug: string;
    onApplyFilters: (next: Omit<EventFilters, "range">) => void;
    onSetTimeRange: (range: EventFilters["range"]) => void;
    onRemoveAttribute: (key: string) => void;
    onRemoveFilter: (key: keyof EventFilters) => void;
    onClearAll: () => void;
    eventCount?: number;
    hasMore?: boolean;
}

export function EventsFilterBar({
    filters,
    orgSlug,
    projectSlug,
    onApplyFilters,
    onSetTimeRange,
    onRemoveAttribute,
    onRemoveFilter,
    onClearAll,
    eventCount,
    hasMore,
}: EventsFilterBarProps) {
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

    return (
        <div role="toolbar" aria-label="Filters" className={styles.bar}>
            {/* Time range — always first */}
            <TimeRangePicker value={filters.range} onChange={onSetTimeRange} />

            {/* Datadog-style facet popover — single control surface for every filter */}
            <FiltersPopover
                filters={filters}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                onApply={onApplyFilters}
            />

            {/* Active filter chips */}
            {filters.levels?.length ? (
                <FilterChip
                    filterKey={t("events.filters.level")}
                    value={filters.levels.join(", ")}
                    variant="red"
                    onRemove={() => onRemoveFilter("levels")}
                />
            ) : null}

            {filters.environments?.length ? (
                <FilterChip
                    filterKey={t("events.filters.environment")}
                    value={filters.environments.join(", ")}
                    variant="green"
                    onRemove={() => onRemoveFilter("environments")}
                />
            ) : null}

            {filters.sources?.length ? (
                <FilterChip
                    filterKey={t("events.filters.source")}
                    value={filters.sources.join(", ")}
                    variant="cyan"
                    onRemove={() => onRemoveFilter("sources")}
                />
            ) : null}

            {filters.releases?.length ? (
                <FilterChip
                    filterKey={t("events.filters.release")}
                    value={filters.releases.join(", ")}
                    variant="purple"
                    onRemove={() => onRemoveFilter("releases")}
                />
            ) : null}

            {filters.errorTypes?.length ? (
                <FilterChip
                    filterKey={t("events.filters.errorType")}
                    value={filters.errorTypes.join(", ")}
                    variant="orange"
                    onRemove={() => onRemoveFilter("errorTypes")}
                />
            ) : null}

            {filters.userId ? (
                <FilterChip
                    filterKey={t("events.filters.userId")}
                    value={filters.userId}
                    variant="cyan"
                    onRemove={() => onRemoveFilter("userId")}
                />
            ) : null}

            {filters.sessionId ? (
                <FilterChip
                    filterKey={t("events.filters.sessionId")}
                    value={filters.sessionId}
                    variant="cyan"
                    onRemove={() => onRemoveFilter("sessionId")}
                />
            ) : null}

            {filters.requestId ? (
                <FilterChip
                    filterKey={t("events.filters.requestId")}
                    value={filters.requestId}
                    variant="cyan"
                    onRemove={() => onRemoveFilter("requestId")}
                />
            ) : null}

            {filters.traceId ? (
                <FilterChip
                    filterKey={t("events.filters.traceId")}
                    value={filters.traceId}
                    variant="cyan"
                    onRemove={() => onRemoveFilter("traceId")}
                />
            ) : null}

            {filters.message ? (
                <FilterChip
                    filterKey={t("events.filters.message")}
                    value={filters.message}
                    onRemove={() => onRemoveFilter("message")}
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

            {hasAnyActiveFilter ? (
                <button type="button" className={styles.clearAll} onClick={onClearAll}>
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
