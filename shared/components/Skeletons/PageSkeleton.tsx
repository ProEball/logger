import { Skeleton } from "@/shared/components/Skeleton/Skeleton";
import styles from "./Skeletons.module.scss";

export function PageSkeleton() {
    return (
        <div className={styles.page} role="status" aria-label="Loading">
            <div className={styles.pageHeading}>
                <Skeleton width={220} height={28} />
                <Skeleton width={140} height={14} />
            </div>
            <div className={styles.pageSection}>
                <Skeleton height={36} />
            </div>
            <div className={styles.pageSection}>
                {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} height={44} />
                ))}
            </div>
        </div>
    );
}
