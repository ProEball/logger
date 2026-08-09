import { Topbar } from "@/shared/components";
import { UserMenu } from "@/features/auth/components/UserMenu/UserMenu";

interface OrgTopBarProps {
    userName: string;
    userEmail: string;
}

export function OrgTopBar({ userName, userEmail }: OrgTopBarProps) {
    return <Topbar right={<UserMenu name={userName} email={userEmail} />} />;
}
