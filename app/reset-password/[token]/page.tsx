import { ResetPasswordForm } from "@/features/auth/components/ResetPasswordForm";
import { resetPasswordAction } from "@/features/auth/actions/reset-password.action";
import styles from "./page.module.scss";

export const metadata = { title: "Set new password — Logger" };

interface ResetPasswordPageProps {
    params: Promise<{ token: string }>;
}

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
    const { token } = await params;

    return (
        <main className={styles.root}>
            <ResetPasswordForm token={token} action={resetPasswordAction} />
        </main>
    );
}
