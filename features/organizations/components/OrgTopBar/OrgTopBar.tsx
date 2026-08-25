import type { ReactNode } from "react";
import { Topbar } from "@/shared/components";
import { UserMenu } from "@/features/auth/components/UserMenu/UserMenu";

interface OrgTopBarProps {
    userName: string;
    userEmail: string;
    /**
     * Optional leading slot. The project layout puts `ProjectPulse` here — the
     * project's name and live rate — and passes it in rather than importing it,
     * so this component does not reach across into `features/projects`
     * (`PROJECT.md` §2.1). The organization shell passes nothing: the sidebar
     * already names the org.
     */
    left?: ReactNode;
}

export function OrgTopBar({ userName, userEmail, left }: OrgTopBarProps) {
    return <Topbar left={left} right={<UserMenu name={userName} email={userEmail} />} />;
}
