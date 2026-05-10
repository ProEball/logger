import { AlertNotificationRow } from "@/features/alerts/components/history/AlertNotificationRow/AlertNotificationRow";
import { t } from "@/core/i18n/t";
import type { AlertNotification } from "@/core/db/schema";
import styles from "./AlertHistoryTable.module.scss";

interface AlertHistoryTableProps {
    notifications: AlertNotification[];
    total: number;
}

export function AlertHistoryTable({ notifications, total }: AlertHistoryTableProps) {
    if (notifications.length === 0) {
        return <p className={styles.empty}>{t("alerts.history.empty")}</p>;
    }

    return (
        <div className={styles.wrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{t("alerts.history.timestamp")}</th>
                        <th>{t("alerts.history.state")}</th>
                        <th>{t("alerts.history.delivery")}</th>
                        <th>{t("alerts.history.attempts")}</th>
                        <th>{t("alerts.history.error")}</th>
                    </tr>
                </thead>
                <tbody>
                    {notifications.map((n) => (
                        <AlertNotificationRow key={n.id} notification={n} />
                    ))}
                </tbody>
            </table>
            {total > notifications.length && (
                <p className={styles.moreNote}>
                    Showing {notifications.length} of {total}
                </p>
            )}
        </div>
    );
}
