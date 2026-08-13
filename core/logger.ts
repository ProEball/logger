import pino from "pino";
import { env } from "@/core/env";

export const logger = pino({
    level: env.LOG_LEVEL,
});
