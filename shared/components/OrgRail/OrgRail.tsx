import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/shared/utils/cx";
import styles from "./OrgRail.module.scss";

export interface OrgRailOrg {
    slug: string;
    name: string;
}

export interface OrgRailProps {
    orgs: OrgRailOrg[];
    currentOrgSlug: string;
    bottom?: ReactNode;
}

export function OrgRail({ orgs, currentOrgSlug, bottom }: OrgRailProps) {
    return (
        <nav className={styles.rail} aria-label="Organization switcher">
            <div className={styles.logo} aria-hidden="true" />
            <div className={styles.divider} role="separator" />
            <div className={styles.pills}>
                {orgs.map((org) => (
                    <Link
                        key={org.slug}
                        href={`/${org.slug}`}
                        className={cx(
                            styles.pill,
                            org.slug === currentOrgSlug && styles.pillActive,
                        )}
                        title={org.name}
                        aria-current={org.slug === currentOrgSlug ? "page" : undefined}
                    >
                        {org.name.charAt(0).toUpperCase()}
                    </Link>
                ))}
            </div>
            {bottom ? (
                <>
                    <div className={styles.divider} role="separator" />
                    <div className={styles.bottom}>{bottom}</div>
                </>
            ) : null}
        </nav>
    );
}
