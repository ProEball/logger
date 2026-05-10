import { CardSkeleton } from '@/shared/components/Skeletons/CardSkeleton';
import styles from './projects-loading.module.scss';

export default function Loading() {
    return (
        <div className={styles.grid}>
            {Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
    );
}
