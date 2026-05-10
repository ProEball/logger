"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/core/auth/config";

const schema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Please confirm your new password"),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

export async function changePasswordAction(data: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

    try {
        await auth.api.changePassword({
            body: {
                currentPassword: parsed.data.currentPassword,
                newPassword: parsed.data.newPassword,
                revokeOtherSessions: true,
            },
            headers: await headers(),
        });
        return {};
    } catch {
        return { error: "Current password is incorrect." };
    }
}
