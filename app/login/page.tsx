import { AuthSplitLayout } from "@/features/auth/components/AuthSplitLayout/AuthSplitLayout";
import { LoginForm } from "@/features/auth/components/LoginForm/LoginForm";
import { loginAction } from "@/features/auth/actions/login.action";

export const metadata = { title: "Sign in — Logger" };

export default function LoginPage() {
    return (
        <AuthSplitLayout>
            <LoginForm action={loginAction} />
        </AuthSplitLayout>
    );
}
