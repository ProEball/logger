"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Drawer } from "@/shared/components/Drawer/Drawer";
import { t } from "@/core/i18n/t";
import { EventDetailHeader } from "../EventDetailHeader/EventDetailHeader";
import { EventDetailTabs } from "../EventDetailTabs/EventDetailTabs";
import type { Event } from "@/core/db/schema";
import styles from "./EventDrawer.module.scss";

interface EventDrawerProps {
    event: Event | null;
    activeTab: string;
}

export function EventDrawer({ event, activeTab }: EventDrawerProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const onClose = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("event");
        params.delete("event_ts");
        params.delete("tab");
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <Drawer
            open={event !== null}
            onClose={onClose}
            width={520}
            side="right"
            ariaLabel={t("events.detail.details")}
        >
            {event ? (
                <div className={styles.body}>
                    <EventDetailHeader event={event} />
                    <EventDetailTabs event={event} activeTab={activeTab} />
                </div>
            ) : null}
        </Drawer>
    );
}
