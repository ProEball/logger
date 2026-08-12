"use client";
import { useEffect, useId, useState, useTransition } from "react";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input, Modal, Select } from "@/shared/components";
import { inviteMemberAction } from "@/features/organizations/actions/invite-member.action";
import styles from "./InviteMemberDialog.module.scss";

type InviteForm = { email: string };

const validators: GValidators<InviteForm> = {
    email: new GValidator<InviteForm>()
        .withRequiredMessage("Email is required")
        .withTypeMismatchMessage("Enter a valid email address"),
};

export type RoleOption = { id: string; name: string };

interface InviteMemberDialogProps {
    open: boolean;
    onClose: () => void;
    onCreated: (inviteUrl: string) => void;
    orgSlug: string;
    roles: RoleOption[];
}

export function InviteMemberDialog({
    open,
    onClose,
    onCreated,
    orgSlug,
    roles,
}: InviteMemberDialogProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
    const uid = useId();
    const ids = { email: `${uid}-email` };

    useEffect(() => {
        if (!open) {
            setServerError(null);
            setRoleId(roles[0]?.id ?? "");
        }
    }, [open, roles]);

    return (
        <Modal open={open} onClose={onClose} title="Invite member" size="sm">
            <div className={styles.body}>
                <GForm<InviteForm>
                    validators={validators}
                    className={styles.form}
                    onSubmit={(state, e) => {
                        e.preventDefault();
                        if (state.isInvalid) return;
                        setServerError(null);
                        startTransition(async () => {
                            const result = await inviteMemberAction({
                                orgSlug,
                                email: state.toRawData().email,
                                roleId,
                            });
                            if ("error" in result) {
                                setServerError(result.error);
                            } else {
                                onCreated(result.inviteUrl);
                            }
                        });
                    }}
                >
                    {() => (
                        <>
                            <GInput
                                formKey="email"
                                type="email"
                                required
                                element={(input, props) => (
                                    <FormField
                                        label="Email"
                                        required
                                        htmlFor={ids.email}
                                        error={input.dirty && input.error ? input.errorText : undefined}
                                    >
                                        <Input
                                            {...props}
                                            id={ids.email}
                                            placeholder="teammate@example.com"
                                            invalid={input.dirty && input.error}
                                        />
                                    </FormField>
                                )}
                            />

                            <FormField label="Role" htmlFor={`${uid}-role`}>
                                <Select
                                    id={`${uid}-role`}
                                    value={roleId}
                                    onChange={(e) => setRoleId(e.target.value)}
                                >
                                    {roles.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name}
                                        </option>
                                    ))}
                                </Select>
                            </FormField>

                            {serverError ? (
                                <p className={styles.serverError} role="alert">
                                    {serverError}
                                </p>
                            ) : null}

                            <div className={styles.footer}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={onClose}
                                    disabled={isPending}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" variant="primary" disabled={isPending}>
                                    {isPending ? "Sending…" : "Send invitation"}
                                </Button>
                            </div>
                        </>
                    )}
                </GForm>
            </div>
        </Modal>
    );
}
