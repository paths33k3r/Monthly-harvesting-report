# AntiGravity Monthly Harvesting Report — Claude Context

## Project overview
A browser-based web app (vanilla JS, no build step) for managing plantation data and downloading formatted Excel reports. Served locally via any static HTTP server (e.g. `npx serve .` or VS Code Live Server). Data persists in Firebase cloud storage and the user's browser.

## Running the app
```
cd "c:/Users/user/Anti Gravity/Monthly harvesting report"
npx serve .          # then open http://localhost:3000
```
or open with VS Code Live Server (right-click index.html → Open with Live Server).

**Important:** Must be served via HTTP, not opened as a file:// URL — the Excel template fetch requires an HTTP server.

## Key files
| File | Purpose |
|---|---|
| `index.html` | Entry point — loads all scripts with `?v=N` cache-busting |
| `workspace.js` | **Multi-workspace** (Oil Palm / Tree Planting) — namespaces every Firebase path, sidebar switcher + branding, per-workspace menu hiding. Loaded first. |
| `script.js` | Main app logic, Firebase sync, UI rendering |
| `render_reports.js` | **Excel report downloads** — YTD, Rainfall, Spraying |
| `render_spraying.js` | Spraying section UI + `getDefaultSprayingData()` |
| `render_manuring.js` | Manuring section UI |
| `render_ytd_report.js` | YTD report UI |
| `render_ironhorse.js` | Iron Horse section UI — Assets, Expenses, template download, import |
| `render_interval_monitor.js` | **Interval Monitor** — days-between-rounds compliance (ISO-week review, printable field sheet, interval log) derived from the Harvesting Interval grid |
| `render_maintenance.js` | Maintenance Gangs, Work Log & Gantt Chart (digitises the hand-written Gantt sheets) |
| `render_wages.js` | **Rate of Wages** — per-gang/month payment calc (FFB rate × net MT − daily-rate blocks − penalty) + Excel report |
| `render_weekly.js` | **Weekly Activity** — track-driven field report: KMZ/KML/GPX import, Leaflet satellite map, photo storage, Word `.docx` export |
| `render_wages_employees.js` | **Employee Master** — EMS master-listing import (.xls via SheetJS), per-agent headcount, working-permit flags, first sub-tab under Rate of Wages |
| `render_wages_prodcost.js` | **Production Cost** — labour-cost summary derived from the Wage Ledger for a free date range, Local/Permit/Gelap split via Employee-Master ID prefixes |
| `render_tree_logs.js` | **Tree Logs Recording** (Tree Planting workspace only) — ACMG-style master summary of all delivery batches, KU-style species/grade drilldown, manual entry, Excel import/template/export, analytics |
| `render_pec.js` | **PEC Application** (Tree Planting workspace only) — Forest Dept PEC register: applications with nested blocks, derived status, pending-approval banner, letter PDF attachments, coupe analytics, Excel import/template/export |
| `render_hyr.js` | **Half-Yearly Report** (Tree Planting workspace only) — Director-of-Forests filing: master-template import/export via row-cloning XML surgery; Appendix 9/5/4A/4B/6A/6B live-editable (flat + grouped row-cloning engines) |
| `Report samples/` | Excel templates used as base for downloads |

## Cache busting
Each script in `index.html` is loaded with a `?v=N` query string. **When editing a file, increment its `?v=N` in `index.html`** so browsers fetch the new version. The numbers are independent per file — read the current value from `index.html` rather than trusting a copy here (it goes stale fast).

## Current branch
Feature branches are named by timestamp (e.g. `2026-05-29_08-51-21`), branched off `main`.

## Git workflow
- Main branch: `main`
- Remote: https://github.com/paths33k3r/Monthly-harvesting-report.git
- `git pull` then open with Live Server — no build step needed

---

## Multi-workspace — Oil Palm / Tree Planting (workspace.js)

### Overview
A single switcher in the sidebar header (`<select id="workspace-switcher">`, injected by `workspace.js`) toggles between two **fully isolated** workspaces: **🌴 Oil Palm** (the original app/data) and **🌳 Tree Planting** (new, starts empty). Same logins & permissions apply to both. The choice is **per-device** (`localStorage.active_workspace`) and switching does a **page reload** so no data bleeds across.

### How isolation works (the core trick)
The whole app uses ONE Firebase Realtime DB object (`firebase.database()` is a singleton; every `window._xxxDb` points at it). `workspace.js` patches that object's `.ref()` **once** (`window._wsPatchDb(db)`, called from `app_boot.js` immediately after the db is created — before any `.ref()` call). So **no per-module edits** are needed. Path rewrite (`window._wsPath`):
- **Oil Palm** → legacy paths unchanged: `shared/app_state`, `shared/spraying_data`, … (zero migration, existing data untouched).
- **Tree Planting** (any non-oil-palm id) → `shared/ws/<id>/app_state`, `shared/ws/<id>/spraying_data`, …
- **Global paths NOT namespaced**: `user_roles/*`, `user_prefs/*`, `_ui_probe`, `users/<uid>/*` (legacy). Logins/permissions are shared.
- Namespaced paths still contain `/shared/`, so the dirty-tracking patch (ui_enhancements.js) and the rules' `shared` read scope keep working.

### Key globals (all defined in workspace.js)
| Symbol | Purpose |
|---|---|
| `window.ACTIVE_WORKSPACE` | current id (`'oil_palm'` default), read from localStorage at load |
| `window.WORKSPACES` | `{ id, label, logo, subtitle, hiddenAreas[], hiddenItems[] }` per workspace |
| `window._wsPath(path)` | rewrites a `shared/*` path for the active workspace |
| `window._isOilPalmWorkspace()` | guard used in script.js to skip Oil-Palm-only seeding |
| `window._wsPatchDb(db)` | wraps `db.ref` (idempotent); called once in app_boot.js |
| `window.switchWorkspace(id)` | confirm → set localStorage → reload |
| `window.applyWorkspaceMenus()` | hides menus not in the active workspace; called in script.js after `applyRolePermissions()` |

### Empty-workspace guards (script.js `init()`)
So a fresh Tree Planting never inherits Oil Palm data, three reads are guarded with `_isOilPalmWorkspace()`: the `users/<uid>/app_state` & `users/<uid>/spraying_data` legacy migrations, and the `harvesting_app_state` localStorage fallback. `loadFreshData()` also skips the `grouped_data.json` block seed for non-oil-palm (blank planting record).

**Exception — one-time rainfall seed:** rainfall-to-date is the same for both systems, so a non-Oil-Palm workspace whose rainfall record is still empty copies Oil Palm's `state.rainfall` once on load (block right after the app_state load in `init()`), then the two are edited separately. Guarded by `state._rainfallSeededFromOilPalm` (ISO timestamp) so it never re-seeds. The read reaches Oil Palm's legacy path via `db.ref().child('shared/app_state')` — `_wsPatchDb` only rewrites *string* `ref()` calls, so a no-arg root ref + `.child()` bypasses the workspace namespacing (verified: `ref('shared/app_state')` → `shared/ws/tree_planting/app_state`, `ref().child('shared/app_state')` → legacy path).

### Workspace menu split (current state)
`WORKSPACES.oil_palm.hiddenAreas = ['treelogs', 'hyr']` (Tree-Planting-only features) · `WORKSPACES.tree_planting.hiddenAreas = ['ffbBudget', 'performance', 'ironhorse', 'weekly']` (Oil-Palm-only — tree planting will get its own performance module later). Everything else shows in both.

### Per-workspace menu exclusivity (groundwork — default = full copy)
`WORKSPACES[ws].hiddenAreas` (array of `data-menu-key` values, e.g. `ironhorse`, `wages`, `maintenance`) hides whole functional areas incl. submenus; `hiddenItems` (array of sidebar element ids, e.g. `sidebar-ytd`) hides single rows. Both default `[]` so every menu shows in both workspaces. `applyWorkspaceMenus()` marks rows it hides with `data-ws-hidden` and restores them on re-run, so it never reveals role-hidden items. **To make a report exclusive, add its key/id to the list** — no other code needed. (Deep-link `#nav=` / command-palette / Reports-panel guarding is NOT yet wired — a later refinement.)

### Security rules
`database.rules.json` adds a `shared/ws/$workspace/*` block mirroring the per-section Oil Palm rules. **Must be published in the Firebase console** (Realtime DB → Rules → Publish) — until then, all Tree Planting writes are denied by default-deny and saves silently fail.

### Not yet workspace-aware
`field.html` / `field_boot.js` (phone weekly-report companion) still targets Oil Palm's `shared/weekly_activity_data` only — separate entry point, deferred.

---

## Maintenance module (render_maintenance.js)

### Overview
Sub-items under the **Maintenance** sidebar menu (alongside Spraying/Manuring/Slashing/Pruning):
- **👥 Gangs** — create maintenance gangs; headcount + members stored **per month** so editing one month never touches earlier months.
- **📝 Work Log** — daily work entries: gang, activity, block, date range, persons, round/method. Supervisor verification toggle in the first column: `–` unverified / `✓` verified (gated by `window._canEdit('maintenance')`). Editing a verified entry resets it to unverified.
- **📊 Gantt Chart** — bars across the days of the selected month, grouped by **block + gang + activity**. Striped bar = unverified, solid = verified. Bottom `Manpower / day` row sums persons per day. Activity filter dropdown.

### View types & wiring
- `state.activeViewType`: `maintenance_gangs` | `maintenance_worklog` | `maintenance_gantt`
- Sidebar ids: `sidebar-mnt-gangs` / `-worklog` / `-gantt` (handlers in script.js)
- Wrappers: `maintenance-gangs-wrapper` / `-worklog-wrapper` / `-gantt-wrapper` (index.html)
- Render fns: `window.renderMaintenanceGangs/WorkLog/Gantt`
- Active year/month: `state.maintYear` / `state.maintMonth`

### Data structure (`state.maintenance`)
```js
{
  "2026": {
    activityTypes: ["Spraying","Slashing","Manuring","Pruning"], // configurable per year
    gangs: { "Anwar gang": { months: { "APR": { headcount:4, members:["Anwar","Jono"] } } } },
    entries: [ { id, gang, activity, block, dateStart, dateEnd, persons, round, method, verified, verifiedBy, createdBy } ]
  }
}
```
- Saved to Firebase `shared/maintenance_data` via `saveMaintenanceData(silent)` (`window._maintenanceDb`); loaded in `init()`.
- **Blocks** come from `state.reports[year]` (Planting Phase Record) — dropdown, falls back to free text if a year has no blocks.
- Maintenance gangs are a **separate list** from harvesting `gangsByYear`.

