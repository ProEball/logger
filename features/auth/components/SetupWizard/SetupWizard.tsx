"use client";
import { useRef, useEffect, useId, useState, useTransition } from "react";
import { GForm, GInput, GValidator } from "gform-react";
import type { GValidators } from "gform-react";
import { Button, FormField, Input } from "@/shared/components";
import type { setupAction } from "../../actions/setup.action";
import styles from "./SetupWizard.module.scss";

type SetupForm = {
    orgName: string;
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
};

interface SetupWizardProps {
    action: typeof setupAction;
}

const validators: GValidators<SetupForm> = {
    orgName: new GValidator<SetupForm>()
        .withRequiredMessage("Organization name is required")
        .withMinLengthMessage("At least 2 characters"),
    name: new GValidator<SetupForm>()
        .withRequiredMessage("Your name is required"),
    email: new GValidator<SetupForm>()
        .withRequiredMessage("Email is required")
        .withTypeMismatchMessage("Enter a valid email"),
    password: new GValidator<SetupForm>()
        .withRequiredMessage("Password is required")
        .withMinLengthMessage("At least 8 characters"),
    confirmPassword: new GValidator<SetupForm>()
        .withRequiredMessage("Please confirm your password")
        .withCustomValidation((input, fields) => {
            if (input.value !== fields.password.value) {
                input.errorText = "Passwords don't match";
                return true;
            }
            return false;
        }),
};

export function SetupWizard({ action }: SetupWizardProps) {
    const [isPending, startTransition] = useTransition();
    const [serverError, setServerError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const uid = useId();
    const ids = {
        orgName: `${uid}-orgName`,
        name: `${uid}-name`,
        email: `${uid}-email`,
        password: `${uid}-password`,
        confirmPassword: `${uid}-confirmPassword`,
    };

    // GForm only calls e.preventDefault() when state.isValid. Attach a native
    // listener so invalid submits never trigger the browser's GET fallback.
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
                <h1 className={styles.title}>Set up your workspace</h1>
                <p className={styles.subtitle}>Create your organization and owner account</p>
            </header>

            <GForm<SetupForm>
                ref={formRef}
                validators={validators}
                className={styles.form}
                onSubmit={(state) => {
                    if (state.isInvalid) return;
                    setServerError(null);
                    startTransition(async () => {
                        const result = await action(state.toRawData());
                        if (result.error) setServerError(result.error);
                    });
                }}
            >
                {(state) => (
                    <>
                        <section className={styles.section}>
                            <h2 className={styles.sectionTitle}>Organization</h2>

                            <GInput
                                formKey="orgName"
                                type="text"
                                required
                                minLength={2}
                                element={(input, props) => (
                                    <FormField
                                        label="Organization name"
                                        required
                                        htmlFor={ids.orgName}
                                        error={input.dirty && input.error ? input.errorText : undefined}
                                    >
                                        <Input
                                            {...props}
                                            id={ids.orgName}
                                            placeholder="Acme Inc."
                                            invalid={input.dirty && input.error}
                                        />
                                    </FormField>
                                )}
                            />
                        </section>

                        <section className={styles.section}>
                            <h2 className={styles.sectionTitle}>Your account</h2>

                            <GInput
                                formKey="name"
                                type="text"
                                required
                                element={(input, props) => (
                                    <FormField
                                        label="Full name"
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
                                minLength={8}
                                element={(input, props) => (
                                    <FormField
                                        label="Password"
                                        required
                                        htmlFor={ids.password}
                                        helper="At least 8 characters"
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
                        </section>

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
                                {isPending ? "Setting up…" : "Create workspace"}
                            </Button>
                        </div>
                    </>
                )}
            </GForm>
        </div>
    );
}
