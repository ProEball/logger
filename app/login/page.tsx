import { LoginForm } from "@/features/auth/components/LoginForm";
import { loginAction } from "@/features/auth/actions/login.action";
import styles from "./page.module.scss";

export const metadata = { title: "Sign in — Logger" };

export default function LoginPage() {
    return (
        <main className={styles.root}>
            <LoginForm action={loginAction} />
        </main>
    );
}
