import { Button } from "@/shared/components";
import { revokeInvitationAction } from "@/features/organizations/actions/revoke-invitation.action";
import type { PendingInvitation } from "@/features/organizations/services/organizations.service";
import styles from "./InvitationsList.module.scss";

interface InvitationsListProps {
    invitations: PendingInvitation[];
    orgSlug: string;
}

export function InvitationsList({ invitations, orgSlug }: InvitationsListProps) {
    if (invitations.length === 0) return null;

    return (
        <section className={styles.section}>
            <h2 className={styles.heading}>Pending invitations ({invitations.length})</h2>
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Expires</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {invitations.map((inv) => {
                            const revokeWithId = revokeInvitationAction.bind(null, inv.id, orgSlug);
                            return (
                                <tr key={inv.id}>
                                    <td>{inv.email}</td>
                                    <td className={styles.muted}>{inv.roleName}</td>
                                    <td className={styles.muted}>
                                        {inv.expiresAt.toLocaleDateString()}
                                    </td>
                                    <td className={styles.actions}>
                                        <form action={revokeWithId}>
                                            <Button type="submit" variant="ghost" size="sm">
                                                Revoke
                                            </Button>
                                        </form>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
