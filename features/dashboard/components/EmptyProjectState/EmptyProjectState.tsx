import { CodeBlock } from "@/shared/components";
import { t } from "@/core/i18n/t";
import styles from "./EmptyProjectState.module.scss";

interface EmptyProjectStateProps {
    /** Project name shown in the heading. */
    projectName: string;
    /**
     * API key prefix (e.g. "lgr_abc1") used in the curl example.
     * If not provided, a placeholder is shown instead.
     */
    apiKeyPrefix?: string;
}

export function EmptyProjectState({ projectName, apiKeyPrefix }: EmptyProjectStateProps) {
    const keyPlaceholder = apiKeyPrefix ? `lgr_${apiKeyPrefix}...` : "<your-api-key>";
    const curlExample = `curl -X POST https://your-logger.example.com/api/ingest \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{"level":"info","message":"Hello, Logger!"}'`;

    return (
        <div className={styles.root}>
            <div className={styles.icon} aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
            </div>
            <h2 className={styles.heading}>{projectName}</h2>
            <p className={styles.body}>{t("dashboard.emptyProject")}</p>
            <div className={styles.example}>
                <p className={styles.exampleLabel}>{t("dashboard.emptyProjectCta")}</p>
                <CodeBlock language="bash" code={curlExample} />
            </div>
        </div>
    );
}
