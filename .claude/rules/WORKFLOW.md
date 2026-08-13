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
| Folder layout or a layering rule | `docs/reference/architecture.md` **+** `PROJECT.md` §2 |
| Dependencies, npm scripts, test or deploy setup | `docs/reference/stack.md` / `docs/reference/misc.md` |
| A background job | `docs/reference/architecture.md` (jobs table) |
| Finished a feature-doc checklist item | that doc's status block **+** `docs/PROGRESS.md` |
| A decision affecting more than one feature | `PLAN.md` §17, **with the rationale, not just the outcome** |

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

## 3. Gates before declaring done

```bash
npx tsc --noEmit    # 0 errors
npm run lint        # 0 problems
npm run test        # all green
npm run build       # succeeds
```

`npm run test:e2e` when the change touches routing, auth, or a user flow.

Fix failures at the root. Do not suppress them with `any`, `@ts-ignore`, `eslint-disable`, or a skipped test. If a suppression is genuinely correct, the comment must explain *why* it is correct — see `seed-system-roles.ts` for the bar.

## 4. Report honestly

State what you verified and how. If a check was skipped, say which and why. If part of the work is incomplete, say which part — do not let a summary imply more than was done.
