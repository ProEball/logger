/**
 * PostToolUse hook (Write|Edit).
 *
 * Enforces the "changed X -> update Y" table in .claude/rules/WORKFLOW.md §1 for
 * the handful of files where forgetting has actually cost this project
 * something. Reads the hook payload on stdin; if the edited path is one of them,
 * injects a reminder back into the model's context.
 *
 * Written in Node, not the usual `jq` one-liner, because jq is not installed on
 * every dev machine here — a jq hook exits silently and does nothing, which is
 * worse than having no hook at all. Node is guaranteed present: this is a Node
 * project.
 *
 * Deliberately narrow. A hook that fires on every edit becomes noise and gets
 * tuned out. Always exits 0 — this advises, it never blocks.
 */

import { readFileSync } from "node:fs";

const RULES = [
    [/\/core\/env\/index\.ts$/, "`.env.example`, `docs/reference/stack.md` (env table), and the feature doc that introduced the variable"],
    [/\/shared\/permissions\/registry\.ts$/, "`docs/PLAN.md` §5 and `docs/reference/users-roles.md`"],
    [/\/core\/db\/schema\//, "the schema tables in `docs/reference/architecture.md`"],
    [/(db\/schema\.sql|db\/events\.sql|core\/clickhouse\/schema\.sql)$/, "`docs/reference/architecture.md` (schema tables, indexes, FK behaviour) — and confirm every statement is idempotent, since the bootstrap re-applies the whole file"],
    [/\/app\/api\/.*\/route\.ts$/, "`docs/reference/api.md` (routes, status codes, response bodies)"],
    [/\/(proxy|next\.config)\.ts$/, "`docs/reference/security.md` (headers / CSP). A CSP change also affects the Caddy notes in `docs/PLAN.md` §15.1"],
    [/\/features\/alerts\/(services|jobs)\//, "`docs/reference/logging.md` (alert evaluation / delivery), plus `docs/reference/security.md` if outbound requests changed"],
    [/\/features\/ingest\//, "`docs/reference/api.md` and `docs/reference/logging.md` (event model)"],
    [/\/package\.json$/, "`docs/reference/stack.md` (dependencies and npm scripts)"],
];

function readStdin() {
    try {
        return readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

const raw = readStdin();
if (!raw.trim()) process.exit(0);

let payload;
try {
    payload = JSON.parse(raw);
} catch {
    process.exit(0);
}

const filePath = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
if (typeof filePath !== "string" || filePath === "") process.exit(0);

// Windows paths arrive backslash-separated; normalise before matching.
const normalized = filePath.replace(/\\/g, "/");

const hit = RULES.find(([pattern]) => pattern.test(normalized));
if (!hit) process.exit(0);

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext:
                `WORKFLOW.md §1 — you edited ${normalized}. If this changed behaviour, ` +
                `update ${hit[1]} in this same change. If it was a pure refactor, ignore this.`,
        },
    }),
);
