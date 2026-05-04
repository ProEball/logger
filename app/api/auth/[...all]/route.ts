import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/core/auth/config";

export const { GET, POST, PUT, PATCH, DELETE } = toNextJsHandler(auth);
