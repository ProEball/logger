"use client";
import Link from "next/link";
import styles from "./SaveBar.module.scss";

interface SaveBarProps {
    orgSlug: string;
    projectSlug: string;
    isPending: boolean;
    isEdit: boolean;
    onTestFire?: () => void;
}

function SendIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
    );
}

export function SaveBar({ orgSlug, projectSlug, isPending, isEdit, onTestFire }: SaveBarProps) {
    return (
        <div className={styles.bar}>
            <Link href={`/${orgSlug}/${projectSlug}/alerts`} className={styles.cancelLink}>
                Cancel
            </Link>

            <div className={styles.actions}>
                {isEdit && onTestFire && (
                    <button type="button" className={styles.testBtn} onClick={onTestFire} disabled={isPending}>
                        <SendIcon />Send test
                    </button>
                )}
                <button type="submit" className={styles.saveBtn} disabled={isPending}>
                    {isPending ? "Saving…" : "Save rule"}
                </button>
            </div>
        </div>
    );
}
