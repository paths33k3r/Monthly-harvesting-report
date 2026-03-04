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

### 📈 Harvesting Performance Dashboard
- **Dropdown Month Selector**: Quickly toggle between monthly performance records via a clean dropdown menu.
- **Data Tables**: Track 1st, 2nd, and 3rd round harvest tonnages, along with budget comparisons.
- **Calculated Metrics**: Automatically compute totals, mandays, MT / Manday, HA per person, and Ratio of HA to MT.
- **Interactive Charts**: Visual breakdown of block-by-block performance and budgets using Chart.js.

### 🤔 Harvesting Interval
- View harvesting frequency, minimum, maximum, and average days between harvests per block.
- Monitor block performance over multiple rounds to ensure optimal harvesting schedules.
- Summary table summarizing totals for each round.

### ⚙️ Data Management
- **Excel Import (`.xlsx`, `.xls`)**: Instantly upload harvesting data directly into the dashboard using SheetJS.
- **Template Download**: One-click generation of the expected `Harvesting_Template.xlsx` template format to ensure data consistency.
- **Admin Utilities**: Capabilities to wipe year data or clean out test inputs.

## 🚀 Running Locally

This application is built using a simple, modern stack (HTML/CSS/Vanilla JS). You can start it locally using any HTTP server.

For example, using `npx`:
```bash
npx http-server -p 8080 -c-1
```

Or using python:
```bash
python -m http.server 8080
```

## 📋 Ongoing Progress / Roadmap
- [x] Initial design and responsive layout (Sidebar & content view)
- [x] Grouping algorithms for O/P and Gang assignment
- [x] Client-side JSON data parsing
- [x] Integrate Chart.js for performance visualization
- [x] Build data management tool (Import Excel / Download Template)
- [x] Update month selection to a dropdown for a cleaner UI
- [ ] Implement robust persistent storage (e.g., LocalStorage / Database Backend)
- [ ] Print/Export to PDF reports
