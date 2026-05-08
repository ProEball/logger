"use client";

import { useState } from "react";
import type { ParsedFrame } from "@/features/events/utils/stack-trace-parser";
import styles from "./StackFrame.module.scss";

interface StackFrameProps {
    frame: ParsedFrame;
}

export function StackFrame({ frame }: StackFrameProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className={styles.frame}>
            <button
                type="button"
                className={styles.header}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <svg
                    className={`${styles.chevron} ${open ? styles.open : ""}`}
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                >
                    <path d="M9 18l6-6-6-6" />
                </svg>
                <span className={styles.fn}>{frame.function ?? "<anonymous>"}</span>
                {frame.file ? (
                    <span className={styles.location}>
                        {frame.file}
                        {frame.line != null ? `:${frame.line}` : ""}
                        {frame.column != null ? `:${frame.column}` : ""}
                    </span>
                ) : null}
            </button>
            {open && frame.raw ? (
                <pre className={styles.raw}>{frame.raw}</pre>
            ) : null}
        </div>
    );
}
