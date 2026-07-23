# Professional UI Redesign Implementation Plan

**Goal:** Redesign the complete application interface while preserving the existing seven views and all business, parser, storage, export, privacy, and assistant behavior.

**Architecture:** Keep `AppState`, API routes, parsers, IndexedDB repositories and domain types unchanged. Replace the application shell and visual tokens, then improve shared presentation components so every current view inherits the same professional design system.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Motion, Lucide React, Recharts, Vitest and Playwright.

## Global Constraints

- Preserve exactly these primary views: Dashboard, Personas, Cuadre Reg., Agrupaciones, Asistente, Historial and Ajustes.
- Do not add accounts, login, users, organizations or roles.
- Do not alter salary calculations, document parsing, matching, export, storage or assistant privacy behavior.
- Respect `prefers-reduced-motion` and keyboard navigation.
- Validate with tests, production build and screenshots for all seven primary views.

## Tasks

- [x] Replace the floating tab header with a responsive sidebar and compact topbar.
- [x] Preserve tab roles, labels, focus restoration and current AppView values.
- [x] Keep Export Excel and Nuevo análisis actions wired to AppState.
- [x] Upgrade colors, spacing, elevation, cards, headings, inputs and data tables.
- [x] Improve the dashboard hierarchy without changing UploadPanel, SummaryCards or ChartsPanel behavior.
- [x] Add Playwright screenshots for all seven primary views.
- [x] Add pull-request validation for tests, build and screenshots.
- [ ] Review generated screenshots and merge the verified commit to main.
