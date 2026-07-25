# Assistant UI Clone Design

**Goal:** Clone the visual language and assistant interface of the supplied reference project while preserving the real application's analysis, privacy, storage and AI functionality.

## Decisions

- The uploaded `retributivo-dashboard(1).zip` is a visual/component reference only.
- The real application remains `erpereh/reg_retributivo_CyC` on `main`.
- Existing IndexedDB repositories remain the source of truth for conversations, messages, citations, model choices and context.
- Conversations survive page reloads and deleted analyses. Deleted-analysis conversations become read-only historical evidence.
- The assistant includes a functional conversation search, conversation creation/switching, model catalogue, provider filter, favourites, response mode, context strategy, context usage and source access.
- Person-review evidence exposes a dedicated explanatory modal after an AI review, while retaining the existing source drawer.
- The global top bar follows the reference; its rightmost primary action is Exportar.
- Existing page functionality and data contracts are unchanged.

## Visual system

- Flat white surfaces, neutral grey canvas, one-pixel borders and almost no card shadow.
- Compact typography and spacing copied from the supplied reference components.
- Lucide icons use consistent dimensions and stroke widths to avoid clipping or malformed rendering.
- Assistant layout: conversation rail, chat header, context strip, timeline, composer/model picker and context panel.

## Verification

- TypeScript syntax transpilation for all modified TSX files.
- `git diff --check` for patch integrity.
- Existing Playwright person-source scenario extended to open and verify the explanatory modal before reopening the source drawer.
- Full dependency-backed test/build/Playwright run is required when npm registry access is available.
