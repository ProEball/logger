/**
 * Stop hook — enforces WORKFLOW.md §2 ("logic is covered by tests, in the same
 * change").
 *
 * Runs when the model is about to finish its turn, which is the only moment the
 * whole change is visible. A PostToolUse hook fires mid-edit, when a test that
 * is about to be written legitimately does not exist yet, and would cry wolf on
 * every second tool call.
 *
 * ## What it can and cannot do
 *
 * It checks two mechanical properties, both of which this project has actually
 * got wrong:
 *
 *  1. A changed `.ts` module under core/, features/ or shared/ has a sibling
 *     `X.test.ts` or `X.itest.ts`. (`features/overview/` shipped with zero
 *     tests for months.)
 *  2. A changed `X.test.ts` actually imports `X`. (`aggregations.service.test.ts`
 *     never imported the service it was named after, so the folder listing
 *     showed 9.5 kB of SQL as covered when it had no tests at all.)
 *
 * It cannot tell logic from a rename, and it cannot tell a good test from a
 * useless one. On 2026-08-20 three separate tests in this repo passed against
 * broken code; every one of them would have satisfied this hook. Treat a green
 * hook as "the file exists and points at the right module", nothing more.
 *
 * ## Blocking
 *
 * Blocks the stop **once** — `stop_hook_active` is checked so a turn can never
 * be trapped in a loop. Raising the issue once is the point; deciding what to
 * do about it is the model's job, and WORKFLOW.md §2 already says an untestable
 * change needs its untestability explained rather than waived silently.
 *
 * A file may opt out with a `test-exempt:` comment carrying a reason. That is
 * deliberately the same shape as the project's rule for suppressions: the
 * escape must be in the diff, next to the code, with its justification.
 *
 * Node rather than a shell pipeline for the same reason as
 * `doc-sync-reminder.mjs`: it has to work on every machine here, and a hook
 * that silently no-ops is worse than no hook.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Only these trees hold the logic WORKFLOW.md §2 calls "must be covered". */
const WATCHED = [/^core\//, /^features\//, /^shared\//];

const EXEMPT = [
    /\.test\.ts$/,
    /\.itest\.ts$/,
    /\.bench\.ts$/,
    /\.d\.ts$/,
    // Type-only modules: no behaviour to assert.
    /\.types\.ts$/,
    // Drizzle table definitions and generated migrations are schema, not logic;
    // they are covered through the services that use them and by the
    // integration suite.
    /^core\/db\/schema\//,
    /^core\/db\/migrations\//,
    // Static authored content and the i18n dictionary are data.
    /^core\/i18n\/dictionary\.ts$/,
    /\/content\//,
    // Barrels re-export; there is nothing in them to test.
    /\/index\.ts$/,
];

function readStdin() {
    try {
        return readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

function changedFiles() {
    try {
        // `-uall` matters more than it looks: by default git collapses an
        // untracked directory into a single entry, so every file inside a newly
        // created folder would be invisible here — which is precisely the case
        // this hook exists for. A new feature folder with no tests is the
        // failure mode, not a lone edited file.
        const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const files = [];
        // NUL-separated, and a rename emits its old path as a separate record.
        for (const record of out.split("\0")) {
            if (!record) continue;
            const status = record.slice(0, 2);
            const file = record.slice(3);
            if (!file || status.includes("D")) continue;
            files.push(file.replace(/\\/g, "/"));
        }
        return files;
    } catch {
        // Not a git repo, or git unavailable: this hook has nothing to say.
        return null;
    }
}

/** Does the file carry an explicit opt-out with a reason? */
function isExemptedInline(absolute) {
    try {
        const source = readFileSync(absolute, "utf8");
        const match = source.match(/test-exempt:\s*(\S.*)/);
        return match ? match[1].trim() : null;
    } catch {
        return null;
    }
}

/** A changed test must import the module it is named for. */
function importsItsSubject(testAbs, subjectBase) {
    try {
        const source = readFileSync(testAbs, "utf8");
        return source.includes(subjectBase);
    } catch {
        return true; // unreadable: not this hook's problem
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

// Set by Claude Code when this hook already blocked once this turn. Without
// this check a disagreement between the hook and reality becomes an infinite
// loop, which is a far worse failure than a missing test.
if (payload?.stop_hook_active) process.exit(0);

const files = changedFiles();
if (!files) process.exit(0);

const missingTests = [];
const misnamedTests = [];

for (const file of files) {
    if (!file.endsWith(".ts") || file.endsWith(".tsx")) continue;
    if (!WATCHED.some((re) => re.test(file))) continue;

    const absolute = path.join(ROOT, file);

    // Rule 2: a changed test must import what its name claims.
    if (file.endsWith(".test.ts") || file.endsWith(".itest.ts")) {
        const subjectBase = path.basename(file).replace(/\.i?test\.ts$/, "");
        if (!importsItsSubject(absolute, subjectBase)) {
            misnamedTests.push({ file, subjectBase });
        }
        continue;
    }

    if (EXEMPT.some((re) => re.test(file))) continue;

    const reason = isExemptedInline(absolute);
    if (reason) continue;

    const base = file.replace(/\.ts$/, "");
    if (existsSync(path.join(ROOT, `${base}.test.ts`))) continue;
    if (existsSync(path.join(ROOT, `${base}.itest.ts`))) continue;

    missingTests.push(file);
}

if (missingTests.length === 0 && misnamedTests.length === 0) process.exit(0);

const lines = ["WORKFLOW.md §2 — logic ships with its tests, in the same change."];

if (missingTests.length > 0) {
    lines.push("", "Changed with no sibling test file:");
    for (const file of missingTests) {
        lines.push(`  - ${file}  (expected ${file.replace(/\.ts$/, "")}.test.ts or .itest.ts)`);
    }
}

if (misnamedTests.length > 0) {
    lines.push("", "Test files that do not import the module they are named for:");
    for (const { file, subjectBase } of misnamedTests) {
        lines.push(`  - ${file}  (no import mentioning "${subjectBase}")`);
    }
    lines.push(
        "  A test named after a module it never imports hides the gap it was supposed to expose.",
    );
}

lines.push(
    "",
    "If a change genuinely cannot be tested, say so explicitly and explain why — do not skip it silently.",
    "To opt a file out permanently, put a `test-exempt: <reason>` comment in it; the reason belongs in the diff.",
    "This is a mechanical check: it sees whether a test exists and what it imports, not whether it asserts anything useful.",
);

process.stdout.write(JSON.stringify({ decision: "block", reason: lines.join("\n") }));
