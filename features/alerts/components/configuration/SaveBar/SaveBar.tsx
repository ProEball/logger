"use client";
import Link from "next/link";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import styles from "./SaveBar.module.scss";

interface SaveBarProps {
    orgSlug: string;
    projectSlug: string;
    isPending: boolean;
    isEdit: boolean;
}

export function SaveBar({ orgSlug, projectSlug, isPending, isEdit }: SaveBarProps) {
    return (
        <div className={styles.bar}>
            <div className={styles.left}>
                <Link
                    href={`/${orgSlug}/${projectSlug}/alerts`}
                    className={styles.cancelLink}
                >
                    {t("common.cancel")}
                </Link>
            </div>
            <div className={styles.right}>
                <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving..." : t("common.save")}
                </Button>
            </div>
        </div>
    );
}
