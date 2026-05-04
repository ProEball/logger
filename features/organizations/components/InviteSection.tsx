"use client";
import { useState } from "react";
import { Button } from "@/shared/components";
import { InviteMemberDialog, type RoleOption } from "./InviteMemberDialog";
import { InvitationCreatedDialog } from "./InvitationCreatedDialog";
import styles from "./InviteSection.module.scss";

interface InviteSectionProps {
    orgSlug: string;
    roles: RoleOption[];
}

type DialogState = "closed" | "invite" | "created";

export function InviteSection({ orgSlug, roles }: InviteSectionProps) {
    const [dialog, setDialog] = useState<DialogState>("closed");
    const [inviteUrl, setInviteUrl] = useState("");

    const handleCreated = (url: string) => {
        setInviteUrl(url);
        setDialog("created");
    };

    const handleClose = () => setDialog("closed");

    return (
        <div className={styles.root}>
            <Button variant="primary" onClick={() => setDialog("invite")}>
                Invite member
            </Button>

            <InviteMemberDialog
                open={dialog === "invite"}
                onClose={handleClose}
                onCreated={handleCreated}
                orgSlug={orgSlug}
                roles={roles}
            />

            <InvitationCreatedDialog
                open={dialog === "created"}
                onClose={handleClose}
                inviteUrl={inviteUrl}
            />
        </div>
    );
}
