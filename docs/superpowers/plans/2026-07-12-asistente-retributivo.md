# Asistente Retributivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` task-by-task. Every production change follows RED → verify RED → GREEN → refactor, then spec and quality review.

**Goal:** Deliver a private, traceable, local-first assistant that uses Retributivo's existing results as its numeric source of truth without changing the current analysis pipeline.

**Architecture:** The Assistant is an isolated client-side domain with its own repositories and IndexedDB database. Analysis ingestion starts only after the current analysis succeeds, providers receive only sanitized text through three internal routes, and all streaming uses validated NDJSON over `fetch`/`ReadableStream`.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Zod, Vitest, IndexedDB, motion/react. Reuse existing parsers and dependencies before adding any package.

## Global constraints

- Do not change the request/response contract or calculations of `/api/analyze` or any existing `/api/analyze/stream` consumer.
- Assistant ingestion errors may only produce `partial` or `error`; they never fail analysis, history, export, Personas, Cuadre Reg. or Agrupaciones.
- Pipeline order per unit is extraction → PII identification → anonymization → safety assertion → chunking → indexing → IndexedDB transaction.
- Never persist or index raw text, original filenames, paths, authors, Office/PDF metadata, API keys or sensitive identifiers.
- All money values come from `AnalysisResult` or shared domain selectors; never duplicate payroll formulas.
- The only stream protocol is UTF-8 NDJSON with `status`, `tool_request`, `tool_result_ack`, `text_delta`, `source`, `action`, `usage`, `done`, `error`.
- Internal routes are limited to `/api/assistant/models`, `/api/assistant/chat`, and optional `/api/assistant/documents/parse`.
- No auth, users, remote DB, sharing, external extraction/OCR/embeddings/storage, custom encryption or destructive business actions.
- Use `cmd /c pnpm ...` on Windows. Never run build and TypeScript concurrently.
- Every phase ends with focused tests, spec review, quality review, the specified commit, and a clean worktree.

---

## Preparation: approved documents

**Files**
- Create: `docs/superpowers/specs/2026-07-12-asistente-retributivo-design.md`
- Create: `docs/superpowers/plans/2026-07-12-asistente-retributivo.md`

- [ ] Review both documents for all approved corrections, type consistency, privacy coverage, placeholders and phase size.
- [ ] Run `rg -n "TBD|TODO|implement later|fill in" docs/superpowers` and resolve every hit that is a placeholder.
- [ ] Run `git diff --check`.
- [ ] Commit: `docs(ai): define assistant design and phased plan`.

## Phase 0: exact baseline

### Task 0.1: Capture repository baseline

**Files**
- Create: `docs/superpowers/reports/2026-07-12-asistente-retributivo-baseline.md`

- [ ] Record `git branch --show-current`, `git status --short`, `git log --oneline -5`, and `git stash list`.
- [ ] Run sequentially and record exact exit codes and summarized failures:
  - `cmd /c pnpm test`
  - `cmd /c pnpm exec tsc --noEmit --incremental false`
  - `cmd /c pnpm build`
  - `git diff --check`
- [ ] Classify every failure as pre-existing, environmental, or introduced; do not alter unrelated fixtures or mocks.
- [ ] If and only if a pre-existing defect materially blocks Assistant work, reproduce it with a focused test and fix it in a separate commit.
- [ ] Commit baseline report: `chore(ai): record assistant verification baseline`.

## Phase 1: domain, persistence, and first vertical slice

### Task 1.1: Domain contracts and NDJSON protocol

**Files**
- Create: `src/lib/assistant/domain.ts`
- Create: `src/lib/assistant/schemas.ts`
- Create: `src/lib/assistant/streamProtocol.ts`
- Test: `tests/assistant/domain.test.ts`
- Test: `tests/assistant/stream-protocol.test.ts`

**Produces**
- `Conversation`, `ChatMessage`, `ChatEvent`, `ChatAction`, `SourceReference`, `ModelProfile`, `DocumentScope`, `SourceAvailability`.
- Discriminated `AssistantStreamEvent` union and incremental NDJSON decoder.

