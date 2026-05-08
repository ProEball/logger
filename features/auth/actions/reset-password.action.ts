"use server";
import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/config";

const schema = z
    .object({
        token: z.string().min(1),
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string().min(1),
    })
    .refine((d) => d.password === d.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

type Result = { error?: string };

export async function resetPasswordAction(data: {
    token: string;
    password: string;
    confirmPassword: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        return { error: first?.message ?? "Invalid input." };
    }

    try {
        await auth.api.resetPassword({
            body: { token: parsed.data.token, newPassword: parsed.data.password },
            headers: await headers(),
        });
    } catch {
        return { error: "This reset link is invalid or has expired." };
    }

    redirect("/login");
}
