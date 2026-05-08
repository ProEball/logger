"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/core/auth/config";

const schema = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
});

export async function updateAccountAction(
    data: { name: string },
): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

    try {
        await auth.api.updateUser({
            body: { name: parsed.data.name },
            headers: await headers(),
        });
        revalidatePath("/account");
        return {};
    } catch {
        return { error: "Failed to update profile." };
    }
}