- [ ] Write failing tests for conversation invariants, one-analysis-only conversion, message statuses, source scopes and every allowed NDJSON event.
- [ ] Verify malformed JSON, unknown event types and invalid payloads fail closed without regex or Markdown parsing.
- [ ] Implement minimal Zod schemas and decoder; run focused tests green.

### Task 1.2: IndexedDB repositories

**Files**
- Create: `src/lib/assistant/storage/database.ts`
- Create: `src/lib/assistant/storage/repositories.ts`
- Create: `src/lib/assistant/storage/indexedDbRepositories.ts`
- Test: `tests/assistant/storage.test.ts`

**Stores**
- `conversations`, `messages`, `events`, `actions`, `sources`, `documents`, `chunks`, `searchTerms`, `snapshots`, `cache`, `analysisVersions`, `indexJobs`, `modelProfiles`, `assistantSettings`, `cleanupJobs`.

- [ ] Audit the existing native IndexedDB helper before adding `idb`; document any dependency decision and pin an exact version.
- [ ] Write RED tests for create/reload, cursor pagination, migration, transactional writes, quota errors and absence of localStorage fallback.
- [ ] Add `fake-indexeddb` as an exact dev dependency only if no equivalent test utility exists.
- [ ] Implement repository interfaces first, then the IndexedDB adapter.

### Task 1.3: Minimal fake chat and local Person tool

**Files**
- Create: `src/lib/assistant/providers/fakeAdapter.ts`
- Create: `src/lib/assistant/tools/personTools.ts`
- Create: `src/components/assistant/AssistantProvider.tsx`
- Create: `src/components/assistant/AssistantView.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/components/dashboard/DashboardApp.tsx`
- Modify: `src/components/layout/TopNav.tsx`
- Test: `tests/assistant/vertical-slice.test.tsx`
- Test: `tests/top-nav.test.tsx`

- [ ] Write a RED end-to-end component test for: general conversation → fake NDJSON stream → reload → convert to active analysis → associate person → `getPersonProfile` → sanitized source.
- [ ] Assert that a general conversation receives only the static Retributivo glossary prompt and cannot read the active analysis, people, payrolls or Registro before explicit conversion.
- [ ] Persist only sanitized `ChatMessage.content`; raw composer text is ephemeral and is cleared after send/unmount.
- [ ] Write a RED parity test comparing `getPersonProfile` totals with the existing Persona row.
- [ ] Implement the smallest accessible Assistant view needed for the vertical slice.
- [ ] Keep stream state inside `AssistantProvider`; do not add keys or per-token state to `AppState`.
- [ ] Run all Phase 1 tests and existing navigation/Persona tests.
- [ ] Commit: `feat(ai): add assistant domain and local persistence`.

## Phase 2: privacy, sources, and document pipeline

### Task 2.1: Deterministic privacy boundary

**Files**
- Create: `src/lib/assistant/privacy/sanitize.ts`
- Create: `src/lib/assistant/privacy/patterns.ts`
- Create: `src/lib/assistant/privacy/assertions.ts`
- Test: `tests/assistant/privacy.test.ts`

- [ ] Write RED cases for known names, DNI/NIE/NIF, IBAN, Social Security, accounts, banks, emails, phones, addresses and unsafe labeled lines.
- [ ] Test recursive persistence auditing for `documents`, `chunks`, `searchTerms`, `sources`, `snapshots`, `cache`, `indexJobs` and errors.
- [ ] Implement `redactKnownPersonValues`, `detectSensitivePatterns`, `sanitizeForAI`, `assertSafeForProvider`, and `assertSafeForPersistence` with fail-closed behavior.

### Task 2.2: Local-first ingestion service

**Files**
- Create: `src/lib/assistant/documents/ingestionService.ts`
- Create: `src/lib/assistant/documents/clientParsers.ts`
- Create: `src/lib/assistant/documents/chunker.ts`
- Create: `src/lib/assistant/search/directIndex.ts`
- Create: `src/app/api/assistant/documents/parse/route.ts` only if browser processing is not viable
- Test: `tests/assistant/ingestion.test.ts`
- Test: `tests/assistant/document-route.test.ts` only if route exists

