"use client";

import { Topbar } from "@/shared/components";
import { UserMenu } from "@/features/auth/components/UserMenu/UserMenu";
import { OrgSwitcher } from "../OrgSwitcher/OrgSwitcher";
import type { OrgSummary } from "@/features/organizations/services/organizations.service";

interface OrgTopBarProps {
    orgSlug: string;
    orgName: string;
    orgs: OrgSummary[];
    userName: string;
    userEmail: string;
}

export function OrgTopBar({ orgSlug, orgName, orgs, userName, userEmail }: OrgTopBarProps) {
    return (
        <Topbar
            left={
                <OrgSwitcher
                    currentOrgSlug={orgSlug}
                    currentOrgName={orgName}
                    orgs={orgs}
                />
            }
            right={<UserMenu name={userName} email={userEmail} />}
        />
    );
}
