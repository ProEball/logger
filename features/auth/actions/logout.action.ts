"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/config";

export async function logoutAction(): Promise<void> {
    await auth.api.signOut({ headers: await headers() });
    redirect("/login");
}
