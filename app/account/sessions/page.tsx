import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/config";
import { SessionsList } from "@/features/auth/components/SessionsList/SessionsList";
import type { SessionItem } from "@/features/auth/components/SessionsList/SessionsList";
import styles from "./page.module.scss";

export const metadata = { title: "Sessions — Logger" };

export default async function SessionsPage() {
    const h = await headers();

    const sessionData = await auth.api.getSession({ headers: h });
    if (!sessionData) redirect("/login");

    const rawSessions = await auth.api.listSessions({ headers: h });

    const sessions: SessionItem[] = rawSessions.map((s) => ({
        id: s.id,
        token: s.token,
        ipAddress: s.ipAddress ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: new Date(s.createdAt),
        expiresAt: new Date(s.expiresAt),
    }));

    // Sort: current first, then by most recently created
    sessions.sort((a, b) => {
        if (a.token === sessionData.session.token) return -1;
        if (b.token === sessionData.session.token) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return (
        <main className={styles.root}>
            <div className={styles.header}>
                <h1 className={styles.title}>Active sessions</h1>
                <p className={styles.subtitle}>
                    {sessions.length} active session{sessions.length === 1 ? '' : 's'}
                </p>
            </div>

            <SessionsList sessions={sessions} currentToken={sessionData.session.token} />
        </main>
    );
}