### Excel template & import (Work Log toolbar)
- **⬇️ Template** (`downloadMaintenanceTemplate(yearStr)`) — available to everyone (read-only too). ExcelJS workbook, sheet `Work Log {year}`: title row 1, instructions row 2, header row 4 (`Gang, Activity, Block, Date Start, Date End, Persons, Round, Method`), example row, and a hidden **Lists** sheet (A=Gangs, B=Activities, C=Blocks) feeding list data-validation dropdowns on rows 5..204. Date cols use `yyyy-mm-dd`. Downloads `Maintenance_Work_Log_Template_{year}.xlsx`.
- **📥 Import** (`importMaintenanceWorkLog(file, yearStr)`) — edit-gated (`window._canEdit('maintenance')`). Scans **every** worksheet, detects header rows (cell normalises to `GANG`), builds a column map via `mntHeaderField`, and infers activity from the Activity column, a one-cell section-title row (e.g. "SLASHING MAINTENANCE"), or the sheet name — so it also reads the user's existing multi-section "Spraying List / Slashing List" sheets. Requires gang + dateStart + block per row; appends to `entries` (existing kept), confirms count, saves, logs audit, re-renders.
- **⚙️ Activities** (`mntManageActivities`) — add/remove activity types for the year.
- Import helpers: `mntLoadExcelJS` (CDN on-demand), `mntNormHeader`, `mntHeaderField`, `mntActivityFromText` (SPRAY/SLASH/MANUR/PRUN keyword detection), `mntCleanBlock` (strips `Blk`/`Block` prefix), `mntToISO` (Date / ISO string / Excel serial → `YYYY-MM-DD`).

---

## Rate of Wages module (render_wages.js)

### Overview
Top-level sidebar menu **💵 Rate of Wages** (id `sidebar-wages`, between Iron Horse and Weekly Activity). Calculates a gang's monthly payment from three parts:
1. **FFB payment** = (gross FFB MT − daily-rate harvest blocks) × RM/MT rate
2. **Daily rate** = Σ over work lines of `rate × Σ(manpower per day)`
3. **Penalty** = unripe bunches × RM/bunch (subtracted)
`Total = FFB payment + daily rate − penalty`. Worked example (Wenderlinus, Apr): 186.41 MT × RM65 + RM660 − RM130 = **RM12,646.65**.

### Key behaviours
- **FFB MT is auto-pulled** from `state.performance` summing **r1+r2+r3+r4** (ALL rounds — can differ slightly from Iron Horse Cost/FFB MT, which drops r4). Per-gang lookup uses the same 3-tier fuzzy name match as `getGangMonthMt` in render_ironhorse.js (exact → ci/prefix/first-word/first-5-letters/"previously" → block-level via `gangAssignments`), ported as `wgGangBlocks(year,gang,month)` which returns `{blockId: mt}`.
- A **Harvesting** daily-rate line auto-subtracts that block's tonnage from the FFB pool (so bunches aren't double-paid); shown read-only with an editable per-line override. Non-harvesting lines (Slashing/Manuring/etc.) subtract nothing.
- **Defaults** (`WG_DEFAULT_FFB_RATE=50`, `WG_DEFAULT_DAILY_RATE=30`, `WG_DEFAULT_PENALTY=10`): applied as *effective* values via `wgEffRate(stored, default)` at compute + display time — the stored field stays `''` until edited, so a fresh month shows RM50/MT and RM30/day without polluting `wgMonthHasData` or blocking carry-forward propagation.
- **FFB MT override** field on the month is a manual fallback when name-matching can't resolve tonnage.
- Manpower is **manual** per day (harvesting-interval manpower is intentionally ignored). "➕ Add day" appends date+manpower cells (no cap).
- **Carry-forward** (`wgMaybeCarry`, run at the top of `wgRenderEditor`): opening a **brand-new** month (no object yet in `state.wages`) seeds it with a **snapshot** of the most recent earlier month that has data for that gang (`wgFindPrevMonthWithData`, walks back ≤12 months across the year boundary). Copies FFB rate + daily-rate lines (block, work type, RM/day, per-day **manpower**); resets dates, `penaltyBunches`, `grossMtOverride`, per-line `tonnageOverride`. It's a one-time copy (not a live link) so editing a month never changes earlier ones, and an edit becomes the baseline the next month inherits. **Guard:** never carries into a **future** month (`wgIsFutureMonth` — after the current calendar month) so nothing is pre-billed; never overwrites a month that already exists; skipped for read-only users. Shows a "↪ carried forward from …" banner (`m._carriedFrom`), cleared on the first rate/work edit.

### View wiring
- `state.activeViewType === 'wages'`; wrapper `wages-wrapper` (index.html); registered in `_switchableWrappers` + hide/clear lists; view branch beside `weekly_activity`; sidebar handler near the Weekly handler. All in `script.js`.
- Selectors persisted in `state.wagesYear` / `state.wagesMonth` / `state.wagesGang`.
- Edit-gated by menu key **`wages`** (`window._canEdit('wages')`, in `ALL_MENU_KEYS` + user-management `allMenuOptions`); DB rule `shared/wages_data` in `database.rules.json`.
- Gangs = harvesting (`state.gangsByYear`) ∪ maintenance (`state.maintenance[y].gangs`) ∪ gangs already saved in wages. Work types = `Harvesting` + maintenance `activityTypes`. Blocks from `state.reports[year]`.

### Data structure (`state.wages`) → Firebase `shared/wages_data` (`window._wagesDb`)
```js
{ "2026": {
  penaltyPerBunch: 10,                       // year-wide RM/bunch
  gangs: { "Wenderlinus Gang": { months: { "APR": {
    ffbRate: 65, penaltyBunches: 13, grossMtOverride: "",
    dailyLines: [ { workType:"Harvesting", block:"39", dailyRate:30,
                    tonnageOverride:"",                 // "" = auto-pull block tonnage
                    days:[ {date:"2026-04-05", manpower:11}, {date:"2026-04-11", manpower:11} ] } ]
  } } } }
} }
```

### Key functions (`wg`-prefixed, module-internal unless noted)
| Function | Purpose |
|---|---|
| `window.renderWagesView()` | Year/month/gang bar + editor pane + Excel button |
| `wgRenderEditor` / `wgRenderLines` / `wgRefresh` | FFB/penalty/daily-rate cards; live recompute (no DOM teardown — keeps input focus) |
| `window.wgCompute(year,gang,month)` | The calc engine → `{grossMt, netMt, ffbPay, dailyPay, penalty, total, ...}` (also used by the Excel report) |
| `window.saveWagesData(silent)` | `JSON.stringify(state.wages)` → `shared/wages_data` (debounced autosave on typing) |
| `window.downloadWagesReport(year,month)` | ExcelJS "Wages {month} {year}" — per-gang row (net MT/FFB pay/daily/penalty/total) + grand total. Also surfaced in Reports panel (render_reports.js) |

---

## Wage Ledger module (render_wages_ledger.js)

### Overview
**"Wage Ledger"** sub-tab under 💵 Rate of Wages (the menu became a parent with **Calculator** = existing `sidebar-wages`, and **Wage Ledger** = `sidebar-wages-ledger`). Where the Calculator *estimates* per gang/month, the Ledger stores the **detailed actuals** imported from the user's monthly Excel. Three independent wage schemes (one per source sheet):
- **Harvester** (15 cols) — per harvest ticket/employee; Ripe Amount = `Weight(KG) × Ripe Unit Price` (+ Bags Amount + Daily Piece Rate).
- **Driver & loader** (18 cols) — per delivery; each Amount = `Weight MT × that role's Unit Price` (Driver/Loader/Loader 2/Lorry Driver).
- **jobcardpr** (12 cols, header on row 2 in the source) — per job card; Amount = `Unit Done × Pay Rate`.

### Key behaviours
- **Template** (`window.downloadWageLedgerTemplate(year,month)`) — ExcelJS, 3 sheets named exactly `Harvester` / `Driver & loader` / `jobcardpr`, exact column order, date cols `yyyy-mm-dd`, money cols `#,##0.00`, Gang/Block list-validation dropdowns from a hidden **Lists** sheet (gangs = harvesting∪maintenance∪wages; blocks = `state.reports[year]`).
- **Import** (`window.importWageLedger(file,year,month)`, edit-gated `_canEdit('wages')`) — detects each scheme by a **header-signature token** (`RIPEBUNCHES` / `DRIVERUNITPRICE` / `JOBCARDNO`) so it's independent of sheet name/order and tolerates the jobcardpr header on row 2. Maps columns via specs (`wlNormHeader` mirrors `mntNormHeader`), converts Excel-serial dates (`wlToISO` mirrors `mntToISO`), auto-computes blank amount cells from qty×rate. **Skips TOTALS rows** (Driver & loader requires a driver/loader/lorry name; Harvester/Job Card require an employee — the source's grand-total rows have neither). `confirm()` with per-category counts, then **replaces** the month's arrays for categories present in the file (clean re-import, no dupes); other categories untouched.
- **View** — Year/Month selectors, per-scheme tables (default 500 rows + a "Show all / Show fewer" toggle via `_wlShowAll`; totals always cover every row), a per-scheme + grand total summary card, and a per-gang breakdown.
- Real April-2026 row counts: Harvester 3,656 · Driver & loader 375 · jobcardpr 708 (sheet *dimensions* are padded higher).

### Data structure (`state.wagesLedger`) → Firebase `shared/wages_ledger_data` (`window._wagesLedgerDb`)
```js
{ "2026": { "APR": {
  harvester:[{no,deliveryDate,harvestingDate,ticketNo,rampChitNo,block,gang,employee,ripeBunches,weightKg,ripeUnitPrice,ripeAmount,bags,bagsAmount,dailyPieceRate}],
  driverLoader:[{no,deliveryDate,ticketNo,rampChitNo,block,gang,driver,weightMt,driverUnitPrice,driverAmount,loader,loaderUnitPrice,loaderAmount,loader2,loader2Amount,lorryDriver,lorryDriverUnitPrice,lorryAmount}],
  jobcard:[{no,gang,employee,jobCardNo,jobDate,startDate,completeDate,block,jobActivity,unitDone,payRate,amount}],
  importedAt, importedBy
} } }
```
- Reuses the **`wages`** menu key (no new permission). DB rule `shared/wages_ledger_data` mirrors `wages_data` in `database.rules.json` (must be published in the Firebase console to take effect). View wired in script.js: `state.activeViewType === 'wages_ledger'`, wrapper `wages-ledger-wrapper`, in `_switchableWrappers` + clear/hide lists, loaded in `init()` after `wages_data`.

---

## Wages Variance module (render_wages_variance.js)

**"⚖️ Variance"** — third sub-tab under 💵 Rate of Wages (`sidebar-wages-variance`, view type `wages_variance`, wrapper `wages-variance-wrapper`). Puts the Calculator's monthly **estimate** (`window.wgCompute`) beside the Wage Ledger's imported **actuals** per gang and flags the difference. **Purely derived** — reads `state.wages` + `state.wagesLedger`, stores nothing (no Firebase path, no rules change, no save fn); menu key `wages` shared.
- Per-gang row: Est (FFB pay / daily / penalty / total) | Act (Harvester / Driver&Loader / Job Card / total) | Diff RM & % | status chip (≤5% OK green · ≤15% check amber · beyond red · grey "no calc entry" · amber "no actuals"). Sorted by |diff| desc; shares `state.wagesYear`/`wagesMonth` with the other wages tabs.
- A gang counts as "has estimate" only when a **stored** Calculator month exists (bare `wgCompute` would invent default-rate numbers).
- **Gang-name resolution** (`wvResolveGang`): payroll labels ("WENDERLINUS") → app names ("Wenderlinus Gang") via exact-ci → ignore-"gang"-word → unique first-word → unique 5-letter prefix; resolved aliases shown under the name, unresolvable labels keep their own row + a ⚠ note.
- Ledger pay per row mirrors `SCHEMES[].payFields` (`WV_PAY` — keep in sync with render_wages_ledger.js).
- `window.downloadWagesVarianceReport(year,month)` — monotone ExcelJS sheet mirroring the table; also registered in the Reports panel's Generate-All ZIP (`ALL_REPORT_DEFS` key `wages_var` in render_reports.js).

