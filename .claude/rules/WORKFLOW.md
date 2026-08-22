# Workflow Rules — Definition of Done

These are gates, not suggestions. A change is finished when all of them pass, in the same commit as the change itself. "I'll document/test it later" is how `PROGRESS.md` fell five commits behind and how `NEXT_PUBLIC_APP_URL` silently broke every alert webhook.

## 1. Documentation is part of the change

**Before** editing anything non-trivial, read the reference doc that covers it — the code may already have documented behaviour you are about to contradict. **After** the change, update every doc the table below points at.

| What you changed | Update |
|---|---|
| An environment variable | `core/env/index.ts` schema **+** `.env.example` **+** `docs/reference/stack.md` **+** the feature doc |
| A permission string | `shared/permissions/registry.ts` **+** `PLAN.md` §5 **+** `docs/reference/users-roles.md` |
| DB schema or a migration | `docs/reference/architecture.md` (schema tables, indexes, FK behaviour) |
| An HTTP route, status code, or response body | `docs/reference/api.md` |
| Auth, authorization, API keys, headers, CSP, rate limits, outbound requests | `docs/reference/security.md` — including its known-gaps table |
| Event model, filters, dashboard widgets, alert evaluation or delivery | `docs/reference/logging.md` |
| Added, removed or re-pointed a widget — anything that changes which query backs a read surface | `docs/reference/widgets.md` |
| Folder layout or a layering rule | `docs/reference/architecture.md` **+** `PROJECT.md` §2 |
| Dependencies, npm scripts, test or deploy setup | `docs/reference/stack.md` / `docs/reference/misc.md` |
| A background job | `docs/reference/architecture.md` (jobs table) |
| Finished a feature-doc checklist item | that doc's status block **+** `docs/PROGRESS.md` |
| A decision affecting more than one feature | `PLAN.md` §17, **with the rationale, not just the outcome** |

A `PostToolUse` hook (`.claude/hooks/doc-sync-reminder.mjs`, wired in `.claude/settings.json`) prints the matching row when you edit one of the high-cost paths above. It **advises and never blocks**, it covers only some of the table, and it cannot tell a behaviour change from a refactor — so it is a safety net, not the rule. The table is the rule.

Rules for the writing itself:

- **Record why, not just what.** A decision without its reasoning gets re-litigated by the next session. When you reject an alternative, say what you rejected and what would change your mind.
- **Correct stale docs in place; do not silently overwrite history.** If a doc records a decision that was later superseded, mark it superseded and point at the replacement.
- **Never document intent as if it were reality.** `docs/reference/` describes what the code does today. Planned work belongs in `docs/features/` or `PLAN.md`.
- **Verify before you write.** Check the claim against the code. A confidently wrong doc is worse than no doc.
- If you discover a doc that is already wrong while working nearby, fix it or flag it — do not step around it.

## 2. Logic is covered by tests

Every added or changed piece of logic ships with tests **in the same change**.

**Must be covered** — services, utils, Server Actions, permission guards, validation schemas, job handlers, reducers, custom hooks. Anything with a branch, a boundary, or a rule.

**Need not be covered** — purely presentational components, styling, static copy. Do not chase coverage on markup.

