"use client";
import { useRef, useEffect, useId, useState, useTransition } from "react";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input } from "@/shared/components";
import type { resetPasswordAction } from "../actions/reset-password.action";
import styles from "./ResetPasswordForm.module.scss";

type ResetForm = { password: string; confirmPassword: string };

interface ResetPasswordFormProps {
    token: string;
    action: typeof resetPasswordAction;
}

const validators: GValidators<ResetForm> = {
    password: new GValidator<ResetForm>()
        .withRequiredMessage("Password is required")
        .withMinLengthMessage("Password must be at least 8 characters"),
    confirmPassword: new GValidator<ResetForm>()
        .withRequiredMessage("Please confirm your password"),
};

export function ResetPasswordForm({ token, action }: ResetPasswordFormProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const uid = useId();
    const ids = { password: `${uid}-password`, confirmPassword: `${uid}-confirmPassword` };

    useEffect(() => {
        const form = formRef.current;
        if (!form) return;
        const handler = (e: Event) => e.preventDefault();
        form.addEventListener("submit", handler);
        return () => form.removeEventListener("submit", handler);
    }, []);

    return (
        <div className={styles.card}>
            <header className={styles.header}>
                <h1 className={styles.title}>Set new password</h1>
                <p className={styles.subtitle}>Choose a strong password for your account.</p>
            </header>

            <GForm<ResetForm>
                ref={formRef}
                validators={validators}
                className={styles.form}
                onSubmit={(state) => {
                    if (state.isInvalid) return;
                    setServerError(null);
                    startTransition(async () => {
                        const data = state.toRawData();
                        const result = await action({
                            token,
                            password: data.password,
                            confirmPassword: data.confirmPassword,
                        });
                        if (result?.error) setServerError(result.error);
                    });
                }}
            >
                {() => (
                    <>
                        <GInput
                            formKey="password"
                            type="password"
                            required
                            minLength={8}
                            element={(input, props) => (
                                <FormField
                                    label="New password"
                                    required
                                    htmlFor={ids.password}
                                    error={input.dirty && input.error ? input.errorText : undefined}
                                >
                                    <Input
                                        {...props}
                                        id={ids.password}
                                        invalid={input.dirty && input.error}
                                    />
                                </FormField>
                            )}
                        />

                        <GInput
                            formKey="confirmPassword"
                            type="password"
                            required
                            element={(input, props) => (
                                <FormField
                                    label="Confirm password"
                                    required
                                    htmlFor={ids.confirmPassword}
                                    error={input.dirty && input.error ? input.errorText : undefined}
                                >
                                    <Input
                                        {...props}
                                        id={ids.confirmPassword}
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
                                disabled={isPending}
                            >
                                {isPending ? "Saving…" : "Set new password"}
                            </Button>
                        </div>
                    </>
                )}
            </GForm>
        </div>
    );
}
