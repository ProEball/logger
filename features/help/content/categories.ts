export type HelpCategorySlug =
    | "overview"
    | "stack"
    | "architecture"
    | "api"
    | "users-roles"
    | "logging"
    | "security"
    | "misc";

export type HelpIconKey =
    | "book-open"
    | "layers"
    | "network"
    | "terminal"
    | "users"
    | "activity"
    | "shield"
    | "settings";

export interface HelpCategory {
    slug: HelpCategorySlug;
    label: string;
    description: string;
    icon: HelpIconKey;
    /** Filename inside docs/reference/ */
    sourceFile: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
    {
        slug: "overview",
        label: "Overview",
        description: "What Logger is, who it is for, and how the pieces fit together.",
        icon: "book-open",
        sourceFile: "README.md",
    },
    {
        slug: "stack",
        label: "Stack & environment",
        description: "Runtime, framework versions, and the environment variables each service expects.",
        icon: "layers",
        sourceFile: "stack.md",
    },
    {
        slug: "architecture",
        label: "Architecture",
        description: "Folder structure, database schema, and background jobs behind the app.",
        icon: "network",
        sourceFile: "architecture.md",
    },
    {
        slug: "api",
        label: "API",
        description: "Ingest endpoint, payload shape, authentication and timestamp policy.",
        icon: "terminal",
        sourceFile: "api.md",
    },
    {
        slug: "users-roles",
        label: "Users, roles & orgs",
        description: "Org membership, the permission catalogue, and role assignment rules.",
        icon: "users",
        sourceFile: "users-roles.md",
    },
    {
        slug: "logging",
        label: "Logging, alerts & dashboard",
        description: "Event levels, alert rule evaluation and webhook delivery, and how dashboard charts are bucketed.",
        icon: "activity",
        sourceFile: "logging.md",
    },
    {
        slug: "security",
        label: "Security",
        description: "Session handling, API key security, per-key rate limiting, and the known gaps in the current build.",
        icon: "shield",
        sourceFile: "security.md",
    },
    {
        slug: "misc",
        label: "Testing & deployment",
        description: "Test layout, CI checks, and the deployment steps for a self-hosted instance.",
        icon: "settings",
        sourceFile: "misc.md",
    },
];

const CATEGORY_BY_SLUG = new Map(HELP_CATEGORIES.map((c) => [c.slug, c]));

// Reverse lookup used to rewrite cross-links between reference docs
// (e.g. a link to "security.md" inside architecture.md) into in-app routes.
const CATEGORY_BY_SOURCE_FILE = new Map(HELP_CATEGORIES.map((c) => [c.sourceFile.toLowerCase(), c]));

export function getHelpCategory(slug: string): HelpCategory | undefined {
    return CATEGORY_BY_SLUG.get(slug as HelpCategorySlug);
}

export function getHelpCategoryBySourceFile(fileName: string): HelpCategory | undefined {
    return CATEGORY_BY_SOURCE_FILE.get(fileName.toLowerCase());
}

export function isHelpCategorySlug(slug: string): slug is HelpCategorySlug {
    return CATEGORY_BY_SLUG.has(slug as HelpCategorySlug);
}