- **Fixing a bug? Write the failing test first.** It must fail against the old code, then pass. A fix without a regression test does not count as fixed.
- **Test behaviour, not implementation.** Query by role/label. Asserting on internals means the test breaks on refactors and passes on real regressions.
- **Mock only at real system boundaries** — the database, an external HTTP API, DNS, the clock. Mocking an internal module tests the mock. (Example: the webhook SSRF guard's tests mock `node:dns/promises`, not the guard.)
- **Cover the edges, not just the happy path** — the empty case, the boundary value, the just-outside-the-range value, the failure branch.
- E2E (`e2e/*.spec.ts`) covers whole user flows and runs against its own isolated database. Unit tests cover logic. Do not use E2E as a substitute for a unit test that is cheaper and more precise.
- If something genuinely cannot be tested, say so explicitly and explain why. Do not quietly skip it.

### The gate that enforces this

`.claude/hooks/test-coverage-gate.mjs` runs on **Stop** — the moment the whole change is visible; a per-edit hook would fire while a test is still being written and get tuned out. It checks two mechanical properties against `git status`:

1. A changed `.ts` under `core/`, `features/` or `shared/` has a sibling `X.test.ts` or `X.itest.ts`.
2. A changed `X.test.ts` actually **imports `X`**. This is not pedantry: `aggregations.service.test.ts` never imported the service it was named for, so a 9.5 kB SQL module read as covered in the folder listing while having no tests at all.

**It blocks once per turn**, guarded by `stop_hook_active` so a disagreement between the hook and reality can never trap a turn in a loop. `.tsx` is exempt (§2 does not require covering presentational components, and firing on every UI edit is how a hook becomes noise), as are type-only modules, barrels, schema and migration files, and authored content.

A file opts out with a **`test-exempt: <reason>`** comment. Same shape as the rule for suppressions: the escape lives next to the code and its justification is in the diff.

**Know what a green hook means.** It sees that a file exists and what it imports — not whether it asserts anything true. On 2026-08-20 three tests in this repository passed against broken code (a top-N ordering bug, an environment name split in two, and a test asserting on text that CSS had uppercased); every one of them would have satisfied this hook. It closes the "nobody wrote a test" gap and none of the others.

## 3. What a subagent may do

Two kinds of work go to a subagent. Everything else stays with whoever is doing the change.

### 3.1 Audit — it reports, it never writes

Use the **`Explore`** agent, which has no `Edit` or `Write` tool at all. That is the reason to pick it: "report, do not modify" is then a property of the toolset rather than a sentence in a prompt that can be reinterpreted halfway through. Same principle as everything else here — the constraint lives in the mechanism, not in good intentions.

Briefs that work:

- "Read this diff. List every claim in `docs/reference/` it contradicts — file, line, and the sentence quoted."
- "Which statements in `<doc>` are not supported by the code as it stands?"
- "Where else does this pattern appear in the tree?"

**The output must be checkable at a glance**: file, line, quotation. A finding that has to be re-derived from scratch cost more than it saved.

The cold start is an *advantage* here. An auditor who was not in the room cannot confirm its own earlier reasoning from memory; it has to go and read.

### 3.2 The descriptive half of `docs/reference/`

Delegate by **kind of claim, not by file**. What a subagent maintains is anything verifiable against the code by someone who was not in the room: schema tables, environment-variable lists, script inventories, route and status-code tables, counts, signatures, which query backs which widget.

What it does not maintain — *in those same files* — is the reasoning. `security.md` explaining why a cache key is an authorization boundary, and `architecture.md` explaining why that key carries a range preset rather than a resolved range, live under `docs/reference/` and are not delegable. See §3.3.

### 3.3 What never goes to a subagent

**Tests for logic you just wrote.** The test *is* the verification, and the person who wrote the code is the one holding a hypothesis about what breaks. A cold agent produces exactly the failure this repository has already had twice: `aggregations.service.test.ts`, named after a service it never imported, and the three tests that passed against broken code on 2026-08-20. Every one of them would satisfy the mechanical gate in §2.

**Anything answering "why".** `PLAN.md` §17, decision logs, superseded-notes, rationale paragraphs. A decision's reasoning usually lives in the conversation that produced it and nowhere in the diff — the caching work on 2026-08-20 turned entirely on one sentence from the user revising the target from one concurrent reader to fifty, and no line of code records that. A subagent given the diff either invents a rationale or asks for the conversation back, and the second defeats the point of delegating.

### 3.4 A floor, so this does not become noise

Delegate when the work is big enough that a cold start costs less than doing it: a sweep over several files, an audit of a whole document, a search whose answer is a conclusion rather than a file dump. A one-line correction noticed in passing gets fixed in passing.

Same judgement the hooks are tuned by — a rule that fires on everything gets tuned out.

### 3.5 Delegation moves the work, never the responsibility

A subagent's report is **input, not a verdict**. Findings get verified before they are acted on; delegated edits get read before the gates in §4 run. If a subagent was wrong, that is not a smaller mistake for having been made elsewhere, and §5 applies to what a subagent did exactly as it applies to what you did.

## 4. Gates before declaring done

```bash
npx tsc --noEmit    # 0 errors
npm run lint        # 0 problems
npm run test        # all green
npm run build       # succeeds
```

`npm run test:e2e` when the change touches routing, auth, or a user flow.

Fix failures at the root. Do not suppress them with `any`, `@ts-ignore`, `eslint-disable`, or a skipped test. If a suppression is genuinely correct, the comment must explain *why* it is correct — see `seed-system-roles.ts` for the bar.

## 5. Report honestly

State what you verified and how. If a check was skipped, say which and why. If part of the work is incomplete, say which part — do not let a summary imply more than was done.
