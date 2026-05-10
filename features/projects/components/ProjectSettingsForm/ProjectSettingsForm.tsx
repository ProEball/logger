"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, Input } from "@/shared/components";
import { SlugInput } from "../SlugInput/SlugInput";
import { useToast } from "@/shared/components/Toast/ToastProvider";
import { updateProjectAction } from "@/features/projects/actions/update-project.action";
import styles from "./ProjectSettingsForm.module.scss";

interface ProjectSettingsFormProps {
    orgSlug: string;
    projectSlug: string;
    projectName: string;
}

export function ProjectSettingsForm({ orgSlug, projectSlug, projectName }: ProjectSettingsFormProps) {
    const router = useRouter();
    const toast = useToast();
    const [isPending, startTransition] = useTransition();

    const [name, setName] = useState(projectName);
    const [slug, setSlug] = useState(projectSlug);
    const [error, setError] = useState<string | null>(null);
    const [slugError, setSlugError] = useState<string | null>(null);

    const isDirty = name !== projectName || slug !== projectSlug;

    const handleSlugChange = useCallback((value: string) => {
        setSlug(value);
        setSlugError(null);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const slugPattern = /^[a-z0-9-]+$/;
        if (!slugPattern.test(slug)) {
            setSlugError("Only lowercase letters, numbers, and hyphens are allowed.");
            return;
        }

        startTransition(async () => {
            const result = await updateProjectAction({
                orgSlug,
                projectSlug,
                name: name !== projectName ? name : undefined,
                newSlug: slug !== projectSlug ? slug : undefined,
            });
            if ("error" in result) {
                if (result.error.includes("slug")) {
                    setSlugError(result.error);
                } else {
                    setError(result.error);
                }
                return;
            }
            if (result.newSlug) {
                router.replace(`/${orgSlug}/${result.newSlug}/settings`);
                return;
            }
            toast.push({ variant: 'success', title: 'Project settings saved' });
        });
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <FormField label="Project name" required>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My API Server"
                    disabled={isPending}
                    maxLength={80}
                    required
                />
            </FormField>

            <FormField label="Slug" required>
                <SlugInput
                    name={name}
                    value={slug}
                    onChange={handleSlugChange}
                    orgSlug={orgSlug}
                    disabled={isPending}
                    error={slugError ?? undefined}
                />
            </FormField>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
                <Button variant="primary" type="submit" disabled={isPending || !isDirty}>
                    {isPending ? "Saving…" : "Save changes"}
                </Button>
            </div>
        </form>
    );
}
