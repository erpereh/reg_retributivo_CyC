# Reference UI Parity Design

## Goal

Adopt the visual language of the approved reference dashboard throughout the existing Registro Retributivo application while preserving all current pages, parsing, comparison, assistant, storage and export behavior.

## Navigation and shell

The sidebar uses the existing views: Inicio, Personas, Conceptos, Cuadre del registro, Agrupaciones, Asistente, Historial and Ajustes. Navigation rows show only icon and label. The brand reads “Retributivo” with “Control salarial”. The analysis card near the top identifies the active analysis and period. The footer replaces the unavailable user profile with an “Análisis activo” card containing real people, document and update data, or “Sin análisis activo”. Operativa and Inteligencia headings establish hierarchy; Ajustes remains separated at the bottom.

The top bar uses a menu/collapse control, global search, theme control, a labelled “Preguntar al asistente” action and contextual actions. Breadcrumb text is removed.

## Visual system

The UI uses a flat, professional system: light neutral canvas, white panels, 1px neutral borders, 12–16px radii, almost no card shadow, compact typography, controlled spacing and a purple primary accent. Decorative gradients, glows, floating orbs and oversized marketing copy are removed. All pages share the same page-heading, toolbar, card, badge and table treatments.

## Dashboard and data pages

Inicio presents a compact heading, four real summary metrics, analysis overview, charts, issues, files/activity and assistant entry points. Existing information remains available, but promotional hero treatments are removed. Tables use stable column widths, compact rows, sticky headers, right-aligned tabular monetary values, subtle status backgrounds and restrained toolbars. Mobile tables scroll horizontally without clipping page actions.

## Assistant

The assistant remains functionally unchanged but is presented as a workspace matching the reference: compact header, flat conversation and context panes, restrained messages, readable Markdown, fixed composer and suggestion cards. Overflow, overlapping text and malformed table rendering are explicitly prevented.

## Responsive and states

Mobile uses a drawer sidebar and one-column cards. Actions wrap without overlap. Empty, loading and error states reuse the same visual language. Dark mode retains hierarchy and contrast without introducing heavy shadows.

## Validation and delivery

Validate unit tests, production build and Playwright. Run the application with the real PDFs and Excel in `fuentes`, inspect every tab, correct visual defects and capture one image per tab. Keep all changes uncommitted on branch `main` for user review.