- [ ] Prove with a RED compatibility test that analysis still resolves when ingestion fails.
- [ ] Add TXT/Markdown/CSV first; then PDF/XLSX; add DOCX last and only after dependency audit.
- [ ] Define and test complete receipt units (page, lines/blocks, concepts/codes/descriptions, units, prices, amounts, earnings/deductions, bases, totals and safe origin) and complete Registro units (all sheets/cells, address, raw/formatted value, formula/cached result, relations and merges).
- [ ] Persist only after safety, chunking and indexing; derive snippets and hashes only from sanitized values.
- [ ] Keep `localDisplayName` ephemeral and persist/send only `sanitizedSourceLabel`.
- [ ] Mark scanned PDFs without text as non-indexable; do not add OCR.

### Task 2.3: General-conversation documents and source lifecycle

**Files**
- Create: `src/lib/assistant/documents/documentActions.ts`
- Create: `src/lib/assistant/sources/sourceLifecycle.ts`
- Test: `tests/assistant/general-documents.test.ts`
- Test: `tests/assistant/source-lifecycle.test.ts`

- [ ] Test strict conversation scoping, explicit copy to a selected destination, delete-by-default and confirmed transfer.
- [ ] Test `available`, `historical_unavailable`, and `deleted`; only `available` participates in retrieval/navigation.
- [ ] Run the complete privacy suite and Phase 2 tests.
- [ ] Commit: `feat(ai): add sanitized document context pipeline`.

## Phase 3: real providers and model settings

### Task 3.1: Provider adapters and ephemeral key vault

**Files**
- Create: `src/lib/assistant/providers/types.ts`
- Create: `src/lib/assistant/providers/geminiAdapter.ts`
- Create: `src/lib/assistant/providers/openAiCompatibleAdapter.ts`
- Create: `src/lib/assistant/providers/ephemeralKeyVault.ts`
- Test: `tests/assistant/provider-adapters.test.ts`
- Test: `tests/assistant/ephemeral-key.test.ts`

- [ ] Reuse `@google/genai` and native fetch unless an additional SDK is demonstrably required.
- [ ] Implement presets Gemini/OpenAI/OpenRouter/Cerebras/Groq/Manual and document `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY` without values.
- [ ] Verify each adapter against current official documentation; resolve context window only by provider metadata → versioned internal catalog → manual value.
- [ ] Ensure the manual key is held in a closure, never serializable React state, storage, URL, global server variable, logs or errors.
- [ ] Implement adapters behind `AIProviderAdapter`; no domain module imports provider SDKs.

### Task 3.2: Model route and behavioral capability probe

**Files**
- Create: `src/app/api/assistant/models/route.ts`
- Create: `src/lib/assistant/server/modelService.ts`
- Test: `tests/assistant/models-route.test.ts`

- [ ] RED-test `list`, `probe`, and `restore_detected` operations.
- [ ] Probe connection, real streaming/adaptation, tools, valid structured args, structured response, sufficient window, cancellation and sanitized errors.
- [ ] Require room for measured instructions/tools, 2,048 output tokens and safety margin.
- [ ] Manual override copy is exactly: `Compatibilidad habilitada manualmente y no garantizada.`

### Task 3.3: Ajustes > IA

