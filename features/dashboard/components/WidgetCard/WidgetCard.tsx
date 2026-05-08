import { Skeleton } from "@/shared/components";
import { WidgetEmpty } from "./parts/WidgetEmpty";
import styles from "./WidgetCard.module.scss";

interface WidgetCardProps {
    title: string;
    children: React.ReactNode;
    isEmpty?: boolean;
    isLoading?: boolean;
    footer?: React.ReactNode;
}

export function WidgetCard({ title, children, isEmpty, isLoading, footer }: WidgetCardProps) {
    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <h2 className={styles.title}>{title}</h2>
            </div>
            <div className={styles.body}>
                {isLoading ? (
                    <Skeleton height={160} />
                ) : isEmpty ? (
                    <WidgetEmpty />
                ) : (
                    children
                )}
            </div>
            {footer && <div className={styles.footer}>{footer}</div>}
        </div>
    );
}
