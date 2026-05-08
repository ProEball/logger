"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setOrgContext } from "@/core/store/slices/org";
import { setTheme, type ThemeValue } from "@/core/store/slices/theme";
import { setPreferences } from "@/core/store/slices/user";
import type { Membership } from "@/shared/permissions/check";
import type { UserPreferences } from "@/shared/types/user-preferences.types";

interface OrgHydratorProps {
    orgId: string;
    orgSlug: string;
    membership: Membership;
    theme: ThemeValue;
    preferences: UserPreferences;
}

/**
 * Client component that hydrates Redux with org context and user preferences
 * on every route change within the [org] segment. Renders nothing.
 */
export function OrgHydrator({ orgId, orgSlug, membership, theme, preferences }: OrgHydratorProps) {
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(setOrgContext({ orgId, orgSlug, membership }));
        dispatch(setTheme(theme));
        dispatch(setPreferences(preferences));
    }, [dispatch, orgId, orgSlug, membership, theme, preferences]);

    return null;
}
