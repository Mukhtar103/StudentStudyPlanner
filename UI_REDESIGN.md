# UI redesign — design direction and verification

## Baseline and scope

26 November 2026. React 19, React Router, Vite, Lucide, vanilla CSS. Existing English and Dari/RTL interface, Inter and self-hosted Vazirmatn retained. At baseline, `database/migrate.js` and `server/test/accounts.test.js` already had local changes; these are outside this redesign.

Observed weaknesses: repeated undifferentiated white rectangles, weak separation between filters and results, long flat navigation, small chart areas, and limited hierarchy between statistics, daily work, and secondary actions. Existing forms, dialogs, empty/error/loading states already provide useful semantics and should keep their behavior.

## Research before implementation

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): predictable action placement, quieter navigation, consistent density.
- [Todoist features](https://www.todoist.com/help/todoist/features): focused task views and readable task hierarchy.
- [Notion student dashboard](https://www.notion.com/templates/student-dashboard): grouped academic workspace and overview composition.
- [ClickUp views](https://clickup.com/features/views): distinct containers for different views of existing work.
- [TickTick calendar](https://help.ticktick.com/articles/7055782166172532736): legible schedule organization.
- [Dribbble: School Student Dashboard](https://dribbble.com/shots/20013506-School-Student-Dashboard): student dashboard composition reference, not a copied template.
- [Behance: Notion Student Planner Dashboard](https://www.behance.net/gallery/232993827/-Notion-Student-Planner-Dashboard): search preview reviewed; direct page returned HTTP 403, so its full design was unavailable.
- [Figma Community guide](https://help.figma.com/hc/en-us/articles/360038510693-Guide-to-the-Figma-Community): resource discovery reviewed. No downloadable community kit imported.

## Selected direction: a calm academic workspace

Original composition with an ink-and-indigo welcome panel, pale slate canvas, warm white surfaces, restrained lavender highlights, and emerald/amber status accents. A twelve-column dashboard gives daily work priority and makes weekly progress wider than task completion. Compact metric cards use separate icon and value areas. Navigation gets a prominent active indicator; filters become a consistent control surface. Course, task, schedule and notification records have distinct, readable boundaries. Account sections use a responsive two-column composition.

Use 8/12/16/24/32 px spacing, 12 px controls, 20 px cards, soft layered shadows, 44 px action targets, visible focus rings, and short hover transitions. Keep existing text, fields, routes, states, calculations, forms, handlers, and API calls. Use logical CSS properties for RTL. All decoration must remain non-interactive. No new dependencies or fictional application records.

## Verification

The actual app was started with `npm run dev`: Vite on port 5173 and the API on port 3001. The frontend returned HTTP 200. Browser checks used installed Microsoft Edge through Playwright, with controlled API responses intercepted in the browser. Fixtures exist only in the external verification script, never in application source or the database.

### Implemented visual changes

| Area | Result |
| --- | --- |
| Workspace shell | Pale navigation rail, precise active marker, quieter icons, compact account/language controls, retained mobile profile link and menu behavior |
| Dashboard | Ink/indigo welcome surface, grouped existing quick actions, redesigned metric hierarchy, 12-column bento composition with wider weekly progress chart |
| Academic records | Segmented navigation, consistent filter surface, generous course/term cards, clearer badges and record details |
| Tasks | Readable task rows, distinct priority/status badges, refined deadline and checklist progress presentation, responsive filter grid |
| Study plan and timetable | Clear day headings, highlighted current day, improved session blocks, availability cards and timing forms |
| Calendar | Unified toolbar, readable weekday band, refined current date and event chips; existing month/week/day behavior retained |
| Progress | Larger chart areas, grid guides, coherent planned/actual colors and legends, rounded progress indicators and course summaries |
| Notifications | Better record spacing, action hierarchy, popover, unread marker and reminder forms |
| Profile/settings | Full-width identity/profile section, two-column preferences/security on wide screens, stacked layout on smaller screens; existing section anchors retained |
| Public pages | Editorial landing composition, raised sample schedule, refined authentication panels and readable privacy page |
| Shared states | Purposeful empty surfaces, clearer alerts, consistent skeleton/loading styling, scrollable dialogs with thin scrollbars |
| Accessibility | Visible focus rings, existing labels/ARIA/keyboard semantics preserved, reduced-motion treatment and forced-colors borders |

The existing public sample workspace and its existing sample data were retained. No new features, charts, dashboard data, navigation destinations, menus or fictional records were added to the application.

### Page coverage

Authenticated routes inspected in both languages: dashboard; academic terms and term detail; courses and course detail; tasks and task detail/subtasks; study plan and session detail; weekly availability; timetable; calendar; progress; notifications; profile; settings.

Public routes inspected: landing; sign in; register; forgot password; reset-password invalid-link state; privacy; preview dashboard and all seven existing preview module routes; not-found page. Shared components carry the visual design to nested forms and dialogs. This does not claim every possible data-dependent or mutation state was exercised.

### Automated checks

- `npm run lint`: passed.
- `npm run build`: passed. No packages were installed or updated.
- `npm test`: 31 tests discovered, **18 passed, 13 skipped, 0 failed**. Skipped tests require a configured integration-test database and were not rerun against live data for this visual task.
- Existing Dari browser harness: **27 responsive route checks passed**, including language persistence, self-hosted Vazirmatn loading, Dari numeral formatting, the existing eight-character password limit, untouched user record titles, study dialog timing input, and language preference saving.
- Comprehensive browser matrix: **194 route/viewport checks passed**, English/LTR and Dari/RTL at widths 1440, 768 and 390 px, plus dashboard/tasks/calendar/settings at 320 px. No document horizontal overflow or unexpected alerts in authenticated normal states. Results: `../outputs/ui-redesign/browser-results.json`.
- Additional modes: **32 checks passed** for calendar week/day, study day view, and term/course/study/availability/reminder dialogs at desktop and mobile widths in both languages. Dialogs fit horizontally and close through Escape. Results: `../outputs/ui-redesign/additional-modes-results.json`.
- Across the comprehensive, additional-mode and existing Dari harnesses: **253 browser view checks**, with no captured JavaScript page errors. These counts describe UI checks, not 253 independent business-logic tests.
- `git diff --check`: passed. Runtime change audit: only a stylesheet import plus the new CSS file. Baseline backend file hashes remained identical.

Interaction checks cover menu open/close and Escape, sidebar navigation, priority filtering, debounced search, clearing filters, task creation request payload, calendar event dialog/Escape, notification read request, notification popover/Escape, profile and preferences submission, error retry, empty/loading states, sign-in validation/request payload, reduced motion, keyboard focus and mobile profile access. Settings anchor positions are checked against their corresponding sections.

### Modified project files

1. `client/src/styles/redesign.css` — new presentation-only theme, layout and responsive rules.
2. `client/src/main.jsx` — one added CSS import; all routing and rendering logic retained.
3. `UI_REDESIGN.md` — design direction, research and verification report.

External verification files: `../work/test_redesign_ui.cjs`, `../work/test_redesign_modes.cjs` (which reuses its isolated fixtures), existing `../work/test_dari_ui.cjs`, and `../outputs/ui-redesign/` screenshots/results. These are outside the application repository and are not runtime dependencies.

### Screenshot evidence

All screenshot files are in `../outputs/ui-redesign/`. They show test-only browser fixtures, not changes to production data.

- `before-dashboard.png` — baseline with the new theme disabled.
- `en-1440-dashboard.png` / `fa-AF-1440-dashboard.png` — desktop dashboard.
- `en-768-dashboard.png` / `fa-AF-768-dashboard.png` — tablet dashboard.
- `en-390-dashboard.png` / `fa-AF-390-dashboard.png` — mobile dashboard.
- `en-1440-settings.png`, `en-1440-courses.png`, `en-1440-tasks.png`, `en-1440-calendar.png`, `en-1440-progress.png` — module examples; Dari counterparts are also included.
- `en-landing.png`, `en-register.png`, and Dari counterparts — public pages.
- `en-390-task-dialog.png`, `en-empty-state.png`, `en-error-state.png`, `en-loading-state.png` — dialog and state evidence.

### Scope audit and practical limits

Backend implementation, database schema and records, API endpoints/contracts, authentication and authorization, business logic, state, calculations, handlers, validation, routing, translations, fonts, environment files and deployment configuration were not changed by this redesign. No application JavaScript changed except the stylesheet import.

The two pre-existing local changes remain untouched. Their SHA-256 hashes match the baseline:

```text
database/migrate.js
DB877566AF818C5864598FBCC03AD8960508DCEAAAC176A6E89D0B279D585910
server/test/accounts.test.js
1BCCB577F00B71F1C6F186E7CD98BD37B583C5DFDF5F90F7D5628C8827B1EB64
```

Browser verification used Edge on Windows. Safari, Firefox, real mobile hardware, a full screen-reader/contrast audit, email delivery, and end-to-end production database mutations were not verified. A successful mocked request confirms the frontend still produces the expected request, not that an external service completed it. No deployment, commit or push was performed. No known horizontal overflow remained in the checked views; long forms intentionally scroll within dialogs.

### Publishing the reviewed design

From the existing project directory, stage only the visual changes and this report:

```powershell
git add client/src/main.jsx client/src/styles/redesign.css UI_REDESIGN.md
git commit -m "Redesign planner interface with responsive bilingual theme"
git push origin main
```

The existing Render/Vercel deployment process can then build the change. No database migration or environment-variable change is needed for this UI redesign.
