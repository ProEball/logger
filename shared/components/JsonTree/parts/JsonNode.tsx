import { cx } from '@/shared/utils/cx';
import styles from '../JsonTree.module.scss';

export interface JsonNodeProps {
    value: unknown;
    depth: number;
    expandDepth: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function Primitive({ value }: { value: unknown }) {
    if (value === null) {
        return <span className={styles.null}>null</span>;
    }
    if (value === undefined) {
        return <span className={styles.null}>undefined</span>;
    }
    if (typeof value === 'boolean') {
        return <span className={styles.boolean}>{String(value)}</span>;
    }
    if (typeof value === 'number') {
        return <span className={styles.number}>{value}</span>;
    }
    if (typeof value === 'string') {
        return <span className={styles.string}>&quot;{value}&quot;</span>;
    }
    return <span className={styles.text}>{String(value)}</span>;
}

export function JsonNode({ value, depth, expandDepth }: JsonNodeProps) {
    if (Array.isArray(value)) {
        return <ArrayNode value={value} depth={depth} expandDepth={expandDepth} />;
    }
    if (isPlainObject(value)) {
        return <ObjectNode value={value} depth={depth} expandDepth={expandDepth} />;
    }
    return <Primitive value={value} />;
}

interface ContainerProps<T> {
    value: T;
    depth: number;
    expandDepth: number;
}

function ObjectNode({ value, depth, expandDepth }: ContainerProps<Record<string, unknown>>) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
        return <span className={styles.text}>{'{}'}</span>;
    }
    const label = entries.length === 1 ? 'key' : 'keys';
    return (
        <details className={styles.node} open={depth < expandDepth}>
            <summary className={styles.summary}>
                <span className={styles.chevron} aria-hidden>
                    ▶
                </span>
                <span className={styles.brace}>{'{'}</span>
                <span className={styles.hint}>
                    {entries.length} {label}
                </span>
                <span className={cx(styles.brace, styles.collapsedTail)}>{'}'}</span>
            </summary>
            <ul className={styles.children}>
                {entries.map(([k, v]) => (
                    <li key={k} className={styles.row}>
                        <span className={styles.property}>&quot;{k}&quot;</span>
                        <span className={styles.colon}>:</span>{' '}
                        <JsonNode value={v} depth={depth + 1} expandDepth={expandDepth} />
                    </li>
                ))}
            </ul>
            <span className={styles.brace}>{'}'}</span>
        </details>
    );
}

function ArrayNode({ value, depth, expandDepth }: ContainerProps<unknown[]>) {
    if (value.length === 0) {
        return <span className={styles.text}>[]</span>;
    }
    const label = value.length === 1 ? 'item' : 'items';
    return (
        <details className={styles.node} open={depth < expandDepth}>
            <summary className={styles.summary}>
                <span className={styles.chevron} aria-hidden>
                    ▶
                </span>
                <span className={styles.brace}>[</span>
                <span className={styles.hint}>
                    {value.length} {label}
                </span>
                <span className={cx(styles.brace, styles.collapsedTail)}>]</span>
            </summary>
            <ul className={styles.children}>
                {value.map((v, i) => (
                    <li key={i} className={styles.row}>
                        <span className={styles.indexKey}>{i}</span>
                        <span className={styles.colon}>:</span>{' '}
                        <JsonNode value={v} depth={depth + 1} expandDepth={expandDepth} />
                    </li>
                ))}
            </ul>
            <span className={styles.brace}>]</span>
        </details>
    );
}

