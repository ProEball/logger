import { StatusBadge } from "@/shared/components/StatusBadge/StatusBadge";
import { t } from "@/core/i18n/t";
import type { Status } from "@/shared/components/StatusBadge/StatusBadge";

export type AlertState = "ok" | "firing" | "disabled";

const STATE_CONFIG: Record<AlertState, { status: Status; label: string }> = {
    ok: { status: "success", label: t("alerts.states.ok") },
    firing: { status: "danger", label: t("alerts.states.firing") },
    disabled: { status: "info", label: t("alerts.states.disabled") },
};

interface AlertStateBadgeProps {
    state: AlertState;
}

export function AlertStateBadge({ state }: AlertStateBadgeProps) {
    const { status, label } = STATE_CONFIG[state];
    return <StatusBadge status={status} label={label} />;
}
