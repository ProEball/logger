import { SetupWizard } from "@/features/auth/components/SetupWizard";
import { setupAction } from "@/features/auth/actions/setup.action";
import styles from "./page.module.scss";

export const metadata = { title: "Set up your workspace — Logger" };

export default function SetupPage() {
    return (
        <main className={styles.root}>
            <SetupWizard action={setupAction} />
        </main>
    );
}
