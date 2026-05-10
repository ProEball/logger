import { StatusBadge } from "@/shared/components/StatusBadge/StatusBadge";
import { t } from "@/core/i18n/t";
import type { Status } from "@/shared/components/StatusBadge/StatusBadge";

type DeliveryStatus = "pending" | "delivered" | "failed" | "retrying";

const STATUS_CONFIG: Record<DeliveryStatus, { status: Status; label: string }> = {
    pending: { status: "info", label: t("alerts.delivery.pending") },
    delivered: { status: "success", label: t("alerts.delivery.delivered") },
    failed: { status: "danger", label: t("alerts.delivery.failed") },
    retrying: { status: "warning", label: t("alerts.delivery.retrying") },
};

interface DeliveryStatusBadgeProps {
    status: string;
}

export function DeliveryStatusBadge({ status }: DeliveryStatusBadgeProps) {
    const config = STATUS_CONFIG[status as DeliveryStatus] ?? STATUS_CONFIG.pending;
    return <StatusBadge status={config.status} label={config.label} />;
}