---

## Daily Wage Ledger module (render_wages_daily.js)

**"📆 Daily Wage Ledger"** — fourth sub-tab under 💵 Rate of Wages (`sidebar-wages-daily`, view type `wages_daily`, wrapper `wages-daily-wrapper`). Digitises the EMS payroll **"Job Card Summary Report by Job Activity"** PDF: per job activity (JAxxxxx code + name), per job location (block / POLE / OPTxxxx), Normal hours+RM, OT hours+RM, Total RM.
- **Direct PDF import** (`window.importWagesDaily(file, year, month)`, edit-gated `_canEdit('wages')`) — the EMS PDF has a real text layer, so **no Excel conversion is needed**. pdf.js 3.11.174 (last UMD build; lazy CDN via `wdEnsurePdfJs`, worker set to the matching `pdf.worker.min.js`) extracts text runs; `wdItemWords` splits runs into words with proportional x; lines regrouped by y (tolerance 3, pdf.js y is bottom-up). Column x-boundaries (validated vs the real Jun-2026 report): No. <60 · activity 60–170 · location 170–265 · five numeric cols ≥265. Wrapped activity names accumulate across lines; per-activity `Total` rows and the `Grand Total` are parsed and **reconciled against the summed rows** — any mismatch is listed in the confirm dialog (import validated: 22 activities / 128 rows / RM120,951.56, zero mismatches). `From dd/mm/yyyy To dd/mm/yyyy` is captured as the period. Import **replaces** the selected month.
- **Excel fallback**: `window.downloadWagesDailyTemplate(year,month)` — flat one-sheet template (No | Code | Name | Location | Normal Hours (HH:MM, text-format) | Normal RM | OT Hours | OT RM | Total RM); the same `importWagesDaily` accepts `.xlsx` (detects header by `JOBACTIVITYCODE`/`JOBLOCATION`+`NORMALHOURS` signature, groups flat rows by code, hours accept "HH:MM" / decimal hours / Excel time serials, Total auto-computed if blank, TOTAL rows skipped). `window.downloadWagesDailyReport(year,month)` exports the grouped on-screen layout.
- **View**: Year/Month + arrows (`state.wagesDailyYear`/`wagesDailyMonth`), summary card (normal/OT hours+RM, grand total, per-location totals), grouped by-activity table with subtotals, contains-filter (activity/location). Hours stored as "HH:MM" strings (`wdToMin`/`wdFmtMin` for math).

### Data structure (`state.wagesDaily`) → Firebase `shared/wages_daily_data` (`window._wagesDailyDb`)
```js
{ "2026": { "JUN": {
  periodFrom:"2026-05-26", periodTo:"2026-06-30",
  activities:[ { no:1, code:"JA14004", name:"APPRENTICE WAGES",
    rows:[ { location:"POLE", normalHours:"645:00", normalAmount:5321.66,
             otHours:"93:30", otAmount:1578.00, totalAmount:6899.66 } ] } ],
  importedAt, importedBy, sourceFile
} } }
```
- Menu key **`wages`** shared (no new permission). DB rule `shared/wages_daily_data` (+ `ws/$ws` mirror) in `database.rules.json` — **must be published in the Firebase console** or writes are denied. Wired in script.js: view branch beside `wages_variance`, `_switchableWrappers` + clear list, `_sharedLoadOk['shared/wages_daily_data']`, loaded in `init()` after `wages_ledger_data`. In sw.js precache (VERSION bumped).

---

## Employee Master module (render_wages_employees.js)

**"👥 Employees"** — FIRST sub-tab under 💵 Rate of Wages (`sidebar-wages-employees`, view type `wages_employees`, wrapper `wages-employees-wrapper`). Digitises the EMS **"Employee Master Listing"** export: every worker with the **Vendor Code (= agent, e.g. "RONI AGENT")** their wages are allocated under — the key that lets Wage-Ledger employee rows be differentiated / rolled up per agent. Menu key **`wages`** shared.
- **Import** (`window.importWagesEmployees(file)`, edit-gated `_canEdit('wages')`) — the EMS export is a **binary .xls (BIFF)**, which ExcelJS can't read, so the importer lazy-loads **SheetJS** (`xlsx@0.18.5 full`, `weEnsureSheetJS`) and reads .xls AND .xlsx. `sheet_to_json(raw:false)` keeps formatted text (IC leading zeros survive; dates arrive as the displayed `dd/mm/yyyy` text → `weToISO`). Header row found by signature (`EMPLOYEEID` + `DISPLAYNAME`/`STAFFCATEGORY`); columns mapped **first-occurrence-wins** (the export repeats Country/State/… headers). Of the 55 source columns only the ~25 populated ones are stored (addresses/phones/Grade/Job Function are empty). Duplicate Employee IDs skipped. Import **replaces** the whole list (confirm shows counts). Validated vs the real Jul-2026 export: 471 employees / 43 agents / 295 active / 0 bad dates (~243 KB JSON).
- **View** — summary tiles (total, active = CONFIRMED+PROBATION, left, foreign/local, agents); **☰ List** mode: search (name/ID/IC/position) + Status (default **Active only**) / Agent / Category filters, 200-row cap + Show all, click a row → expandable detail (IC, DOB, remark…); **🤝 By agent** mode: per-vendor active/left headcount with position breakdown — the wage-allocation grouping.
- **Template** (`downloadWagesEmployeesTemplate`) + **Export** (`downloadWagesEmployeesReport`) via ExcelJS, available read-only. Lookup hooks for other wages tabs: `window.weFindEmployee(nameOrId)` / `window.weAgentOf(nameOrId)` (exact-ci display-name/ID match).
- **Working Permit** (added for Production Cost): per-employee `workPermit` (bool) + `workPermitNo` — a checkbox + number input in the list's far-right column, shown **only for `GTF-` IDs** (edit-gated, silent autosave). Ticked GTF = **PERMIT** wage class, unticked = NO PERMIT/GELAP. Values are **preserved across re-imports** (carried over by Employee ID since the EMS export doesn't know about permits) and round-trip via template/export (`Working Permit` = YES/blank, `Permit No.`).
- Data: `state.wagesEmployees = { list:[{no,employeeId,type,vendor,firstName,middleName,lastName,title,displayName,centralization,icNo,dob,gender,maritalStatus,nationality,race,email,dateJoin,dateConfirm,employmentType,dateLeave,position,staffCategory,staffStatus,remark,workPermit,workPermitNo}], importedAt, importedBy, sourceFile }` → Firebase `shared/wages_employees_data` (`window._wagesEmployeesDb`, `saveWagesEmployeesData`). DB rule (+ `ws/$ws` mirror) in `database.rules.json` — **must be published in the Firebase console** or writes are denied. Wired in script.js (view branch, `_switchableWrappers` + clear list, `_sharedLoadOk` entry, loaded in `init()` after `wages_daily_data`). In sw.js precache (VERSION bumped).

---

## Production Cost module (render_wages_prodcost.js)

**"🏭 Production Cost"** — sub-tab under 💵 Rate of Wages after Daily Wage Ledger (`sidebar-wages-prodcost`, view type `wages_prodcost`, wrapper `wages-prodcost-wrapper`). Recreates the accountant's monthly **"Summary of Labour Cost"** sheet (sections × LOCAL/PERMIT/NO PERMIT-GELAP columns, header production MT), but **derived live from the Wage Ledger** instead of typed/imported. **Purely derived** — reads `state.wagesLedger` + `state.wagesEmployees`, stores nothing (no Firebase path, no rules change); menu key `wages` shared.
- **Wage-class rule** (`wpCategoryOf`, resolves each ledger person via `weFindEmployee`): `GTF-` → PERMIT if `workPermit` ticked in the Employee Master else GELAP · `GTG-` → GELAP · `GTL-`/`GT-`/`PFB-` → LOCAL · `CON-`/`AG-` (agents) → GELAP · not in the master → **UNMATCHED** (own red column + a name-by-name card so nothing is silently dropped; column hidden when zero).
- **Rows** (activity ← ledger scheme): harvester → `FFB HARVESTING` (ripe+bags+piece, by deliveryDate); driverLoader → `FFB TRANSPORTING (DRIVER)` / `FFB LOADING` (loader+loader2) / `FFB TRANSPORTING (LORRY)` per role; jobcard → its own `jobActivity` (by jobDate). Undated rows are skipped and counted in the header.
- **Period** = free FROM→TO date range persisted in `state.prodCostFrom/To` — the source sheet runs on cut-offs (01/05→25/05, 26/05→30/06) so ranges **span months** (`wpMonthsInRange` walks every ledger month overlapping the range, rows filtered by exact date). ❮❯ arrows shift the whole range a month (full-calendar-month ranges stay full months); a `26→25 cut-off` button snaps to the payroll period.
- **FFB production for the range** (`window.wpFfbForRange(from,to)` → `{mt,tickets,undated,monthsUsed}`): Σ harvester `weightKg`/1000 by delivery date. Summary card shows total cost, FFB MT, labour-cost÷MT, and per-class totals. `window.downloadProductionCostReport(from,to)` exports the sheet (ExcelJS, unmatched list appended).
- **Harvesting Interval tie-in**: the interval month-cards selector (`renderSelectorView`, `target==='interval_month'` in script.js) gets a **"Total FFB for a period"** widget — From/To dates (persisted `state.intervalFfbFrom/To`) → `wpFfbForRange` MT + ticket count; guarded behind `typeof window.wpFfbForRange === 'function'`.

---

## Tree Logs Recording module (render_tree_logs.js)

### Overview
Top-level sidebar menu **🪵 Tree Logs Recording** (id `sidebar-tree-logs`, second item under **Operations**, after PEC Application). **Tree-Planting-workspace only** — Oil Palm hides it via `WORKSPACES.oil_palm.hiddenAreas = ['treelogs']`. Digitises the user's "Logs Species Summary" workbook, which has two sheet shapes:
- **KU… sheets** = one **delivery batch** with a *detailed* species/grade breakdown (`SPECIES CATEGORY | SPECIES | GRADE | QUANTITY (PCS) | VOLUME (MT)`, grouped by category+grade with Sub-Totals + a Grand Total).
- **ACMG… sheets** = monthly *summary-only* lists of batches that have no detail sheet (just `NO. | DELIVERY DATE | BATCH NO. | QTY | VOLUME`), tagged to one species (Acacia Mangium).

