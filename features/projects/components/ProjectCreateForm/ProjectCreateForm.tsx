"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, Input } from "@/shared/components";
import { SlugInput } from "../SlugInput/SlugInput";
import { slugify } from "@/features/projects/utils/slugify";
import { createProjectAction } from "@/features/projects/actions/create-project.action";
import styles from "./ProjectCreateForm.module.scss";

interface ProjectCreateFormProps {
    orgSlug: string;
}

export function ProjectCreateForm({ orgSlug }: ProjectCreateFormProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [slugError, setSlugError] = useState<string | null>(null);

    const handleSlugChange = useCallback((value: string) => {
        setSlug(value);
        setSlugError(null);
    }, []);

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setName(value);
        setError(null);
        if (!slug || slug === slugify(name)) {
            // Will be auto-updated by SlugInput
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        const slugPattern = /^[a-z0-9-]+$/;
        if (slug && !slugPattern.test(slug)) {
            setSlugError("Only lowercase letters, numbers, and hyphens are allowed.");
            return;
        }

        setError(null);
        startTransition(async () => {
            const result = await createProjectAction({ orgSlug, name: name.trim(), slug: slug || undefined });
            if ("error" in result) {
                if (result.error.includes("slug")) {
                    setSlugError(result.error);
                } else {
                    setError(result.error);
                }
                return;
            }
            router.push(`/${result.project.orgSlug}/${result.project.slug}`);
        });
    };

    const charCount = name.length;
    const showCounter = charCount > 60;

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <FormField
                label="Project name"
                required
                helper="Used in the UI and as the default for the slug below."
            >
                <div className={styles.nameField}>
                    <Input
                        value={name}
                        onChange={handleNameChange}
                        placeholder="My API Server"
                        disabled={isPending}
                        maxLength={80}
                        required
                    />
                    {showCounter && (
                        <span className={styles.counter}>{charCount} / 80</span>
                    )}
                </div>
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
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => router.push(`/${orgSlug}/projects`)}
                    disabled={isPending}
                >
                    Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={isPending || !name.trim()}>
                    {isPending ? "Creating…" : "Create project"}
                </Button>
            </div>
        </form>
    );
}
