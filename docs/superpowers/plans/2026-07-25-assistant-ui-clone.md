# Assistant UI Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transplant the supplied assistant UI into the real application without replacing its domain logic.

**Architecture:** Keep `AssistantProvider` and IndexedDB repositories unchanged. Replace only assistant presentation components and shared shell styling, then connect person evidence to a modal through existing `SourceReference.presentation` data.

**Tech Stack:** Next.js 15, React 19, TypeScript, IndexedDB, Playwright, Vitest, Lucide, Motion.

## Global Constraints

- Work on `main` as explicitly approved by the user.
- Use the supplied ZIP only as a visual/component reference.
- Preserve existing analysis and assistant behavior.
- Commit after verification.

### Task 1: Clone assistant navigation and header
- Modify conversation sidebar, chat header and context strip.
- Preserve conversation CRUD and selection callbacks.

### Task 2: Clone composer and model catalogue
- Preserve provider/model selection, favourites, compatibility checks, context strategy and response mode.

### Task 3: Add person explanation modal
- Open existing structured person evidence in a modal from the corresponding assistant answer.
- Retain source drawer behavior.

### Task 4: Align global shell
- Standardize icon sizing and make Exportar the rightmost top-bar action.

### Task 5: Verify
- Transpile modified TSX files, run `git diff --check`, extend the Playwright person-evidence flow and run full suites when dependencies are available.
