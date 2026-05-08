import { KeyValue } from "@/shared/components/KeyValue/KeyValue";
import { t } from "@/core/i18n/t";
import type { Event } from "@/core/db/schema";

interface EventDetailFieldsProps {
    event: Event;
}

export function EventDetailFields({ event }: EventDetailFieldsProps) {
    const ts = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);

    const rows = [
        { key: t("events.detail.field.id"), value: event.id },
        { key: t("events.detail.field.timestamp"), value: `${ts.toLocaleString()} (${ts.toISOString()})` },
        { key: t("events.detail.field.level"), value: event.level },
        event.source ? { key: t("events.detail.field.source"), value: event.source } : null,
        event.environment ? { key: t("events.detail.field.environment"), value: event.environment } : null,
        event.release ? { key: t("events.detail.field.release"), value: event.release } : null,
        event.userId ? { key: t("events.detail.field.userId"), value: event.userId } : null,
        event.sessionId ? { key: t("events.detail.field.sessionId"), value: event.sessionId } : null,
        event.requestId ? { key: t("events.detail.field.requestId"), value: event.requestId } : null,
        event.traceId ? { key: t("events.detail.field.traceId"), value: event.traceId } : null,
        event.errorType ? { key: t("events.detail.field.errorType"), value: event.errorType } : null,
        event.userAgent ? { key: t("events.detail.field.userAgent"), value: event.userAgent } : null,
        event.ip ? { key: t("events.detail.field.ip"), value: event.ip } : null,
    ].filter(Boolean) as { key: string; value: string }[];

    return <KeyValue rows={rows} keyWidth={160} />;
}
