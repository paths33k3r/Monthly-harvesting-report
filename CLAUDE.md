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
| `script.js` | Main app logic, Firebase sync, UI rendering |
| `render_reports.js` | **Excel report downloads** — YTD, Rainfall, Spraying |
| `render_spraying.js` | Spraying section UI + `getDefaultSprayingData()` |
| `render_manuring.js` | Manuring section UI |
| `render_ytd_report.js` | YTD report UI |
| `render_ironhorse.js` | Iron Horse section UI — Assets, Expenses, template download, import |
| `render_maintenance.js` | Maintenance Gangs, Work Log & Gantt Chart (digitises the hand-written Gantt sheets) |
| `render_weekly.js` | **Weekly Activity** — track-driven field report: KMZ/KML/GPX import, Leaflet satellite map, photo storage, Word `.docx` export |
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
### Phase 8 — Dark mode (hard: many hardcoded inline colors in render_*.js). ← NEXT
### Phase 9 — Split script.js (~291 KB) into modules. Do alone; riskiest.

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
