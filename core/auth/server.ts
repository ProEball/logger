import { headers } from "next/headers";
import { auth } from "./config";

export { auth };

export async function getSession() {
    return auth.api.getSession({
        headers: await headers(),
    });
}

export async function getCurrentUser() {
    const session = await getSession();
    return session?.user ?? null;
}
