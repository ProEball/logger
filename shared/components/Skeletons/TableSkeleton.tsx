import { Skeleton } from "@/shared/components/Skeleton/Skeleton";
import styles from "./Skeletons.module.scss";

interface TableSkeletonProps {
    rows?: number;
}

export function TableSkeleton({ rows = 8 }: TableSkeletonProps) {
    return (
        <div className={styles.table} role="status" aria-label="Loading">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={styles.tableRow}>
                    <Skeleton width={52} height={20} radius={4} />
                    <Skeleton className={styles.tableColFill} height={14} />
                    <Skeleton width={88} height={14} />
                    <Skeleton width={68} height={14} />
                </div>
            ))}
        </div>
    );
}
