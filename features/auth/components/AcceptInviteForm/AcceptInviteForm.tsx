"use client";
import { useId, useState, useTransition } from "react";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input } from "@/shared/components";
import { PasswordField } from "../PasswordField/PasswordField";
import type { registerAndAcceptAction } from "@/features/organizations/actions/accept-invitation.action";
import styles from "./AcceptInviteForm.module.scss";

type AcceptForm = { name: string; password: string };

interface AcceptInviteFormProps {
    token: string;
    email: string;
    action: typeof registerAndAcceptAction;
}

const validators: GValidators<AcceptForm> = {
    name: new GValidator<AcceptForm>().withRequiredMessage("Name is required"),
    password: new GValidator<AcceptForm>()
        .withRequiredMessage("Password is required")
        .withMinLengthMessage("Password must be at least 8 characters"),
};

export function AcceptInviteForm({ token, email, action }: AcceptInviteFormProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const uid = useId();
    const ids = { name: `${uid}-name`, password: `${uid}-password` };

    return (
        <div className={styles.card}>
            <header className={styles.header}>
                <h1 className={styles.title}>Create your account</h1>
                <p className={styles.subtitle}>
                    You&apos;ve been invited to join. Your email is{" "}
                    <strong>{email}</strong>.
                </p>
            </header>

            <GForm<AcceptForm>
                validators={validators}
                className={styles.form}
                onSubmit={(state, e) => {
                    e.preventDefault();
                    if (state.isInvalid) return;
                    setServerError(null);
                    startTransition(async () => {
                        const result = await action({
                            token,
                            name: state.toRawData().name,
                            password: state.toRawData().password,
                        });
                        if (result?.error) setServerError(result.error);
                    });
                }}
            >
                {() => (
                    <>
                        <GInput
                            formKey="name"
                            type="text"
                            required
                            element={(input, props) => (
                                <FormField
                                    label="Your name"
                                    required
                                    htmlFor={ids.name}
                                    error={input.dirty && input.error ? input.errorText : undefined}
                                >
                                    <Input
                                        {...props}
                                        id={ids.name}
                                        placeholder="Jane Smith"
                                        invalid={input.dirty && input.error}
                                    />
                                </FormField>
                            )}
                        />

                        <GInput
                            formKey="password"
                            type="password"
                            required
                            minLength={8}
                            element={(input, props) => (
                                <FormField
                                    label="Password"
                                    required
                                    htmlFor={ids.password}
                                    helper="At least 8 characters"
                                    error={input.dirty && input.error ? input.errorText : undefined}
                                >
                                    <PasswordField
                                        {...props}
                                        id={ids.password}
                                        invalid={input.dirty && input.error}
                                    />
                                </FormField>
                            )}
                        />

                        <div className={styles.footer}>
                            {serverError ? (
                                <p className={styles.serverError} role="alert">
                                    {serverError}
                                </p>
                            ) : null}
                            <Button
                                type="submit"
                                variant="primary"
                                size="lg"
                                disabled={isPending}
                                rightIcon={
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                        <polyline points="12 5 19 12 12 19" />
                                    </svg>
                                }
                            >
                                {isPending ? "Creating account…" : "Create account & join"}
                            </Button>
                        </div>
                    </>
                )}
            </GForm>
        </div>
    );
}
