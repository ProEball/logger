import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.string().url(),
        NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
        AUTH_SECRET: z.string().min(1),
        APP_URL: z.string().url().default("http://localhost"),
    },
    client: {},
    experimental__runtimeEnv: {},
});
