import { Skeleton } from "@/shared/components/Skeleton/Skeleton";
import styles from "./Skeletons.module.scss";

interface ListSkeletonProps {
    rows?: number;
}

export function ListSkeleton({ rows = 6 }: ListSkeletonProps) {
    return (
        <div className={styles.list} role="status" aria-label="Loading">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={styles.listRow}>
                    <Skeleton width={32} height={32} radius={16} />
                    <div className={styles.listContent}>
                        <Skeleton width={150} height={14} />
                        <Skeleton width={100} height={12} />
                    </div>
                    <Skeleton width={72} height={14} />
                </div>
            ))}
        </div>
    );
}
