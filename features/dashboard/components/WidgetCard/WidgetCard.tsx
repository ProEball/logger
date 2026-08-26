import { Skeleton } from "@/shared/components";
import { WidgetEmpty } from "./parts/WidgetEmpty";
import styles from "./WidgetCard.module.scss";

interface WidgetCardProps {
    title: string;
    children: React.ReactNode;
    isEmpty?: boolean;
    isLoading?: boolean;
    footer?: React.ReactNode;
    actions?: React.ReactNode;
}

/**
 * A titled panel.
 *
 * `section` with an accessible name rather than a bare `div`: that makes it a
 * landmark, so a screen reader can jump between widgets and a test can address
 * one by role and name — which is what `PROJECT.md` §11 asks for and what the
 * dashboard e2e had no way to do while every card was an anonymous `div`.
 */
export function WidgetCard({ title, children, isEmpty, isLoading, footer, actions }: WidgetCardProps) {
    return (
        <section className={styles.card} aria-label={title}>
            <div className={styles.header}>
                <h2 className={styles.title}>{title}</h2>
                {actions && <div className={styles.actions}>{actions}</div>}
            </div>
            <div className={styles.body}>
                {isLoading ? (
                    <Skeleton height={160} />
                ) : isEmpty ? (
                    <WidgetEmpty />
                ) : (
                    children
                )}
            </div>
            {footer && <div className={styles.footer}>{footer}</div>}
        </section>
    );
}
