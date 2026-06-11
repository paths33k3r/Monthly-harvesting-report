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

    // =================================================================
    // Quick Access — per-user customizable shortcuts (toggle on/off).
    // The enabled set is saved to Firebase under user_prefs/<uid>/quickAccess
    // so it follows the account across devices. Cards always render in the
    // fixed catalog order below (no reordering). Falls back to localStorage
    // when logged out.
    // =================================================================
    const QA_CATALOG = [
        { id: 'planting',           icon: '📋', title: 'Planting Phase Record', desc: 'Blocks & planted area',        target: 'sidebar-planting' },
        { id: 'interval',           icon: '📐', title: 'Harvesting Interval',    desc: 'Monthly interval entry',       target: 'sidebar-interval' },
        { id: 'perf',               icon: '📈', title: 'Harvesting Performance', desc: 'Performance by gang & block',  target: 'sidebar-perf' },
        { id: 'current-prev',       icon: '🔁', title: 'Current vs Previous',    desc: 'Month-over-month compare',     target: 'sidebar-current-prev' },
        { id: 'ytd',                icon: '📅', title: 'YTD Performance',        desc: 'Year-to-date figures',         target: 'sidebar-ytd' },
        { id: 'ffb-budget',         icon: '🎯', title: 'FFB Budget',             desc: 'Budget estimate',              target: 'sidebar-ffb-budget' },
        { id: 'harvesting-gangs',   icon: '🧑‍🌾', title: 'Harvesting Gangs',      desc: 'Gang overview',                target: 'sidebar-harvesting-gangs' },
        { id: 'ironhorse-assets',   icon: '🐴', title: 'Iron Horse Assets',      desc: 'Machines & gang assignment',   target: 'sidebar-ironhorse-assets' },
        { id: 'ironhorse-expenses', icon: '💰', title: 'Iron Horse Expenses',    desc: 'Monthly expense tracking',     target: 'sidebar-ironhorse-expenses' },
        { id: 'ironhorse-costperha',icon: '📊', title: 'Iron Horse Cost / HA',   desc: 'Cost per hectare',             target: 'sidebar-ironhorse-costperha' },
        { id: 'rainfall',           icon: '🌧️', title: 'Rainfall Record',        desc: 'Monthly rainfall',             target: 'sidebar-rainfall' },
        { id: 'spraying',           icon: '💧', title: 'Spraying',               desc: 'Spraying maintenance',         target: 'sidebar-spraying' },
        { id: 'manuring',           icon: '🧪', title: 'Manuring',               desc: 'Manuring records',             target: 'sidebar-manuring' },
        { id: 'mnt-worklog',        icon: '🌿', title: 'Field Maintenance',      desc: 'Work log & Gantt',             target: 'sidebar-mnt-worklog' },
        { id: 'mnt-gangs',          icon: '👥', title: 'Maintenance Gangs',      desc: 'Gang setup',                   target: 'sidebar-mnt-gangs' },
        { id: 'excel-reports',      icon: '📊', title: 'Reports',                desc: 'Download Excel reports',       target: 'sidebar-excel-reports' },
        { id: 'audit-log',          icon: '🧾', title: 'Audit Log',              desc: 'Activity history',             target: 'sidebar-audit-log' },
        { id: 'user-mgmt',          icon: '🔐', title: 'User Management',        desc: 'Roles & access',               target: 'sidebar-user-mgmt' }
    ];
    const QA_DEFAULT = ['planting', 'perf', 'ironhorse-expenses', 'mnt-worklog', 'rainfall', 'excel-reports'];
    const QA_BY_ID = {};
    QA_CATALOG.forEach(c => { QA_BY_ID[c.id] = c; });

    function qaGetUid() {
        try { return (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null; } catch (e) { return null; }
    }
    function qaGetDb() {
        try { return window._ironHorseDb || (window.firebase && firebase.database()) || null; } catch (e) { return null; }
    }
    // A shortcut is usable only if its sidebar target exists and isn't access-hidden.
    function qaUsable(target) {
        const el = document.getElementById(target);
        if (!el) return false;
        let n = el;
        while (n) { if (n.classList && n.classList.contains('hidden')) return false; n = n.parentElement; }
        return true;
    }
    // Set of enabled ids (ignores unknown ids).
    function qaEnabledSet(order) {
        const set = {};
        (order || []).forEach(id => { if (QA_BY_ID[id]) set[id] = 1; });
        return set;
    }
    // localStorage key for a given uid (anon users included). Used as a fallback
    // so the preference survives a refresh even when the Firebase write/read of
    // user_prefs is blocked by security rules.
    function qaLsKey(uid) { return 'qa_pref_' + (uid || 'anon'); }
    function qaReadLs(uid) {
        try {
            const raw = localStorage.getItem(qaLsKey(uid));
            if (raw) { const o = JSON.parse(raw); if (Array.isArray(o) && o.length) return o; }
        } catch (e) {}
        return null;
    }
    // Load this user's preference once, cache on window._qaPref, then re-render.
    function qaLoadInto(done) {
        const uid = qaGetUid();
        const db = qaGetDb();
        if (!uid || !db) {
            window._qaPref = { uid: uid || 'anon', order: qaReadLs(uid) || QA_DEFAULT.slice() };
            done();
            return;
        }
        db.ref('user_prefs/' + uid + '/quickAccess').once('value')
            .then(snap => {
                const val = snap.val();
                let order;
                if (Array.isArray(val) && val.length) {
                    order = val;
                    try { localStorage.setItem(qaLsKey(uid), JSON.stringify(order)); } catch (e) {}
                } else {
                    // Nothing in the cloud (or write was blocked) — fall back to the
                    // last choice saved locally before defaulting.
                    order = qaReadLs(uid) || QA_DEFAULT.slice();
                }
                window._qaPref = { uid: uid, order: order };
                done();
            })
            .catch(() => { window._qaPref = { uid: uid, order: qaReadLs(uid) || QA_DEFAULT.slice() }; done(); });
    }
    function qaSave(order) {
        const uid = qaGetUid();
        const db = qaGetDb();
        window._qaPref = { uid: uid || 'anon', order: order.slice() };
        // Always mirror to localStorage so the choice survives a refresh even if the
        // Firebase write is denied (user_prefs may not be covered by DB rules).
        try { localStorage.setItem(qaLsKey(uid), JSON.stringify(order)); } catch (e) {}
        if (uid && db) {
            db.ref('user_prefs/' + uid + '/quickAccess').set(order).catch(e => console.error('quickAccess save failed:', e));
        }
    }

    function qaOpenModal() {
        const pref = (window._qaPref && window._qaPref.order) ? window._qaPref.order : QA_DEFAULT;
        const enabledSet = qaEnabledSet(pref);

        const rowsHtml = QA_CATALOG.map(c => {
            const checked = enabledSet[c.id] ? 'checked' : '';
            const usable = qaUsable(c.target);
            const note = usable ? '' : ' <span style="font-size:.7rem; color:#b91c1c;">(no access)</span>';
            return `<li style="margin-bottom:.4rem;">
                <label style="display:flex; align-items:center; gap:.6rem; padding:.5rem .6rem; border:1px solid var(--border-color,#e5e7eb); border-radius:8px; background:var(--bg-primary,#fff); cursor:pointer; ${usable ? '' : 'opacity:.55;'}">
                    <input type="checkbox" class="qa-check" data-id="${c.id}" ${checked} style="width:16px; height:16px; flex:none;">
                    <span style="font-size:1.2rem;">${c.icon}</span>
                    <span style="flex:1; min-width:0;"><span style="font-weight:600;">${c.title}</span>${note}<br><span style="font-size:.78rem; color:var(--text-muted,#6b7280);">${c.desc}</span></span>
                </label>
            </li>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'qa-modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:9999;';
        overlay.innerHTML = `
            <div style="background:var(--bg-primary,#fff); width:min(480px,92vw); max-height:85vh; display:flex; flex-direction:column; border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.25); overflow:hidden;">
                <div style="padding:1rem 1.25rem; border-bottom:1px solid var(--border-color,#e5e7eb);">
                    <h3 style="margin:0; font-size:1.05rem; color:var(--text-primary,#111827);">Customize Quick Access</h3>
                    <p style="margin:.25rem 0 0; font-size:.82rem; color:var(--text-muted,#6b7280);">Tick the shortcuts you want on your dashboard. Saved to your account.</p>
                </div>
                <ul style="list-style:none; margin:0; padding:1rem 1.25rem; overflow:auto;">${rowsHtml}</ul>
                <div style="padding:.85rem 1.25rem; border-top:1px solid var(--border-color,#e5e7eb); display:flex; justify-content:flex-end; gap:.6rem;">
                    <button type="button" id="qa-cancel" style="padding:.5rem 1rem; border:1px solid var(--border-color,#e5e7eb); background:var(--bg-secondary,#f3f4f6); border-radius:8px; cursor:pointer;">Cancel</button>
                    <button type="button" id="qa-save" style="padding:.5rem 1.1rem; border:none; background:#10b981; color:#fff; border-radius:8px; cursor:pointer; font-weight:600;">Save</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('#qa-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#qa-save').onclick = () => {
            const checkedIds = {};
            Array.prototype.slice.call(overlay.querySelectorAll('.qa-check')).forEach(cb => {
                if (cb.checked) checkedIds[cb.getAttribute('data-id')] = 1;
            });
            // Persist in fixed catalog order so display order stays stable.
            const order = QA_CATALOG.map(c => c.id).filter(id => checkedIds[id]);
            qaSave(order);
            overlay.remove();
            window.renderDashboard();
        };
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // Historical FFB grand totals (MT) per month, hard-coded from the user's
    // "FFB summary 2021 - 2024.xlsx". Live performance data, when it exists
    // for one of these years, takes precedence over this table.
    const FFB_HISTORY = {
        '2021': [1356.00, 1080.00, 1834.00, 1809.00, 1809.00, 1758.42, 2009.62, 2512.03, 2512.03, 3516.84, 2763.23, 2512.03],
        '2022': [1276.75, 822.83, 1061.45, 1274.54, 1496.14, 1363.34, 1483.82, 1896.38, 1883.46, 2346.50, 1936.18, 1991.04],
        '2023': [1450.95, 1191.72, 1334.48, 1263.48, 1400.83, 1424.10, 1582.25, 1658.37, 1806.92, 1966.14, 1803.11, 1545.42],
        '2024': [1328.21, 852.04, 655.97, 1064.09, 1352.63, 1285.96, 1537.55, 2136.82, 2341.78, 2640.73, 2304.94, 1989.43]
    };
    const FFB_HISTORY_COLORS = { '2021': '#94a3b8', '2022': '#3b82f6', '2023': '#8b5cf6', '2024': '#ef4444' };
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

        // hard-coded history years, skipping any year already covered live
        const historyYears = Object.keys(FFB_HISTORY)
            .filter(y => y !== yrCurr && y !== yrPrev && !monthlyFfbTotals(perf[y]).any)
            .sort();
        const hasFfbData = currTotals.any || prevTotals.any || historyYears.length > 0;

        // one bar per year: hard-coded history + any live year with data
        const sum12 = (arr) => arr.reduce((t, v) => t + (Number(v) || 0), 0);
        const yearlyTotals = historyYears.map(y => ({ y: y, total: sum12(FFB_HISTORY[y]), color: FFB_HISTORY_COLORS[y] || '#94a3b8' }));
        if (prevTotals.any) yearlyTotals.push({ y: yrPrev, total: sum12(prevTotals.arr), color: '#f59e0b' });
        if (currTotals.any) yearlyTotals.push({ y: yrCurr, total: sum12(currTotals.arr), color: '#10b981' });
        yearlyTotals.sort((a, b) => a.y.localeCompare(b.y));
        const hasYearly = yearlyTotals.length > 0;

        const budgetCurr = monthlyBudgetTotals(s.ffbBudget && s.ffbBudget[yrCurr]);
        const hasBudgetView = currTotals.any || budgetCurr.any;

        const haCurr = totalHaForYear(s, yrCurr);
        const haPrev = totalHaForYear(s, yrPrev);
        const yieldCurr = currTotals.arr.map(v => (haCurr > 0 ? v / haCurr : 0));
        const yieldPrev = prevTotals.arr.map(v => (haPrev > 0 ? v / haPrev : 0));
        const hasYield = (haCurr > 0 && currTotals.any) || (haPrev > 0 && prevTotals.any);

        // ---- Quick Access: resolve this user's saved shortcut preference ----
        const curUid = qaGetUid() || 'anon';
        const prefLoaded = window._qaPref && window._qaPref.uid === curUid;
        const qaOrder = prefLoaded ? window._qaPref.order : QA_DEFAULT;
        const qaEnabled = qaEnabledSet(qaOrder);
        const qaCards = QA_CATALOG.filter(c => qaEnabled[c.id] && qaUsable(c.target));
        const qaCardsHtml = qaCards.length
            ? qaCards.map(c => quickCard(c.icon, c.title, c.desc, c.target)).join('')
            : `<p style="grid-column:1/-1; color:var(--text-muted,#6b7280); padding:1rem 0;">No shortcuts selected yet — click <strong>Customize</strong> to add some.</p>`;

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
                ${chartCard('FFB Production — Total Tonnage', historyYears.length ? `${historyYears[0]} – ${yrCurr}` : `${yrPrev} vs ${yrCurr}`, 'ffbCompareChart', 'ffbCompareEmpty', ffbEmptyMsg, 320)}
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:1.25rem; margin-bottom:1.5rem;">
                ${chartCard('Yearly Totals', yearlyTotals.length ? `${yearlyTotals[0].y} – ${yearlyTotals[yearlyTotals.length - 1].y}` : '', 'ffbYearlyChart', 'ffbYearlyEmpty', 'No yearly figures yet.', 280)}
                ${chartCard('Actual vs Budget', yrCurr, 'ffbBudgetChart', 'ffbBudgetEmpty', budgetEmptyMsg, 280)}
                ${chartCard('Yield (MT / HA)', `${yrPrev} vs ${yrCurr}`, 'ffbYieldChart', 'ffbYieldEmpty', yieldEmptyMsg, 280)}
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-top:1.5rem;">
                <h3 class="dash-section" style="margin:0;">Quick access</h3>
                <button type="button" id="qa-customize-btn" style="display:inline-flex; align-items:center; gap:.4rem; padding:.4rem .8rem; border:1px solid var(--border-color,#e5e7eb); background:var(--bg-secondary,#f3f4f6); border-radius:8px; cursor:pointer; font-size:.85rem; color:var(--text-primary,#111827);">⚙️ Customize</button>
            </div>
            <div class="quick-grid" id="qa-grid">
                ${qaCardsHtml}
            </div>
        `;

        wrapper.querySelectorAll('.quick-card').forEach(card => {
            card.onclick = () => {
                const el = document.getElementById(card.getAttribute('data-target'));
                if (el) el.click();
            };
        });

        // Quick Access customize button + first-load of the saved preference.
        const qaBtn = document.getElementById('qa-customize-btn');
        if (qaBtn) qaBtn.onclick = qaOpenModal;
        if (!prefLoaded) {
            // Renders once with defaults, then re-renders with the synced preference.
            qaLoadInto(() => window.renderDashboard());
        }

        // ---- Chart 1: FFB total tonnage, year vs year (line) ----
        drawChart('ffbCompareChart', 'ffbCompareEmpty', hasFfbData, {
            type: 'line',
            data: {
                labels: MONTHS,
                datasets: [
                    // dashed muted lines for the hard-coded history; click the
                    // legend to hide/show any year
                    ...historyYears.map(y => ({
                        label: y, data: FFB_HISTORY[y],
                        borderColor: FFB_HISTORY_COLORS[y] || '#94a3b8',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5, borderDash: [6, 4], tension: 0.3,
                        fill: false, pointRadius: 2, pointHoverRadius: 4
                    })),
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

        // ---- Chart 1b: total tonnage per year (bar, multi-year trend) ----
        drawChart('ffbYearlyChart', 'ffbYearlyEmpty', hasYearly, {
            type: 'bar',
            data: {
                labels: yearlyTotals.map(t => t.y),
                datasets: [{
                    label: 'FFB (MT)',
                    data: yearlyTotals.map(t => t.total),
                    backgroundColor: yearlyTotals.map(t => t.color),
                    borderRadius: 6,
                    maxBarThickness: 64
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `${fmt(ctx.parsed.y)} MT` } }
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
