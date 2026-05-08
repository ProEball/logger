"use client";

import { useSelector } from "react-redux";
import { selectCurrentMembership } from "@/core/store/slices/org";
import { hasPermission } from "./check";
import type { Permission } from "./registry";

export function usePermission(perm: Permission): boolean {
    const membership = useSelector(selectCurrentMembership);
    if (!membership) return false;
    return hasPermission(membership, perm);
}
