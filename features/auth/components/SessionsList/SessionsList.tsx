'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { revokeSessionAction } from '@/features/auth/actions/revoke-session.action';
import styles from './SessionsList.module.scss';

export interface SessionItem {
    id: string;
    token: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
}

interface SessionsListProps {
    sessions: SessionItem[];
    currentToken: string;
}

function formatDate(d: Date): string {
    return new Date(d).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

function shortUA(ua: string | null): string {
    if (!ua) return 'Unknown device';
    // Extract browser / OS hint from the UA string
    if (ua.includes('Chrome')) return ua.includes('Mobile') ? 'Chrome (mobile)' : 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return ua.includes('Mobile') ? 'Safari (mobile)' : 'Safari';
    if (ua.includes('Edge') || ua.includes('Edg/')) return 'Edge';
    return ua.slice(0, 40);
}

export function SessionsList({ sessions, currentToken }: SessionsListProps) {
    const router = useRouter();
    const [revokingToken, setRevokingToken] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isPending, startTransition] = useTransition();

    const handleRevoke = (token: string) => {
        setRevokingToken(token);
        setErrors((prev) => { const next = { ...prev }; delete next[token]; return next; });
        startTransition(async () => {
            const result = await revokeSessionAction({ token });
            setRevokingToken(null);
            if (result.error) {
                setErrors((prev) => ({ ...prev, [token]: result.error! }));
                return;
            }
            router.refresh();
        });
    };

    return (
        <div className={styles.wrap}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Device</th>
                        <th>IP address</th>
                        <th>Started</th>
                        <th>Expires</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {sessions.map((s) => {
                        const isCurrent = s.token === currentToken;
                        const isRevoking = revokingToken === s.token && isPending;
                        return (
                            <tr key={s.id} className={isCurrent ? styles.currentRow : undefined}>
                                <td>
                                    <span className={styles.device}>{shortUA(s.userAgent)}</span>
                                    {isCurrent ? (
                                        <span className={styles.currentBadge}>This session</span>
                                    ) : null}
                                    {errors[s.token] ? (
                                        <span className={styles.rowError}>{errors[s.token]}</span>
                                    ) : null}
                                </td>
                                <td className={styles.muted}>{s.ipAddress ?? '—'}</td>
                                <td className={styles.muted}>{formatDate(s.createdAt)}</td>
                                <td className={styles.muted}>{formatDate(s.expiresAt)}</td>
                                <td className={styles.actionsCell}>
                                    {!isCurrent ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRevoke(s.token)}
                                            disabled={isRevoking}
                                        >
                                            {isRevoking ? 'Revoking…' : 'Revoke'}
                                        </Button>
                                    ) : null}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