### What it does (maps to the 4 user requirements)
1. New menu **Tree Logs Recording**.
2. **Master view** = ACMG-style summary of **all** batches for the selected year, grouped by delivery month with per-month sub-totals + a year Grand Total (detailed *and* summary-only batches in one list).
3. Clicking a 📋 **detailed batch** drills into a **KU-style** species/grade breakdown (grouped sub-totals + grand total); Σ summary-only batches just show totals.
4. **Manual entry** (per-batch choice of *Detailed* lines vs *Summary only* totals) + **Import / Template / Export** Excel.
Plus: **Analytics** (qty+volume by species/grade/category) and **editable Code Lists**.

### View wiring (single view type, internal modes)
- `state.activeViewType === 'tree_logs'`; wrapper `tree-logs-wrapper`; in `_switchableWrappers` + clear/hide lists; view branch beside `wages_ledger`; sidebar handler near the Wage Ledger / Audit handlers. All in script.js.
- One view type; a **module-local** `_tlMode` (`list | detail | edit | analytics | codes`) + `_tlDetailId` / `_tlEditId` drive internal navigation (re-renders into the same wrapper, like Weekly). Selected year persisted in `state.treeLogsYear`.
- Edit-gated by menu key **`treelogs`** (`window._canEdit('treelogs')`, in `ALL_MENU_KEYS` + user-management `allMenuOptions`). Edit affordances are gated directly on `tlCanEdit()` (not only `_applyReadOnly`, since internal mode switches don't re-run it). Template + Export available to read-only users.

### Data structure (`state.treeLogs`) → Firebase `shared/tree_logs_data` (`window._treeLogsDb`)
```js
{ company: "POLIMA FOREST BINTULU SDN BHD",
  codes: { categories:["MLH","MKK","SLGB"], grades:["REG","SG","SSG","BSG"], species:[…22…] }, // editable; seeded from the workbook
  years: { "2024": { batches: [
    { id, batchNo:"KU0524A01", deliveryDate:"2024-05-28", detailed:true,
      lines:[ { category:"MLH", species:"MLH", grade:"BSG", qty:219, volume:54.582 }, … ],
      createdAt, updatedAt, updatedBy },
    { id, batchNo:"KU0825AP01", deliveryDate:"2025-08-26", detailed:false,
      species:"ACMG", totalQty:57, totalVolume:14.79, … }   // summary-only
  ] } } }
```
- DB rule `shared/tree_logs_data` (+ the `ws/$ws` mirror) added in `database.rules.json` gated by `treelogs` — **must be published in the Firebase console** or Tree Planting writes are denied.

### Import / Template / Export (ExcelJS, lazy-loaded via `tlEnsureExcelJS`)
- **Import** (`window.importTreeLogs(file, fallbackYear)`, edit-gated) walks every sheet; **classifies** each by header signature (`SPECIES CATEGORY`+`GRADE` → KU detail; `BATCH NO.`+a delivery-date header → ACMG summary), tracks the current year from `YEAR 20xx` divider sheets, and assigns each batch a year via **divider → delivery-date year → batch-code year (`KU<mm><yy>`) → fallback**. KU parse carries the category down within a (cat,grade) group and skips Sub-Total/Grand-Total rows; ACMG parse reads the species code from the `LOGS SPECIES: … (XXX)` title. **Merge is idempotent**: matches existing by (year, batchNo) → updates in place, else appends; `confirm()` shows new-vs-update counts. New category/species/grade codes seen on import are auto-added to the code lists. Skips the hidden `Lists` sheet and any `… TEMPLATE` sheet. (Algorithm validated against the real 63-sheet workbook: 106 batches = 56 detailed + 50 summary-only, zero grand-total mismatches.)
- **Template** (`window.downloadTreeLogsTemplate(year)`) — importable blank workbook: a `Detail Batch (KU)` sheet + a `Summary (ACMG)` sheet (header layouts the importer recognises) with category/species/grade list-validation dropdowns fed by a hidden `Lists` sheet.
- **Export** (`window.downloadTreeLogsReport(year)`) — a `Summary {year}` sheet (ACMG layout) + one KU-style sheet per detailed batch. `window.downloadTreeLogsBatch(year,id)` exports a single batch's KU sheet.
- Saved via `window.saveTreeLogsData(silent)`. Deletes use `window.notifyUndo` (session-long Recently-deleted recovery).

### Invoices (billed-out PDFs) — `_tlMode === 'invoices'`
- **What/why:** the user's billed invoices (one per delivery run, often covering several batches) are scanned **image PDFs with no text layer**, so they can't be parsed in-browser. The list now shows an **Invoice column after Batch No.** (🧾 + invoice no, a link that opens the stored PDF) and an **🧾 Invoices** toolbar button → **Invoice Manager** (`tlRenderInvoices`): import PDFs, see all invoices (linked + archive), open/delete each.
- **Pre-built mapping** `TL_INVOICE_MAP` (embedded constant, invNo → `{d:date, t:totalRM, b:[batchNos]}`) + inverted `TL_BATCH2INV`. Built offline by OCR-ing all 40 invoices and cross-checking each line against the workbook's per-(category,grade) **sub-totals** (newer invoices also embed `(KU…)` codes; some 2024-H1 invoices aggregate several batches → resolved by subset-sum). **Result: 105/105 batches linked, zero mismatches.** 5 invoices are orphan-archive (pre-Aug-2023 deliveries not in the system); the 10×2022 invoices have no batch and are auto-archived from their filename.
- **Import** (`window.importTreeLogInvoices(fileList)`, edit-gated) — multi-select PDFs; invoice no = filename (`PFB202402001.pdf` → `PFB202402001`); date/total/batchNos from `TL_INVOICE_MAP` (filename-derived date for orphans); stores each PDF as a **data URL** under `shared/tree_logs_invoice_files/<invNo>` (kept out of the main record, like Weekly images) and writes a registry entry to `state.treeLogs.invoices[invNo] = {date,total,batchNos,fileName,hasPdf,uploadedAt,uploadedBy}`.
- **Open** (`tlOpenInvoice`) loads the data URL → Blob URL → new tab (avoids long-`data:`-nav blocking). **Helpers:** `tlUploadInvoicePdf`/`tlLoadInvoicePdf` (in-memory `_tlInvCache`)/`tlDeleteInvoicePdf`; `tlBatchInvoice(batchNo)` (registry → map fallback). Delete uses `notifyUndo` (cache-based restore within the session).
- **Column states:** clickable 🧾 when the PDF is imported; greyed 🧾 (link known, PDF not yet imported) otherwise; `—` if the batch has no invoice. Same link appears in the batch detail card (`#tl-detail-inv`).
- DB rule `shared/tree_logs_invoice_files` (+ `ws/$ws` mirror) gated by `treelogs` — **must be published in the Firebase console** or invoice-PDF writes are denied.

---

## PEC Application module (render_pec.js) — Tree Planting workspace only

### Overview
Top-level sidebar menu **📜 PEC Application** (id `sidebar-pec`, first item under **Operations**, before Tree Logs). Tree-Planting-only — Oil Palm hides it via `WORKSPACES.oil_palm.hiddenAreas` (now `['treelogs','pec','hyr']`). Digitises the "PEC applied and approved" register (Permission to Enter Coupe applications to the Sarawak Forest Department). The source Excel is FLAT (one row per block, application fields repeated); the app stores **one record per application with blocks nested**, and the block total is **computed**, never typed (import flags stated-total mismatches).

### Key behaviours
- **Status is derived**, not stored: `approvedDate` → Approved (chip shows days-to-approval) · `applicationDate` only → Pending (chip shows days waiting; red past 90) · neither → Draft.
- **Pending banner** at the top of the list: every pending application as a days-waiting chip, sorted longest first.
- **Letter PDF attachments** — two slots per application (`app` = application letter, `apr` = approval letter), data URLs stored OUT of the main record at `shared/pec_files/<appId>_<slot>` (mirrors Tree Logs invoices: in-memory `_pcFileCache`, Blob-URL open, `notifyUndo` on remove with cache-based byte restore). Record only carries `files:{app|apr:{fileName,uploadedAt,uploadedBy}}`.
- **Coupe analytics card** under the list: per-Forest-Dept-coupe applications/blocks/area/approved-area (+ pending count), plus avg/min/max days-to-approval across approved applications.
- **Import** (`window.importPecApplications(file)`, edit-gated) — flat register: header row detected by signature (`FORESTDEPTCOUPENO` or `PECREFNO` + `BLOCKNO`), rows grouped into applications by (letterRef | pecRefNo | forestCoupeNo); later rows may fill fields the first row lacked (real file: Coupe 2014 rows have no PEC ref/areas — imports fine as incomplete). **Idempotent**: existing application matched by letterRef/pecRefNo is replaced (blocks & dates), keeping its id + attachments; validated against the real register (5 applications / 36 block rows, per-coupe Ha sums = the sheet's stated totals 240/400/441/373).
- **Template** + **Export** (flat one-row-per-block layout back) available read-only; ExcelJS lazy-loaded (`pcEnsureExcelJS`).
- Editor is a working-copy form (nothing touches `state.pec` until Save): application fields + dynamic block rows with live Ha total; validation (needs some ref, approved⇒applied, approved ≥ applied).

### View wiring
`state.activeViewType === 'pec'`; wrapper `pec-wrapper`; in `_switchableWrappers` + clear list; view branch beside `hyr_report`; sidebar handler near the HYR handlers; module-local `_pcMode` (`list | edit`). Edit-gated by menu key **`pec`** (`ALL_MENU_KEYS` + user-management `allMenuOptions`).

### Data structure (`state.pec`) → Firebase `shared/pec_data` (`window._pecDb`, `savePecData`, `_pecLoaded` gate)
```js
{ applications: [ { id, forestCoupeNo:"04A", internalCoupeNo:"COUPE 2016",
    letterRef:"PFB/21/020", pecRefNo:"LPF0042/21/04A", operationHeading:"1-4 (HILL/RAMP)",
    applicationDate:"2021-09-08", approvedDate:"2021-11-19",
    blocks:[ { blockNo:"001", areaHa:49 } ],
    files:{ app:{fileName,uploadedAt,uploadedBy}, apr:{…} },   // PDFs at shared/pec_files/<id>_<slot>
    remarks, createdAt, updatedAt, updatedBy } ] }
```
DB rules `shared/pec_data` + `shared/pec_files` (+ `ws/$ws` mirrors) gated by `pec` in `database.rules.json` — **must be published in the Firebase console** or Tree Planting writes are denied. Loaded in `init()` before `hyr_data` (retry loop + `_sharedLoadOk['shared/pec_data']`). In sw.js precache (VERSION bumped).

---

## Half-Yearly Report module (render_hyr.js) — Tree Planting workspace only

### Overview
Top-level sidebar menu **📄 Half-Yearly Report** (Tree-Planting-exclusive — hidden in Oil Palm via `WORKSPACES.oil_palm.hiddenAreas`), with sub-tabs **Report** (`sidebar-hyr-report`) and **Appendix 9: Planting Summary** (`sidebar-hyr-appendix9`). Digitises the ~23-sheet workbook the licensee submits to the Sarawak Director of Forests every 6 months (Licence for Planted Forest). Most sheets are maintained by hand and just need their period stamp + filename refreshed each half-year; **PHASE 1 ships one live-editable appendix (9 — all-coupes planting summary) as a pilot** for the export engine before the other three (Appendix 4A/4B planting-by-block, 5 roads, 6A/6B silviculture) are built on top of it.

**Critical constraint:** the export engine edits the workbook's XML directly (JSZip) to preserve exact regulatory formatting — this only works on the ZIP-based **.xlsx** container, not legacy binary **.xls** (confirmed via magic-byte check: `D0CF11E0` = OLE/BIFF, not `504B0304` = ZIP). Users must upload `.xlsx` — Excel's own "Save As" conversion from old `.xls` is lossless and far better than anything the app could do; `importHyrMaster` rejects `.xls` uploads with a message pointing to this.

### View wiring
- `state.activeViewType === 'hyr_report'` / `'hyr_appendix9'`; wrappers `hyr-report-wrapper` / `hyr-appendix9-wrapper`; registered in `_switchableWrappers` + hide/clear lists; view branches beside `tree_logs`; sidebar handlers near the Tree Logs handler. All in `script.js`.
- Edit-gated by menu key **`hyr`** (`window._canEdit('hyr')`, in `ALL_MENU_KEYS` + user-management `allMenuOptions`). Export is available to read-only users; Import + row edit/delete are gated.

### Data structure
```js
state.hyr = {
  year: "2025", half: "JUL-DEC",                          // current period (drives filename + which period's data shows)
  master: { fileName, importedAt, importedBy },            // metadata only — bytes stored separately
  periods: { "2025-JUL-DEC": { appendix9: { coupes: [
    { id, coupeNo:"OP/T2008", scheduledYear:"2023", actualYear:"2008  TO 2010", typeOfPlantation:"MONO",
      areaNotUnderFTL:0, area:378, areaUnderFTLOthers:0,                 // → derived Total (H) = sum of these 3
      clearing:0, planted1st:252, planted2nd:0, enrichment:0, protection:60,
      notPlantedTerIV:0, notPlantedBuffer:5, notPlantedNative:61,        // → derived Total (Q) = sum of these 8
      groundVerification:"YES", remarks:"Completed" } ] } } }
}
```
→ Firebase `shared/hyr_data` (`window._hyrDb`, `saveHyrData`) — small JSON, `_sharedLoadOk` entry, loaded in `init()` after `wages_employees_data`. The master **workbook itself** is stored separately at `shared/hyr_master_file` as a single data URL (kept OUT of `hyr_data`, like `weekly_images`/`tree_logs_invoice_files`, so period-data saves stay tiny) — **not** in `_sharedLoadOk` (untracked path, matches the existing convention: only eagerly-loaded sections need the race guard; this is fetched lazily on Export).

### Import (`window.importHyrMaster(file, year, half)`, edit-gated, .xlsx only)
One upload does two things at once: (1) stores the raw file bytes as the new master template for Export, (2) parses the **Appendix 9** sheet (found by name, header-signature-detected at `Coupe No.` + `Actual planting year`, data starts 3 rows below the 3-row merged header) into `state.hyr.periods[key].appendix9.coupes`, skipping the trailing `Gross` totals row. `confirm()` shows the coupe count before committing (matches Tree Logs/Wage Ledger import UX); re-import **replaces** the period's coupes.

### Export engine (`window.downloadHyrReport(year, half)`) — the reusable part
JSZip-based row-cloning XML surgery, generic enough for the Phase-2 appendices to reuse:
- `hyrFindSheetPath(zip, sheetName)` — resolves a sheet's display name → `xl/worksheets/sheetN.xml` via `workbook.xml`'s `<sheet name=... r:id=...>` (attributes extracted independently since order isn't guaranteed) + `workbook.xml.rels`.
- `hyrRegenSheetRows(sheetXml, opts)` — the row-count-safe regenerator: takes the template's own data rows as a **per-column style lookup** (so fonts/borders/number formats survive even though the row count can differ from the template), builds new `<row>` XML from app-state records (values only — no formulas, matching the "static values" convention used by every other export in this app), rebuilds the totals row from a `totalsFn`, and **shifts every row number, cell reference, and `<mergeCell>` below the managed block** by the resulting delta (records could be more or fewer than the template had). Validated end-to-end: importing a 13-coupe sample, editing one value + adding a 14th coupe, exporting, and confirming (a) the totals row correctly moved from row 17→18, (b) all `mergeCell` refs in the trailing notes section shifted +1, (c) `<dimension>` extended, (d) the file re-parses cleanly in ExcelJS with correct values, (e) untouched sheets (frozen **and** not-yet-live passthrough) are **byte-identical** to the imported master.
- Sheet tiers for Phase 1: **live** (Appendix 9, rebuilt from state) · **passthrough** (everything else — FRONT, Appendix 1–8, 10–12, Bamboo — carried through unchanged; period-stamp relabelling for these is Phase 2, since Appendix 9 itself has no period stamp on its own sheet) · nothing is dropped — all ~23 sheets ship in every export.
- Filename: `HYR (<Mon>-<Mon> <year>).xlsx` (3-letter months, e.g. `HYR (Jul-Dec 2025).xlsx`).

### Firebase rules
`shared/hyr_data` and `shared/hyr_master_file` write rules (+ the `ws/$ws` mirror) gated by `hyr` in `database.rules.json` — **must be published in the Firebase console** or Tree Planting writes are denied.

### Phase 2 — Appendix 4A/4B, 5, 6A/6B (live-editable, grouped rows)
Adds three more live appendices on top of Phase 1's engine, plus a second row-cloning
mode for GROUPED data (one record → a variable number of sub-rows):

- **Appendix 5** (`sidebar-hyr-appendix5`, flat list, reuses `hyrRegenSheetRows`) — road
  segments with a carry-down "Type of Road" column (shown once per contiguous
  same-type run). `compute(rec, i, records)` on `hyrRegenSheetRows`'s column spec was
  extended to take the row index + full array so a column can look at its *neighbour*
  to decide whether to repeat or blank itself — needed for this carry-down, not needed
  by Appendix 9. No totals row; the notes-section heading doubles as the row-shift
  boundary marker (`hyrRegenFlatSheet`'s `boundaryCol/boundaryNeedle` params).
- **Appendix 4A/4B** (planting progress by block) and **Appendix 6A/6B** (silviculture by
  month) — both **grouped**: a block record expands into a variable number of sub-rows
  (species/planting lines for 4, Slashing/Spraying/Fertilizing/Pruning operation lines
  for 6), with the group's key columns (Coupe No, Block No…) written once on the first
  row and **merged** across the group's row span — mirroring the template's own
  `A4:A6`-style merges. New engine: `hyrRegenGroupedRows` (parallel to
  `hyrRegenSheetRows`, same row-shift/mergeCell-reconciliation logic, but builds
  `keyColumns` once per group + `lineColumns` once per sub-row, and supports
  `wholeTableColumns`/`wholeTableValues` for fields that apply to the *entire* table,
  not per-group — Appendix 4's single Coupe No / felling-date columns).
- **A and B aren't identical layouts** — confirmed against the real template, not
  assumed: **6A's columns sit one letter right of 6B's** (`B/C/D/E-P/Q` vs
  `A/B/C/D-O/P`) and 6A has no separate totals row (the "TOTAL" label shares a row with
  the notes footer) — handled via a per-coupe `HYR_A6_LAYOUT` lookup rather than
  hardcoded columns. **4A doesn't use 4B's whole-table Coupe-No merge** — 4A merges
  Coupe No **per block** like every other key column instead; discovered by this
  exact bug (see below), not assumed up front.
- **Import parsers must detect group boundaries by "changed from previous row," not
  truthiness.** ExcelJS resolves a read on *any* cell inside a merged range to the
  anchor cell's value — so a block's Coupe No/Block No reads as populated on **every**
  row of the group, not just its first (`hyrParseAppendix4`, `hyrParseAppendix6`). A
  truthiness-based "start new group when non-empty" check therefore treats every row
  as a new group; the fix compares the (coupe, block) key to the *previous* row's key.
  Caught by testing against a real converted sample (471-employee-style validation,
  not synthetic data) — the bug produced obviously-wrong block counts (19 instead of
  6) that a hand-built test fixture would never have exposed. The same wide-merge
  behaviour also means a template's "Note:" footer row, if merged across the block/type
  columns too, reads as literal "Note: ..." text in those columns — the import loop's
  stop condition checks for a `NOTE`-prefixed value explicitly, not just emptiness.
- **Overlapping-merge defence, generic to `hyrRegenGroupedRows`**: a header-area merge
  can extend one row into the data region (seen for real — a "Start/Completed" header
  cell merged `B9:B10`, spilling into row 10, the first data row). Excel forbids
  overlapping merged ranges. Before adding a new group/whole-table merge, the engine
  checks it against every *preserved* header merge and silently drops the new merge on
  conflict (the cell value still renders correctly, just without the extra visual
  merge) rather than emitting an invalid file. Caught by exporting the real sample data
  and diffing merge ranges for overlaps — worth re-checking if a future appendix's
  export seems to hang when reopened in Excel.
- Verified end-to-end against a real converted sample: imported, edited a value **and**
  changed the row count on every live appendix simultaneously (13→13 coupes with an
  edit, 16→17 roads, 6→7 blocks on 4A, 6→7 blocks on 6A), exported, and confirmed for
  each: the totals row/merges shifted to the exact right row, grand totals
  recalculated correctly by hand-verified arithmetic, no overlapping merges, no
  duplicate row numbers, correct `<dimension>`, and all 32 XML parts (worksheets +
  rels) parse cleanly via the browser's native `DOMParser` — frozen and not-yet-live
  passthrough sheets confirmed byte-identical to the imported master throughout.

### Not yet built (Phase 3)
Period-stamp text patching (`AS AT ... 2025`, `REPORTING PERIOD`/`YEAR` pairs) for the
passthrough sheets (FRONT, Appendix 1–3, 7–8, 10–12, Bamboo) — still carried through
unchanged on every export, since Phase 1/2 focused on the four live appendices first.

---

## AI Assist module (render_ai_assist.js)

**"🤖 AI Assist"** — top-level sidebar item under **System**, above Reports
(`sidebar-ai-assist`, view type `ai_assist`, wrapper `ai-assist-wrapper`). Answers ad-hoc
data questions and compiles cuts of the data that no built-in report covers — the
month-to-month FFB summary that prompted the module being the motivating case.
**Purely derived** — reads `state`, stores nothing in Firebase (no path, no rules change,
no save fn). Menu key **`aiassist`** (in `ALL_MENU_KEYS` + user-management `allMenuOptions`).

### The design rule
**The model never produces a number.** It chooses a tool and its arguments; the tool
computes the answer from `window.state` using the same traversal the existing reports use.
Excel downloads are built from the **cached tool result** (`result_id`), never from figures
the model retyped — so a downloaded file can never disagree with what the engine computed.
The system prompt states this as an absolute rule, and every tool returns a `result_id`.

### Tools (schemas + local implementations in the module)
| Tool | Backed by |
|---|---|
| `get_data_scope` | scans `state.performance` — valid years/months/gangs/blocks, so the model never guesses identifiers |
| `query_ffb_production` | **the pivot** — `state.performance[y][Mon][gang].blocks[id]={r1..r4}`; `group_by` month/block/gang/month_block/month_gang/gang_block, plus round/block/gang filters |
| `query_intervals` | `window.imIntervals` / `imTarget` |
| `query_wages` | `window.wgCompute` over saved Calculator months |
| `query_employees` | `state.wagesEmployees.list`, grouped by agent/position/category/status with GTF + permit counts |
| `download_excel` | ExcelJS over a cached `result_id` |

`query_ffb_production` counts each **(gang, block)** cell once — it does not use
`gangAssignments` to attribute blocks, so a block worked by two gangs in one month sums
correctly instead of double-counting via the YTD report's fallback scan.

### Transport — two modes, `transportMode()`
- **proxy** (production): posts to the URL in `localStorage.ai_assist_proxy` with the
  caller's Firebase ID token as a bearer. `ai_proxy/worker.js` is the Cloudflare Worker —
  it verifies the token (RS256 against Google's JWKs, issuer/audience/expiry), holds
  `ANTHROPIC_API_KEY` as a Worker secret, caps `max_tokens`, and forwards to
  `/v1/messages`. **Deploy it and paste the URL into ⚙ Setup** before the hosted site can
  use AI Assist. Add the production host to `ALLOWED_ORIGINS` in the worker.
- **local** (dev only): key in `localStorage.ai_assist_key`, calls the API directly with
  `anthropic-dangerous-direct-browser-access`. **Hard-refuses on any host but localhost**
  so a key can never ship on the hosted page.

Model `claude-opus-5`, agentic loop capped at 8 tool rounds; all `tool_result` blocks for
one assistant turn are returned in a single user message.

### Tests
`node scripts/test_ai_tools.js` — loads the module under fake browser globals and checks
the pivot against an independent re-implementation of `render_ytd_report.js`'s traversal
(21 assertions: grouping totals reconcile across every `group_by`, `gangAssignments` is
never treated as a gang, a two-gang block sums once, round/gang/month filters, empty
months omitted rather than zero-filled, error paths, result-cache identity).
Fixture-based — **re-verify against real data** once loaded, via the console:
`await window._aiTools.runTool('query_ffb_production', {year:'2026', group_by:'month'})`
and check the year total against the YTD report.

---

## Interval Monitor module (render_interval_monitor.js)

### Overview
**"⏱ Interval Monitor"** — second sub-tab under 📈 Harvesting Performance
(`sidebar-interval-monitor`, view type `interval_monitor`, wrapper
`interval-monitor-wrapper`), right under **Harvesting Interval**. Measures the
gap between harvesting rounds per block against the estate's **≤ 15-day**
target and reviews it **by ISO week (Mon–Sun, crossing month ends)**. **Purely
derived** — reads `state.performance`, stores nothing but the user's own
settings (`state.intervalTargetDays`, `imWeek`, `imAsAt`, `imLogMonth`,
`imLogGang`) inside the existing `app_state`; no Firebase path, no rules
change, no save function. Menu key **`performance`** shared.

### How the source grid encodes intervals (decoded + validated, Aug 2026)
The daily-report workbook's `HARVESTING INTERVAL-<MON>` sheet — already imported
by `handleImportExcel` into `blocks[id].days[i] = {roundVal, hpVal}` — encodes:
- `roundVal` = **days since the current round started**, incremented every
  calendar day whether harvested or not; `hpVal` = manpower that day (blank = no
  harvesting; sums to the sheet's `TOTAL MANDAY`, verified on all 33 blocks).
- **counter back to 1 = a new round starts.** The counter on the day *before* a
  reset is the **interval just closed** (days between two round starts) and it
  already carries the previous month's tail, so an interval is computable from
  one month's sheet alone — no cross-month chaining required (the engine still
  chains when earlier months are present).
- **The green/yellow/red fills carry no information the values don't.** Checked
  cell by cell over `E5:AI70`: a filled cell is exactly a cell with manpower
  under it (100% match, zero exceptions). The round number is just the order of
  **worked** rounds within the month, and deriving it that way reproduced the
  clerk's colouring on **60 of 61** rounds. So the module **derives** rounds
  (SheetJS can't read fills anyway) and flags divergences — the single Aug-2026
  mismatch, Darso blk 19 day 30, is a genuine 3rd round left yellow in the
  workbook (its tonnage also landed in the 2ND RD column).
- **A carried-in round counts as the month's 1st round only if harvesting
  actually continued into the month** — a bare counter with no manpower is just
  the tail of last month's interval (blk 1 = counter 16→22 with no work, so d8
  is the 1st round; blk 14 worked on d1, so its carried round *is* the 1st).
- Blocks whose counter never resets (the workbook carries two sitting at 416+
  days) are flagged **not in rotation** and excluded from the averages.

### Views (module-local `_imMode`)
- **📅 Weekly** (default) — ISO-week picker (◀ ▶, only weeks with data), summary
  tiles (intervals closed, average, breaches, % within target, rounds started,
  overdue/due at week end, mandays), per-block table (round starts + the interval
  each closed, peak days reached in the week, days at week end, status chip) and
  a per-gang rollup. A ③ note lists 3rd-or-later rounds started that week — the
  ones to fill **red** and bill to the **3RD RD** column in the Excel sheet.
- **📋 Field sheet** — printable inspection sheet, longest-waiting block first,
  with a tick box and a blank "Findings / action" column, `As at` date picker
  (defaults to the latest day filled in; a `*` marks blocks whose days were
  extrapolated past the last filled day) and Inspected/Date/Verified signature
  lines.
- **🧾 Interval log** — every completed interval for the year with month/gang
  filters, per-block averages (min/avg/max/breaches) and the full list, longest
  first, plus **⬇ Excel report**.
All three print via the header 🖨️ PDF button or the view's own 🖨️ Print; print
CSS lives at the end of `style.css` (`.im-noprint` / `.im-print-head` /
`.im-table` / `.im-box`, colour-adjust forced so the status colours survive).

### Excel export
`window.downloadIntervalLogReport(year, month?, gang?)` (ExcelJS lazy-loaded via
`imEnsureExcelJS`) — four sheets: **Summary** (totals + by month + by gang),
**Per block**, **Intervals** (the full log, auto-filtered, longest first) and
**Open now** (running intervals as at the latest day filled in — the field sheet
in spreadsheet form). Breach figures are red/green; the log button passes the
view's own month/gang filters; an empty scope warns instead of emitting an empty
file. Registered in the Reports panel's Generate-All ZIP as `interval_log`
(`ALL_REPORT_DEFS` in render_reports.js), which passes the panel's month.

**Dates must be rebased to UTC midnight before writing** (`imXlDate`) — ExcelJS
serialises a Date by its raw UTC epoch with no timezone correction, so a
local-midnight date east of UTC (Malaysia is UTC+8) becomes the *previous* day's
serial plus 0.667 and Excel renders it a day early under a `dd/mm/yyyy` format.
Caught by round-tripping the generated workbook back through ExcelJS and
checking the serial was a whole number.

### Public engine API (also used by the grid and the dashboard)
| Function | Purpose |
|---|---|
| `window.imTarget()` | the interval target (`state.intervalTargetDays`, default 15) |
| `window.imDayFlags(year, monthName, blockId)` | `array(31)` of `{counter, manday, roundNo, isStart, over, interval}` — drives the grid colouring |
| `window.imBlockStatus(year, asAtDate)` | per block: last round start, last cut, days since, status (extrapolates past the last filled day) |
| `window.imIntervals(year)` | every closed interval `{blockId, gang, start, roundNo, interval, breach, …}` |
| `window.imInvalidate()` | drop the memoised year analysis (called on grid edits + import) |

### Harvesting Interval grid — round colouring
`renderIntervalTable` (script.js) now paints each day's **counter** cell with the
derived round colour (1st green `#00B050`, 2nd yellow `#FFFF00`, 3rd red
`#FF0000`, 4th blue `#00B0F0` — only on days with manpower, exactly like the
workbook), turns the figure red once the counter passes the target, and puts the
interval/round explanation in the cell's tooltip. A legend + an "⏱ Interval
Monitor →" link sit under the view heading. `paintRoundColors()` re-runs on each
cell edit (via `imInvalidate()`), so no full table re-render and no lost focus.

### Dashboard alert fix (found while building this)
`buildHarvestAlerts` in render_dashboard.js now prefers `window.imBlockStatus`
(days since the last round **start**, against the user's target) and only falls
back to the old "last non-empty day" scan. That fallback was **broken**: since
the importer moved to `{roundVal, hpVal}` objects, `String(cell)` returned
`"[object Object]"` for every day, so every block always looked harvested on the
last day of the month and the alert never fired. The fallback now reads `hpVal`
via `dayHasHarvest()`.

---

## Weekly Activity module (render_weekly.js)

### Overview
Top-level sidebar menu **🗺️ Weekly Activity** (id `sidebar-weekly`, after Iron Horse, before Rainfall). Digitises the user's weekly field report: they import the **KMZ** (or KML/GPX) their GPS app exports — the module draws the **track** on a satellite map, pins geotagged **photos** along it, and pulls embedded photos/coordinates/captions into **observations**. The user adds narrative (Main Activity, Others, per-block notes) and exports a Word `.docx` matching their hand-made report.

### View wiring
- `state.activeViewType === 'weekly_activity'`; wrapper `weekly-activity-wrapper` (index.html); registered in `_switchableWrappers` + hide/clear lists; view branch beside the `ironhorse_*` branches; sidebar handler near the Iron Horse handlers. All in `script.js`.
- Active year `state.weeklyYear`; selected week `state.weeklyWeekId`.
- Edit-gated by menu key **`weekly`** (`window._canEdit('weekly')`, in `ALL_MENU_KEYS` + the user-management `allMenuOptions`).

### Data structure (`state.weekly`) → Firebase `shared/weekly_activity_data` (`window._weeklyDb`)
```js
{ "2026": { weeks: [ {
  id, date:"2026-04-24", day:"Friday",
  mainActivity:[...], others:[...],
  track:{ coords:[[lng,lat],...], source },
  mapImage:{ path, type, mode:"auto"|"uploaded" },   // path under shared/weekly_images
  observations:[ { id, block, caption, notes, lat, lng, photoPath, photoType } ],
  blockSections:[ { block, title, notes:[] } ],
  archive:{ archivedToDrive, driveFileLink, archivedAt },
  createdBy, createdAt
} ] } }
```
- Blocks dropdown from `state.reports[year]` (Planting Phase Record), free-text fallback — like Maintenance.

### Image storage (Realtime Database — NOT Firebase Storage)
- **Firebase Storage was avoided** because Google now requires the paid **Blaze** plan to enable it. Photos + the rendered map image are instead stored as **data URLs in the Realtime Database**, under a **separate path** `shared/weekly_images/<year>/<weekId>/<id>` — kept OUT of the main `shared/weekly_activity_data` record so every save stays tiny (real import: 6 obs + 5 photos → main record ~1 KB). Records store only the **path** (`observation.photoPath`, `mapImage.path`), never bytes.
- A module-level **in-memory cache** `_wkImageCache` (path → data URL) is never serialised into `state.weekly`. `wkUploadBlob(year,weekId,name,blob)` writes the data URL to the DB + cache and returns `{path,type}`; `wkLoadImage(path)` resolves from cache then DB (lazy — old weeks don't load images until viewed); `wkDeleteStorage(path)` removes both.
- **Photos are downscaled before storing** (`wkResizeImage`, ~1600px/JPEG q0.82) — KMZ camera originals are 6–10 MB; this brings them to ~0.5 MB, keeping the DB small and the exported `.docx` small (real Block 4 KMZ: 40 MB doc → 3 MB). NB: JSZip-extracted blobs have an empty MIME type, so `wkResizeImage` decodes rather than gating on `blob.type`. Writes are wrapped in `wkWithTimeout` (30 s) and the observation is saved **before** its photo so a stuck write never loses the caption/coords.
- **Import is two-file friendly:** the user's GPS app (AlpineQuest) exports the **track** and the **geotagged photos** as *separate* KMZ files; importing both into the same week appends correctly (track has `LineString` only; photos are `Placemark>Point` with `ExtendedData/Data[name=wptPhotos]` + an `<img>` in the description).
- **No auto-expiry:** images persist in the DB until a week is deleted. `wkIsArchivedAge()` now only flags a week once it's explicitly archived to Drive (`archive.archivedToDrive`). The exported `.docx` (images embedded) is the permanent **Google Drive** backup (manual save now; automated "Connect Drive" upload + an optional 30-day DB cleanup are deferred enhancements).
- **No out-of-band console setup needed** — uses the existing Realtime DB. (Realtime DB security rules should still restrict writes by role, same caveat as the rest of the app.)

### Key functions (all `wk`-prefixed; module-internal unless noted)
| Function | Purpose |
|---|---|
| `renderWeeklyActivity()` (window) | Toolbar (year, New Week), week list + editor pane |
| `wkRenderWeekEditor(host,year,week)` | Date/day, export/save/delete, import bar, map, narrative, observations |
| `wkRenderObservations` / `wkObsCard` / `wkObsAddRow` | Observations section — Capture/Add buttons at the TOP (no scrolling), then two views: 🗂 **one-by-one pager** (◀ ▶ buttons, swipe, ←/→ keys, jump dropdown, full-width photo, opens on latest capture) and ☰ list. Per-device default: pager on phones (`field-mode`/≤768 px), list on desktop; persisted `localStorage.wk_obs_view`; pager position is session-only (`_wkObsPage`). Paging/toggling redraws only the section (never the map). Tap any photo → `wkShowPhotoFull` lightbox |
| `wkImportTrackFile(file,year,week)` | KMZ(JSZip)/KML/GPX → `wkParseKML`/`wkParseGPX`; extracts embedded photos → DB images; appends observations |
| `wkRenderMap(id,week)` / `wkRasterizeMap(id)` | Leaflet + Esri World Imagery; track polyline + numbered `circleMarker` dots; waits for tile `load` then `html-to-image` → PNG (behind `wkWithTimeout`). NB: `leaflet-image` was dropped — it silently hangs under Leaflet 1.9 |
| `wkUploadBlob` / `wkLoadImage` / `wkDeleteStorage` | Store data URL → `shared/weekly_images` (+cache, returns `{path,type}`) / lazy-load path → data URL / delete |
| `downloadWeeklyActivityDoc(year,id)` (window) | Lazy-loads `docx` UMD; title→Main→Others→track map→per-block photos w/ caption + Google Maps coord link; deferred-anchor download |
| `saveWeeklyActivityData(silent)` (window) | `JSON.stringify(state.weekly)` → `shared/weekly_activity_data` |
- Lazy CDN loaders: `wkEnsureJSZip`, `wkEnsureLeaflet` (Leaflet), `wkEnsureHtmlToImage` (global `htmlToImage`), `wkEnsureDocx` (global `window.docx`).

---

## Excel report architecture
Reports are generated client-side using:
- **ExcelJS** (CDN) — used for YTD, Rainfall, Iron Horse template reports
- **JSZip** (CDN) — used for Spraying report (direct XML manipulation to preserve all template formatting)

### Spraying report (`downloadSprayingReport` in render_reports.js)
- Template: `Report samples/Spraying Maintenance 2025.xlsx`
- Target sheet: **sheet4.xml** = "GLY + ALLY 20225 (2)" (not sheet1!)
- Uses JSZip to manipulate XML directly — ExcelJS is NOT used here
- `setNum(row, col, value)` — regex-replaces cell values in sheet4.xml
- `fillHalfXml(section, colMap, halfMonths)` — writes block data for JAN-JUN or JUL-DEC
- All sheets are kept in the output (NOT stripped) — `activeTab` in workbook.xml is set to sheet4's index so Excel opens there directly
- Column layout: G+H=JAN GLY/ALY, I+J=FEB, K+L=MAR, M+N=APR, O+P=MAY, Q+R=JUN (same for JUL-DEC)
- Row layout per block: row N = Rounds, row N+1 = Litres/GM, row N+2 = Ha

### SPRAY_PHASES row mapping (render_reports.js ~line 383)
| Phase | JAN-JUN start | JUL-DEC start | blocks |
|---|---|---|---|
| OP2010 | 11 | 151 | 1-9,11,12,23 |
| OP2011 | 54 | 194 | 10,13-18 |
| OP2012 | 82 | 222 | 19-22,24 |
| OP2015 | 104 | 244 | 25,26A,26B,27-32 |
| OP2016 | 138 | 278 | 33,39 |

### Rainfall report (`downloadRainfallReport` in render_reports.js)
- Template: `Report samples/Rainfall 2024 vs 2025 up to Dec 2025.xlsx`
- Uses ExcelJS with `stripCellStyles: false` to preserve borders
- Template data cells have black fills baked in — explicitly overridden with `WHITE_FILL` for data rows 6-17
- Future months (after selected month) get `BLACK_FILL`

### YTD report (`downloadYtdReport` in render_reports.js)
- Template: `Report samples/Havesting Performance Dec 2025.xlsx`
- Uses ExcelJS, no `applyRowBorder` calls — template borders pass through unchanged

---

## Iron Horse feature (render_ironhorse.js)

### Overview
Top-level menu after "Harvesting Performance". Two sub-sections:
1. **Asset Numbers** — manage which machines exist per year, assign gangs with date periods
2. **Expenses** — monthly expense tracking per asset across 6 base + optional extra categories

### Constants
```js
IH_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
IH_CATS   = ['DC','FUEL','LUBE','PART','SR1','TOOL']   // 6 base categories
IH_DEFAULT_ASSET_NOS = ['GT06','GT07','GT08','GT09','GT10','GT12','GT13','GT16','GT17','GT20','GT22']
```

### Iron Horse data structure (`window.state.ironHorse`)
```js
{
  assets: {
    "2026": [
      {
        assetNo: "GT06",
        description: "IRON HORSE",
        gangAssignments: [
          { gang: "Gang A", from: "2026-01-01", to: "2026-06-30", remark: "" }
        ]
      }
    ]
  },
  expenses: {
    "2026": {
      extraCategories: ["PET"],   // per-year extras, in addition to IH_CATS
      months: {
        "JAN": {
          "GT06": { DC: 0, FUEL: 0, LUBE: 0, PART: 0, SR1: 0, TOOL: 0, PET: 0 }
        }
      }
    }
  }
}
```
Saved to Firebase: `shared/ironhorse_data`  
Loaded via: `window._ironHorseDb.ref('shared/ironhorse_data').once('value')`

### Key functions in render_ironhorse.js
| Function | Purpose |
|---|---|
| `renderIronHorseAssets()` | Year/month selectors, asset table, gang assignment history |
| `renderIronHorseExpenses()` | Year/month selectors, dynamic expense table with extra columns |
| `ihShowGangAssignModal(assetNo, yearStr, onConfirm, prefill)` | Custom overlay modal — gang dropdown from `gangsByYear[year]`, date pickers, remarks; prefill for edit mode |
| `resolveGangForMonth(gangAssignments, yearStr, monthIdx)` | Returns active gang at mid-month (15th) — handles overlapping periods |
| `ihEnsureExpenseYear(yearStr)` | Creates/migrates year expense object; migrates old flat structure to `{ months, extraCategories }` |
| `ihGetAllCategories(yearStr)` | Returns `IH_CATS + extraCategories[year]` |
| `ihNormalizeHeader(str)` | Normalises import headers: `"D.C/"→"DC"`, `"SR/1"→"SR1"` etc. |
| `downloadIronHorseTemplate(yearStr, monthStr)` | ExcelJS template with pre-filled assets, dark/blue/green styling |
| `importIronHorseExpenses(file, yearStr, monthStr)` | Robust import: auto-detects header row, prompts for unknown columns, dash=0 |
| `saveIronHorseData(silent)` | Saves to Firebase `shared/ironhorse_data` |

### Header normalization for import
`ihNormalizeHeader` strips spaces/special chars so Excel column headers like `D.C/`, `SR/1` map correctly to internal keys `DC`, `SR1`.

### Per-year extra categories
- Stored in `expenses[year].extraCategories = []`
- Auto-detected on import: unknown columns prompt user to add as extra category
- Manually managed via **➕ Add Category** / **✕ Remove Category** buttons in Expenses view
- Extra category columns shown with blue-tinted header to distinguish from base

### Gang assignment
- Gang dropdown populated from `window.state.gangsByYear[yearStr]` (not free text)
- Edit (✏) button pre-fills modal with existing assignment
- Delete (✕) button removes by matching `gang + from` (not array index)

### Remove asset
Fixed to use `currentList.findIndex(a => a.assetNo === asset.assetNo)` then splice — not forEach index.

---

## Spraying data structure (`window.state.spraying`)
```js
{
  "2026": {
    phases: [
      {
        phaseName: "OP2010",
        blocks: [
          {
            blockNo: "1",
            haPrevious: 53.2,
            haPresent: 53.09,
            months: {
              FEB: { roundGly:"1", roundAly:"1", litresGly:40, gmAly:2000, haGly:53.2, haAly:53.2 }
            }
          }
        ]
      }
    ]
  }
}
```
Extra chemicals per year stored in `window.state.spraying[year].extraChemicals = [{name,unit}]`.  
Extra chemical Round and Ha inputs use keys `extras[name_round]` and `extras[name_ha]`.

---

## Current status / known issues

### Completed & working
- **Spraying report**: Fixed (sheet4 instead of sheet1, activeTab fix). Output has all 7 sheets — opens to "GLY + ALLY" tab.
- **Rainfall report**: Fixed (WHITE_FILL overrides black template fills, borders preserved).
- **YTD report**: Fixed (template borders pass through, no manual border application).
- **Spraying extra chemicals Round/Ha**: Fixed — inputs now editable (were empty `<td>` before).
- **Iron Horse Assets**: Working — year/month selectors, add/remove assets, gang assignment modal with dropdown, edit/delete assignment periods.
- **Iron Horse Expenses**: Working — base + extra categories, add/remove extra categories, save to Firebase.
- **Iron Horse import (Data Management)**: Wired up — auto-detects headers, prompts for unknown columns.
- **Iron Horse template download**: Fixed — anchor is appended to `document.body`, clicked, then `URL.revokeObjectURL` + `a.remove()` are deferred via `setTimeout`. All cells use static values (no `{ formula }`). See `downloadIronHorseTemplate()` in render_ironhorse.js.

### app_state size limit (root cause of "imports vanish after refresh")
`saveState` writes ONE string to `shared/app_state`, and Realtime Database
refuses any string over **10 MB** (UTF-8). It used to stringify the *whole*
`state` object, which duplicated every module section that already has its own
path — Wage Ledger (thousands of rows a month), Employee Master, Tree Logs,
Weekly, HYR… Once the blob crossed 10 MB every save failed with
`value argument contains a string greater than 10485760 utf8 bytes`, silently,
because callers pass `silent=true`. Symptom: imports look fine, then vanish on
refresh.

- `APP_STATE_OWN_PATHS` (script.js) maps each such state key to its real path;
  `appStateJson()` omits a section **only when `_sharedLoadOk[path] === true`**,
  so a section whose own read failed keeps its copy rather than risking loss.
- A payload over 95% of the limit is refused **locally** with a size breakdown
  (`window._appStateSizes()`) instead of being sent and rejected.
- **Any new module section must be added to `APP_STATE_OWN_PATHS`**, or its data
  will be duplicated into app_state again.
- Backup restore now replaces the live state object's *contents*
  (`delete`+`Object.assign`) — it used to reassign `window.state`, which left
  script.js's closure holding the old object, so the save after a restore
  persisted the pre-restore data.

### Access control (important)
- Role/permission enforcement is **client-side only** (`_canEdit`, `_applyReadOnly` disable buttons and set `readOnly`). The real security boundary must be **Firebase Realtime Database security rules** — confirm they restrict writes by role, otherwise a non-admin can still write via the console.
- `loadUserRole()` in script.js grants `admin` **only** to the genuine first-ever user (when `user_roles` is empty). Any other user with no record defaults to a locked-down `user` role, and role-read failures **fail closed** (least privilege).

### Pending / unresolved
- **Iron Horse Expenses import**: Wired up but not fully tested with real user data yet.

---

## Enhancement roadmap (agreed 2026-06-10 — continue in order, one commit per phase)

Companion file: `ui_enhancements.js` (self-contained UI layer; loaded last in index.html).
It already provides `window.notify(msg, type, ms)` toasts ('info'|'success'|'error'|'warn'),
the Ctrl+K command palette, sidebar filter, mobile nav, and `#nav=<sidebar-id>` deep links.

### Phase 1 — Unsaved-changes warning + Save indicator (small) ✅ DONE
Implemented in ui_enhancements.js (`initDirtyTracking` + `patchFirebaseSet`): dirty flag set on
`input` events on `.edit-input, .ha-input` inside `main`; cleared by patching the compat-SDK
Reference prototype `set()` for any path containing `/shared/`; "● unsaved" badge before
`#header-user-info` (CSS in style.css); `beforeunload` guard. `window._markUnsaved()` exposed
for app code. Original investigation notes:
- `saveState()` (script.js ~1131, `window.saveState`) writes `JSON.stringify(state)` → `shared/app_state`. Manual: global 💾 `#save-main-btn` and FFB `#save-ffb-btn`.
- Module saves (mostly **silent autosaves** on each edit, so dirty-tracking must clear on them too):
  `window.saveMaintenanceData` → `shared/maintenance_data`; `window.saveWeeklyActivityData` → `shared/weekly_activity_data`; `saveIronHorseData` → `shared/ironhorse_data` (module-local const); `saveSprayingData` → `shared/spraying_data` (module-local); `saveManuringToFirebase` → `shared/manuring_data` (module-local).
- Since several save fns are module-local, the reliable choke point is patching the compat-SDK
  Reference prototype: clear the dirty flag on any `.set()` whose `ref.toString()` contains `/shared/`.
- Mark dirty on `input` events on `.edit-input, .ha-input` inside `main` only; exclude
  `#login-overlay`, `#forgot-pw-overlay`, `#first-login-overlay`, `.nav-filter-input`, palette input.
- False-dirty is acceptable (one extra confirm); false-clean = today's behavior, no regression.
- Add `beforeunload` guard + an "● unsaved" badge near `#header-user-info`.

### Phase 2 — Replace ~98 `alert()` calls with `window.notify` toasts (mechanical) ✅ DONE
All 98 alerts replaced (success → 'success', failures → 'error', validation → 'warn').
`confirm()`/`prompt()` dialogs kept. The two "Backup restored — will reload" sites now delay
`location.reload()` by 1.2 s so the toast is visible (alert used to block before reloading).

### Phase 3 — Firebase Realtime DB security rules ✅ RULES WRITTEN — USER MUST DEPLOY
`database.rules.json` written; **not active until pasted into Firebase console → Realtime
Database → Rules → Publish** (the console editor accepts the `//` comments).
- Rules can't test array membership, so the app now also writes
  `user_roles/<uid>/editableMenusMap = {key:true,...}` alongside `editableMenus`
  (`menusToMap` in script.js; written by User Management create + edit).
- **Migration:** users created before this change have no `editableMenusMap` — after the rules
  go live an admin must re-save each existing user's permissions once (User Management → ✏ → Save).
- `dataManagement` grants write to ALL `shared/*` paths (its Restore rewrites every section).
- `user_roles` writes: admin, the first-ever-user bootstrap (only while `user_roles` is empty),
  or a user creating their own zero-permission default record; `firstLogin` self-clearable to false.
- `shared/audit_log` writable by any signed-in user; reads of everything require auth.

### Phase 4 — PWA/offline ✅ DONE
`sw.js` service worker: network-first for same-origin (fresh `?v=` code when online, cached app
shell + Excel templates offline), cache-first for CDN libs (jsdelivr/cdnjs/unpkg/gstatic/fonts);
Firebase DB/Auth traffic and Esri tiles are never intercepted. Bump `VERSION` in sw.js to flush
caches. Registered in ui_enhancements.js (`initOffline`), which also shows a red "📡 offline"
header badge + reconnect toasts (navigator online/offline). `manifest.json` added (no icons yet).
NB: the RTDB **web** SDK has no disk persistence — queued offline writes flush on reconnect but
are lost if the page reloads while offline; the badge tooltip warns to keep the page open.
### Phase 5 — Undo for deletes ✅ DONE
`window.notifyUndo(msg, onUndo, toastMs=7000, onExpire?)` in ui_enhancements.js — delete sites
remove + save immediately, then show an undo toast (hover pauses dismissal). Every deletion also
lands in a session-long **"Recently deleted" tray** (↩ chip bottom-right, panel with Restore per
item, max 50): restorable until the page is closed or reloaded (restore closures are live code,
so they can't survive a reload). `onExpire` (irreversible cleanup, e.g. purging a weekly photo)
runs on cap-eviction or `pagehide` (best-effort — a force-killed tab may orphan photo bytes).
Converted (confirm() removed): maintenance gang + work-log entry, Iron Horse asset + gang
assignment, spraying block, FFB Budget block, weekly observation (photo bytes purged via
onExpire so Undo keeps the photo). Kept confirm() (undo impossible/misleading): backup
restore/delete, user delete, bulk delete, clear-all-year (spraying/manuring/performance),
weekly week delete (images), harvesting gang remove (block reassignment).
### Phase 6 — PDF export ✅ DONE
Header "🖨️ PDF" button (`initPrintButton` in ui_enhancements.js): renames `document.title` to
"<current view heading> — <date>" (becomes the suggested PDF filename), opens the browser print
dialog (Save as PDF), restores the title on `afterprint`. Print CSS strips all chrome.
### Phase 7 — Dashboard alerts ✅ DONE
"⚠️ Harvest alerts" section on the dashboard (render_dashboard.js): a block's last-harvest date is
the latest non-empty cell in its interval `days` grid; blocks past `ALERT_OVERDUE_DAYS` (21) show
as clickable chips (amber; red past 42 days) linking to the Interval view, capped at 10 + "+N
more", plus a count of blocks never harvested. Hidden entirely when the year has no interval data;
shows a green all-clear when nothing is overdue.
### Phase 8 — Dark mode ✅ DONE
`html.dark` palette override in style.css (the app styles itself via CSS variables, so the swap
covers most surfaces; `color-scheme: dark` handles native inputs). Applied pre-paint by an inline
head script reading `localStorage.theme`; toggled by the 🌙/☀️ header button
(`initThemeToggle` in ui_enhancements.js), which also re-tints Chart.js defaults and re-renders
the dashboard charts. Printing always uses the light palette (`@media print` re-override).
Known leftovers: semantic light tints (status chips/cells with inline dark text) stay light by
design; the Rainfall sheet keeps its white "Excel paper" look on purpose.
### Phase 9 — Split script.js into modules. 🔶 IN PROGRESS (branch `2026-06-11_11-30-05`)
Step 1 done (script.js 5259 → 4195 lines). Pattern: extract a contiguous closure section into a
file that receives its dependencies explicitly and returns what the rest needs — no build step.
- `app_boot.js` — login shell: Firebase init, login/logout, remember-me, idle timer. Sets
  `window._fb = { auth, db }` and calls `window.runMainApplication()` after login.
- `app_user_mgmt.js` — `window._initUserMgmt({auth, db})` → `{ loadUserRole,
  applyRolePermissions, renderUserManagementPanel }`; still defines `window._canEdit/_applyReadOnly`.
- script.js — `runMainApplication` (now `window.runMainApplication`), reads `window._fb` at start.
  Load order in index.html: app_boot → app_user_mgmt → script.js. Deleted stale **unloaded**
  `render_interval.js` (the live `renderIntervalTable` is inside script.js).
- Verified: localhost boots with zero console errors; `_initUserMgmt` instantiates.
**Next extraction candidates** (clean → messy): handleImportExcel/FFB import block (~1375–1690);
renderSidebar (~2171–2747, calls every renderer — extract LAST along with init).
The view renderers (renderTable/Performance/Interval/FfbBudget) share many closure locals
(months, formatHA, recalculateTotals, DOM refs) — extract each WITH its helpers or pass a ctx.

---

## Dependencies
```bash
npm install          # installs jszip (used in test scripts)
```
ExcelJS and JSZip are loaded from CDN in the browser — no local install needed for the app itself.

## Node.js utilities
```bash
node gen_spray.js    # (deleted after use) — generates spraying XLSX server-side for testing
```
