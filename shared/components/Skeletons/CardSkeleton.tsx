import { Skeleton } from "@/shared/components/Skeleton/Skeleton";
import styles from "./Skeletons.module.scss";

export function CardSkeleton() {
    return (
        <div className={styles.card} role="status" aria-label="Loading">
            <Skeleton width={40} height={40} radius={8} />
            <div className={styles.cardContent}>
                <Skeleton width={140} height={16} />
                <Skeleton width={200} height={13} />
                <Skeleton height={13} />
            </div>
        </div>
    );
}
