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

        // ---- FFB year-over-year comparison (two most recent years with data) ----
        const perf = s.performance || {};
        const perfYears = Object.keys(perf).filter(k => /^\d{4}$/.test(k)).sort();
        const yrCurr = perfYears.length ? perfYears[perfYears.length - 1] : '2026';
        const yrPrev = perfYears.length > 1 ? perfYears[perfYears.length - 2] : String(Number(yrCurr) - 1);
        const currTotals = monthlyFfbTotals(perf[yrCurr]);
        const prevTotals = monthlyFfbTotals(perf[yrPrev]);
        const hasFfbData = currTotals.any || prevTotals.any;

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
            <h3 class="dash-section">FFB Production — ${yrPrev} vs ${yrCurr}</h3>
            <div style="background:var(--bg-primary,#fff); border:1px solid var(--border-color,#e5e7eb); border-radius:12px; padding:1rem 1.25rem 1.25rem; margin-bottom:1.5rem;">
                <div style="position:relative; height:320px;">
                    <canvas id="ffbCompareChart"></canvas>
                </div>
                <div id="ffbCompareEmpty" style="display:none; text-align:center; color:var(--text-muted,#6b7280); padding:2.5rem 1rem;">
                    No harvest figures captured yet for ${yrPrev} or ${yrCurr}.<br>
                    Import the Harvesting Interval files to populate this chart.
                </div>
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

        // ---- Draw FFB year-over-year comparison chart ----
        const canvas = document.getElementById('ffbCompareChart');
        const emptyEl = document.getElementById('ffbCompareEmpty');
        // Always tear down any prior instance so re-renders don't error on a reused canvas.
        if (window._ffbCompareChart) {
            try { window._ffbCompareChart.destroy(); } catch (e) {}
            window._ffbCompareChart = null;
        }
        if (canvas && typeof Chart !== 'undefined') {
            if (!hasFfbData) {
                canvas.style.display = 'none';
                if (emptyEl) emptyEl.style.display = 'block';
            } else {
                canvas.style.display = 'block';
                if (emptyEl) emptyEl.style.display = 'none';
                window._ffbCompareChart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: MONTHS,
                        datasets: [
                            {
                                label: yrPrev,
                                data: prevTotals.arr,
                                borderColor: '#f59e0b',
                                backgroundColor: 'rgba(245,158,11,0.12)',
                                borderWidth: 2, tension: 0.3, fill: true,
                                pointRadius: 3, pointHoverRadius: 5
                            },
                            {
                                label: yrCurr,
                                data: currTotals.arr,
                                borderColor: '#10b981',
                                backgroundColor: 'rgba(16,185,129,0.12)',
                                borderWidth: 2, tension: 0.3, fill: true,
                                pointRadius: 3, pointHoverRadius: 5
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { position: 'top' },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} MT`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: 'FFB (MT)' },
                                ticks: { callback: (v) => Number(v).toLocaleString('en-MY') }
                            }
                        }
                    }
                });
            }
        }
    };
})();
