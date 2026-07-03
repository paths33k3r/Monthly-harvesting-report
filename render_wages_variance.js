// ─────────────────────────────────────────────────────────────────────────
// render_wages_variance.js — ⚖️ Wages Variance (Estimate vs Actual)
//
// Third sub-tab under 💵 Rate of Wages. Puts the Calculator's monthly
// ESTIMATE (window.wgCompute, render_wages.js) side by side with the Wage
// Ledger's imported ACTUALS (state.wagesLedger, render_wages_ledger.js) per
// gang, and flags the difference — entry errors and rate discrepancies show
// up immediately.
//
// Purely a DERIVED view: reads state.wages + state.wagesLedger, stores
// nothing — no Firebase path, no security-rule change, no save function.
// Access: menu key 'wages' (shared with the Calculator and the Ledger).
// ─────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const WV_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // A ledger row's pay = these fields summed (mirrors SCHEMES[].payFields
    // in render_wages_ledger.js — keep in sync if the ledger schemas change).
    const WV_PAY = {
        harvester: ['ripeAmount', 'bagsAmount', 'dailyPieceRate'],
        driverLoader: ['driverAmount', 'loaderAmount', 'loader2Amount', 'lorryAmount'],
        jobcard: ['amount'],
    };
    const WV_SCHEME_KEYS = ['harvester', 'driverLoader', 'jobcard'];
    const WV_SCHEME_LABEL = { harvester: 'Harvester', driverLoader: 'Driver & Loader', jobcard: 'Job Card' };

    // Variance thresholds (percent of the estimate)
    const WV_OK_PCT = 5;
    const WV_WARN_PCT = 15;

    // ── tiny helpers (mirror the wg/wl conventions) ──────────────────────
    const wvEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const wvNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const wvRM = (n) => 'RM' + wvNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wvPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    const wvCurrentYear = () => String(new Date().getFullYear());
    const wvCurrentMonth = () => WV_MONTHS[new Date().getMonth()];

    const wvYearList = () => {
        const set = new Set();
        [window.state.wagesLedger, window.state.wages, window.state.performance, window.state.gangsByYear]
            .forEach(obj => { if (obj) Object.keys(obj).forEach(k => { if (/^\d{4}$/.test(k)) set.add(k); }); });
        if (!set.size) set.add(wvCurrentYear());
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // Canonical gang names = harvesting ∪ maintenance ∪ gangs saved in wages
    // (the same union the Calculator and the Ledger dropdowns use).
    const wvGangList = (year) => {
        const set = new Set();
        ((window.state.gangsByYear && window.state.gangsByYear[year]) || []).forEach(g => { if (g) set.add(g); });
        const mnt = (window.state.maintenance && window.state.maintenance[year] && window.state.maintenance[year].gangs) || {};
        Object.keys(mnt).forEach(g => { if (g) set.add(g); });
        const wg = (window.state.wages && window.state.wages[year] && window.state.wages[year].gangs) || {};
        Object.keys(wg).forEach(g => { if (g) set.add(g); });
        return [...set].sort((a, b) => a.localeCompare(b));
    };

    // ── gang-name resolution ─────────────────────────────────────────────
    // Ledger imports carry whatever the payroll Excel used ("WENDERLINUS")
    // while the Calculator uses the app's names ("Wenderlinus Gang").
    // Tiers: exact (case/space-insensitive) → same ignoring the word "gang"
    // → unique first-word → unique 5-letter prefix. Unresolvable labels keep
    // their own row (flagged) rather than silently vanishing.
    const wvNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const wvNormNG = (s) => wvNorm(s).replace(/\bGANG\b/g, ' ').replace(/\s+/g, ' ').trim();
    const wvResolveGang = (label, canonical) => {
        const nl = wvNorm(label);
        if (!nl) return null;
        for (const c of canonical) if (wvNorm(c) === nl) return c;
        const ng = wvNormNG(label);
        if (ng) for (const c of canonical) if (wvNormNG(c) === ng) return c;
        const fw = ng.split(' ')[0];
        if (fw && fw.length >= 4) {
            const hits = canonical.filter(c => wvNormNG(c).split(' ')[0] === fw);
            if (hits.length === 1) return hits[0];
        }
        if (ng.length >= 5) {
            const p5 = ng.slice(0, 5);
            const hits = canonical.filter(c => wvNormNG(c).slice(0, 5) === p5);
            if (hits.length === 1) return hits[0];
        }
        return null;
    };

    // ── build the comparison ─────────────────────────────────────────────
    // Returns { rows, unmatched, estSum, actSum, cmpEst, cmpAct } where each
    // row = { gang, hasEst, est(FFB/daily/penalty/total), act(per-scheme +
    // total), diff, pct, matchedFrom[] }.
    const wvBuild = (year, month) => {
        const canonical = wvGangList(year);
        const led = (window.state.wagesLedger && window.state.wagesLedger[year] && window.state.wagesLedger[year][month]) || {};

        const act = {};              // display gang -> per-scheme actual totals
        const matchedFrom = {};      // display gang -> Set of raw ledger labels
        const unmatched = new Set(); // raw labels no canonical gang matched
        WV_SCHEME_KEYS.forEach(sk => {
            (led[sk] || []).forEach(row => {
                const pay = WV_PAY[sk].reduce((s, f) => s + wvNum(row[f]), 0);
                if (!pay) return;
                const label = String(row.gang || '').trim();
                let g;
                if (!label) g = '(no gang)';
                else {
                    const hit = wvResolveGang(label, canonical);
                    g = hit || label;
                    if (!hit) unmatched.add(label);
                    else if (wvNorm(hit) !== wvNorm(label)) (matchedFrom[g] = matchedFrom[g] || new Set()).add(label);
                }
                const a = act[g] = act[g] || { harvester: 0, driverLoader: 0, jobcard: 0, total: 0 };
                a[sk] += pay; a.total += pay;
            });
        });

        // A gang has a real estimate only when the Calculator has a stored
        // month for it (wgCompute alone would invent default-rate numbers).
        const storedMonth = (g) => {
            const w = window.state.wages;
            return !!(w && w[year] && w[year].gangs && w[year].gangs[g] &&
                w[year].gangs[g].months && w[year].gangs[g].months[month]);
        };
        const gangSet = new Set(Object.keys(act));
        canonical.forEach(g => { if (storedMonth(g)) gangSet.add(g); });

        const rows = [];
        let estSum = 0, actSum = 0, cmpEst = 0, cmpAct = 0;
        [...gangSet].forEach(g => {
            const hasEst = storedMonth(g);
            const est = (hasEst && typeof window.wgCompute === 'function') ? window.wgCompute(year, g, month) : null;
            const a = act[g] || { harvester: 0, driverLoader: 0, jobcard: 0, total: 0 };
            const diff = est ? a.total - est.total : null;
            const pct = (est && Math.abs(est.total) > 0.005) ? (diff / est.total) * 100 : null;
            if (est) { estSum += est.total; cmpEst += est.total; cmpAct += a.total; }
            actSum += a.total;
            rows.push({ gang: g, hasEst: !!est, est, act: a, diff, pct, matchedFrom: [...(matchedFrom[g] || [])] });
        });

        // Biggest discrepancies first; estimate-only / actual-only rows after.
        rows.sort((x, y) => {
            const xc = x.diff != null, yc = y.diff != null;
            if (xc !== yc) return xc ? -1 : 1;
            if (xc) return Math.abs(y.diff) - Math.abs(x.diff);
            return y.act.total - x.act.total;
        });
        return { rows, unmatched: [...unmatched], estSum, actSum, cmpEst, cmpAct };
    };

    const wvStatus = (r) => {
        if (!r.hasEst) return { label: 'no calc entry', color: '#6b7280', hint: 'The Calculator has no entry for this gang/month — the ledger amount cannot be checked.' };
        if (r.act.total < 0.005) return { label: 'no actuals', color: '#d97706', hint: 'Estimated in the Calculator but nothing in the imported ledger for this gang.' };
        const p = Math.abs(r.pct == null ? 999 : r.pct);
        if (p <= WV_OK_PCT) return { label: 'OK', color: '#16a34a', hint: `Within ±${WV_OK_PCT}% of the estimate.` };
        if (p <= WV_WARN_PCT) return { label: 'check', color: '#d97706', hint: `More than ±${WV_OK_PCT}% off the estimate — worth a look.` };
        return { label: 'investigate', color: '#ef4444', hint: `More than ±${WV_WARN_PCT}% off the estimate — likely an entry or rate error.` };
    };

    // ── styling (match the wages modules) ────────────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const TH = 'padding:6px 8px; border-bottom:2px solid var(--border-color,#ccc); font-size:0.78rem; color:var(--text-secondary); white-space:nowrap;';
    const TD = 'padding:5px 8px; border-bottom:1px solid var(--border-color,#eee); font-size:0.86rem; color:var(--text-primary); white-space:nowrap;';

    // ── main render ──────────────────────────────────────────────────────
    window.renderWagesVariance = () => {
        const host = document.getElementById('wages-variance-wrapper');
        if (!host) return;
        const state = window.state;

        if (!state.wagesYear || !/^\d{4}$/.test(state.wagesYear)) state.wagesYear = wvCurrentYear();
        if (!state.wagesMonth || !WV_MONTHS.includes(state.wagesMonth)) state.wagesMonth = wvCurrentMonth();
        const year = state.wagesYear, month = state.wagesMonth;

        const years = wvYearList();
        const yearOpts = years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
        const monthOpts = WV_MONTHS.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}</option>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1250px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">⚖️ Wages Variance</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Calculator <strong>estimate</strong> vs imported Wage Ledger <strong>actuals</strong>, per gang.
            Green = within ±${WV_OK_PCT}%, amber = within ±${WV_WARN_PCT}%, red = investigate.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="wv-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Month
              <select id="wv-month" style="${SS} margin-left:4px;">${monthOpts}</select></label>
            <div style="flex:1;"></div>
            <button id="wv-dl-excel" class="btn-primary" style="padding:0.45rem 1rem;" title="Download this comparison as Excel">⬇ Excel report</button>
          </div>
          <div id="wv-body"></div>
        </div>`;

        host.querySelector('#wv-year').onchange = (e) => { state.wagesYear = e.target.value; window.renderWagesVariance(); };
        host.querySelector('#wv-month').onchange = (e) => { state.wagesMonth = e.target.value; window.renderWagesVariance(); };

        // Prev/next month arrows beside the Month selector (shared helpers)
        if (typeof window.makeMonthArrowEls === 'function' && typeof window.stepMonthAcross === 'function') {
            const mSel = host.querySelector('#wv-month');
            const mLabel = mSel ? mSel.closest('label') : null;
            if (mLabel) {
                const goto = (delta) => {
                    const next = window.stepMonthAcross(year, month, WV_MONTHS, years, delta);
                    if (!next) return;
                    state.wagesYear = next.year; state.wagesMonth = next.month;
                    window.renderWagesVariance();
                };
                const a = window.makeMonthArrowEls(
                    !!window.stepMonthAcross(year, month, WV_MONTHS, years, -1),
                    !!window.stepMonthAcross(year, month, WV_MONTHS, years, 1),
                    () => goto(-1), () => goto(1), { height: '32px' });
                const wrap = document.createElement('span');
                wrap.style.cssText = 'display:inline-flex; align-items:center; gap:0.35rem; margin-left:2px;';
                wrap.appendChild(a.prevBtn); wrap.appendChild(a.nextBtn);
                mLabel.insertAdjacentElement('afterend', wrap);
            }
        }

        host.querySelector('#wv-dl-excel').onclick = async () => {
            const btn = host.querySelector('#wv-dl-excel');
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Generating…';
            try { await window.downloadWagesVarianceReport(state.wagesYear, state.wagesMonth); }
            catch (err) { if (window.notify) window.notify('Excel failed: ' + err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = old; }
        };

        wvRenderBody(year, month);
    };

    const wvRenderBody = (year, month) => {
        const body = document.getElementById('wv-body');
        if (!body) return;
        const { rows, unmatched, estSum, actSum, cmpEst, cmpAct } = wvBuild(year, month);

        if (!rows.length) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                Nothing to compare for <strong>${wvEsc(month)} ${wvEsc(year)}</strong> yet.<br><br>
                Enter gang months in the <strong>🧮 Calculator</strong> and import the payroll Excel in the
                <strong>📒 Wage Ledger</strong> — this report compares the two.
            </div>`;
            return;
        }

        const cmpDiff = cmpAct - cmpEst;
        const cmpPct = Math.abs(cmpEst) > 0.005 ? (cmpDiff / cmpEst) * 100 : null;
        const nCmp = rows.filter(r => r.diff != null).length;
        const summary = `
        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.7rem; font-size:1rem; color:var(--text-primary);">Summary — ${wvEsc(month)} ${wvEsc(year)}</h3>
          <div style="display:flex; gap:2.2rem; flex-wrap:wrap; font-size:0.9rem; color:var(--text-primary);">
            <div><div style="font-size:0.78rem; color:var(--text-secondary);">Estimated (Calculator)</div>
                 <div style="font-weight:700; font-size:1.08rem;">${wvRM(estSum)}</div></div>
            <div><div style="font-size:0.78rem; color:var(--text-secondary);">Actual (Wage Ledger)</div>
                 <div style="font-weight:700; font-size:1.08rem;">${wvRM(actSum)}</div></div>
            <div><div style="font-size:0.78rem; color:var(--text-secondary);">Difference (over ${nCmp} comparable gang${nCmp === 1 ? '' : 's'})</div>
                 <div style="font-weight:700; font-size:1.08rem; color:${Math.abs(cmpPct == null ? 0 : cmpPct) <= WV_OK_PCT ? '#16a34a' : (Math.abs(cmpPct) <= WV_WARN_PCT ? '#d97706' : '#ef4444')};">
                   ${wvRM(cmpDiff)}${cmpPct != null ? ' (' + wvPct(cmpPct) + ')' : ''}</div></div>
          </div>
          ${unmatched.length ? `<div style="margin-top:0.7rem; font-size:0.8rem; color:#d97706;">
              ⚠ Ledger gang name${unmatched.length === 1 ? '' : 's'} not matched to any Calculator gang (shown as own rows):
              <strong>${unmatched.map(wvEsc).join(', ')}</strong></div>` : ''}
        </div>`;

        const tr = rows.map(r => {
            const st = wvStatus(r);
            const dim = 'color:var(--text-secondary);';
            const estCells = r.hasEst
                ? `<td style="${TD} text-align:right;">${wvRM(r.est.ffbPay)}</td>
                   <td style="${TD} text-align:right;">${wvRM(r.est.dailyPay)}</td>
                   <td style="${TD} text-align:right;">${r.est.penalty ? '−' + wvRM(r.est.penalty) : wvRM(0)}</td>
                   <td style="${TD} text-align:right; font-weight:600;">${wvRM(r.est.total)}</td>`
                : `<td style="${TD} text-align:right; ${dim}">—</td><td style="${TD} text-align:right; ${dim}">—</td>
                   <td style="${TD} text-align:right; ${dim}">—</td><td style="${TD} text-align:right; ${dim}">—</td>`;
            const diffCell = r.diff == null
                ? `<td style="${TD} text-align:right; ${dim}">—</td><td style="${TD} text-align:right; ${dim}">—</td>`
                : `<td style="${TD} text-align:right; font-weight:600; color:${st.color};">${wvRM(r.diff)}</td>
                   <td style="${TD} text-align:right; color:${st.color};">${r.pct != null ? wvPct(r.pct) : '—'}</td>`;
            const alias = r.matchedFrom.length
                ? `<div style="font-size:0.72rem; color:var(--text-secondary);">ledger: ${r.matchedFrom.map(wvEsc).join(', ')}</div>` : '';
            return `<tr>
                <td style="${TD}">${wvEsc(r.gang)}${alias}</td>
                ${estCells}
                <td style="${TD} text-align:right;">${wvRM(r.act.harvester)}</td>
                <td style="${TD} text-align:right;">${wvRM(r.act.driverLoader)}</td>
                <td style="${TD} text-align:right;">${wvRM(r.act.jobcard)}</td>
                <td style="${TD} text-align:right; font-weight:600;">${wvRM(r.act.total)}</td>
                ${diffCell}
                <td style="${TD}"><span title="${wvEsc(st.hint)}" style="font-size:0.72rem; font-weight:600; color:${st.color}; border:1px solid ${st.color}; border-radius:10px; padding:0.06rem 0.5rem;">${st.label}</span></td>
              </tr>`;
        }).join('');

        body.innerHTML = summary + `
        <div style="${CARD} padding:0; overflow:auto;">
          <table style="width:100%; border-collapse:collapse; min-width:1080px;">
            <thead><tr>
              <th style="${TH} text-align:left;">Gang</th>
              <th style="${TH} text-align:right;">FFB pay <span style="opacity:0.7;">(est)</span></th>
              <th style="${TH} text-align:right;">Daily <span style="opacity:0.7;">(est)</span></th>
              <th style="${TH} text-align:right;">Penalty <span style="opacity:0.7;">(est)</span></th>
              <th style="${TH} text-align:right;">Estimate</th>
              <th style="${TH} text-align:right;">${WV_SCHEME_LABEL.harvester}</th>
              <th style="${TH} text-align:right;">${WV_SCHEME_LABEL.driverLoader}</th>
              <th style="${TH} text-align:right;">${WV_SCHEME_LABEL.jobcard}</th>
              <th style="${TH} text-align:right;">Actual</th>
              <th style="${TH} text-align:right;">Diff (RM)</th>
              <th style="${TH} text-align:right;">Diff (%)</th>
              <th style="${TH} text-align:left;">Status</th>
            </tr></thead>
            <tbody>${tr}</tbody>
          </table>
        </div>
        <p style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.4rem;">
          Estimate = FFB pay + daily rate − penalty (🧮 Calculator). Actual = Harvester + Driver &amp; Loader + Job Card
          amounts imported into the 📒 Wage Ledger. The estimate covers harvest/maintenance gang pay — driver &amp;
          lorry amounts have no Calculator counterpart, so some positive difference is normal for gangs with transport rows.
        </p>`;
    };

    // ── Excel report (monotone, mirrors the on-screen table) ─────────────
    const wvEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    window.downloadWagesVarianceReport = async (year, month) => {
        await wvEnsureExcelJS();
        const { rows, unmatched, estSum, actSum, cmpEst, cmpAct } = wvBuild(year, month);
        if (!rows.length) {
            if (window.notify) window.notify(`Nothing to compare for ${month} ${year} — enter Calculator months and import the Wage Ledger first.`, 'warn');
            return;
        }

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet(`Variance ${month} ${year}`);
        const thin = { style: 'thin', color: { argb: 'FF999999' } };
        const border = { top: thin, left: thin, bottom: thin, right: thin };
        const money = '#,##0.00';

        ws.getCell('A1').value = 'Wages Variance — Estimate (Calculator) vs Actual (Wage Ledger)';
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A2').value = `${month} ${year}`;
        ws.getCell('A2').font = { bold: true, size: 11 };

        const HEAD = ['Gang', 'FFB Pay (Est)', 'Daily (Est)', 'Penalty (Est)', 'Estimate Total',
            'Harvester (Act)', 'Driver & Loader (Act)', 'Job Card (Act)', 'Actual Total',
            'Difference (RM)', 'Difference (%)', 'Status'];
        const hr = ws.getRow(4);
        HEAD.forEach((h, i) => {
            const c = hr.getCell(i + 1);
            c.value = h;
            c.font = { bold: true };
            c.border = border;
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
            c.alignment = { horizontal: i === 0 || i === 11 ? 'left' : 'right', wrapText: true, vertical: 'middle' };
        });

        let rn = 5;
        rows.forEach(r => {
            const st = wvStatus(r);
            const row = ws.getRow(rn++);
            const vals = [
                r.gang + (r.matchedFrom.length ? `  (ledger: ${r.matchedFrom.join(', ')})` : ''),
                r.hasEst ? r.est.ffbPay : null,
                r.hasEst ? r.est.dailyPay : null,
                r.hasEst ? -r.est.penalty : null,
                r.hasEst ? r.est.total : null,
                r.act.harvester, r.act.driverLoader, r.act.jobcard, r.act.total,
                r.diff, (r.pct != null) ? r.pct / 100 : null, st.label,
            ];
            vals.forEach((v, i) => {
                const c = row.getCell(i + 1);
                c.value = (v == null && i > 0 && i < 11) ? '—' : v;
                c.border = border;
                if (i >= 1 && i <= 9 && typeof v === 'number') c.numFmt = money;
                if (i === 10 && typeof v === 'number') c.numFmt = '+0.0%;-0.0%';
                c.alignment = { horizontal: i === 0 || i === 11 ? 'left' : 'right' };
                if (i === 4 || i === 8) c.font = { bold: true };
            });
        });

        // Totals row
        const tot = ws.getRow(rn);
        const cmpDiff = cmpAct - cmpEst;
        const totVals = ['TOTAL', null, null, null, estSum, null, null, null, actSum, cmpDiff,
            (Math.abs(cmpEst) > 0.005) ? cmpDiff / cmpEst : null, ''];
        totVals.forEach((v, i) => {
            const c = tot.getCell(i + 1);
            c.value = (v == null) ? '' : v;
            c.border = border;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
            if (typeof v === 'number' && i !== 10) c.numFmt = money;
            if (i === 10 && typeof v === 'number') c.numFmt = '+0.0%;-0.0%';
            c.alignment = { horizontal: i === 0 ? 'left' : 'right' };
        });
        rn += 2;
        ws.getCell(rn, 1).value = 'Difference (RM/%) totals cover only gangs that exist in BOTH the Calculator and the Ledger.';
        ws.getCell(rn, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
        if (unmatched.length) {
            rn++;
            ws.getCell(rn, 1).value = `Unmatched ledger gang names (own rows above): ${unmatched.join(', ')}`;
            ws.getCell(rn, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
        }

        ws.columns = [{ width: 30 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 14 },
            { width: 14 }, { width: 18 }, { width: 14 }, { width: 13 }, { width: 14 }, { width: 13 }, { width: 13 }];

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Wages_Variance_${month}_${year}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
        if (typeof window.logAudit === 'function') window.logAudit('download', 'wages', `Variance report ${month} ${year}`, year);
    };
})();
