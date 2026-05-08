"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AutoRefreshValue } from "@/shared/types/user-preferences.types";

const INTERVAL_MS: Record<AutoRefreshValue, number | null> = {
    off: null,
    "10s": 10_000,
    "30s": 30_000,
    "60s": 60_000,
};

export function useAutoRefresh(value: AutoRefreshValue): void {
    const router = useRouter();
    const intervalMs = INTERVAL_MS[value];
    // Stable ref so the effect doesn't re-run when router identity changes
    const routerRef = useRef(router);
    useEffect(() => {
        routerRef.current = router;
    });

    useEffect(() => {
        if (!intervalMs) return;

        const onVisibilityChange = () => {
            // When tab becomes visible again, do an immediate refresh
            if (document.visibilityState === "visible") {
                routerRef.current.refresh();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);

        const id = setInterval(() => {
            if (document.visibilityState === "visible") {
                routerRef.current.refresh();
            }
        }, intervalMs);

        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [intervalMs]);
}
