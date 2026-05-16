import styles from "./AlertStateBadge.module.scss";

export type AlertState = "ok" | "firing" | "disabled";

interface AlertStateBadgeProps {
    state: AlertState;
}

export function AlertStateBadge({ state }: AlertStateBadgeProps) {
    return (
        <span className={`${styles.badge} ${styles[state]}`}>
            {state}
        </span>
    );
}
