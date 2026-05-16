import { AlertNotificationRow } from "@/features/alerts/components/history/AlertNotificationRow/AlertNotificationRow";
import type { AlertNotification } from "@/core/db/schema";
import styles from "./AlertHistoryTable.module.scss";

interface AlertHistoryTableProps {
    notifications: AlertNotification[];
    total: number;
}

function RefreshIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
    );
}

export function AlertHistoryTable({ notifications, total }: AlertHistoryTableProps) {
    const shown = notifications.length;

    return (
        <div className={styles.wrapper}>
            <div className={styles.tableHead}>
                <span className={styles.countLabel}>
                    {shown === total ? `${total} notifications` : `${shown} of ${total} notifications`}
                </span>
                <div className={styles.headActions}>
                    <button type="button" className={styles.headBtn}>
                        <RefreshIcon />Refresh
                    </button>
                    <button type="button" className={styles.headBtn}>
                        <DownloadIcon />Export
                    </button>
                </div>
            </div>

            {notifications.length === 0 ? (
                <div className={styles.empty}>No notifications yet</div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.th}>Triggered</th>
                                <th className={styles.th}>State</th>
                                <th className={styles.th}>Delivery</th>
                                <th className={styles.th} style={{ textAlign: "center" }}>Attempts</th>
                                <th className={styles.th}>Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {notifications.map((n) => (
                                <AlertNotificationRow key={n.id} notification={n} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
