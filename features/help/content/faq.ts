import type { HelpCategorySlug } from "./categories";

export interface HelpFaqEntry {
    id: string;
    cat: HelpCategorySlug;
    question: string;
    /** Short answer, one or two sentences — a paraphrase of the linked article section, not new information. */
    answer: string;
    /** Heading slug inside that category's article, e.g. "rate-limiting" — used to build the "Read full article" link. */
    anchor?: string;
}

export const HELP_FAQ: HelpFaqEntry[] = [
    {
        id: "ingest-old-timestamp",
        cat: "api",
        question: "What happens if I send an event with a timestamp more than 30 days in the past?",
        answer: "The event is rejected with a 400 and an \"Event timestamp is older than 30-day retention window\" error — it is not stored. The cutoff matches the 30-day partition retention, so an event that old would be dropped almost immediately anyway.",
        anchor: "event-schema",
    },
    {
        id: "ingest-future-timestamp",
        cat: "api",
        question: "What happens if a client's clock is ahead and sends a future timestamp?",
        answer: "Timestamps more than 5 minutes in the future are silently coerced to the server's current time (logged as a warning) rather than rejected — only the 30-day-in-the-past case is a hard error.",
        anchor: "event-schema",
    },
    {
        id: "role-deletion",
        cat: "users-roles",
        question: "Can I delete a role that's still assigned to someone?",
        answer: "No. The delete is blocked by a database foreign-key constraint and the action returns \"Reassign them first.\" Reassign every member and pending invitation off the role before deleting it. System roles (Admin, Member, Viewer) can never be deleted at all.",
        anchor: "system-built-in-roles",
    },
    {
        id: "second-org",
        cat: "users-roles",
        question: "Can I create a second organization?",
        answer: "No — this product supports exactly one organization, created once via the /setup wizard on first run. There is no in-app \"create another organization\" flow.",
        anchor: "organization-lifecycle",
    },
    {
        id: "rate-limit-replicas",
        cat: "security",
        question: "Is the ingest rate limit safe if we run multiple app replicas?",
        answer: "Not yet. The limiter keeps its counters in the process's own memory, so each replica enforces the limit independently — the effective ceiling scales with the number of replicas. This is a documented, known limitation, not intended behavior.",
        anchor: "rate-limiting",
    },
    {
        id: "password-reset-email",
        cat: "security",
        question: "Why didn't I get a password reset email?",
        answer: "Password reset isn't wired to a real email provider in this build — the reset link is written to the application log only. An operator with log access has to retrieve it and hand it to the user manually.",
        anchor: "authentication",
    },
    {
        id: "api-key-storage",
        cat: "security",
        question: "How are API keys stored — can an admin see a key again after creation?",
        answer: "No. Only a SHA-256 hash and a 4-character display prefix are stored; the full key is shown exactly once, at creation time, and cannot be retrieved again. Revoke and issue a new one if it's lost.",
        anchor: "api-key-security-ingest-authentication",
    },
    {
        id: "bucket-sizing",
        cat: "logging",
        question: "How is the dashboard chart's bucket size chosen?",
        answer: "It's derived from the selected time range, not fixed: 1-minute buckets up to a 1-hour range, 1-hour buckets up to 24h, 12-hour buckets up to 7 days, and 1-day buckets for the 30-day view.",
        anchor: "bucket-sizing",
    },
    {
        id: "attribute-type-conflict",
        cat: "logging",
        question: "Why was my event rejected with an \"attribute type conflict\"?",
        answer: "Each attribute key is locked to the JSON type (string, number, or boolean) it first appeared with, per project. Sending a different type for the same key later — e.g. a number where a string was first seen — is rejected so that attribute filtering stays reliable.",
        anchor: "attribute-type-enforcement",
    },
    {
        id: "route-sitemap",
        cat: "architecture",
        question: "Where do I find the full list of routes and how the app is organized on disk?",
        answer: "The Architecture article's folder-structure section lists every top-level folder (app/, core/, features/, shared/) and the full route sitemap for org- and project-scoped pages.",
        anchor: "app-routing-only",
    },
    {
        id: "worker-in-process",
        cat: "misc",
        question: "Do I need a separate worker process to run background jobs?",
        answer: "Not for local development — set WORKER_IN_PROCESS=true and the same Next.js process also runs partition maintenance and alert evaluation/delivery. A dedicated worker container is the intended production setup, but that Docker packaging isn't built yet.",
        anchor: "deployment",
    },
    {
        id: "env-vars-validated",
        cat: "stack",
        question: "Which environment variables actually get validated at startup?",
        answer: "Only four: DATABASE_URL, AUTH_SECRET, APP_URL, and NODE_ENV. Everything else (rate limit, log level, worker toggle, build metadata) is read from process.env directly and isn't schema-checked.",
        anchor: "environment-variables",
    },
    {
        id: "alert-webhook-notify",
        cat: "logging",
        question: "How do I get notified when something goes wrong?",
        answer: "Create an alert rule on a project: an event filter (same shape as the events list), a threshold condition (count >= N within a time window), and one or more webhook channels. Rules are evaluated every minute — a transition to \"firing\" (or back to \"ok\", if notify-on-resolve is on) posts a JSON payload to each configured webhook URL.",
        anchor: "alerts",
    },
    {
        id: "webhook-delivery-failure",
        cat: "logging",
        question: "What happens if my alert's webhook endpoint is down or returns an error?",
        answer: "Delivery classifies the response: 2xx is delivered; 4xx fails immediately and is not retried (treated as a permanent config error); 5xx or a timeout/network error is retried up to 3 times with a 30-second base delay and exponential backoff.",
        anchor: "delivery",
    },
    {
        id: "api-key-per-key-rate-limit",
        cat: "security",
        question: "Can I set a different ingest rate limit for each API key?",
        answer: "Yes. The rate limiter is per-API-key, not per-project or per-IP. The default is 1000 events/60s (RATE_LIMIT_PER_MIN), but each key's limit can be overridden individually from 1 to 100,000/min from its row in the API keys list.",
        anchor: "rate-limiting",
    },
    {
        id: "api-key-delete",
        cat: "security",
        question: "Can I delete an API key, or only revoke it?",
        answer: "Both, but in that order. Revoking is the reversible step — the key stops authenticating immediately — and it's required before you can delete it. Hard delete is only permitted on an already-revoked key; an active key can't be removed without revoking it first.",
        anchor: "api-key-security-ingest-authentication",
    },
];
