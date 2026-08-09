import Link from "next/link";
import { CodeBlock } from "@/shared/components";
import { t } from "@/core/i18n/t";
import styles from "./EmptyProjectState.module.scss";

interface EmptyProjectStateProps {
    /** Project name shown in the heading. */
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    /**
     * API key prefix (e.g. "lgr_abc1") used in the curl example.
     * If not provided, step 1 prompts the user to create a key instead.
     */
    apiKeyPrefix?: string;
}

export function EmptyProjectState({ projectName, orgSlug, projectSlug, apiKeyPrefix }: EmptyProjectStateProps) {
    const hasKey = Boolean(apiKeyPrefix);
    const keyPlaceholder = hasKey ? `lgr_${apiKeyPrefix}...` : "<your-api-key>";
    const curlExample = `curl -X POST https://your-logger.example.com/api/ingest \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{"level":"info","message":"Hello, Logger!"}'`;
    const apiKeysHref = `/${orgSlug}/${projectSlug}/settings/api-keys`;
    const step1Body = hasKey
        ? t("dashboard.emptyProjectStep1BodyHasKey").replace("{{prefix}}", `lgr_${apiKeyPrefix}...`)
        : t("dashboard.emptyProjectStep1BodyNoKey");

    return (
        <div className={styles.root}>
            <div className={styles.icon} aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
            </div>
            <h2 className={styles.heading}>{projectName}</h2>
            <p className={styles.body}>{t("dashboard.emptyProject")}</p>

            <div className={styles.steps}>
                <div className={styles.step}>
                    <p className={styles.stepLabel}>{t("dashboard.emptyProjectStep1Title")}</p>
                    <p className={styles.stepBody}>{step1Body}</p>
                    <Link href={apiKeysHref} className={styles.ctaLink}>
                        {hasKey ? t("dashboard.emptyProjectManageKeys") : t("dashboard.emptyProjectCreateKey")}
                    </Link>
                </div>

                <div className={styles.step}>
                    <p className={styles.stepLabel}>{t("dashboard.emptyProjectStep2Title")}</p>
                    <CodeBlock language="bash" code={curlExample} />
                </div>
            </div>
        </div>
    );
}
