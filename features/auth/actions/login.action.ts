"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/config";

type LoginFormData = { email: string; password: string };
type LoginResult = { error: string } | void;

export async function loginAction(data: LoginFormData): Promise<LoginResult> {
    try {
        await auth.api.signInEmail({
            body: { email: data.email, password: data.password },
            headers: await headers(),
        });
    } catch {
        return { error: "Invalid email or password." };
    }
    redirect("/");
}
