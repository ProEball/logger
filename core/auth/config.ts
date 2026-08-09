import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { env } from "@/core/env";
import { logger } from "@/core/logger";

export const auth = betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,

    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
        usePlural: true,
    }),

    emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, token }) => {
            const resetUrl = `${env.APP_URL}/reset-password/${token}`;
            logger.info({ email: user.email, resetUrl }, "[PASSWORD_RESET]");
        },
    },

    session: {
        // 30-day rolling session (Q-A3, Q-A4)
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 0,
    },

    user: {
        additionalFields: {
            preferences: {
                type: "json",
                required: false,
                returned: true,
                defaultValue: () => ({ theme: "dark" }),
            },
        },
    },

    plugins: [nextCookies()],
});
