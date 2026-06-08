// =====================================================================
// Dashboard home — KPI snapshot, FFB analytics charts + quick links.
// Reads window.state defensively so a missing/changed structure shows a
// safe fallback instead of throwing. Navigation reuses the existing
// sidebar handlers via .click(). Charts use the already-loaded Chart.js.
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

    // A reusable chart "card" shell — title row + fixed-height canvas + empty-state.
    function chartCard(title, sub, canvasId, emptyId, emptyMsg, height) {
        return `
            <div style="background:var(--bg-primary,#fff); border:1px solid var(--border-color,#e5e7eb); border-radius:12px; padding:1rem 1.25rem 1.25rem;">
                <div style="display:flex; align-items:baseline; justify-content:space-between; gap:1rem; margin-bottom:.6rem;">
                    <h3 style="margin:0; font-size:1rem; color:var(--text-primary,#111827);">${title}</h3>
                    ${sub ? `<span style="font-size:.8rem; color:var(--text-muted,#6b7280); white-space:nowrap;">${sub}</span>` : ''}
                </div>
                <div style="position:relative; height:${height}px;">
                    <canvas id="${canvasId}"></canvas>
                </div>
                <div id="${emptyId}" style="display:none; text-align:center; color:var(--text-muted,#6b7280); padding:2rem 1rem; font-size:.9rem;">${emptyMsg}</div>
            </div>`;
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function monthIndex(key) {
        const k = String(key).slice(0, 3).toLowerCase();
        return MONTHS.findIndex(m => m.toLowerCase() === k);
    }

    // Total FFB tonnage (sum of r1..r4 across every gang/block) per month for one year.
    // Mirrors the actual-total logic in render_current_vs_prev.js.
    function monthlyFfbTotals(perfYearObj) {
        const arr = new Array(12).fill(0);
        let any = false;
        if (perfYearObj && typeof perfYearObj === 'object') {
            Object.keys(perfYearObj).forEach(mKey => {
                const idx = monthIndex(mKey);
                if (idx < 0) return;
                const monthObj = perfYearObj[mKey];
                if (!monthObj || typeof monthObj !== 'object') return;
                let sum = 0;
                Object.keys(monthObj).forEach(gang => {
                    if (gang === 'gangAssignments') return;
                    const blocks = monthObj[gang] && monthObj[gang].blocks;
                    if (!blocks || typeof blocks !== 'object') return;
                    Object.keys(blocks).forEach(bId => {
                        const pd = blocks[bId] || {};
                        sum += (parseFloat(pd.r1) || 0) + (parseFloat(pd.r2) || 0) +
                               (parseFloat(pd.r3) || 0) + (parseFloat(pd.r4) || 0);
                    });
                });
                arr[idx] = sum;
                if (sum) any = true;
            });
        }
        return { arr: arr, any: any };
    }

    // Total budgeted FFB tonnage per month for one year (sum of each block's months[]).
    function monthlyBudgetTotals(budgetArr) {
        const arr = new Array(12).fill(0);
        let any = false;
        if (Array.isArray(budgetArr)) {
            budgetArr.forEach(b => {
                const months = b && b.months;
                if (Array.isArray(months)) {
                    for (let i = 0; i < 12; i++) {
                        const n = parseFloat(months[i]) || 0;
                        arr[i] += n;
                        if (n) any = true;
                    }
                }
            });
        }
        return { arr: arr, any: any };
    }

    // Total planted HA for a year — prefers Planting Phase Record, falls back to budget rows.
    function totalHaForYear(s, year) {
        let ha = 0;
        if (s.reports && Array.isArray(s.reports[year])) {
            ha = s.reports[year].reduce((t, b) => t + (parseFloat(b.ha) || 0), 0);
        }
        if (!ha && s.ffbBudget && Array.isArray(s.ffbBudget[year])) {
            ha = s.ffbBudget[year].reduce((t, b) => t + (parseFloat(b.ha) || 0), 0);
        }
        return ha;
    }

    // Central chart registry so every re-render tears down its prior instance
    // (prevents "canvas already in use" and frees memory).
    const CHART_REG = window._dashCharts = window._dashCharts || {};
    function drawChart(canvasId, emptyId, hasData, config) {
        const canvas = document.getElementById(canvasId);
        const emptyEl = document.getElementById(emptyId);
        if (CHART_REG[canvasId]) {
            try { CHART_REG[canvasId].destroy(); } catch (e) {}
            CHART_REG[canvasId] = null;
        }
        if (!canvas || typeof Chart === 'undefined') return;
        if (!hasData) {
            canvas.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        canvas.style.display = 'block';
        if (emptyEl) emptyEl.style.display = 'none';
        CHART_REG[canvasId] = new Chart(canvas.getContext('2d'), config);
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

        // ---- FFB analytics: two most recent years that have performance data ----
        const perf = s.performance || {};
        const perfYears = Object.keys(perf).filter(k => /^\d{4}$/.test(k)).sort();
        const yrCurr = perfYears.length ? perfYears[perfYears.length - 1] : '2026';
        const yrPrev = perfYears.length > 1 ? perfYears[perfYears.length - 2] : String(Number(yrCurr) - 1);

        const currTotals = monthlyFfbTotals(perf[yrCurr]);
        const prevTotals = monthlyFfbTotals(perf[yrPrev]);
        const hasFfbData = currTotals.any || prevTotals.any;

        const budgetCurr = monthlyBudgetTotals(s.ffbBudget && s.ffbBudget[yrCurr]);
        const hasBudgetView = currTotals.any || budgetCurr.any;

        const haCurr = totalHaForYear(s, yrCurr);
        const haPrev = totalHaForYear(s, yrPrev);
        const yieldCurr = currTotals.arr.map(v => (haCurr > 0 ? v / haCurr : 0));
        const yieldPrev = prevTotals.arr.map(v => (haPrev > 0 ? v / haPrev : 0));
        const hasYield = (haCurr > 0 && currTotals.any) || (haPrev > 0 && prevTotals.any);

        const ffbEmptyMsg = `No harvest figures captured yet for ${yrPrev} or ${yrCurr}.<br>Import the Harvesting Interval files to populate this chart.`;
        const budgetEmptyMsg = `No actual or budget figures for ${yrCurr} yet.`;
        const yieldEmptyMsg = `Need harvest data and planted HA to compute yield.`;

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

            <h3 class="dash-section">Production overview</h3>
            <div style="margin-bottom:1.25rem;">
                ${chartCard('FFB Production — Total Tonnage', `${yrPrev} vs ${yrCurr}`, 'ffbCompareChart', 'ffbCompareEmpty', ffbEmptyMsg, 320)}
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:1.25rem; margin-bottom:1.5rem;">
                ${chartCard('Actual vs Budget', yrCurr, 'ffbBudgetChart', 'ffbBudgetEmpty', budgetEmptyMsg, 280)}
                ${chartCard('Yield (MT / HA)', `${yrPrev} vs ${yrCurr}`, 'ffbYieldChart', 'ffbYieldEmpty', yieldEmptyMsg, 280)}
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

        // ---- Chart 1: FFB total tonnage, year vs year (line) ----
        drawChart('ffbCompareChart', 'ffbCompareEmpty', hasFfbData, {
            type: 'line',
            data: {
                labels: MONTHS,
                datasets: [
                    {
                        label: yrPrev, data: prevTotals.arr,
                        borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)',
                        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5
                    },
                    {
                        label: yrCurr, data: currTotals.arr,
                        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)',
                        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} MT` } }
                },
                scales: {
                    y: {
                        beginAtZero: true, title: { display: true, text: 'FFB (MT)' },
                        ticks: { callback: (v) => Number(v).toLocaleString('en-MY') }
                    }
                }
            }
        });

        // ---- Chart 2: Actual vs Budget for current year (grouped bar) ----
        drawChart('ffbBudgetChart', 'ffbBudgetEmpty', hasBudgetView, {
            type: 'bar',
            data: {
                labels: MONTHS,
                datasets: [
                    {
                        label: `Actual ${yrCurr}`, data: currTotals.arr,
                        backgroundColor: 'rgba(16,185,129,0.78)', borderRadius: 4
                    },
                    {
                        label: `Budget ${yrCurr}`, data: budgetCurr.arr,
                        backgroundColor: 'rgba(148,163,184,0.55)', borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} MT` } }
                },
                scales: {
                    y: {
                        beginAtZero: true, title: { display: true, text: 'FFB (MT)' },
                        ticks: { callback: (v) => Number(v).toLocaleString('en-MY') }
                    }
                }
            }
        });

        // ---- Chart 3: Yield MT/HA, year vs year (line) ----
        drawChart('ffbYieldChart', 'ffbYieldEmpty', hasYield, {
            type: 'line',
            data: {
                labels: MONTHS,
                datasets: [
                    {
                        label: yrPrev, data: yieldPrev,
                        borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.10)',
                        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5
                    },
                    {
                        label: yrCurr, data: yieldCurr,
                        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.10)',
                        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${(Number(ctx.parsed.y) || 0).toFixed(2)} MT/HA` } }
                },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'MT / HA' } }
                }
            }
        });
    };
})();
