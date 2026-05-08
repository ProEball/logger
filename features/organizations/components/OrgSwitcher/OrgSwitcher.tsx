"use client";

import { useRouter } from "next/navigation";
import { cx } from "@/shared/utils/cx";
import { Popover } from "@/shared/components";
import type { OrgSummary } from "@/features/organizations/services/organizations.service";
import styles from "./OrgSwitcher.module.scss";

interface OrgSwitcherProps {
    currentOrgSlug: string;
    currentOrgName: string;
    orgs: OrgSummary[];
}

export function OrgSwitcher({ currentOrgSlug, currentOrgName, orgs }: OrgSwitcherProps) {
    const router = useRouter();

    const trigger = (
        <button type="button" className={styles.trigger}>
            <span className={styles.orgDot}>{(currentOrgName[0] ?? "?").toUpperCase()}</span>
            <span className={styles.orgName}>{currentOrgName}</span>
            <svg
                className={styles.chevron}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
            >
                <path
                    d="M2 4.5l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    );

    return (
        <Popover trigger={trigger} placement="bottom-start" width={220}>
            <div className={styles.list}>
                {orgs.map((org) => (
                    <button
                        key={org.id}
                        type="button"
                        className={cx(styles.item, org.slug === currentOrgSlug && styles.itemActive)}
                        onClick={() => router.push(`/${org.slug}`)}
                    >
                        <span className={styles.itemDot}>{(org.name[0] ?? "?").toUpperCase()}</span>
                        <span className={styles.itemName}>{org.name}</span>
                        {org.slug === currentOrgSlug && (
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                                className={styles.checkIcon}
                                aria-hidden="true"
                            >
                                <path
                                    d="M2 6l3 3 5-5"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        )}
                    </button>
                ))}
            </div>
        </Popover>
    );
}
