import { cx } from '@/shared/utils/cx';
import { JsonNode } from './parts/JsonNode';
import styles from './JsonTree.module.scss';

export interface JsonTreeProps {
    data: unknown;
    expandDepth?: number;
    className?: string;
}

export function JsonTree({ data, expandDepth = 1, className }: JsonTreeProps) {
    return (
        <div className={cx(styles.tree, className)}>
            <JsonNode value={data} depth={0} expandDepth={expandDepth} />
        </div>
    );
}
