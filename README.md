# Monthly Harvesting Report

Interactive web dashboard for visualizing and managing plantation harvesting performance.

## 🌟 Features Implemented

### 📊 Planting Phase Record
- Hierarchical view of blocks by Year (O/P phase).
- Calculate and display total hectares (HA) per year and sub-totals per phase.
- Add, edit, or delete blocks on the fly.

### 👥 Harvesting Gangs Management
- Predefined team assignments and dynamic gang creation.
- View and manage blocks assigned to each Gang.
- Grouping interface that aligns blocks with specific operational years under each Gang.
- **Historical Consistency**: Gang assignments and block allocations are maintained on a month-to-month basis, preserving historical records even if teams change in the future.

### 📈 Harvesting Performance Dashboard
- **Dropdown Month Selector**: Quickly toggle between monthly performance records via a clean dropdown menu.
- **Data Tables**: Track 1st, 2nd, 3rd, and 4th round harvest tonnages, along with budget comparisons.
- **Automatic Manpower Retrieval**: The system automatically calculates the **Peak Daily Attendance** (highest sum of manpower across all assigned blocks on any single day) for the imported month.
- **🔄 Sync Button**: Integrated refresh button to manually update or recover the peak manpower figure from the interval data.
- **Calculated Metrics**: Automatically compute totals, mandays, MT / Manday, HA per person, and Ratio of HA to MT.
- **Interactive Charts**: Visual breakdown of block-by-block performance and budgets using Chart.js.

### 🤔 Harvesting Interval
- View harvesting frequency, minimum, maximum, and average days between harvests per block.
- Monitor block performance over multiple rounds to ensure optimal harvesting schedules.
- Detailed daily manpower and round tracking for each block.
- Summary table summarizing totals for each round.

### 🌴 FFB Budget Estimate
- **Editable Grid**: A fully interactive spreadsheet-like view to budget your FFB targets by block and month.
- **Auto-Aggregation**: Live calculation of Subtotals per planting phase and Grand Totals across the year.
- **Budget Duplication**: Easily roll over budgets and gang assignments to the next year using the `➕ Add Year` feature.

### ⚙️ Data Management
- **Persistent Storage**: All edits to the FFB Budget and Planting Phase records are instantly saved to the browser's `localStorage`.
- **Excel Import (`.xlsx`, `.xls`)**: Instantly upload harvesting data directly into the dashboard using SheetJS.
- **Template Download**: One-click generation of the expected `Harvesting_Template.xlsx` template format.
- **Admin Utilities**: Robust initialization and error handling for smooth navigation across years and months.

## 🚀 Running Locally

This application is built using a simple, modern stack (HTML/CSS/Vanilla JS). You can start it locally using any HTTP server.

For example, using `python`:
```bash
python -m http.server 8001
```

> [!NOTE]
> If you experience caching issues (old code showing up), clear your browser cache or run on a different port like `8001`.

## 📋 Ongoing Progress / Roadmap
- [x] Initial design and responsive layout (Sidebar & content view)
- [x] Grouping algorithms for O/P and Gang assignment
- [x] Client-side JSON data parsing
- [x] Integrate Chart.js for performance visualization
- [x] Build data management tool (Import Excel / Download Template)
- [x] Update month selection to a dropdown for a cleaner UI
- [x] Implement robust persistent storage (LocalStorage)
- [x] Automatic manpower retrieval from interval data
- [x] Historical monthly gang data preservation
- [x] UI enhancement layer: Ctrl+K command palette, sidebar filter, mobile off-canvas nav, scroll-to-top, `?` shortcut help, `window.notify()` toast API, print stylesheet (`ui_enhancements.js`)
- [x] "Open in New Tab" deep links — every sidebar view has a real `#nav=<sidebar-id>` URL; refresh restores the current view
- [x] Unsaved-changes warning — "● unsaved" header badge + leave-page guard; clears on any cloud save
- [ ] Print/Export to PDF reports

## 🔧 Planned Enhancements (prioritized — continue from here)
Work in phases, one commit each, so the app stays working at every step.
See **CLAUDE.md → "Enhancement roadmap"** for technical notes per phase.

1. ~~**Unsaved-changes warning + Save indicator**~~ ✅ done
2. ~~**Replace ~98 `alert()` calls with toasts**~~ ✅ done
3. ~~**Firebase security rules**~~ ✅ written (`database.rules.json`) — **NOT ACTIVE until deployed**: paste into Firebase console → Realtime Database → Rules → Publish, then re-save each pre-existing user's permissions once in User Management
4. ~~**PWA / offline support**~~ ✅ done — `sw.js` caches the app shell + CDN libs; "📡 offline" badge + reconnect toast (note: reloading while offline loses unsynced edits — keep the page open)
5. ~~**Undo for deletes**~~ ✅ done — row/item deletes (work-log entries, gangs, assets, blocks, observations) show a 5-second "Deleted — Undo" toast; destructive bulk actions still ask for confirmation
6. ~~**PDF export buttons**~~ ✅ done — header 🖨️ PDF button prints the current view with a clean layout and a sensible PDF filename
7. ~~**Dashboard alerts**~~ ✅ done — "Harvest alerts" on the dashboard flags blocks >21 days since their last recorded harvest (click a chip to open the Interval view)
8. **Dark mode** (large) — many render files hardcode inline colors; needs care
9. **Split `script.js` (~291 KB) into modules** (large, riskiest — do alone with nothing else in flight)
