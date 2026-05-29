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

## Dependencies
```bash
npm install          # installs jszip (used in test scripts)
```
ExcelJS and JSZip are loaded from CDN in the browser — no local install needed for the app itself.

## Node.js utilities
```bash
node gen_spray.js    # (deleted after use) — generates spraying XLSX server-side for testing
```
