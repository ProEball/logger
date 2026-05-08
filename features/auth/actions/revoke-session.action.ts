"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/core/auth/config";

const schema = z.object({ token: z.string().min(1) });

export async function revokeSessionAction(
    data: { token: string },
): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    try {
        await auth.api.revokeSession({
            body: { token: parsed.data.token },
            headers: await headers(),
        });
        revalidatePath("/account/sessions");
        return {};
    } catch {
        return { error: "Failed to revoke session." };
    }
}
