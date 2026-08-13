# NextJS and React APP Coding Rules and Guidelines

## 1. Core Principles
- Follow SOLID principles:
    - Single Responsibility Principle
    - Open-Closed Principle
    - Liskov Substitution Principle
    - Interface Segregation Principle
    - Dependency Inversion Principle
- Always keep code DRY (don't repeat yourself)
- Always keep in mind performance and efficiency
- Prefer readability over cleverness

## 2. Project Structure
- 2.1 Follow Feature Driven Development (FDD) pattern at the project root:
    - `core/` — Redux store, state management core, core components, global services, and anything app-wide.
    - `shared/` — shared library of components, hooks, services, and utilities used across features.
    - `features/` — individual features of the application.
      Each feature is composed of:
        - `components/` — feature-specific components (see §2.2 for folder structure)
        - `services/` — feature-specific API/data services
        - `hooks/` — feature-specific custom hooks
        - `utils/` — feature-specific utility functions
    - Features must NOT import from another feature. If something needs to be shared, move it to `shared/`.
    - Use the `@/` path alias (mapped to project root) for all imports: `@/core/`, `@/shared/`, `@/features/`.
- 2.2 Component folder structure — **every component lives in its own named subfolder**:
    ```
    components/
      ComponentName/
        ComponentName.tsx
        ComponentName.module.scss
        parts/                        ← sub-components used ONLY by this component
          SubComponent.tsx
          SubComponent.module.scss
    ```
    - Semantic grouping subfolders (`filters/`, `detail/`, `widgets/`, etc.) are allowed inside `components/` when a feature has many thematically related components. Inside each group, the same per-component folder rule applies:
      ```
      components/
        filters/
          TimeRangePicker/
            TimeRangePicker.tsx
            TimeRangePicker.module.scss
      ```
    - A `parts/` subfolder at the **feature** `components/` level is NOT allowed. If a component is used by more than one parent, give it its own top-level folder in `components/`. If it is only ever used by one parent, nest it inside that parent's `parts/`.
    - Do NOT add barrel `index.ts` files per component folder — import using the full explicit path: `import { Foo } from "@/features/f/components/Foo/Foo"`.
    - `shared/components/` follows the same pattern. Its top-level `index.ts` barrel is the only exception (for convenience imports across all features).
- 2.3 `app/` is reserved for Next.js App Router only — layouts, pages, and route segments.
    - Do NOT place business logic, components, or services inside `app/`.
    - Pages in `app/` should only compose feature components and handle routing concerns.

## 3. Coding Rules
- 3.1 General
    - Always put `;` at the end of each statement.
    - Use 4 spaces for indentation.
- 3.2 Functions
    - Must be 40 lines or fewer.
    - Follow the single responsibility principle.
- 3.3 Components
    - Must be 250 lines or fewer, unless unavoidable.
    - By default, components are Server Components. Use `"use client";` only when:
        - Using `useState`, `useEffect`, or other client-side hooks.
        - Accessing browser-only APIs.
        - Using event handlers (`onClick`, `onChange`, etc.).
        - Never convert entire pages to client components unnecessarily.
    - Follow the single responsibility principle.
    - Keep components small and focused.
    - Extract complex logic into hooks.
    - Avoid inline functions inside JSX when possible.
    - Avoid accepting `setState` functions as props.
    - Extract repeated UI into reusable components.
        - If a sub-component is used only inside one parent component, place it as a flat file inside that parent's `parts/` subfolder: `ParentName/parts/SubName.tsx` (+ `.module.scss`). Do NOT put a sub-subfolder inside `parts/`.
        - If a sub-component is used by two or more components, promote it to its own top-level folder in `components/`.
- 3.4 Hooks
    - Never call hooks conditionally.
    - Follow the single responsibility principle.
    - Custom hooks must start with `use`.
    - Hooks must not mutate external state directly.
    - Side effects belong in `useEffect`.

## 4. TypeScript Rules
- Always use TypeScript — no `any`, no `@ts-ignore` without an explanation comment.
- Prefer `type` for unions, intersections, and aliases; prefer `interface` for object shapes that may be extended.
- Do not use type assertions (`as`) unless absolutely necessary; add a comment explaining why.
- Enable and respect `strict: true` — all compiler errors must be fixed, not suppressed.
- Export types and interfaces that are shared across files.
- Name types and interfaces in PascalCase.

## 5. State Management
- 5.1 General
    - Never mutate state directly.
- 5.2 Application-level State
    - Use Redux Toolkit for global app state:
        - user state
        - theme state
        - language state
        - etc.
- 5.3 Feature-level State
    - Use React Context for simple feature-scoped state.
    - Use `useSyncExternalStore` to avoid unnecessary re-renders when subscribing to external stores.
- 5.4 Component-level State
    - Use `useState` for simple local state.
    - Avoid an excessive number of `useState` calls — consider `useReducer` for complex local state.
    - Avoid passing `setState` functions as props.

## 6. Data Fetching
- Fetch on the server whenever possible using async Server Components.
- Use `Suspense` for loading states.
- Avoid client-side fetching unless necessary (interactivity, user-triggered actions).
- No direct `fetch` calls inside components — use services.

## 7. API & Services Layer
- All API calls must go through service functions located in `services/`.
- Services must:
    - Validate inputs before sending requests.
    - Handle and throw meaningful errors.
- No business logic inside route handlers (`app/api/`) — delegate to services.

## 8. Server Actions
- Place Server Actions in dedicated `actions/` files, not inline inside components.
- Server Actions must validate all inputs using a schema (e.g., Zod).
- Handle errors explicitly — never let a Server Action fail silently.
- Use Server Actions for form submissions and mutations; prefer fetching data in Server Components.

## 9. Error Handling
- Never swallow errors silently.
- Always handle async errors with `try/catch` or `.catch()`.
- Use Next.js `error.tsx` boundaries for route-level error handling.
- Return meaningful, typed error messages from services and Server Actions.

## 10. Performance Guidelines
- Avoid unnecessary re-renders.
- Memoize expensive computations with `useMemo`.
- Use `React.memo` only when profiling confirms it helps.
- Avoid large client bundles — use Next.js `dynamic()` imports for heavy components.
- Prefer Server Components for static or data-driven UI to reduce client bundle size.

## 11. Testing
- 11.1 Unit & Integration — Vitest + React Testing Library
    - Test components, hooks, utilities, and Server Actions logic.
    - Test files live next to the source file: `ComponentName.test.tsx`.
    - Test behaviour, not implementation — query by role/label, not by class or id.
    - Mock only at system boundaries (external APIs, databases) — do not mock internal modules.
- 11.2 End-to-End — Playwright
    - Cover full user flows, API routes, and server-rendered pages.
    - E2E tests live in `e2e/` at the project root.
    - Each flow should have its own spec file: `e2e/auth.spec.ts`, `e2e/dashboard.spec.ts`, etc.
- 11.3 General
    - Aim for high coverage on business logic; do not chase 100% coverage on presentational components.
    - **When** tests are required and what "covered" means is defined in `WORKFLOW.md` §2 — that is the binding rule. This section covers only *how* to write them.

## 12. Styling Rules
- Use SCSS modules (`.module.scss`) — no global styles except in `app/globals.scss`.
- Use SASS nesting ordered by HTML structure.
- Avoid inline styles unless absolutely necessary.
- Extract repeated styles into reusable components or SCSS mixins/variables.
- Use meaningful, descriptive class names in camelCase.

## 13. Forms
- Use `gform-react` library for all forms.
- Use GForm's `validators` prop for form validation.
- Use Server Actions for form submission.

## 14. Naming Conventions
- Use `camelCase` for variables, functions, hooks, and methods.
- Use `PascalCase` for components, classes, types, and interfaces.
- Use `UPPER_SNAKE_CASE` for constants: `API_BASE_URL`.
- Boolean variables must start with: `is`, `has`, `should`, or `can`.

## 15. File Naming Conventions
- Components → own subfolder in `PascalCase`, file matches folder: `UserCard/UserCard.tsx` + `UserCard/UserCard.module.scss`
- Hooks → `kebab-case`: `use-auth.ts`
- Utilities & functions → `camelCase`: `formatDate.ts`
- Services → `camelCase.service.ts`: `user.service.ts`
- Types/interfaces files → `camelCase.types.ts`: `user.types.ts`
- Test files → same name as source + `.test`, lives in the same component folder: `UserCard/UserCard.test.tsx`
- E2E files → `kebab-case.spec.ts`: `user-auth.spec.ts`

## 16. Anti-Patterns to Avoid
- Massive page components — pages compose, features implement
- Deep prop drilling — use composition or context
- Business logic inside JSX
- Anonymous large inline functions
- Global mutable state
- Ignoring loading and error states
- Using `any` type or suppressing TypeScript errors
- Placing feature code inside `app/` directory
- Importing from one feature into another
