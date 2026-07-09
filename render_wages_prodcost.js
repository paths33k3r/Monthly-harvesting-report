// =====================================================================
// render_wages_prodcost.js — Production Cost module
// ---------------------------------------------------------------------
// Recreates the accountant's monthly "Summary of Labour Cost" sheet,
// but DERIVED live from the Wage Ledger instead of typed by hand:
// every ledger row in a chosen date range is priced to the employee
// who earned it, and the employee's ID prefix (from the Employee
// Master) decides which wage-class column the amount lands in:
//
//   GT- / GTL- / PFB-  → LOCAL            (local workers)
//   GTF-               → PERMIT if the "Working Permit" box is ticked
//                        in the Employee Master, else NO PERMIT/GELAP
//   GTG-               → NO PERMIT / GELAP (no valid ID)
//   CON- / AG-         → NO PERMIT / GELAP (agents — commission)
//   not in the master  → UNMATCHED (flagged, never silently dropped)
//
// The period is a free FROM→TO date range (the source report runs on
// cut-off periods like 01/05–25/05 or 26/05–30/06, so it can span two
// months). Total FFB production for the range is summed from the
// Harvester scheme's per-ticket delivery weights.
//
// Purely derived — reads state.wagesLedger + state.wagesEmployees,
// stores nothing (no Firebase path, no rules change, no save fn).
// Surfaced as the "Production Cost" sub-tab under 💵 Rate of Wages.
// Access: menu key 'wages' (shared) — view/export need no edit rights.
// =====================================================================

