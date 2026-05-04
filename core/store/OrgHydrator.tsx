"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setOrgContext } from "@/core/store/slices/org";
import { setTheme, type ThemeValue } from "@/core/store/slices/theme";
import type { Membership } from "@/shared/permissions/check";

interface OrgHydratorProps {
    orgId: string;
    orgSlug: string;
    membership: Membership;
    theme: ThemeValue;
}

/**
 * Client component that hydrates Redux with org context and user preferences
 * on every route change within the [org] segment. Renders nothing.
 */
export function OrgHydrator({ orgId, orgSlug, membership, theme }: OrgHydratorProps) {
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(setOrgContext({ orgId, orgSlug, membership }));
        dispatch(setTheme(theme));
    }, [dispatch, orgId, orgSlug, membership, theme]);

    return null;
}
