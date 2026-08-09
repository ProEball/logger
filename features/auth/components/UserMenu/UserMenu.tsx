"use client";

import Link from "next/link";
import { Avatar, Popover } from "@/shared/components";
import { ThemeSwitcher } from "@/shared/components/AppShell/parts/ThemeSwitcher";
import { logoutAction } from "../../actions/logout.action";
import styles from "./UserMenu.module.scss";

interface UserMenuProps {
    name: string;
    email: string;
}

function IconUser() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}

function IconMonitor() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
        </svg>
    );
}

function IconLogOut() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
        </svg>
    );
}

export function UserMenu({ name, email }: UserMenuProps) {
    const trigger = (
        <button type="button" className={styles.trigger} aria-label="User menu">
            <Avatar name={name} size={28} />
            <span className={styles.triggerName}>{name}</span>
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
        <Popover trigger={trigger} placement="bottom-end" width={220}>
            <div className={styles.menu}>
                {/* Identity header */}
                <div className={styles.identity}>
                    <span className={styles.identityName}>{name}</span>
                    <span className={styles.identityEmail}>{email}</span>
                </div>

                <hr className={styles.divider} />

                {/* Nav links */}
                <Link href="/account" className={styles.menuItem}>
                    <IconUser />
                    Account
                </Link>
                <Link href="/account/sessions" className={styles.menuItem}>
                    <IconMonitor />
                    Sessions
                </Link>

                <hr className={styles.divider} />

                {/* Theme */}
                <div className={styles.themeRow}>
                    <span className={styles.themeLabel}>Theme</span>
                    <ThemeSwitcher />
                </div>

                <hr className={styles.divider} />

                {/* Sign out */}
                <form action={logoutAction} className={styles.signOutForm}>
                    <button type="submit" className={styles.signOutBtn}>
                        <IconLogOut />
                        Sign out
                    </button>
                </form>
            </div>
        </Popover>
    );
}
