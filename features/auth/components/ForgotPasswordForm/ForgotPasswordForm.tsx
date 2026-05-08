"use client";
import { useRef, useEffect, useId, useState, useTransition } from "react";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input } from "@/shared/components";
import type { requestPasswordResetAction } from "../actions/request-password-reset.action";
import styles from "./ForgotPasswordForm.module.scss";

type ForgotForm = { email: string };

interface ForgotPasswordFormProps {
    action: typeof requestPasswordResetAction;
}

const validators: GValidators<ForgotForm> = {
    email: new GValidator<ForgotForm>()
        .withRequiredMessage("Email is required")
        .withTypeMismatchMessage("Enter a valid email"),
};

export function ForgotPasswordForm({ action }: ForgotPasswordFormProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);
    const uid = useId();
    const ids = { email: `${uid}-email` };

    useEffect(() => {
        const form = formRef.current;
        if (!form) return;
        const handler = (e: Event) => e.preventDefault();
        form.addEventListener("submit", handler);
        return () => form.removeEventListener("submit", handler);
    }, []);

    if (submitted) {
        return (
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Check your email</h1>
                    <p className={styles.subtitle}>
                        If that email is registered, you&apos;ll find a reset link waiting for you.
                    </p>
                </header>
                <a href="/login" className={styles.backLink}>
                    Back to sign in
                </a>
            </div>
        );
    }

    return (
        <div className={styles.card}>
            <header className={styles.header}>
                <h1 className={styles.title}>Reset password</h1>
                <p className={styles.subtitle}>
                    Enter your email and we&apos;ll send you a reset link.
                </p>
            </header>

            <GForm<ForgotForm>
                ref={formRef}
                validators={validators}
                className={styles.form}
                onSubmit={(state) => {
                    if (state.isInvalid) return;
                    setServerError(null);
                    startTransition(async () => {
                        const result = await action(state.toRawData());
                        if (result?.error) {
                            setServerError(result.error);
                        } else {
                            setSubmitted(true);
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
                                        placeholder="jane@example.com"
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
                                {isPending ? "Sending…" : "Send reset link"}
                            </Button>
                            <a href="/login" className={styles.backLink}>
                                Back to sign in
                            </a>
                        </div>
                    </>
                )}
            </GForm>
        </div>
    );
}
