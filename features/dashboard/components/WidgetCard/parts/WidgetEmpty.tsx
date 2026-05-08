import { t } from "@/core/i18n/t";
import styles from "./WidgetEmpty.module.scss";

export function WidgetEmpty() {
    return (
        <div className={styles.empty}>
            <p className={styles.text}>{t("dashboard.empty")}</p>
        </div>
    );
}
