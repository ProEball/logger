"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { t } from "@/core/i18n/t";
import { EventDetailFields } from "../EventDetailFields/EventDetailFields";
import { AttributesList } from "../AttributesList/AttributesList";
import { ContextTree } from "../ContextTree/ContextTree";
import { StackTraceViewer } from "../StackTraceViewer/StackTraceViewer";
import type { Event } from "@/core/db/schema";
import styles from "./EventDetailTabs.module.scss";

type TabId = "details" | "attributes" | "context" | "stackTrace";

const TABS: TabId[] = ["details", "attributes", "context", "stackTrace"];

const TAB_LABELS: Record<TabId, () => string> = {
    details: () => t("events.detail.details"),
    attributes: () => t("events.detail.attributes"),
    context: () => t("events.detail.context"),
    stackTrace: () => t("events.detail.stackTrace"),
};

interface EventDetailTabsProps {
    event: Event;
    activeTab: string;
}

export function EventDetailTabs({ event, activeTab }: EventDetailTabsProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const currentTab: TabId = TABS.includes(activeTab as TabId) ? (activeTab as TabId) : "details";

    const setTab = (tab: TabId) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", tab);
        router.replace(`${pathname}?${params.toString()}`);
    };

    const renderContent = () => {
        switch (currentTab) {
            case "details":
                return <EventDetailFields event={event} />;
            case "attributes":
                return <AttributesList attributes={(event.attributes as Record<string, unknown>) ?? {}} />;
            case "context":
                return <ContextTree context={event.context} />;
            case "stackTrace":
                return <StackTraceViewer stackTrace={event.stackTrace} />;
        }
    };

    return (
        <div className={styles.container}>
            <div role="tablist" className={styles.tabNav}>
                {TABS.map((id) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={currentTab === id}
                        className={`${styles.tab} ${currentTab === id ? styles.tabActive : ""}`}
                        onClick={() => setTab(id)}
                    >
                        {TAB_LABELS[id]()}
                    </button>
                ))}
            </div>
            <div className={styles.content}>{renderContent()}</div>
        </div>
    );
}
