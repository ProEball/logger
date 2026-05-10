import { AlertStateBadge } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import { DeliveryStatusBadge } from "@/features/alerts/components/history/DeliveryStatusBadge/DeliveryStatusBadge";
import type { AlertNotification } from "@/core/db/schema";
import type { AlertState } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import styles from "./AlertNotificationRow.module.scss";

interface AlertNotificationRowProps {
    notification: AlertNotification;
}

function formatTimestamp(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(d);
}

export function AlertNotificationRow({ notification }: AlertNotificationRowProps) {
    const state = notification.state as AlertState;
    const hasError = !!notification.deliveryLastError;

    return (
        <>
            <tr className={styles.row}>
                <td className={styles.ts}>{formatTimestamp(notification.triggeredAt)}</td>
                <td><AlertStateBadge state={state} /></td>
                <td><DeliveryStatusBadge status={notification.deliveryStatus} /></td>
                <td className={styles.attempts}>{notification.deliveryAttempts}</td>
                {hasError && (
                    <td>
                        <details>
                            <summary className={styles.errorToggle}>Show error</summary>
                            <code className={styles.errorText}>{notification.deliveryLastError}</code>
                        </details>
                    </td>
                )}
                {!hasError && <td />}
            </tr>
        </>
    );
}
