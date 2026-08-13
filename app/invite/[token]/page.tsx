import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/config";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { invitations } from "@/core/db/schema";
import { AuthSplitLayout } from "@/features/auth/components/AuthSplitLayout/AuthSplitLayout";
import { AcceptInviteForm } from "@/features/auth/components/AcceptInviteForm/AcceptInviteForm";
import { AcceptButton } from "@/features/organizations/components/AcceptButton/AcceptButton";
import {
    acceptInvitationAction,
    registerAndAcceptAction,
} from "@/features/organizations/actions/accept-invitation.action";
import { Button } from "@/shared/components";
import styles from "./page.module.scss";

interface InvitePageProps {
    params: Promise<{ token: string }>;
}

export const metadata = { title: "You've been invited — Logger" };

export default async function InvitePage({ params }: InvitePageProps) {
    const { token } = await params;

    const [invite] = await db
        .select({
            id: invitations.id,
            email: invitations.email,
            expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
        .limit(1);

    if (!invite || invite.expiresAt < new Date()) {
        return (
            <AuthSplitLayout>
                <div className={styles.card}>
                    <header className={styles.header}>
                        <h1 className={styles.title}>Invitation not found</h1>
                        <p className={styles.subtitle}>
                            This link is invalid or has already expired. Ask the sender to create a
                            new invitation.
                        </p>
                    </header>
                    <div className={styles.body}>
                        <Link href="/login" className={styles.link}>
                            Go to sign in
                        </Link>
                    </div>
                </div>
            </AuthSplitLayout>
        );
    }

    const user = await getCurrentUser();

    // Logged-in, email matches → accept button (client component for pending + error state)
    if (user && user.email.toLowerCase() === invite.email.toLowerCase()) {
        const acceptFn = acceptInvitationAction.bind(null, token);
        return (
            <AuthSplitLayout>
                <div className={styles.card}>
                    <header className={styles.header}>
                        <h1 className={styles.title}>You&apos;re invited</h1>
                        <p className={styles.subtitle}>
                            You&apos;ve been invited to join as <strong>{invite.email}</strong>.
                        </p>
                    </header>
                    <div className={styles.body}>
                        <AcceptButton action={acceptFn} />
                    </div>
                </div>
            </AuthSplitLayout>
        );
    }

    // Logged-in with different email → hint to sign out
    if (user) {
        return (
            <AuthSplitLayout>
                <div className={styles.card}>
                    <header className={styles.header}>
                        <h1 className={styles.title}>Wrong account</h1>
                        <p className={styles.subtitle}>
                            This invitation is for <strong>{invite.email}</strong>. You&apos;re
                            signed in as <strong>{user.email}</strong>.
                        </p>
                        <p className={styles.subtitle}>
                            Sign out and open this link again, or ask for a new invitation for your
                            current email.
                        </p>
                    </header>
                    <div className={styles.body}>
                        <form
                            action={async () => {
                                "use server";
                                await auth.api.signOut({ headers: await headers() });
                                redirect(`/invite/${token}`);
                            }}
                        >
                            <Button type="submit" variant="ghost">
                                Sign out and continue
                            </Button>
                        </form>
                    </div>
                </div>
            </AuthSplitLayout>
        );
    }

    // Not logged in → registration form
    return (
        <AuthSplitLayout>
            <AcceptInviteForm token={token} email={invite.email} action={registerAndAcceptAction} />
        </AuthSplitLayout>
    );
}