**Files**
- Create: `src/components/settings/AssistantAiSettings.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Test: `tests/assistant/settings-ai.test.tsx`

- [ ] Add model profiles, defaults, probes, overrides, storage metrics/cleanup and the exact IndexedDB disclosure from the design.
- [ ] Document server-only env names without values in `.env.example`.
- [ ] Run Phase 3 and existing Settings tests.
- [ ] Commit: `feat(ai): add configurable model providers`.

## Phase 4: orchestration and advanced context

### Task 4.1: Read-only tool registry and parity

**Files**
- Create: `src/lib/assistant/tools/registry.ts`
- Create: `src/lib/assistant/tools/analysisTools.ts`
- Create: `src/lib/assistant/tools/sharedSelectors.ts`
- Test: `tests/assistant/tools.test.ts`

- [ ] Add the approved tool allowlist with Zod input/output and analysis scoping.
- [ ] Compare Person and Cuadre tool results exactly with existing view selectors.
- [ ] Any new aggregate must be a shared selector over `AnalysisResult`, never a duplicated formula.

### Task 4.2: Context planning, token budget and compaction

**Files**
- Create: `src/lib/assistant/context/contextPlanner.ts`
- Create: `src/lib/assistant/context/tokenBudget.ts`
- Create: `src/lib/assistant/context/compaction.ts`
- Test: `tests/assistant/context.test.ts`

- [ ] RED-test automatic/full/optimized strategies, dedupe by `sourceId + sanitizedHash + factKey`, 10% margin, 75% warning and 85% compaction.
- [ ] Set global defaults to strict/automatic, allow per-conversation overrides, and test strict and flexible response section semantics.
- [ ] Ensure full context means all relevant deduplicated sanitized content that fits, not indiscriminate inclusion.
- [ ] Preserve lineage, decisions, figures, sources, actions, people and analysis version.

### Task 4.3: Chat route, orchestration and bounded fallback

**Files**
- Create: `src/app/api/assistant/chat/route.ts`
- Create: `src/lib/assistant/server/chatService.ts`
- Create: `src/lib/assistant/orchestration/assistantOrchestrator.ts`
- Test: `tests/assistant/chat-route.test.ts`
- Test: `tests/assistant/fallback.test.ts`

- [ ] Implement phases `plan`, `respond`, `continue` over one NDJSON route and at most three tool rounds.
- [ ] Revalidate privacy on client and server for every round.
- [ ] Allow one transient retry and one compatible default switch only.
- [ ] Never fallback for auth, privacy block, incompatibility, bad context window or user cancellation.
- [ ] Preserve partial output as `interrupted`; continue in a new message with each model identified.
- [ ] Commit: `feat(ai): add contextual assistant orchestration`.

## Phase 5: complete Assistant interface

### Task 5.1: Three-panel shell, history and mobile drawers

**Files**
- Create: `src/components/assistant/AssistantShell.tsx`
- Create: `src/components/assistant/ConversationSidebar.tsx`
- Create: `src/components/assistant/ConversationTimeline.tsx`
- Create: `src/components/assistant/ContextSidebar.tsx`
- Create: `src/components/assistant/AssistantDrawer.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/assistant/assistant-layout.test.tsx`

- [ ] Build desktop conversations/chat/context panels and full-screen mobile chat with two accessible drawers.
- [ ] Test Escape, focus restoration, hidden content, keyboard order and global overflow at approved breakpoints.

### Task 5.2: Timeline, composer, sources, actions and Markdown

**Files**
- Create: `src/components/assistant/AssistantComposer.tsx`
- Create: `src/components/assistant/AssistantMessage.tsx`
- Create: `src/components/assistant/ConversationEvent.tsx`
- Create: `src/components/assistant/SourceSummary.tsx`
- Create: `src/components/assistant/SourceDetails.tsx`
- Create: `src/components/assistant/ActionProposal.tsx`
- Create: `src/components/assistant/SafeMarkdown.tsx`
- Create: `src/components/assistant/PersonContextPicker.tsx`
- Create: `src/components/assistant/ContextUsageDetails.tsx`
- Test: `tests/assistant/assistant-ui.test.tsx`

- [ ] Audit existing rendering utilities before adding markdown packages; pin exact versions and lazy-load if added.
- [ ] Reject arbitrary HTML and unsafe URL schemes; visual blocks and actions use structured allowlists only.
- [ ] Aggregate `aria-live` announcements instead of announcing tokens.
- [ ] Add 120–240 ms functional motion with reduced-motion behavior.
- [ ] Implement send/stop/regenerate/copy, conversation search/rename/archive/delete, associated-person selection/primary/removal, model/mode/strategy controls, indexing/token details, source expansion, safe actions, comparison table and timeline blocks.
- [ ] Commit: `feat(ai): add assistant conversation interface`.

## Phase 6: functional integrations

### Task 6.1: Persona and navigation intents

**Files**
- Extract the current Person detail modal into a focused component
- Modify: `src/components/tables/TablesView.tsx`
- Modify: `src/components/app/AppState.tsx`
- Test: `tests/assistant/person-integration.test.tsx`

- [ ] Continue in an existing same-analysis conversation or choose/create one; never duplicate the person or auto-call a model.

### Task 6.2: Analysis deletion, versioning and safe actions

**Files**
- Create: `src/lib/assistant/integrations/analysisCleanup.ts`
- Create: `src/lib/assistant/integrations/analysisVersion.ts`
- Modify: `src/components/history/HistoryView.tsx`
- Test: `tests/assistant/analysis-cleanup.test.ts`
- Test: `tests/assistant/actions.test.ts`

- [ ] Implement cancel/delete-all/preserve-conversations through idempotent cleanup jobs.
- [ ] Hash only canonical sanitized calculation-affecting values.
- [ ] Keep preserved conversations read-only and cited sources inert.
- [ ] Implement safe structured navigation/context/visual actions; reject destructive and Markdown-derived actions.
- [ ] Define and validate the exact discriminated action union from the design: `open_person`, `open_cuadre`, `open_grouping`, `show_sources`, `add_person`, `remove_person`, `set_primary_person`, `compare_people`, `generate_visual`, `show_comparison_table`, `show_timeline`, `create_conversation`, and `copy_document_context`, with their typed IDs and person/document arrays.
- [ ] Commit: `feat(ai): integrate assistant with analyses and people`.

## Phase 7: performance and integral verification

### Task 7.1: Measure before Worker

**Files**
- Create benchmark fixtures/tests under `tests/assistant/performance/`
- Create `WorkerIndexExecutor` only if thresholds are demonstrated

- [ ] Measure direct indexing with large sanitized fixtures.
- [ ] Add a Worker only for a >50 ms main-thread task or >5,000 chunks with measured UI responsiveness loss.
- [ ] Keep `IndexExecutor` interchangeable without domain/repository changes.

### Task 7.2: E2E, accessibility and final audit

- [ ] Audit for an existing browser runner before adding exact-version `@playwright/test` as dev-only.
- [ ] Cover reload persistence, general→analysis, people, partial indexing, stop/retry/fallback, source states, key disappearance, mobile drawers and reduced motion using fake providers.
- [ ] Run sequentially:
  - `cmd /c pnpm test`
  - available E2E/browser suite
  - `cmd /c pnpm exec tsc --noEmit --incremental false`
  - `cmd /c pnpm build`
  - `git diff --check`
  - `git status --short`
- [ ] Distinguish passed/skipped tests, pre-existing/new TypeScript and build errors, privacy and accessibility results.
- [ ] Run final whole-branch spec and quality review; fix every Critical/Important finding and re-review.
- [ ] Perform the approved manual matrix: general chat, attach/convert analysis, reject second analysis into same conversation, Persona entry, many people/primary/removal, model/mode/strategy, compaction/small model/fallback, partial/full indexing, sources/actions/visuals, stop/reload, both analysis-deletion paths, ephemeral key reload, mobile and reduced motion.
- [ ] Produce the final 39-part report covering branch, documents, architecture, files, IndexedDB/migrations, document pipeline/extraction, privacy/index/tools/providers/models/capabilities/keys/context/compaction/stream/sources/actions/integrations, responsive/motion/accessibility, tests/skips/TypeScript/pre-existing/new errors/build/diff, commits/Git status/limitations/future DB.
- [ ] Commit: `test(ai): verify assistant workflows and privacy`.

## Phase handoff contract

After each phase, report the commit, focused/full tests, errors, created/modified files, clean Git status and next phase. If capacity is low, stop only after the phase commit with:

> Continúa el plan del Asistente Retributivo desde la Fase N+1. Verifica primero la rama, el árbol limpio, el último commit y `.superpowers/sdd/progress.md`. No repitas fases completadas. Sigue TDD, revisión de especificación, revisión de calidad y commit de fase.
