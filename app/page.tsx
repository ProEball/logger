import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { organizationMembers, organizations } from "@/core/db/schema";

export default async function RootPage() {
    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const [membership] = await db
        .select({ slug: organizations.slug })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, user.id))
        .limit(1);

    if (!membership) redirect("/login");

    redirect(`/${membership.slug}`);
}
