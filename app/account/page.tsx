import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { AccountProfileForm } from "@/features/auth/components/AccountProfileForm";
import { ChangePasswordForm } from "@/features/auth/components/ChangePasswordForm";
import styles from "./page.module.scss";

export const metadata = { title: "Account — Logger" };

export default async function AccountPage() {
    const user = await getCurrentUser();
    if (!user) redirect("/login");

    return (
        <main className={styles.root}>
            <h1 className={styles.title}>Account</h1>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Profile</h2>
                <AccountProfileForm initialName={user.name} email={user.email} />
            </section>

            <hr className={styles.divider} />

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Change password</h2>
                <ChangePasswordForm />
            </section>
        </main>
    );
}
