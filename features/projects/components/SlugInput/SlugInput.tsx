"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/shared/components";
import { slugify } from "@/features/projects/utils/slugify";
import styles from "./SlugInput.module.scss";

interface SlugInputProps {
    name: string;
    value: string;
    onChange: (slug: string) => void;
    orgSlug: string;
    disabled?: boolean;
    error?: string;
}

export function SlugInput({ name, value, onChange, orgSlug, disabled, error }: SlugInputProps) {
    const [locked, setLocked] = useState(true);
    const [internalValue, setInternalValue] = useState(value);
    const prevName = useRef(name);

    useEffect(() => {
        if (!locked) return;
        if (name === prevName.current) return;
        prevName.current = name;
        const generated = slugify(name);
        setInternalValue(generated);
        onChange(generated);
    }, [name, locked, onChange]);

    // Mirror the controlled `value` prop into local state during render rather
    // than from an effect, so a parent-driven change never renders stale text.
    const [prevValue, setPrevValue] = useState(value);
    if (prevValue !== value) {
        setPrevValue(value);
        setInternalValue(value);
    }

    const handleUnlock = () => setLocked(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        setInternalValue(raw);
        onChange(raw);
    };

    return (
        <div className={styles.root}>
            <div className={styles.inputRow}>
                <Input
                    value={internalValue}
                    onChange={handleChange}
                    disabled={disabled || locked}
                    placeholder="my-project"
                    aria-label="Project slug"
                    className={styles.input}
                />
                {locked && (
                    <button
                        type="button"
                        className={styles.editBtn}
                        onClick={handleUnlock}
                        aria-label="Edit slug"
                        disabled={disabled}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                    </button>
                )}
            </div>
            <p className={styles.preview}>
                <span className={styles.previewBase}>/{orgSlug}/</span>
                <span className={styles.previewSlug}>{internalValue || "…"}</span>
            </p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
    );
}
