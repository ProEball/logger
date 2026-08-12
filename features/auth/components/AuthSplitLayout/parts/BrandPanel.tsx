import styles from "./BrandPanel.module.scss";

const FEATURES = [
    { dot: "cyan", text: "Stream and filter logs in real time" },
    { dot: "orange", text: "Set alerts before issues become incidents" },
    { dot: "purple", text: "Explore the full event timeline" },
] as const;

export function BrandPanel() {
    return (
        <aside className={styles.panel}>
            <div className={styles.inner}>
                <div className={styles.mark}>
                    <span className={styles.prompt}>
                        &gt;<span className={styles.caret} />
                    </span>
                </div>
                <div className={styles.name}>Logger</div>
                <p className={styles.tag}>Real-time observability for engineering teams</p>

                <div className={styles.featureList}>
                    {FEATURES.map((feature) => (
                        <div key={feature.text} className={styles.feature}>
                            <span className={`${styles.fdot} ${styles[feature.dot]}`} />
                            {feature.text}
                        </div>
                    ))}
                </div>
            </div>

            <div className={styles.version}>
                <span className={styles.vchip}>v1.0</span>
            </div>
        </aside>
    );
}
