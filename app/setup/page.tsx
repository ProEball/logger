import { AuthSplitLayout } from "@/features/auth/components/AuthSplitLayout/AuthSplitLayout";
import { SetupWizard } from "@/features/auth/components/SetupWizard/SetupWizard";
import { setupAction } from "@/features/auth/actions/setup.action";

export const metadata = { title: "Set up your workspace — Logger" };

export default function SetupPage() {
    return (
        <AuthSplitLayout>
            <SetupWizard action={setupAction} />
        </AuthSplitLayout>
    );
}
