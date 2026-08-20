"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getFacetCountsAction } from "@/features/events/actions/get-facet-counts.action";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import { FacetColumn } from "./parts/FacetColumn";
import { FreeformFilters } from "./parts/FreeformFilters";
import type { EventFilters, FacetCounts, AttributeFilter } from "@/features/events/utils/event-filters.types";
import type { EventLevel } from "@/features/ingest/utils/event-schema";
import styles from "./FiltersPopover.module.scss";

type CorrelationKey = "userId" | "sessionId" | "requestId" | "traceId";
type NonRangeFilters = Omit<EventFilters, "range">;

interface FacetDraft {
    levels: EventLevel[];
    environments: string[];
    sources: string[];
    releases: string[];
    errorTypes: string[];
    message: string;
    userId: string;
    sessionId: string;
    requestId: string;
    traceId: string;
    attributes: AttributeFilter[];
}

interface FiltersPopoverProps {
    filters: EventFilters;
    orgSlug: string;
    projectSlug: string;
    onApply: (next: NonRangeFilters) => void;
}

function draftFromFilters(filters: EventFilters): FacetDraft {
    return {
        levels: filters.levels ?? [],
        environments: filters.environments ?? [],
        sources: filters.sources ?? [],
        releases: filters.releases ?? [],
        errorTypes: filters.errorTypes ?? [],
        message: filters.message ?? "",
        userId: filters.userId ?? "",
        sessionId: filters.sessionId ?? "",
        requestId: filters.requestId ?? "",
        traceId: filters.traceId ?? "",
        attributes: filters.attributes ?? [],
    };
}

function countDraft(d: FacetDraft): number {
    return (
        d.levels.length +
        d.environments.length +
        d.sources.length +
        d.releases.length +
        d.errorTypes.length +
        (d.message.trim() ? 1 : 0) +
        (d.userId.trim() ? 1 : 0) +
        (d.sessionId.trim() ? 1 : 0) +
        (d.requestId.trim() ? 1 : 0) +
        (d.traceId.trim() ? 1 : 0) +
        d.attributes.length
    );
}

function countFilters(filters: EventFilters): number {
    return (
        (filters.levels?.length ?? 0) +
        (filters.environments?.length ?? 0) +
        (filters.sources?.length ?? 0) +
        (filters.releases?.length ?? 0) +
        (filters.errorTypes?.length ?? 0) +
        (filters.message ? 1 : 0) +
        (filters.userId ? 1 : 0) +
        (filters.sessionId ? 1 : 0) +
        (filters.requestId ? 1 : 0) +
        (filters.traceId ? 1 : 0) +
        (filters.attributes?.length ?? 0)
    );
}

const EMPTY_DRAFT: FacetDraft = {
    levels: [],
    environments: [],
    sources: [],
    releases: [],
    errorTypes: [],
    message: "",
    userId: "",
    sessionId: "",
    requestId: "",
    traceId: "",
    attributes: [],
};

const NO_FACETS: FacetCounts = {
    levels: [],
    environments: [],
    sources: [],
    releases: [],
    errorTypes: [],
};

