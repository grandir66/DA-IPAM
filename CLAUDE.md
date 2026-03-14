# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web-based networking application (DA-IPAM). The project needs to be bootstrapped — no code exists yet.

**Planned Stack:** Next.js 14+ (App Router), TypeScript (strict mode), Tailwind CSS, shadcn/ui, framer-motion, Zod.

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # Lint check
```

## Architecture

Uses Next.js App Router layout:

- `src/app/` — Pages and API routes
- `src/components/ui/` — shadcn/ui components
- `src/components/shared/` — Reusable components (Card, Navbar, etc.)
- `src/lib/` — Utilities (auth, db, API helpers)

## Code Conventions

- TypeScript strict mode, no `any`
- Functional components with named exports and TypeScript interfaces
- React Hooks (useState, useEffect) or React Query for data fetching
- Tailwind CSS utility classes only (no custom CSS files)
- Zod for form validation on both client and server
- Auth tokens stored in HttpOnly cookies (never localStorage)
- CSRF and XSS protection required; sanitize all user input

## Design Guidelines

- Minimalist soft UI: subtle gradients, soft shadows, spacious layout (8px/16px gap)
- Typography: Inter or Geist font family
- Animations via framer-motion for page transitions and micro-interactions
- shadcn/ui as the component library for consistency and accessibility