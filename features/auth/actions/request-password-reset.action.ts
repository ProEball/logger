"use server";
import { z } from "zod";
import { headers } from "next/headers";
import { auth } from "@/core/auth/config";

const schema = z.object({ email: z.string().email() });

type Result = { error?: string };

export async function requestPasswordResetAction(data: { email: string }): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Enter a valid email address." };

    try {
        await auth.api.requestPasswordReset({
            body: { email: parsed.data.email },
            headers: await headers(),
        });
    } catch {
        // Never reveal whether the email exists
    }

    return {};
}
