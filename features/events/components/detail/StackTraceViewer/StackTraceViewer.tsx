"use client";

import { useState } from "react";
import { t } from "@/core/i18n/t";
import { StackFrame } from "../StackFrame/StackFrame";
import { parseStackTrace } from "@/features/events/utils/stack-trace-parser";
import styles from "./StackTraceViewer.module.scss";

interface StackTraceViewerProps {
    stackTrace: string | null | undefined;
}

export function StackTraceViewer({ stackTrace }: StackTraceViewerProps) {
    const [expanded, setExpanded] = useState(false);

    if (!stackTrace) {
        return <p className={styles.empty}>{t("events.detail.noStackTrace")}</p>;
    }

    const frames = parseStackTrace(stackTrace);

    if (!expanded) {
        return (
            <button type="button" className={styles.trigger} onClick={() => setExpanded(true)}>
                {t("events.detail.viewStackTrace").replace("{{frames}}", String(frames.length))}
            </button>
        );
    }

    return (
        <div className={styles.viewer}>
            <button type="button" className={styles.hideBtn} onClick={() => setExpanded(false)}>
                {t("events.detail.hideStackTrace")}
            </button>
            <div className={styles.frames}>
                {frames.map((frame, i) => (
                    <StackFrame key={i} frame={frame} />
                ))}
                {frames.length === 0 ? (
                    <pre className={styles.raw}>{stackTrace}</pre>
                ) : null}
            </div>
        </div>
    );
}
