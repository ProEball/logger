import { Skeleton } from "@/shared/components/Skeleton/Skeleton";
import styles from "./Skeletons.module.scss";

export function WidgetSkeleton() {
    return (
        <div className={styles.widget} role="status" aria-label="Loading">
            <Skeleton width={130} height={16} />
            <Skeleton height={160} />
        </div>
    );
}
