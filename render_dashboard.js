// =====================================================================
// Dashboard home — KPI snapshot + quick links.
// Reads window.state defensively so a missing/changed structure shows a
// safe fallback instead of throwing. Navigation reuses the existing
// sidebar handlers via .click().
// =====================================================================
(function () {
    function fmt(n) {
        return (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function latestYear(obj) {
        if (!obj || typeof obj !== 'object') return null;
        const ys = Object.keys(obj).filter(k => /^\d{4}$/.test(k)).sort();
        return ys.length ? ys[ys.length - 1] : null;
    }
    function kpiCard(icon, soft, value, label) {
        return `<div class="kpi-card">
            <div class="kpi-chip" style="background:${soft}">${icon}</div>
            <div class="kpi-value">${value}</div>
            <div class="kpi-label">${label}</div>
        </div>`;
    }
    function quickCard(icon, title, desc, sidebarId) {
        return `<button type="button" class="quick-card" data-target="${sidebarId}">
            <span class="quick-ico">${icon}</span>
            <span class="quick-body">
                <span class="quick-title">${title}</span>
                <span class="quick-desc">${desc}</span>
            </span>
            <span class="quick-arrow">→</span>
        </button>`;
    }

    window.renderDashboard = function () {
        const wrapper = document.getElementById('dashboard-wrapper');
        if (!wrapper) return;
        const s = window.state || {};

        // ---- KPIs (each guarded independently) ----
        let totalHa = 0, blockCount = 0;
        const ryear = latestYear(s.reports);
        if (ryear && Array.isArray(s.reports[ryear])) {
            blockCount = s.reports[ryear].length;
            totalHa = s.reports[ryear].reduce((t, b) => t + (Number(b.ha) || 0), 0);
        }

        let machines = 0;
        const ihYear = latestYear(s.ironHorse && s.ironHorse.assets);
        if (ihYear && Array.isArray(s.ironHorse.assets[ihYear])) {
            machines = s.ironHorse.assets[ihYear].length;
        }

        let maintLogs = 0;
        const mYear = latestYear(s.maintenance);
        if (mYear && s.maintenance[mYear] && Array.isArray(s.maintenance[mYear].entries)) {
            maintLogs = s.maintenance[mYear].entries.length;
        }

        const suffix = (y) => (y ? ` (${y})` : '');

        wrapper.innerHTML = `
            <div class="dash-head">
                <h1>Dashboard</h1>
                <p>Estate overview${ryear ? ' · Report Year ' + ryear : ''}</p>
            </div>
            <div class="kpi-grid">
                ${kpiCard('🌴', '#ecfdf5', fmt(totalHa) + ' <span class="kpi-unit">HA</span>', 'Total Planted' + suffix(ryear))}
                ${kpiCard('📋', '#eff4ff', blockCount, 'Blocks' + suffix(ryear))}
                ${kpiCard('🐴', '#f5f3ff', machines, 'Iron Horse Machines' + suffix(ihYear))}
                ${kpiCard('🌿', '#fffbeb', maintLogs, 'Maintenance Logs' + suffix(mYear))}
            </div>
            <h3 class="dash-section">Quick access</h3>
            <div class="quick-grid">
                ${quickCard('📋', 'Planting Phase Record', 'Blocks &amp; planted area', 'sidebar-planting')}
                ${quickCard('📈', 'Harvesting Performance', 'Interval, YTD &amp; charts', 'sidebar-perf')}
                ${quickCard('🐴', 'Iron Horse', 'Assets, expenses &amp; cost', 'sidebar-ironhorse-expenses')}
                ${quickCard('🌿', 'Field Maintenance', 'Work log &amp; Gantt', 'sidebar-mnt-worklog')}
                ${quickCard('🌧️', 'Rainfall Record', 'Monthly rainfall', 'sidebar-rainfall')}
                ${quickCard('📊', 'Reports', 'Download Excel reports', 'sidebar-excel-reports')}
            </div>
        `;

        wrapper.querySelectorAll('.quick-card').forEach(card => {
            card.onclick = () => {
                const el = document.getElementById(card.getAttribute('data-target'));
                if (el) el.click();
            };
        });
    };
})();
