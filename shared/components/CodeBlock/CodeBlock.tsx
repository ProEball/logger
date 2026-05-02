import { cx } from '@/shared/utils/cx';
import { CopyButton } from './parts/CopyButton';
import styles from './CodeBlock.module.scss';

export interface CodeBlockProps {
    code: string;
    language?: string;
    showLineNumbers?: boolean;
    highlightLines?: number[];
    copyable?: boolean;
    className?: string;
}

export function CodeBlock({
    code,
    language,
    showLineNumbers = true,
    highlightLines,
    copyable = true,
    className,
}: CodeBlockProps) {
    const lines = code.split('\n');
    const highlights = new Set(highlightLines);

    return (
        <div className={cx(styles.block, className)}>
            {(language || copyable) && (
                <div className={styles.header}>
                    <span className={styles.lang}>{language ?? ''}</span>
                    {copyable ? <CopyButton text={code} /> : null}
                </div>
            )}
            <div className={styles.body}>
                {lines.map((line, idx) => {
                    const lineNumber = idx + 1;
                    return (
                        <div
                            key={idx}
                            className={cx(styles.line, highlights.has(lineNumber) && styles.highlight)}
                        >
                            {showLineNumbers ? (
                                <span className={styles.ln}>{lineNumber}</span>
                            ) : null}
                            <span className={styles.lc}>{line || ' '}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
