import { JsonTree } from "@/shared/components/JsonTree/JsonTree";
import { t } from "@/core/i18n/t";
import styles from "./ContextTree.module.scss";

interface ContextTreeProps {
    context: unknown;
}

export function ContextTree({ context }: ContextTreeProps) {
    const isEmpty =
        context == null ||
        (typeof context === "object" && Object.keys(context as object).length === 0);

    if (isEmpty) {
        return <p className={styles.empty}>{t("events.detail.noContext")}</p>;
    }

    return (
        <div className={styles.wrap}>
            <JsonTree data={context} expandDepth={2} />
        </div>
    );
}
