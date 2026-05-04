import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";
import { requestPasswordResetAction } from "@/features/auth/actions/request-password-reset.action";
import styles from "./page.module.scss";

export const metadata = { title: "Reset password — Logger" };

export default function ForgotPasswordPage() {
    return (
        <main className={styles.root}>
            <ForgotPasswordForm action={requestPasswordResetAction} />
        </main>
    );
}
