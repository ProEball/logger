import { cx } from '@/shared/utils/cx';
import type { AlertState } from '@/features/alerts/components/AlertStateBadge/AlertStateBadge';
import { AlertStateBadge } from '@/features/alerts/components/AlertStateBadge/AlertStateBadge';
import styles from './AlertCard.module.scss';

export interface AlertCardProps {
    name: string;
    state: AlertState;
    condition?: string;
    lastTriggered?: string;
    channels?: number;
    className?: string;
}

export function AlertCard({ name, state, condition, lastTriggered, channels, className }: AlertCardProps) {
    return (
        <div className={cx(styles.card, styles[`card_${state}`], className)}>
            <div className={styles.head}>
                <h4 className={styles.title}>{name}</h4>
                <AlertStateBadge state={state} />
            </div>
            {condition ? (
                <div className={styles.condition}>
                    <ConditionCode code={condition} />
                </div>
            ) : null}
            <div className={styles.metaRow}>
                {lastTriggered ? (
                    <span className={styles.metaItem}>
                        <b>Last triggered</b> {lastTriggered}
                    </span>
                ) : null}
                {channels !== undefined ? (
                    <span className={styles.metaItem}>
                        <b>{channels}</b> {channels === 1 ? 'channel' : 'channels'}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function ConditionCode({ code }: { code: string }) {
    // Colorize simple threshold conditions like "rate > 50 per_min"
    const parts = code.split(/(\s+)/);
    return (
        <code className={styles.conditionCode}>
            {parts.map((part, i) => {
                if (/^[><=!]+$/.test(part)) {
                    return <span key={i} className={styles.condOp}>{part}</span>;
                }
                if (/^\d+(\.\d+)?$/.test(part)) {
                    return <span key={i} className={styles.condNum}>{part}</span>;
                }
                if (/^[a-z_][a-z0-9_.]*$/i.test(part) && part.length > 0 && !/^\s+$/.test(part)) {
                    return <span key={i} className={styles.condKey}>{part}</span>;
                }
                return part;
            })}
        </code>
    );
}
