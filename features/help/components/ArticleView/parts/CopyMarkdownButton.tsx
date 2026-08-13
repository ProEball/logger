"use client";

import { useCallback, useState } from "react";
import { IconFileText } from "@/features/help/components/icons";
import styles from "./CopyMarkdownButton.module.scss";

export interface CopyMarkdownButtonProps {
    markdown: string;
}

export function CopyMarkdownButton({ markdown }: CopyMarkdownButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleClick = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard API unavailable (insecure context, denied permission). No fallback for now.
        }
    }, [markdown]);

    return (
        <button type="button" className={styles.btn} onClick={handleClick}>
            <IconFileText />
            {copied ? "Copied" : "Copy page as Markdown"}
        </button>
    );
}