(function () {
    'use strict';

    const WP_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const WP_CATS = ['LOCAL', 'PERMIT', 'GELAP', 'UNMATCHED'];
    const WP_CAT_LABEL = { LOCAL: 'Local', PERMIT: 'Permit', GELAP: 'No Permit / Gelap', UNMATCHED: 'Unmatched' };

    const wpEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const wpNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const wpRM = (n) => 'RM' + wpNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wpMoney = (n) => wpNum(n) ? wpNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    const wpPad = (n) => String(n).padStart(2, '0');
    const wpISO = (d) => `${d.getFullYear()}-${wpPad(d.getMonth() + 1)}-${wpPad(d.getDate())}`;
    const wpDMY = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

    // ── Wage-class of a ledger person via the Employee Master ──────────
    // Kept here (not in render_wages_employees.js) so the rule that maps
    // the summary's columns lives beside the summary itself.
    const wpCategoryOf = (name) => {
        const e = (typeof window.weFindEmployee === 'function') ? window.weFindEmployee(name) : null;
        if (!e) return 'UNMATCHED';
        const id = String(e.employeeId || '').toUpperCase();
        if (/^GTF/.test(id)) return e.workPermit ? 'PERMIT' : 'GELAP';
        if (/^GTG/.test(id)) return 'GELAP';
        if (/^(GTL|GT|PFB)/.test(id)) return 'LOCAL';
        if (/^(CON|AG)/.test(id)) return 'GELAP';          // agents — commission column in the source sheet
        return 'UNMATCHED';
    };

    // ── Range helpers ───────────────────────────────────────────────────
    // Ledger months whose calendar span overlaps [from, to] (both ISO).
    const wpMonthsInRange = (from, to) => {
        const out = [];
        const led = window.state.wagesLedger || {};
        Object.keys(led).filter(y => /^\d{4}$/.test(y)).forEach(y => {
            WP_MONTHS.forEach((m, i) => {
                if (!led[y][m]) return;
                const first = `${y}-${wpPad(i + 1)}-01`;
                const last = `${y}-${wpPad(i + 1)}-31`;
                if (first <= to && last >= from) out.push({ year: y, month: m, data: led[y][m] });
            });
        });
        return out;
    };
    const wpInRange = (iso, from, to) => !!iso && /^\d{4}-\d{2}-\d{2}/.test(iso) && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

    // FFB production (MT) for a date range — summed from the Harvester
    // scheme's per-ticket delivery weights. Shared with the Harvesting
    // Interval selector's period widget.
    const wpFfbForRange = (from, to) => {
        let kg = 0, tickets = 0, undated = 0;
        const monthsUsed = new Set();
        wpMonthsInRange(from, to).forEach(({ year, month, data }) => {
            (data.harvester || []).forEach(r => {
                const d = r.deliveryDate || r.harvestingDate;
                if (!d) { undated++; return; }
                if (wpInRange(d, from, to)) { kg += wpNum(r.weightKg); tickets++; monthsUsed.add(`${month} ${year}`); }
            });
        });
        return { mt: kg / 1000, tickets, undated, monthsUsed: [...monthsUsed] };
    };
    window.wpFfbForRange = wpFfbForRange;

    // ── The aggregation engine ──────────────────────────────────────────
    // Walks every Wage Ledger row in the range and buckets pay into
    // { activity → { LOCAL, PERMIT, GELAP, UNMATCHED } }.
    const wpCompute = (from, to) => {
        const acts = new Map();          // activity → {LOCAL,PERMIT,GELAP,UNMATCHED}
        const unmatched = new Map();     // person name → RM (needs a master record / permit flag)
        const add = (activity, person, amount) => {
            const amt = wpNum(amount);
            if (!amt) return;
            const a = String(activity || 'OTHER').toUpperCase().trim() || 'OTHER';
            if (!acts.has(a)) acts.set(a, { LOCAL: 0, PERMIT: 0, GELAP: 0, UNMATCHED: 0 });
            const cat = wpCategoryOf(person);
            acts.get(a)[cat] += amt;
            if (cat === 'UNMATCHED') {
                const key = String(person || '(blank)').trim() || '(blank)';
                unmatched.set(key, (unmatched.get(key) || 0) + amt);
            }
        };

        let rows = 0, undated = 0;
        wpMonthsInRange(from, to).forEach(({ data }) => {
            (data.harvester || []).forEach(r => {
                const d = r.deliveryDate || r.harvestingDate;
                if (!d) { undated++; return; }
                if (!wpInRange(d, from, to)) return;
                rows++;
                add('FFB HARVESTING', r.employee, wpNum(r.ripeAmount) + wpNum(r.bagsAmount) + wpNum(r.dailyPieceRate));
            });
            (data.driverLoader || []).forEach(r => {
                const d = r.deliveryDate;
                if (!d) { undated++; return; }
                if (!wpInRange(d, from, to)) return;
                rows++;
                add('FFB TRANSPORTING (DRIVER)', r.driver, r.driverAmount);
                add('FFB LOADING', r.loader, r.loaderAmount);
                add('FFB LOADING', r.loader2, r.loader2Amount);
                add('FFB TRANSPORTING (LORRY)', r.lorryDriver, r.lorryAmount);
            });
            (data.jobcard || []).forEach(r => {
                const d = r.jobDate || r.completeDate || r.startDate;
                if (!d) { undated++; return; }
                if (!wpInRange(d, from, to)) return;
                rows++;
                add(r.jobActivity, r.employee, r.amount);
            });
        });

        // rows sorted by total desc; per-category grand totals
        const list = [...acts.entries()].map(([activity, c]) => ({
            activity, ...c, total: c.LOCAL + c.PERMIT + c.GELAP + c.UNMATCHED,
        })).sort((a, b) => b.total - a.total);
        const grand = { LOCAL: 0, PERMIT: 0, GELAP: 0, UNMATCHED: 0, total: 0 };
        list.forEach(r => { WP_CATS.forEach(c => grand[c] += r[c]); grand.total += r.total; });

        return {
            list, grand, rows, undated,
            unmatched: [...unmatched.entries()].sort((a, b) => b[1] - a[1]),
            ffb: wpFfbForRange(from, to),
        };
    };
    window.wpComputeProductionCost = wpCompute;

    // ── Lazy ExcelJS ────────────────────────────────────────────────────
    const wpEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    // =====================================================================
    // Excel export — mirrors the accountant's summary layout
    // =====================================================================
    const downloadProductionCostReport = async (from, to) => {
        const R = wpCompute(from, to);
        if (!R.list.length) {
            if (window.notify) window.notify('No wage ledger rows in the selected period.', 'warn');
            return;
        }
        await wpEnsureExcelJS();
        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet('Production Cost');
        ws.getCell('A1').value = `SUMMARY OF LABOUR COST (${wpDMY(from)} - ${wpDMY(to)})`;
        ws.getCell('A1').font = { bold: true, size: 13 };
        ws.getCell('A2').value = `TOTAL PRODUCTION FOR PERIOD: ${R.ffb.mt.toLocaleString('en-MY', { minimumFractionDigits: 3 })} MT (${R.ffb.tickets} tickets)`;
        ws.getCell('A2').font = { bold: true, size: 11 };

        let r = 4;
        const hdr = ws.getRow(r++);
        hdr.values = ['DESCRIPTION', 'LOCAL', 'PERMIT', 'NO PERMIT / GELAP', 'UNMATCHED', 'TOTAL'];
        hdr.font = { bold: true };
        hdr.border = { bottom: { style: 'medium' } };
        [42, 15, 15, 17, 15, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        R.list.forEach(row => {
            ws.getRow(r++).values = [row.activity,
                row.LOCAL || '', row.PERMIT || '', row.GELAP || '', row.UNMATCHED || '', row.total];
        });
        const g = ws.getRow(r++);
        g.values = ['TOTAL :', R.grand.LOCAL, R.grand.PERMIT, R.grand.GELAP, R.grand.UNMATCHED, R.grand.total];
        g.font = { bold: true };
        g.border = { top: { style: 'double' } };
        for (let rr = 5; rr < r; rr++) [2, 3, 4, 5, 6].forEach(c => { ws.getRow(rr).getCell(c).numFmt = '#,##0.00'; });

        if (R.unmatched.length) {
            r += 1;
            ws.getRow(r++).values = ['UNMATCHED — not found in Employee Master:'];
            ws.getRow(r - 1).font = { bold: true, color: { argb: 'FFB91C1C' } };
            R.unmatched.forEach(([name, amt]) => {
                const row = ws.getRow(r++);
                row.values = [name, '', '', '', '', amt];
                row.getCell(6).numFmt = '#,##0.00';
            });
        }

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Production_Cost_${from}_to_${to}.xlsx`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        if (window.notify) window.notify('Production cost report downloaded.', 'success');
    };
    window.downloadProductionCostReport = downloadProductionCostReport;

    // =====================================================================
    // Main render
    // =====================================================================
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;';

    // Default period: the current calendar month so far.
    const wpDefaultRange = () => {
        const now = new Date();
        return { from: wpISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: wpISO(now) };
    };

    window.renderWagesProdCostView = () => {
        const host = document.getElementById('wages-prodcost-wrapper');
        if (!host) return;
        const state = window.state;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(state.prodCostFrom || '') || !/^\d{4}-\d{2}-\d{2}$/.test(state.prodCostTo || '')) {
            const d = wpDefaultRange();
            state.prodCostFrom = d.from; state.prodCostTo = d.to;
        }

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1300px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🏭 Production Cost</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            The <em>Summary of Labour Cost</em> — derived live from the <strong>Wage Ledger</strong> for any date range
            (cut-off periods like 01/05→25/05 or 26/05→30/06 work fine). Each employee's pay lands in
            <strong>Local / Permit / No&nbsp;Permit</strong> from their Employee-Master ID
            (GT·GTL local · GTF permit if ticked · GTG gelap). FFB production comes from the harvest tickets in the range.
          </p>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">From
              <input type="date" id="wp-from" value="${wpEsc(state.prodCostFrom)}" style="${SS} margin-left:4px;"></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">To
              <input type="date" id="wp-to" value="${wpEsc(state.prodCostTo)}" style="${SS} margin-left:4px;"></label>
            <button id="wp-prev" style="${BTN}" title="Previous month">❮</button>
            <button id="wp-next" style="${BTN}" title="Next month">❯</button>
            <button id="wp-cutoff" style="${BTN} font-size:0.8rem;" title="Set the range to the 26th of the previous month → 25th (payroll cut-off)">26→25 cut-off</button>
            <div style="flex:1;"></div>
            <button id="wp-dl-report" style="${BTN}">📤 Export</button>
          </div>

          <div id="wp-body"></div>
        </div>`;

        const setRange = (from, to) => {
            state.prodCostFrom = from; state.prodCostTo = to;
            window.renderWagesProdCostView();
        };
        const shiftMonth = (delta) => {
            // steps the whole range by one calendar month, preserving its shape:
            // full calendar months step to full months, cut-off ranges keep their day-of-month
            const f = new Date(state.prodCostFrom + 'T00:00:00');
            const t = new Date(state.prodCostTo + 'T00:00:00');
            const isFullMonth = f.getDate() === 1 && t.getMonth() !== (new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)).getMonth();
            const nf = new Date(f.getFullYear(), f.getMonth() + delta, f.getDate());
            let nt;
            if (isFullMonth) nt = new Date(t.getFullYear(), t.getMonth() + delta + 1, 0);   // last day of shifted month
            else nt = new Date(t.getFullYear(), t.getMonth() + delta, t.getDate());
            setRange(wpISO(nf), wpISO(nt));
        };

        host.querySelector('#wp-from').onchange = (e) => { if (e.target.value) setRange(e.target.value, state.prodCostTo); };
        host.querySelector('#wp-to').onchange = (e) => { if (e.target.value) setRange(state.prodCostFrom, e.target.value); };
        host.querySelector('#wp-prev').onclick = () => shiftMonth(-1);
        host.querySelector('#wp-next').onclick = () => shiftMonth(1);
        host.querySelector('#wp-cutoff').onclick = () => {
            // 26th of the month before the current TO month → 25th of it
            const t = new Date(state.prodCostTo + 'T00:00:00');
            setRange(wpISO(new Date(t.getFullYear(), t.getMonth() - 1, 26)), wpISO(new Date(t.getFullYear(), t.getMonth(), 25)));
        };
        host.querySelector('#wp-dl-report').onclick = async () => {
            const btn = host.querySelector('#wp-dl-report');
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ …';
            try { await downloadProductionCostReport(state.prodCostFrom, state.prodCostTo); }
            catch (err) { if (window.notify) window.notify(err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = old; }
        };

        wpRenderBody(state.prodCostFrom, state.prodCostTo);
    };

    const wpRenderBody = (from, to) => {
        const body = document.getElementById('wp-body');
        if (!body) return;
        if (from > to) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">The From date is after the To date.</div>`;
            return;
        }
        const R = wpCompute(from, to);

        if (!R.rows) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No Wage Ledger rows dated <strong>${wpEsc(wpDMY(from))} → ${wpEsc(wpDMY(to))}</strong>.<br><br>
                Import the month's ledger under <strong>📒 Wage Ledger</strong> first — this view derives everything from it.
            </div>`;
            return;
        }

        const noMaster = !(window.state.wagesEmployees && Array.isArray(window.state.wagesEmployees.list) && window.state.wagesEmployees.list.length);
        const costPerMt = R.ffb.mt > 0 ? R.grand.total / R.ffb.mt : 0;

        const tile = (label, val, sub, color) => `
            <div style="flex:1; min-width:150px; text-align:center; padding:0.6rem 0.4rem;">
              <div style="font-size:1.45rem; font-weight:700; color:${color || 'var(--text-primary)'};">${val}</div>
              <div style="font-size:0.78rem; color:var(--text-secondary);">${label}${sub ? `<br><span style="font-size:0.7rem;">${sub}</span>` : ''}</div>
            </div>`;

        const summary = `
        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.2rem; font-size:1rem; color:var(--text-primary);">Summary of Labour Cost — ${wpEsc(wpDMY(from))} → ${wpEsc(wpDMY(to))}</h3>
          <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:0.4rem;">${R.rows.toLocaleString()} ledger rows in range${R.undated ? ` · ⚠ ${R.undated} undated rows skipped` : ''}${R.ffb.monthsUsed.length ? ` · FFB from ${R.ffb.monthsUsed.join(', ')}` : ''}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
            ${tile('Total labour cost', wpRM(R.grand.total))}
            ${tile('FFB production', `${R.ffb.mt.toLocaleString('en-MY', { minimumFractionDigits: 3 })} MT`, `${R.ffb.tickets.toLocaleString()} tickets`)}
            ${tile('Labour cost ÷ FFB MT', R.ffb.mt > 0 ? wpRM(costPerMt) + '/MT' : '—')}
            ${tile('Local', wpRM(R.grand.LOCAL))}
            ${tile('Permit', wpRM(R.grand.PERMIT))}
            ${tile('No Permit / Gelap', wpRM(R.grand.GELAP))}
          </div>
        </div>`;

        const warn = [];
        if (noMaster) warn.push('The Employee Master is empty — everything shows as UNMATCHED. Import it under 👥 Employees first.');
        if (!noMaster && R.grand.UNMATCHED > 0) warn.push(`${R.unmatched.length} name(s) in the ledger were not found in the Employee Master (${wpRM(R.grand.UNMATCHED)} unallocated) — see the list below.`);
        const warnHtml = warn.length ? `<div style="${CARD} border-color:#f59e0b; background:rgba(245,158,11,0.07); font-size:0.84rem; color:var(--text-primary);">⚠ ${warn.map(wpEsc).join('<br>⚠ ')}</div>` : '';

        const showUn = R.grand.UNMATCHED > 0;
        const TH = 'padding:6px 10px; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); z-index:1; white-space:nowrap;';
        const TD = 'padding:4px 10px; border-bottom:1px solid var(--border-color,#eee); white-space:nowrap;';
        let rowsHtml = '';
        R.list.forEach(row => {
            rowsHtml += `<tr>
                <td style="${TD}">${wpEsc(row.activity)}</td>
                <td style="${TD} text-align:right;">${wpMoney(row.LOCAL)}</td>
                <td style="${TD} text-align:right;">${wpMoney(row.PERMIT)}</td>
                <td style="${TD} text-align:right;">${wpMoney(row.GELAP)}</td>
                ${showUn ? `<td style="${TD} text-align:right; color:#b91c1c;">${wpMoney(row.UNMATCHED)}</td>` : ''}
                <td style="${TD} text-align:right; font-weight:700;">${wpMoney(row.total)}</td></tr>`;
        });
        rowsHtml += `<tr style="font-weight:700; font-size:0.95em; border-top:2px solid var(--border-color,#ccc); background:var(--bg-main,#eef4ee);">
            <td style="${TD}">TOTAL :</td>
            <td style="${TD} text-align:right;">${wpMoney(R.grand.LOCAL)}</td>
            <td style="${TD} text-align:right;">${wpMoney(R.grand.PERMIT)}</td>
            <td style="${TD} text-align:right;">${wpMoney(R.grand.GELAP)}</td>
            ${showUn ? `<td style="${TD} text-align:right; color:#b91c1c;">${wpMoney(R.grand.UNMATCHED)}</td>` : ''}
            <td style="${TD} text-align:right;">${wpMoney(R.grand.total)}</td></tr>`;

        const table = `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="padding:0.8rem 1.1rem; background:var(--bg-main,#f3f5f3); border-bottom:1px solid var(--border-color,#e0e0e0);">
            <h3 style="margin:0; font-size:0.98rem; color:var(--text-primary);">By description / job activity</h3>
          </div>
          <div style="max-height:560px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.84rem; color:var(--text-primary);">
              <thead><tr>
                <th style="${TH} text-align:left;">DESCRIPTION</th>
                <th style="${TH} text-align:right;">LOCAL</th>
                <th style="${TH} text-align:right;">PERMIT</th>
                <th style="${TH} text-align:right;">NO PERMIT / GELAP</th>
                ${showUn ? `<th style="${TH} text-align:right; color:#b91c1c;">UNMATCHED</th>` : ''}
                <th style="${TH} text-align:right;">TOTAL</th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;

        let unHtml = '';
        if (showUn && !noMaster) {
            const items = R.unmatched.slice(0, 40).map(([name, amt]) =>
                `<tr><td style="${TD}">${wpEsc(name)}</td><td style="${TD} text-align:right;">${wpMoney(amt)}</td></tr>`).join('');
            unHtml = `
            <div style="${CARD} padding:0; overflow:hidden;">
              <div style="padding:0.8rem 1.1rem; background:rgba(185,28,28,0.06); border-bottom:1px solid var(--border-color,#e0e0e0);">
                <h3 style="margin:0; font-size:0.98rem; color:#b91c1c;">Unmatched names — not in the Employee Master</h3>
                <div style="font-size:0.76rem; color:var(--text-secondary);">Add these workers under 👥 Employees (or fix the spelling there) so their pay lands in the right column.</div>
              </div>
              <div style="max-height:300px; overflow:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:0.83rem; color:var(--text-primary);">${items}
                ${R.unmatched.length > 40 ? `<tr><td colspan="2" style="${TD} color:var(--text-secondary);">… and ${R.unmatched.length - 40} more (all included in the totals & export)</td></tr>` : ''}</table>
              </div>
            </div>`;
        }

        body.innerHTML = summary + warnHtml + table + unHtml;
    };

})();
