import styles from "./DeliveryStatusBadge.module.scss";

type DeliveryStatus = "pending" | "delivered" | "failed";

interface DeliveryStatusBadgeProps {
    status: string;
}

export function DeliveryStatusBadge({ status }: DeliveryStatusBadgeProps) {
    const s = (["pending", "delivered", "failed"].includes(status)
        ? status
        : "pending") as DeliveryStatus;
    return <span className={`${styles.badge} ${styles[s]}`}>{s}</span>;
}
