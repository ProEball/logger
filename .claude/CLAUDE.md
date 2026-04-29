# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Next.js 16 app using the App Router with TypeScript and ESLint. No Tailwind, no `src/` directory — pages and components live directly under `app/`.

## Common Commands

```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # production build
npm run start    # run production server
npm run lint     # run ESLint
```

## Architecture

- `app/` — App Router: layouts, pages, and route segments
- `public/` — static assets served at root
- `next.config.ts` — Next.js configuration
- `tsconfig.json` — TypeScript configuration

Route files follow Next.js App Router conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, etc.

@rules/PROJECT.md