import { AlertStateBadge } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import { DeliveryStatusBadge } from "@/features/alerts/components/history/DeliveryStatusBadge/DeliveryStatusBadge";
import type { AlertNotification } from "@/core/db/schema";
import type { AlertState } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import styles from "./AlertNotificationRow.module.scss";

interface AlertNotificationRowProps {
    notification: AlertNotification;
}

function SplitTimestamp({ date }: { date: Date | string }) {
    const d = typeof date === "string" ? new Date(date) : date;
    const datePart = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
    const timePart = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
    const ms = String(d.getMilliseconds()).padStart(3, "0");

    return (
        <span className={styles.ts}>
            <span className={styles.tsDate}>{datePart}</span>
            {" "}
            <span className={styles.tsTime}>{timePart}</span>
            <span className={styles.tsMs}>.{ms}</span>
        </span>
    );
}

export function AlertNotificationRow({ notification }: AlertNotificationRowProps) {
    const state = notification.state as AlertState;
    const error = notification.deliveryLastError;

    return (
        <tr className={styles.row}>
            <td className={styles.td}>
                <SplitTimestamp date={notification.triggeredAt} />
            </td>
            <td className={styles.td}>
                <AlertStateBadge state={state} />
            </td>
            <td className={styles.td}>
                <DeliveryStatusBadge status={notification.deliveryStatus} />
            </td>
            <td className={`${styles.td} ${styles.center}`}>
                <span className={styles.attempts}>{notification.deliveryAttempts}</span>
            </td>
            <td className={styles.td}>
                {error ? (
                    <span className={styles.error} title={error}>
                        {error.length > 60 ? error.slice(0, 60) + "…" : error}
                    </span>
                ) : (
                    <span className={styles.noError}>—</span>
                )}
            </td>
        </tr>
    );
}