export function FiltersPopover({ filters, orgSlug, projectSlug, onApply }: FiltersPopoverProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState<FacetDraft>(() => draftFromFilters(filters));

    // Counts are loaded when the panel opens, not with the page. They are five
    // aggregations over the whole filtered range, and nobody can see them while
    // the panel is shut — which is almost every page load. See
    // `get-facet-counts.action.ts`.
    const [facetCounts, setFacetCounts] = useState<FacetCounts>(NO_FACETS);
    const [isLoadingFacets, setIsLoadingFacets] = useState(false);
    const [facetError, setFacetError] = useState<string | null>(null);
    const searchParams = useSearchParams();

    const loadFacets = useCallback(
        async (search: string) => {
            setIsLoadingFacets(true);
            setFacetError(null);
            try {
                const result = await getFacetCountsAction(orgSlug, projectSlug, search);
                if ("error" in result) {
                    setFacetError(result.error);
                    setFacetCounts(NO_FACETS);
                } else {
                    setFacetCounts(result.facetCounts);
                }
            } catch {
                setFacetError(t("events.filters.countsUnavailable"));
                setFacetCounts(NO_FACETS);
            } finally {
                setIsLoadingFacets(false);
            }
        },
        [orgSlug, projectSlug],
    );

    const handleOpenChange = (next: boolean) => {
        if (next) {
            setQuery("");
            setDraft(draftFromFilters(filters));
            // Refetched on every open rather than cached: the counts are scoped
            // by the active filters, and those change between openings.
            void loadFacets(searchParams.toString());
        }
        setOpen(next);
    };

    const toggleLevel = (value: EventLevel) => {
        setDraft((prev) => ({
            ...prev,
            levels: prev.levels.includes(value) ? prev.levels.filter((v) => v !== value) : [...prev.levels, value],
        }));
    };

    const toggleField = (field: "environments" | "sources" | "releases" | "errorTypes") => (value: string) => {
        setDraft((prev) => {
            const current = prev[field];
            const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
            return { ...prev, [field]: next };
        });
    };

    const setMessage = (value: string) => setDraft((prev) => ({ ...prev, message: value }));

    const setCorrelation = (key: CorrelationKey, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

    const addAttribute = (attr: AttributeFilter) =>
        setDraft((prev) => ({
            ...prev,
            attributes: [...prev.attributes.filter((a) => a.key !== attr.key), attr],
        }));

    const removeAttribute = (key: string) =>
        setDraft((prev) => ({ ...prev, attributes: prev.attributes.filter((a) => a.key !== key) }));

    const clearAll = () => setDraft(EMPTY_DRAFT);

    const apply = () => {
        onApply(draft);
        setOpen(false);
    };

    // Badge on the closed trigger reflects committed filters (updates instantly when a
    // chip is removed elsewhere); the draft count below only matters while open.
    const committedCount = countFilters(filters);
    const draftCount = countDraft(draft);

    const trigger = (
        <button type="button" className={styles.trigger} data-open={open || undefined}>
            {t("events.filters.filters")}
            {committedCount > 0 ? <span className={styles.count}>{committedCount}</span> : null}
        </button>
    );

    const footer = (
        <div className={styles.footerRow}>
            <button type="button" className={styles.clearAll} onClick={clearAll}>
                {t("events.filters.clearAll")}
            </button>
            <Button size="sm" variant="primary" onClick={apply}>
                {t("events.filters.apply")}
                {draftCount > 0 ? ` (${draftCount})` : ""}
            </Button>
        </div>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={handleOpenChange}
            width={760}
            footer={footer}
            className={styles.popover}
        >
            <div className={styles.searchRow}>
                <Input
                    autoFocus
                    placeholder={t("events.filters.searchFilters")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            {facetError ? (
                <div role="status" className={styles.facetError}>
                    {facetError}
                </div>
            ) : null}
            <div className={styles.columns}>
                <FacetColumn<EventLevel>
                    title={t("events.filters.level")}
                    options={facetCounts.levels}
                    selected={draft.levels}
                    query={query}
                    isLoading={isLoadingFacets}
                    isLevel
                    onToggle={toggleLevel}
                />
                <FacetColumn<string>
                    title={t("events.filters.environment")}
                    options={facetCounts.environments}
                    selected={draft.environments}
                    query={query}
                    isLoading={isLoadingFacets}
                    onToggle={toggleField("environments")}
                />
                <FacetColumn<string>
                    title={t("events.filters.source")}
                    options={facetCounts.sources}
                    selected={draft.sources}
                    query={query}
                    isLoading={isLoadingFacets}
                    onToggle={toggleField("sources")}
                />
                <FacetColumn<string>
                    title={t("events.filters.release")}
                    options={facetCounts.releases}
                    selected={draft.releases}
                    query={query}
                    isLoading={isLoadingFacets}
                    onToggle={toggleField("releases")}
                />
                <FacetColumn<string>
                    title={t("events.filters.errorType")}
                    options={facetCounts.errorTypes}
                    selected={draft.errorTypes}
                    query={query}
                    isLoading={isLoadingFacets}
                    onToggle={toggleField("errorTypes")}
                />
            </div>
            <FreeformFilters
                message={draft.message}
                onMessageChange={setMessage}
                correlation={{
                    userId: draft.userId,
                    sessionId: draft.sessionId,
                    requestId: draft.requestId,
                    traceId: draft.traceId,
                }}
                onCorrelationChange={setCorrelation}
                attributes={draft.attributes}
                onAddAttribute={addAttribute}
                onRemoveAttribute={removeAttribute}
            />
        </Popover>
    );
}
