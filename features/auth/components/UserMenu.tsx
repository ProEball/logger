"use client";

import Link from "next/link";
import { Avatar, Popover } from "@/shared/components";
import { ThemeSwitcher } from "@/shared/components/AppShell/parts/ThemeSwitcher";
import { logoutAction } from "../actions/logout.action";
import styles from "./UserMenu.module.scss";

interface UserMenuProps {
    name: string;
    email: string;
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
                    Account
                </Link>
                <Link href="/account/sessions" className={styles.menuItem}>
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
                        Sign out
                    </button>
                </form>
            </div>
        </Popover>
    );
}
