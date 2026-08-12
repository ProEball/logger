"use client";
import { useRef, useEffect, useId, useState, useTransition } from "react";
import Link from "next/link";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input } from "@/shared/components";
import { PasswordField } from "../PasswordField/PasswordField";
import type { loginAction } from "../../actions/login.action";
import styles from "./LoginForm.module.scss";

type LoginForm = { email: string; password: string };

interface LoginFormProps {
    action: typeof loginAction;
}

const validators: GValidators<LoginForm> = {
    email: new GValidator<LoginForm>()
        .withRequiredMessage("Email is required")
        .withTypeMismatchMessage("Enter a valid email"),
    password: new GValidator<LoginForm>()
        .withRequiredMessage("Password is required"),
};

export function LoginForm({ action }: LoginFormProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const uid = useId();
    const ids = { email: `${uid}-email`, password: `${uid}-password` };

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
                <h1 className={styles.title}>Sign in</h1>
                <p className={styles.subtitle}>Welcome back</p>
            </header>

            <GForm<LoginForm>
                ref={formRef}
                validators={validators}
                className={styles.form}
                onSubmit={(state) => {
                    if (state.isInvalid) return;
                    setServerError(null);
                    startTransition(async () => {
                        const result = await action(state.toRawData());
                        if (result?.error) setServerError(result.error);
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

                        <GInput
                            formKey="password"
                            type="password"
                            required
                            element={(input, props) => (
                                <FormField
                                    label="Password"
                                    required
                                    htmlFor={ids.password}
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
                                {isPending ? "Signing in…" : "Sign in"}
                            </Button>
                            <Link href="/forgot-password" className={styles.forgotLink}>
                                Forgot your password?
                            </Link>
                        </div>
                    </>
                )}
            </GForm>
        </div>
    );
}
