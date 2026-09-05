/* ============================================================================
 * render_report_builder.js — 📐 Report Builder
 * ----------------------------------------------------------------------------
 * Build any cut of the FFB production record without writing a new report:
 * pick a grouping, a period, and optional filters → table + Excel download.
 *
 * The YTD report answers "how much so far this year". This answers everything
 * else of the same shape — month-to-month, per block, per gang, per round, any
 * combination — so an ad-hoc request no longer needs new code.
 *
 * Purely derived: reads window.state, stores nothing. Menu key 'performance'
 * (shared with Harvesting Performance — same data, no new permission).
 *
 * Also the single source of truth for the pivot: render_ai_assist.js calls
 * window.rbPivot rather than carrying its own copy, so the optional
 * natural-language front end and these dropdowns can never disagree.
 * ==========================================================================*/
(function () {
    'use strict';

    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const perfMonthKey = (m) => m.charAt(0) + m.slice(1).toLowerCase();   // "APR" → "Apr"
    const num = (v) => parseFloat(v) || 0;
    const round2 = (n) => Math.round(n * 100) / 100;

    const GROUPINGS = {
        month:       { label: 'Month',          cols: ['Month'],          of: (c) => [c.month] },
        block:       { label: 'Block',          cols: ['Block'],          of: (c) => [c.block] },
        gang:        { label: 'Gang',           cols: ['Gang'],           of: (c) => [c.gang] },
        month_block: { label: 'Month + Block',  cols: ['Month', 'Block'], of: (c) => [c.month, c.block] },
        month_gang:  { label: 'Month + Gang',   cols: ['Month', 'Gang'],  of: (c) => [c.month, c.gang] },
        gang_block:  { label: 'Gang + Block',   cols: ['Gang', 'Block'],  of: (c) => [c.gang, c.block] },
    };

    /* ══════════════════════════════════════════════════════════════════════
     * THE ENGINE — pure, no DOM. Walks
     *   state.performance[year][Mon][gang].blocks[id] = {r1..r4}
     * the same shape render_ytd_report.js reads. Each (gang, block) cell is
     * counted exactly once, so a block worked by two gangs in one month sums
     * correctly instead of double-counting through gangAssignments.
     * ════════════════════════════════════════════════════════════════════*/
    window.rbPivot = function rbPivot(args) {
        const st = window.state || {};
        const year = String((args && args.year) || '');
        const perfYear = (st.performance || {})[year];
        if (!perfYear) {
            return { error: `No production data for ${year}. Available: ${Object.keys(st.performance || {}).join(', ') || 'none'}` };
        }

        const a = args || {};
        const wantMonths = (a.months && a.months.length ? a.months : MONTHS)
            .map((m) => String(m).toUpperCase().slice(0, 3))
            .filter((m) => MONTHS.includes(m));
        const rounds = (a.rounds && a.rounds.length ? a.rounds : [1, 2, 3, 4]).map(Number);
        const gangFilter = a.gangs && a.gangs.length
            ? new Set(a.gangs.map((g) => String(g).toLowerCase())) : null;
        const blockFilter = a.blocks && a.blocks.length
            ? new Set(a.blocks.map((b) => String(b))) : null;

        // Collect atomic cells first, then aggregate — keeps grouping trivial.
        const cells = [];
        wantMonths.forEach((mon) => {
            const md = perfYear[perfMonthKey(mon)];
            if (!md) return;
            Object.keys(md).forEach((gang) => {
                if (gang === 'gangAssignments') return;
                if (gangFilter && !gangFilter.has(gang.toLowerCase())) return;
                const blocks = (md[gang] && md[gang].blocks) || {};
                Object.keys(blocks).forEach((bid) => {
                    if (blockFilter && !blockFilter.has(String(bid))) return;
                    const b = blocks[bid] || {};
                    let mt = 0;
                    rounds.forEach((r) => { mt += num(b['r' + r]); });
                    if (!mt) return;
                    cells.push({ month: mon, gang, block: String(bid), mt });
                });
            });
        });

        if (!cells.length) {
            return { error: `No production rows matched (year ${year}, months ${wantMonths.join('/')}).` };
        }

        const spec = GROUPINGS[a.group_by] || GROUPINGS.month;

        const agg = new Map();
        cells.forEach((c) => {
            const key = spec.of(c);
            const k = key.join('\u0000');   // NUL separator: no gang or block name can contain it
            if (!agg.has(k)) agg.set(k, { key, mt: 0, blocks: new Set() });
            const e = agg.get(k);
            e.mt += c.mt;
            e.blocks.add(c.block);
        });

        const rows = [...agg.values()].map((e) => [...e.key, round2(e.mt), e.blocks.size]);
        // Month groupings read best in calendar order; everything else by size.
        if (spec.cols[0] === 'Month') {
            rows.sort((x, y) => (MONTHS.indexOf(x[0]) - MONTHS.indexOf(y[0]))
                || String(x[1] ?? '').localeCompare(String(y[1] ?? ''), undefined, { numeric: true }));
        } else {
            rows.sort((x, y) => y[spec.cols.length] - x[spec.cols.length]);
        }

        const title = `FFB production ${year} — by ${spec.cols.join(' + ').toLowerCase()}`
            + (rounds.length < 4 ? ` (rounds ${rounds.join('+')})` : '');

        return {
            title,
            columns: [...spec.cols, 'FFB (MT)', 'Blocks'],
            rows,
            total_mt: round2(cells.reduce((s, c) => s + c.mt, 0)),
            rounds_included: rounds,
            months_covered: [...new Set(cells.map((c) => c.month))].sort((x, y) => MONTHS.indexOf(x) - MONTHS.indexOf(y)),
            note: 'Each gang/block cell counted once. Totals are what the performance sheet records.',
        };
    };

    /* ── What data exists (also used by the optional AI front end) ────────*/
    window.rbScope = function rbScope() {
        const st = window.state || {};
        const perf = st.performance || {};
        const years = Object.keys(perf).sort();
        const detail = {};
        years.forEach((y) => {
            const monthsWithData = MONTHS.filter((m) => {
                const md = perf[y][perfMonthKey(m)];
                if (!md) return false;
                return Object.keys(md).some((k) => k !== 'gangAssignments' && md[k] && md[k].blocks
                    && Object.keys(md[k].blocks).length);
            });
            const gangs = new Set();
            const blocks = new Set();
            monthsWithData.forEach((m) => {
                const md = perf[y][perfMonthKey(m)] || {};
                Object.keys(md).forEach((g) => {
                    if (g === 'gangAssignments') return;
                    gangs.add(g);
                    Object.keys((md[g] && md[g].blocks) || {}).forEach((b) => blocks.add(b));
                });
            });
            detail[y] = {
                months_with_production: monthsWithData,
                gangs: [...gangs].sort(),
                blocks: [...blocks].sort((x, y2) => String(x).localeCompare(String(y2), undefined, { numeric: true })),
            };
        });
        return { years, detail };
    };

    /* ══════════════════════════════════════════════════════════════════════
     * EXCEL
     * ════════════════════════════════════════════════════════════════════*/
    const ensureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    window.rbToExcel = async function rbToExcel(result, filename) {
        if (!result || !result.rows) throw new Error('Nothing to export');
        await ensureExcelJS();

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet((result.title || 'Report').slice(0, 28).replace(/[\\/*?:[\]]/g, '-'));

        const titleRow = ws.addRow([result.title]);
        ws.mergeCells(titleRow.number, 1, titleRow.number, result.columns.length);
        Object.assign(titleRow.getCell(1), {
            font: { bold: true, size: 13 },
            alignment: { horizontal: 'center' },
        });
        titleRow.height = 22;
        ws.addRow([`Generated ${new Date().toLocaleString()}`]);
        ws.addRow([]);

        const head = ws.addRow(result.columns);
        head.eachCell((c) => {
            c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
            c.alignment = { horizontal: 'center', wrapText: true };
            c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        result.rows.forEach((row) => {
            const x = ws.addRow(row);
            x.eachCell((c) => {
                c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                if (typeof c.value === 'number') c.numFmt = '#,##0.00';
            });
        });

        // Total only the columns that are numeric in every row.
        const numericCol = result.columns.map((_, i) => result.rows.every((row) => typeof row[i] === 'number'));
        if (numericCol.some(Boolean)) {
            const totals = result.columns.map((_, i) => (numericCol[i]
                ? round2(result.rows.reduce((s, row) => s + num(row[i]), 0)) : ''));
            const firstLabel = numericCol.indexOf(false);
            if (firstLabel >= 0) totals[firstLabel] = 'TOTAL';
            const tr = ws.addRow(totals);
            tr.eachCell((c) => {
                c.font = { bold: true };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
                c.border = { top: { style: 'double' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                if (typeof c.value === 'number') c.numFmt = '#,##0.00';
            });
        }

        result.columns.forEach((c, i) => {
            const width = Math.max(String(c).length + 4,
                ...result.rows.map((row) => String(row[i] ?? '').length + 3));
            ws.getColumn(i + 1).width = Math.min(width, 40);
        });

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (filename || result.title).replace(/[^\w\-. ]/g, '_') + '.xlsx';
        document.body.appendChild(a);
        a.click();
        // Deferred cleanup — same pattern as the other report downloads.
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
        return result;
    };

    /* ══════════════════════════════════════════════════════════════════════
     * VIEW
     * ════════════════════════════════════════════════════════════════════*/
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Selections live on state so the view survives navigating away and back.
    const sel = () => {
        const st = window.state;
        st.reportBuilder = st.reportBuilder || {};
        const rb = st.reportBuilder;
        if (!rb.groupBy) rb.groupBy = 'month';
        if (!rb.rounds) rb.rounds = [1, 2, 3, 4];
        if (!rb.gangs) rb.gangs = [];
        if (!rb.blocks) rb.blocks = [];
        return rb;
    };

    let _rbResult = null;

    window.renderReportBuilder = function renderReportBuilder() {
        const host = document.getElementById('report-builder-wrapper');
        if (!host) return;

        const scope = window.rbScope();
        const rb = sel();

        if (!scope.years.length) {
            host.innerHTML = `
                <div class="report-header-bar"><h2 style="margin:0">📐 Report Builder</h2></div>
                <p class="rb-empty">No harvesting performance data yet. Import a monthly report first.</p>`;
            return;
        }

        if (!rb.year || !scope.years.includes(rb.year)) rb.year = scope.years[scope.years.length - 1];
        const yearScope = scope.detail[rb.year] || { months_with_production: [], gangs: [], blocks: [] };
        const availMonths = yearScope.months_with_production;
        if (!rb.from || !availMonths.includes(rb.from)) rb.from = availMonths[0] || 'JAN';
        if (!rb.to || !availMonths.includes(rb.to)) rb.to = availMonths[availMonths.length - 1] || 'DEC';

        host.innerHTML = `
            <div class="report-header-bar">
                <h2 style="margin:0">📐 Report Builder</h2>
                <div class="rb-note">Any cut of the FFB production record — no new code needed.</div>
            </div>

            <div class="rb-presets">
                <span class="rb-note">Quick:</span>
                <button class="rb-preset" data-preset="month">Month-to-month FFB</button>
                <button class="rb-preset" data-preset="block">Production by block</button>
                <button class="rb-preset" data-preset="gang">Production by gang</button>
                <button class="rb-preset" data-preset="month_gang">Month × gang</button>
            </div>

            <div class="rb-controls">
                <label>Year
                    <select id="rb-year" class="edit-input">
                        ${scope.years.map((y) => `<option value="${esc(y)}"${y === rb.year ? ' selected' : ''}>${esc(y)}</option>`).join('')}
                    </select>
                </label>
                <label>Group by
                    <select id="rb-group" class="edit-input">
                        ${Object.entries(GROUPINGS).map(([k, g]) =>
                            `<option value="${k}"${k === rb.groupBy ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}
                    </select>
                </label>
                <label>From
                    <select id="rb-from" class="edit-input">
                        ${availMonths.map((m) => `<option value="${m}"${m === rb.from ? ' selected' : ''}>${m}</option>`).join('')}
                    </select>
                </label>
                <label>To
                    <select id="rb-to" class="edit-input">
                        ${availMonths.map((m) => `<option value="${m}"${m === rb.to ? ' selected' : ''}>${m}</option>`).join('')}
                    </select>
                </label>
                <label>Rounds
                    <span class="rb-rounds">
                        ${[1, 2, 3, 4].map((r) => `<label class="rb-round"><input type="checkbox" class="rb-r" value="${r}"${
                            rb.rounds.includes(r) ? ' checked' : ''}> ${r}</label>`).join('')}
                    </span>
                </label>
            </div>

            <details class="rb-filters"${(rb.gangs.length || rb.blocks.length) ? ' open' : ''}>
                <summary>Filters ${(rb.gangs.length || rb.blocks.length)
                    ? `<span class="rb-active">${rb.gangs.length + rb.blocks.length} active</span>` : ''}</summary>
                <div class="rb-filter-grid">
                    <div>
                        <strong>Gangs</strong> <span class="rb-note">(none = all)</span>
                        <div class="rb-chips">${yearScope.gangs.map((g) =>
                            `<label class="rb-chip${rb.gangs.includes(g) ? ' on' : ''}"><input type="checkbox" class="rb-g" value="${esc(g)}"${
                                rb.gangs.includes(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('') || '<em>none</em>'}</div>
                    </div>
                    <div>
                        <strong>Blocks</strong> <span class="rb-note">(none = all)</span>
                        <div class="rb-chips">${yearScope.blocks.map((b) =>
                            `<label class="rb-chip${rb.blocks.includes(b) ? ' on' : ''}"><input type="checkbox" class="rb-b" value="${esc(b)}"${
                                rb.blocks.includes(b) ? ' checked' : ''}> ${esc(b)}</label>`).join('') || '<em>none</em>'}</div>
                    </div>
                </div>
                <button class="btn-secondary" id="rb-clear-filters">Clear filters</button>
            </details>

            <div id="rb-output"></div>`;

        const monthRange = () => {
            const i = MONTHS.indexOf(rb.from);
            const j = MONTHS.indexOf(rb.to);
            return i <= j ? MONTHS.slice(i, j + 1) : MONTHS.slice(j, i + 1);
        };

        const draw = () => {
            const out = host.querySelector('#rb-output');
            const res = window.rbPivot({
                year: rb.year,
                group_by: rb.groupBy,
                months: monthRange(),
                rounds: rb.rounds,
                gangs: rb.gangs,
                blocks: rb.blocks,
            });
            _rbResult = res.error ? null : res;

            if (res.error) {
                out.innerHTML = `<p class="rb-empty">${esc(res.error)}</p>`;
                return;
            }

            out.innerHTML = `
                <div class="rb-summary">
                    <div><span class="rb-big">${res.total_mt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> MT total</div>
                    <div><span class="rb-big">${res.rows.length}</span> rows</div>
                    <div><span class="rb-big">${res.months_covered.length}</span> months with data</div>
                    <button class="btn-primary" id="rb-dl">⬇ Excel</button>
                </div>
                <div style="overflow-x:auto">
                    <table class="rb-tbl">
                        <thead><tr>${res.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
                        <tbody>${res.rows.map((r) => '<tr>' + r.map((c, i) =>
                            `<td${i >= res.columns.length - 2 ? ' class="rb-num"' : ''}>${
                                typeof c === 'number' ? c.toLocaleString(undefined, { maximumFractionDigits: 2 }) : esc(c)
                            }</td>`).join('') + '</tr>').join('')}</tbody>
                        <tfoot><tr>
                            <td colspan="${res.columns.length - 2}">TOTAL</td>
                            <td class="rb-num">${res.total_mt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td class="rb-num"></td>
                        </tr></tfoot>
                    </table>
                </div>
                <p class="rb-note">${esc(res.note)}</p>`;

            out.querySelector('#rb-dl').onclick = async () => {
                try {
                    await window.rbToExcel(_rbResult);
                    if (window.notify) window.notify('Excel downloaded.', 'success');
                } catch (e) {
                    if (window.notify) window.notify('Download failed: ' + e.message, 'error');
                }
            };
        };

        const readFilters = () => {
            rb.rounds = [...host.querySelectorAll('.rb-r:checked')].map((el) => Number(el.value));
            if (!rb.rounds.length) rb.rounds = [1, 2, 3, 4];   // empty = all, never nothing
            rb.gangs = [...host.querySelectorAll('.rb-g:checked')].map((el) => el.value);
            rb.blocks = [...host.querySelectorAll('.rb-b:checked')].map((el) => el.value);
        };

        host.querySelector('#rb-year').onchange = (e) => {
            rb.year = e.target.value;
            rb.from = null; rb.to = null; rb.gangs = []; rb.blocks = [];  // scope changed
            window.renderReportBuilder();
        };
        host.querySelector('#rb-group').onchange = (e) => { rb.groupBy = e.target.value; draw(); };
        host.querySelector('#rb-from').onchange = (e) => { rb.from = e.target.value; draw(); };
        host.querySelector('#rb-to').onchange = (e) => { rb.to = e.target.value; draw(); };
        host.querySelectorAll('.rb-r, .rb-g, .rb-b').forEach((el) => {
            el.onchange = () => { readFilters(); el.closest('.rb-chip')?.classList.toggle('on', el.checked); draw(); };
        });
        host.querySelector('#rb-clear-filters').onclick = () => {
            rb.gangs = []; rb.blocks = [];
            window.renderReportBuilder();
        };
        host.querySelectorAll('.rb-preset').forEach((b) => {
            b.onclick = () => {
                rb.groupBy = b.dataset.preset;
                rb.gangs = []; rb.blocks = []; rb.rounds = [1, 2, 3, 4];
                rb.from = availMonths[0]; rb.to = availMonths[availMonths.length - 1];
                window.renderReportBuilder();
            };
        });

        draw();
    };
})();
