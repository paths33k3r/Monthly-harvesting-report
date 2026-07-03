// render_reports.js — Excel report downloads: Harvesting YTD, Rainfall, GLY+ALLY Spraying

(function () {
    'use strict';

    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const MONTHS_UP = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

    // ── Lazy-load ExcelJS from CDN ──────────────────────────────────────────
    async function ensureExcelJS() {
        if (typeof ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res;
            s.onerror = () => rej(new Error('Failed to load ExcelJS library'));
            document.head.appendChild(s);
        });
    }

    async function ensureJSZip() {
        if (typeof JSZip !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
            s.onload = res;
            s.onerror = () => rej(new Error('Failed to load JSZip library'));
            document.head.appendChild(s);
        });
    }

    // Strip shared formulas from xlsx buffer to avoid ExcelJS parse errors
    // opts.stripCellStyles: also strip s="" from cells B-L rows 6-17 (needed for rainfall fill overrides)
    async function preprocessXlsx(buf, opts = {}) {
        await ensureJSZip();
        const zip = await JSZip.loadAsync(buf);

        // Fix styles.xml: cells with applyFill="0" inherit fill from the parent "Normal" style
        // (which is black). Force applyFill="1" so cells use their own fillId instead.
        const stylesFile = zip.files['xl/styles.xml'];
        if (stylesFile) {
            let stylesXml = await stylesFile.async('string');
            stylesXml = stylesXml.replace(/ applyFill="0"/g, ' applyFill="1"');
            zip.file('xl/styles.xml', stylesXml);
        }

        const sheetPaths = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
        for (const path of sheetPaths) {
            let xml = await zip.files[path].async('string');
            // Master shared formula: keep formula text, remove shared attributes
            xml = xml.replace(/<f t="shared" ref="[^"]*" si="\d+">/g, '<f>');
            // Clone shared formula (no formula text): remove the element entirely
            xml = xml.replace(/<f t="shared" si="\d+"\/>/g, '');
            // Strip column-level style attribute so cell-level fills take precedence
            xml = xml.replace(/(<col\b[^>]*?) style="[^"]*"/g, '$1');
            // Strip cell-level style only for templates that need fill overrides (e.g. rainfall)
            if (opts.stripCellStyles) {
                xml = xml.replace(/<c r="([B-L])(\d+)"([^>]*?)>/g, (match, col, row, rest) => {
                    const r = parseInt(row);
                    if (r >= 6 && r <= 17) return `<c r="${col}${row}"${rest.replace(/ s="\d+"/, '')}>`;
                    return match;
                });
            }
            zip.file(path, xml);
        }
        return zip.generateAsync({ type: 'arraybuffer' });
    }

    async function loadTemplate(filename, opts = {}) {
        const url = encodeURI('Report samples/' + filename);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Could not load template "${filename}" (${resp.status}). Make sure the app is served via HTTP, not file://.`);
        const raw = await resp.arrayBuffer();
        const buf = await preprocessXlsx(raw, opts);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        return wb;
    }

    function downloadBuffer(buf, filename) {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        if (typeof window.logAudit === 'function') {
            window.logAudit('download', 'reports', filename, '');
        }
    }

    function setStatus(id, msg, autoClear) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg;
        if (autoClear) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3500);
    }

    // ── Data helpers (mirror render_ytd_report.js logic) ───────────────────
    function getYtdActual(year, blockId, mIdx) {
        let sum = 0;
        const perf = window.state.performance;
        if (!perf || !perf[year]) return 0;
        for (let i = 0; i <= mIdx; i++) {
            const mData = perf[year][MONTHS[i]];
            if (!mData) continue;
            const gang = (mData.gangAssignments || {})[String(blockId)];
            const add = (pd) => { if (!pd) return; sum += (parseFloat(pd.r1)||0)+(parseFloat(pd.r2)||0)+(parseFloat(pd.r3)||0)+(parseFloat(pd.r4)||0); };
            if (gang && mData[gang] && mData[gang].blocks) {
                add(mData[gang].blocks[String(blockId)]);
            } else {
                Object.keys(mData).forEach(k => { if (k !== 'gangAssignments' && mData[k] && mData[k].blocks) add(mData[k].blocks[String(blockId)]); });
            }
        }
        return sum;
    }

    function getYtdBudget(year, blockId, mIdx) {
        const arr = (window.state.ffbBudget && window.state.ffbBudget[year]) || [];
        const bd  = arr.find(b => String(b.block_id) === String(blockId));
        if (!bd || !Array.isArray(bd.months)) return 0;
        let s = 0;
        for (let i = 0; i <= mIdx; i++) s += parseFloat(bd.months[i] || 0);
        return s;
    }

    function getBlockHa(year, blockId) {
        const blocks = (window.state.reports && window.state.reports[year]) || [];
        const b = blocks.find(bl => String(bl.block_id) === String(blockId));
        return b ? (parseFloat(b.ha) || 0) : 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 1. HARVESTING PERFORMANCE YTD REPORT
    //    Template: "Havesting Performance Dec 2025.xlsx"
    //    Sheet:    "OVERALL BY GANG COMPARISON YTD2"
    // ══════════════════════════════════════════════════════════════════════

    // Fixed row layout matching the template sheet (1-indexed Excel rows)
    const YTD_PHASES = [
        { op:"2010", subtotalRow:6,
          blocks:[{id:"1",r:7},{id:"2",r:8},{id:"3",r:9},{id:"4",r:10},
                  {id:"5",r:11},{id:"6",r:12},{id:"7",r:13},{id:"8",r:14},
                  {id:"9",r:15},{id:"11",r:16},{id:"12",r:17},{id:"23",r:18}] },
        { op:"2011", subtotalRow:20,
          blocks:[{id:"10",r:21},{id:"13",r:22},{id:"14",r:23},{id:"15",r:24},
                  {id:"16",r:25},{id:"17",r:26},{id:"18",r:27}] },
        { op:"2012", subtotalRow:29,
          blocks:[{id:"19",r:30},{id:"20",r:31},{id:"21",r:32},{id:"22",r:33},{id:"24",r:34}] },
        { op:"2015", subtotalRow:36,
          blocks:[{id:"25",r:37},{id:"26A",r:38},{id:"27",r:39},{id:"28",r:40},
                  {id:"29",r:41},{id:"30",r:42},{id:"31",r:43}] },
        { op:"2016", subtotalRow:45,
          blocks:[{id:"33",r:46},{id:"39",r:47}] }
    ];
    const YTD_GRAND_ROW = 49;

    window.downloadYtdReport = async (year, month) => {
        setStatus('rep-ytd-status', 'Generating…');
        try {
            await ensureExcelJS();
            const wb = await loadTemplate('Havesting Performance Dec 2025.xlsx', { stripCellStyles: false });
            const ws = wb.getWorksheet('OVERALL BY GANG COMPARISON YTD2');
            if (!ws) throw new Error('Worksheet "OVERALL BY GANG COMPARISON YTD2" not found');

            const prevYear = String(parseInt(year) - 1);
            const mIdx    = MONTHS.indexOf(month);
            const mLabel  = MONTHS_UP[mIdx];

            // Write value only — leave template numFmt and borders intact
            const setN = (r, c, v) => {
                ws.getCell(r, c).value = parseFloat(v.toFixed(2));
            };

            // Title + year headers
            ws.getCell('A1').value = `YIELD TO DATE OF CURRENT YEAR VS. PAST YEAR (UP TO ${mLabel} ${year})`;
            ws.getCell('D5').value = parseInt(year);
            ws.getCell('F5').value = parseInt(prevYear);
            ws.getCell('H5').value = `${year} vs ${prevYear}`;
            ws.getCell('I5').value = parseInt(year);
            ws.getCell('J5').value = parseInt(prevYear);

            let gHA=0, gCB=0, gCA=0, gPB=0, gPA=0;

            YTD_PHASES.forEach(phase => {
                let pHA=0, pCB=0, pCA=0, pPB=0, pPA=0;

                phase.blocks.forEach((blk, bIdx) => {
                    const ha   = getBlockHa(year, blk.id) || getBlockHa(prevYear, blk.id);
                    const cBud = getYtdBudget(year, blk.id, mIdx);
                    const cAct = getYtdActual(year, blk.id, mIdx);
                    const pBud = getYtdBudget(prevYear, blk.id, mIdx);
                    const pAct = getYtdActual(prevYear, blk.id, mIdx);
                    const varr = cAct - pAct;
                    const cMH  = ha > 0 ? cAct / ha : 0;
                    const pMH  = ha > 0 ? pAct / ha : 0;
                    const row  = blk.r;

                    ws.getCell(row, 1).value = parseInt(blk.id) || blk.id;
                    ws.getCell(row, 2).value = parseInt(phase.op);
                    setN(row, 3, ha);
                    setN(row, 4, cBud);
                    setN(row, 5, cAct);
                    setN(row, 6, pBud);
                    setN(row, 7, pAct);
                    setN(row, 8, varr);
                    setN(row, 9, cMH);
                    setN(row, 10, pMH);

                    pHA += ha; pCB += cBud; pCA += cAct; pPB += pBud; pPA += pAct;
                });

                const sr   = phase.subtotalRow;
                const pVar = pCA - pPA;
                const pCMH = pHA > 0 ? pCA / pHA : 0;
                const pPMH = pHA > 0 ? pPA / pHA : 0;

                ws.getCell(sr, 1).value = null;
                ws.getCell(sr, 2).value = parseInt(phase.op);
                setN(sr, 3, pHA);
                setN(sr, 4, pCB);
                setN(sr, 5, pCA);
                setN(sr, 6, pPB);
                setN(sr, 7, pPA);
                setN(sr, 8, pVar);
                setN(sr, 9, pCMH);
                setN(sr, 10, pPMH);

                gHA+=pHA; gCB+=pCB; gCA+=pCA; gPB+=pPB; gPA+=pPA;
            });

            const gVar = gCA - gPA;
            const gCMH = gHA > 0 ? gCA / gHA : 0;
            const gPMH = gHA > 0 ? gPA / gHA : 0;
            setN(YTD_GRAND_ROW, 3, gHA);
            setN(YTD_GRAND_ROW, 4, gCB);
            setN(YTD_GRAND_ROW, 5, gCA);
            setN(YTD_GRAND_ROW, 6, gPB);
            setN(YTD_GRAND_ROW, 7, gPA);
            setN(YTD_GRAND_ROW, 8, gVar);
            setN(YTD_GRAND_ROW, 9, gCMH);
            setN(YTD_GRAND_ROW, 10, gPMH);

            // Clear template footer notes
            for (let r = 52; r <= 55; r++) {
                for (let c = 1; c <= 10; c++) ws.getCell(r, c).value = null;
            }

            // Remove all sheets except the one we need
            wb.worksheets.filter(s => s.name !== 'OVERALL BY GANG COMPARISON YTD2')
                         .forEach(s => wb.removeWorksheet(s.id));

            const buf = await wb.xlsx.writeBuffer();
            downloadBuffer(buf, `Harvesting_YTD_${mLabel}_${year}.xlsx`);
            setStatus('rep-ytd-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('YTD report error:', e);
            setStatus('rep-ytd-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // 2. RAINFALL COMPARISON REPORT
    //    Template: "Rainfall 2024 vs 2025 up to Dec 2025.xlsx"
    //    Sheet:    "Dec Rainfall 2024 vs 2025"
    // ══════════════════════════════════════════════════════════════════════

    window.downloadRainfallReport = async (year, month) => {
        setStatus('rep-rain-status', 'Generating…');
        try {
            await ensureExcelJS();
            const wb = await loadTemplate('Rainfall 2024 vs 2025 up to Dec 2025.xlsx', { stripCellStyles: false });
            const ws = wb.getWorksheet('Dec Rainfall 2024 vs 2025');
            if (!ws) throw new Error('Rainfall worksheet not found');

            const prevYear = String(parseInt(year) - 1);
            const mIdx    = MONTHS.indexOf(month);
            const mLabel  = MONTHS_UP[mIdx];
            const rfCurr  = (window.state.rainfall && window.state.rainfall[year])     || {};
            const rfPrev  = (window.state.rainfall && window.state.rainfall[prevYear]) || {};

            const BLACK_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
            const WHITE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

            // Helper — set value then immediately override fill so template black fills don't win
            const setCell = (row, col, val, fill) => {
                const c = ws.getCell(row, col);
                c.value = val != null && val !== 0 ? val : null;
                c.fill  = fill;
            };

            // Clear extra template columns (N onwards — values only, leave borders intact)
            for (let r = 1; r <= 50; r++) {
                for (let c = 14; c <= 30; c++) {
                    ws.getCell(r, c).value = null;
                }
            }

            // Title and year headers
            ws.getCell('A1').value = `SUMMARY REPORT FOR RAINFALL RECORD FOR THE YEAR ${prevYear} VS ${year} (Updated as of ${mLabel} ${year})`;
            ws.getCell('B3').value = parseInt(prevYear);
            ws.getCell('F3').value = parseInt(year);
            ws.getCell('J3').value = `${year} vs ${prevYear}`;

            let prevCum=0, currCum=0;
            let totPrevD=0, totPrevM=0, totCurrD=0, totCurrM=0;
            // YTD totals for prev year — only months 0..mIdx (for correct DIFF comparison)
            let totPrevDYtd=0, totPrevMYtd=0, prevCumYtd=0;

            for (let i = 0; i < 12; i++) {
                const row  = 6 + i;
                const mKey = MONTHS_UP[i];

                // Previous year — all 12 months always shown, white fill applied inline
                const pd    = rfPrev[mKey] || {};
                const prevD = parseFloat(pd.days) || 0;
                const prevM = parseFloat(pd.mm)   || 0;
                prevCum += prevM;
                setCell(row, 2, prevD, WHITE_FILL);
                setCell(row, 3, prevM, WHITE_FILL);
                setCell(row, 4, prevCum, WHITE_FILL);
                totPrevD += prevD; totPrevM += prevM;

                if (i <= mIdx) {
                    // Current year — fill up to selected month
                    const cd    = rfCurr[mKey] || {};
                    const currD = parseFloat(cd.days) || 0;
                    const currM = parseFloat(cd.mm)   || 0;
                    currCum += currM;
                    setCell(row, 6,  currD,          WHITE_FILL);
                    setCell(row, 7,  currM,          WHITE_FILL);
                    setCell(row, 8,  currCum,        WHITE_FILL);
                    setCell(row, 10, currD - prevD,  WHITE_FILL);
                    setCell(row, 11, currM - prevM,  WHITE_FILL);
                    setCell(row, 12, currCum - prevCum, WHITE_FILL);
                    totCurrD += currD; totCurrM += currM;
                    // Track YTD prev totals for correct DIFF in total row
                    totPrevDYtd += prevD; totPrevMYtd += prevM;
                    prevCumYtd = prevCum;
                } else {
                    // Future months — black fill, no data
                    [6, 7, 8, 10, 11, 12].forEach(c => {
                        ws.getCell(row, c).value = null;
                        ws.getCell(row, c).fill  = BLACK_FILL;
                    });
                }
            }

            // Total row (row 18)
            // Prev year shows full-year total; curr year shows YTD; DIFF compares YTD-to-YTD
            ws.getCell(18, 2).value  = totPrevD;
            ws.getCell(18, 3).value  = totPrevM;
            ws.getCell(18, 4).value  = prevCum;
            ws.getCell(18, 6).value  = totCurrD;
            ws.getCell(18, 7).value  = totCurrM;
            ws.getCell(18, 8).value  = currCum;
            ws.getCell(18, 10).value = totCurrD - totPrevDYtd;
            ws.getCell(18, 11).value = totCurrM - totPrevMYtd;

            // Summary notes (rows 22-27) — diff uses YTD of both years through selected month
            const diff = Math.round(currCum - prevCumYtd);
            ws.getCell('A22').value = `MM TO MONTH ${year} vs ${prevYear}`;
            ws.getCell('A23').value = Math.abs(diff);
            ws.getCell('A24').value = parseInt(prevYear);
            ws.getCell('B24').value = diff >= 0 ? '<' : '>';
            ws.getCell('C24').value = parseInt(year);
            ws.getCell('A26').value = `*MM TO MONTH as of ${mLabel} for both years`;
            ws.getCell('A27').value = diff >= 0
                ? `**${year} MM TO MONTH is more than ${prevYear} by ${Math.abs(diff)}`
                : `**${year} MM TO MONTH is less than ${prevYear} by ${Math.abs(diff)}`;

            // Keep only the rainfall sheet
            wb.worksheets.filter(s => s.name !== 'Dec Rainfall 2024 vs 2025')
                         .forEach(s => wb.removeWorksheet(s.id));

            const buf = await wb.xlsx.writeBuffer();
            downloadBuffer(buf, `Rainfall_${prevYear}_vs_${year}_${mLabel}_${year}.xlsx`);
            setStatus('rep-rain-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('Rainfall report error:', e);
            setStatus('rep-rain-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // 3. SPRAYING GLY + ALLY ANNUAL REPORT  (built from scratch via ExcelJS)
    //    Mirrors the on-screen Spraying layout: GLY, ALY and every extra
    //    chemical inline per month, split into JAN–JUN and JUL–DEC half-pages,
    //    grouped by phase. Restrained monotone (grayscale) styling. This
    //    replaces the old GLY/ALY-only template, which could not represent the
    //    user's extra chemicals (they were dropped from the Excel entirely).
    // ══════════════════════════════════════════════════════════════════════
    window.downloadSprayingReport = async (year, month) => {
        setStatus('rep-spray-status', 'Generating…');
        try {
            await ensureExcelJS();

            const sprayData = window.state.spraying && window.state.spraying[year];
            if (!sprayData || !(sprayData.phases || []).some(p => (p.blocks || []).length > 0)) {
                setStatus('rep-spray-status', `❌ No spraying data for ${year}. Enter data in the Spraying section first.`, true);
                return;
            }
            const extraChemicals = sprayData.extraChemicals || [];
            const cutIdx = month ? MONTHS_UP.indexOf(month.toUpperCase()) : 11;  // '' = full year

            // ── Monotone (grayscale) palette ──────────────────────────────────
            const C = {
                phaseFill:    'FF374151',  // gray-700 (phase bar, TOTAL group, subtotal accents)
                headFill:     'FF4B5563',  // gray-600 (column headers)
                subFill:      'FFE5E7EB',  // gray-200 (GLY/ALY sub-headers)
                subExtraFill: 'FFD1D5DB',  // gray-300 (extra-chemical sub-headers — italic to set apart)
                zebra:        'FFF9FAFB',  // gray-50  (alternate block shading)
                totalFill:    'FFD1D5DB',  // gray-300 (subtotal row)
            };
            const white = { argb: 'FFFFFFFF' };
            const dark  = { argb: 'FF111827' };
            const thin  = { style: 'thin', color: { argb: 'FFB0B4BA' } };
            const allThin = { top: thin, bottom: thin, left: thin, right: thin };

            const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            function styleCell(cell, opt) {
                opt = opt || {};
                if (opt.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
                if (opt.font) cell.font = opt.font;
                cell.alignment = Object.assign({ vertical: 'middle', horizontal: 'center', wrapText: true }, opt.align || {});
                cell.border = opt.border || allThin;
                if (opt.numFmt) cell.numFmt = opt.numFmt;
            }

            const wb = new window.ExcelJS.Workbook();
            wb.creator = 'Monthly Harvesting Report';
            wb.created = new Date();
            const ws = wb.addWorksheet(`GLY + ALLY ${year}`, {
                views: [{ state: 'frozen', xSplit: 4, ySplit: 0 }],
                pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
            });

            const nExtra       = extraChemicals.length;
            const colsPerMonth = 2 + nExtra;                 // GLY, ALY, + extras
            const FIXED        = 4;                            // Block, HaPrev, HaPresent, Particular
            const HALF_MONTHS  = 6;
            const T_BASE       = FIXED + 1 + HALF_MONTHS * colsPerMonth;   // first col of TOTAL group
            const lastCol      = T_BASE + colsPerMonth - 1;

            ws.getColumn(1).width = 8;    // Block No
            ws.getColumn(2).width = 9;    // Ha Prev
            ws.getColumn(3).width = 9;    // Ha Present
            ws.getColumn(4).width = 13;   // Particular
            for (let c = 5; c <= lastCol; c++) ws.getColumn(c).width = 9;

            let r = 1;
            // ── Title block ───────────────────────────────────────────────────
            [
                ['POLIMA FOREST BINTULU SDN. BHD.', 13, dark],
                ['ESTATE MONTHLY REPORT — LADANG BATANG KAYAN', 10, { argb: 'FF374151' }],
                [`GLYPHOSATE & ALLY SPRAYING SELECT — ${year}`, 11, { argb: 'FF374151' }],
            ].forEach(([text, size, color], i) => {
                ws.mergeCells(r, 1, r, lastCol);
                const cell = ws.getCell(r, 1);
                cell.value = text;
                cell.font = { bold: true, size, color };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                ws.getRow(r).height = i === 0 ? 20 : 16;
                r++;
            });
            r++;  // spacer

            const HALVES = [
                { label: 'JAN – JUN', months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN'] },
                { label: 'JUL – DEC', months: ['JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
            ];
            const SUB_ROWS = ['Round', 'No.Litre / GM', 'Ha'];
            const glyVal   = (md, si) => si === 0 ? md.roundGly : si === 1 ? md.litresGly : md.haGly;
            const alyVal   = (md, si) => si === 0 ? md.roundAly : si === 1 ? md.gmAly     : md.haAly;
            const extraVal = (md, ch, si) => {
                const ex = md.extras || {};
                return si === 0 ? ex[ch.name + '_round'] : si === 1 ? ex[ch.name] : ex[ch.name + '_ha'];
            };
            const active = m => MONTHS_UP.indexOf(m) <= cutIdx;

            function renderHeader(half) {
                const top = r, sub = r + 1;
                const fixedLabels = ['BLOCK NO', 'HA PREV', 'HA PRESENT', 'PARTICULAR'];
                for (let c = 1; c <= FIXED; c++) {
                    ws.mergeCells(top, c, sub, c);
                    styleCell(ws.getCell(top, c), { fill: C.headFill, font: { bold: true, size: 8, color: white } });
                    ws.getCell(top, c).value = fixedLabels[c - 1];
                }
                const writeGroup = (base, label, groupFill) => {
                    ws.mergeCells(top, base, top, base + colsPerMonth - 1);
                    styleCell(ws.getCell(top, base), { fill: groupFill, font: { bold: true, size: 8, color: white } });
                    ws.getCell(top, base).value = label;
                    styleCell(ws.getCell(sub, base),     { fill: C.subFill, font: { bold: true, size: 7, color: dark } });
                    ws.getCell(sub, base).value     = 'GLY\n(LITRE)';
                    styleCell(ws.getCell(sub, base + 1), { fill: C.subFill, font: { bold: true, size: 7, color: dark } });
                    ws.getCell(sub, base + 1).value = 'ALY\n(GM)';
                    extraChemicals.forEach((ch, xi) => {
                        styleCell(ws.getCell(sub, base + 2 + xi), { fill: C.subExtraFill, font: { bold: true, italic: true, size: 7, color: dark } });
                        ws.getCell(sub, base + 2 + xi).value = `${ch.name}\n(${ch.uom})`;
                    });
                };
                half.months.forEach((m, mi) => writeGroup(FIXED + 1 + mi * colsPerMonth, m, C.headFill));
                writeGroup(T_BASE, 'TOTAL', C.phaseFill);
                ws.getRow(top).height = 14;
                ws.getRow(sub).height = 22;
                r += 2;
            }

            function renderPhaseHalf(phase, half) {
                renderHeader(half);

                (phase.blocks || []).forEach((blk, bi) => {
                    const r0 = r;
                    const zebra = bi % 2 === 1 ? C.zebra : 'FFFFFFFF';
                    for (let c = 1; c <= 3; c++) ws.mergeCells(r0, c, r0 + 2, c);
                    styleCell(ws.getCell(r0, 1), { fill: zebra, font: { bold: true, size: 9, color: dark }, numFmt: '@' });
                    ws.getCell(r0, 1).value = blk.blockNo != null ? String(blk.blockNo) : '';
                    styleCell(ws.getCell(r0, 2), { fill: zebra, font: { size: 8, color: dark }, numFmt: '0.00', align: { horizontal: 'right' } });
                    ws.getCell(r0, 2).value = num(blk.haPrevious);
                    styleCell(ws.getCell(r0, 3), { fill: zebra, font: { size: 8, color: dark }, numFmt: '0.00', align: { horizontal: 'right' } });
                    ws.getCell(r0, 3).value = num(blk.haPresent);

                    // Per-block TOTAL group = this half's litre/GM sums for the block
                    let bG = 0, bA = 0; const bX = {}; extraChemicals.forEach(ch => bX[ch.name] = 0);
                    half.months.forEach(m => {
                        if (!active(m)) return;
                        const md = (blk.months || {})[m] || {};
                        bG += num(md.litresGly) || 0; bA += num(md.gmAly) || 0;
                        extraChemicals.forEach(ch => { bX[ch.name] += num((md.extras || {})[ch.name]) || 0; });
                    });

                    SUB_ROWS.forEach((label, si) => {
                        const rr = r0 + si;
                        const fmt = si === 0 ? '0.##' : '#,##0.##';
                        styleCell(ws.getCell(rr, FIXED), { fill: zebra, font: { size: 8, color: dark }, align: { horizontal: 'left' } });
                        ws.getCell(rr, FIXED).value = label;
                        half.months.forEach((m, mi) => {
                            const base = FIXED + 1 + mi * colsPerMonth;
                            const md = (blk.months || {})[m] || {};
                            const on = active(m);
                            styleCell(ws.getCell(rr, base),     { fill: zebra, font: { size: 8, color: dark }, numFmt: fmt });
                            ws.getCell(rr, base).value     = on ? num(glyVal(md, si)) : null;
                            styleCell(ws.getCell(rr, base + 1), { fill: zebra, font: { size: 8, color: dark }, numFmt: fmt });
                            ws.getCell(rr, base + 1).value = on ? num(alyVal(md, si)) : null;
                            extraChemicals.forEach((ch, xi) => {
                                styleCell(ws.getCell(rr, base + 2 + xi), { fill: zebra, font: { size: 8, color: dark }, numFmt: fmt });
                                ws.getCell(rr, base + 2 + xi).value = on ? num(extraVal(md, ch, si)) : null;
                            });
                        });
                        // TOTAL group — only the No.Litre/GM row carries the block half-total
                        if (si === 1) {
                            styleCell(ws.getCell(rr, T_BASE),     { fill: zebra, font: { bold: true, size: 8, color: dark }, numFmt: '#,##0.##' });
                            ws.getCell(rr, T_BASE).value     = bG || null;
                            styleCell(ws.getCell(rr, T_BASE + 1), { fill: zebra, font: { bold: true, size: 8, color: dark }, numFmt: '#,##0.##' });
                            ws.getCell(rr, T_BASE + 1).value = bA || null;
                            extraChemicals.forEach((ch, xi) => {
                                styleCell(ws.getCell(rr, T_BASE + 2 + xi), { fill: zebra, font: { bold: true, size: 8, color: dark }, numFmt: '#,##0.##' });
                                ws.getCell(rr, T_BASE + 2 + xi).value = bX[ch.name] || null;
                            });
                        } else {
                            for (let c = T_BASE; c <= lastCol; c++) styleCell(ws.getCell(rr, c), { fill: zebra, font: { size: 8 } });
                        }
                    });
                    r += 3;
                });

                // ── Phase TOTAL block (two rows: No.Litre/GM and Ha) ──────────
                // Mirrors the printed report footer: an italic "Total" with the Ha
                // Previous / Ha Present phase sums, then per-month column sums of
                // litres·GM (row 1) and Ha (row 2), including the extra chemicals.
                const tr1 = r, tr2 = r + 1;       // No.Litre/GM row, Ha row
                const totFont  = { bold: true, size: 8, color: dark };
                const totFontI = { bold: true, italic: true, size: 8, color: dark };
                const setTot = (row, col, val, opt) => {
                    styleCell(ws.getCell(row, col), Object.assign({ fill: C.totalFill, font: totFont, numFmt: '0.00' }, opt || {}));
                    ws.getCell(row, col).value = val;
                };
                // "Total" label in the Block No column, both rows
                ws.mergeCells(tr1, 1, tr2, 1);
                styleCell(ws.getCell(tr1, 1), { fill: C.totalFill, font: totFontI, align: { horizontal: 'center' } });
                ws.getCell(tr1, 1).value = 'Total';
                // Ha Previous / Ha Present phase sums (cols 2 & 3), merged across both rows
                let sumHaPrev = 0, sumHaPresent = 0;
                (phase.blocks || []).forEach(blk => { sumHaPrev += num(blk.haPrevious) || 0; sumHaPresent += num(blk.haPresent) || 0; });
                ws.mergeCells(tr1, 2, tr2, 2);
                styleCell(ws.getCell(tr1, 2), { fill: C.totalFill, font: totFontI, numFmt: '0.00', align: { horizontal: 'right' } });
                ws.getCell(tr1, 2).value = Math.round(sumHaPrev * 100) / 100 || null;
                ws.mergeCells(tr1, 3, tr2, 3);
                styleCell(ws.getCell(tr1, 3), { fill: C.totalFill, font: totFontI, numFmt: '0.00', align: { horizontal: 'right' } });
                ws.getCell(tr1, 3).value = Math.round(sumHaPresent * 100) / 100 || null;
                // Particular labels
                styleCell(ws.getCell(tr1, FIXED), { fill: C.totalFill, font: totFont, align: { horizontal: 'left' } });
                ws.getCell(tr1, FIXED).value = 'No.Litre / GM';
                styleCell(ws.getCell(tr2, FIXED), { fill: C.totalFill, font: totFont, align: { horizontal: 'left' } });
                ws.getCell(tr2, FIXED).value = 'Ha';
                // Per-month sums — litres/GM on row 1, Ha on row 2
                let gG = 0, gA = 0, gHG = 0, gHA = 0;
                const gXl = {}, gXh = {}; extraChemicals.forEach(ch => { gXl[ch.name] = 0; gXh[ch.name] = 0; });
                half.months.forEach((m, mi) => {
                    const base = FIXED + 1 + mi * colsPerMonth;
                    const on = active(m);
                    let lG = 0, gA_ = 0, hG = 0, hA = 0;
                    const exL = {}, exH = {}; extraChemicals.forEach(ch => { exL[ch.name] = 0; exH[ch.name] = 0; });
                    if (on) (phase.blocks || []).forEach(blk => {
                        const md = (blk.months || {})[m] || {};
                        lG += num(md.litresGly) || 0; gA_ += num(md.gmAly) || 0;
                        hG += num(md.haGly) || 0; hA += num(md.haAly) || 0;
                        extraChemicals.forEach(ch => {
                            exL[ch.name] += num((md.extras || {})[ch.name]) || 0;
                            exH[ch.name] += num((md.extras || {})[ch.name + '_ha']) || 0;
                        });
                    });
                    gG += lG; gA += gA_; gHG += hG; gHA += hA;
                    extraChemicals.forEach(ch => { gXl[ch.name] += exL[ch.name]; gXh[ch.name] += exH[ch.name]; });
                    setTot(tr1, base,     on ? lG  : null);
                    setTot(tr1, base + 1, on ? gA_ : null);
                    setTot(tr2, base,     on ? hG  : null);
                    setTot(tr2, base + 1, on ? hA  : null);
                    extraChemicals.forEach((ch, xi) => {
                        setTot(tr1, base + 2 + xi, on ? exL[ch.name] : null);
                        setTot(tr2, base + 2 + xi, on ? exH[ch.name] : null);
                    });
                });
                // TOTAL group grand sums
                setTot(tr1, T_BASE,     gG  || null); setTot(tr1, T_BASE + 1, gA  || null);
                setTot(tr2, T_BASE,     gHG || null); setTot(tr2, T_BASE + 1, gHA || null);
                extraChemicals.forEach((ch, xi) => {
                    setTot(tr1, T_BASE + 2 + xi, gXl[ch.name] || null);
                    setTot(tr2, T_BASE + 2 + xi, gXh[ch.name] || null);
                });
                ws.getRow(tr1).height = 15;
                ws.getRow(tr2).height = 15;
                r += 2;
            }

            (sprayData.phases || []).forEach(phase => {
                ws.mergeCells(r, 1, r, lastCol);
                const pc = ws.getCell(r, 1);
                pc.value = phase.phaseName || 'PHASE';
                pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.phaseFill } };
                pc.font = { bold: true, size: 10, color: white };
                pc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
                pc.border = allThin;
                ws.getRow(r).height = 18;
                r++;
                HALVES.forEach(half => renderPhaseHalf(phase, half));
                r++;  // spacer between phases
            });

            const buf = await wb.xlsx.writeBuffer();
            downloadBuffer(buf, `Spraying_GLY_ALLY_${year}.xlsx`);
            setStatus('rep-spray-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('Spraying report error:', e);
            setStatus('rep-spray-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // GENERATE ALL REPORTS → single ZIP
    // ══════════════════════════════════════════════════════════════════════

    // Registry of every report the "Generate All" feature can bundle.
    // `fn(year, month)` reuses each report's existing download generator; the
    // file it would normally save is captured (see generateAllReports) and zipped.
    const ALL_REPORT_DEFS = [
        { key: 'ytd',      label: '📈 Harvesting Performance YTD', fn: (y, m) => window.downloadYtdReport(y, m) },
        { key: 'rain',     label: '🌧 Rainfall',                   fn: (y, m) => window.downloadRainfallReport(y, m) },
        { key: 'spray',    label: '🌿 Spraying (annual)',          fn: (y) => window.downloadSprayingReport(y) },  // always full year — annual report
        { key: 'manuring', label: '🌿 Manuring (annual)',          fn: (y) => window._downloadManuringExcel(y) },  // always full year — annual report
        { key: 'ih',       label: '🐎 Iron Horse — Cost per FFB MT', fn: (y) => window.downloadIronHorseCostPerFFBMt(y) },
        { key: 'wages',    label: '💵 Rate of Wages',              fn: (y, m) => window.downloadWagesReport(y, m) },
        { key: 'wages_var', label: '⚖️ Wages Variance (est vs actual)', fn: (y, m) => window.downloadWagesVarianceReport(y, m) },
    ];

    // Runs each selected report generator, transparently intercepts the file it
    // produces (instead of saving it individually), and bundles everything into
    // one ZIP. No generator is modified — we patch URL.createObjectURL + the
    // anchor click for the duration of the run, then restore them.
    window.generateAllReports = async (year, month, selectedKeys, onStep) => {
        await ensureExcelJS();
        await ensureJSZip();

        const defs = ALL_REPORT_DEFS.filter(r => selectedKeys.includes(r.key));
        const captured = [];                 // {filename, url} in click order
        const blobMap = new Map();           // blob: url -> Blob (direct ref, survives revoke)

        const origCreate = URL.createObjectURL;
        const origRevoke = URL.revokeObjectURL;
        const origClick  = HTMLAnchorElement.prototype.click;

        URL.createObjectURL = function (obj) {
            const u = origCreate.call(URL, obj);
            if (obj instanceof Blob) blobMap.set(u, obj);
            return u;
        };
        URL.revokeObjectURL = function () { /* deferred during capture — keep blobs alive */ };
        HTMLAnchorElement.prototype.click = function () {
            if (this.download && typeof this.href === 'string' && this.href.indexOf('blob:') === 0) {
                captured.push({ filename: this.download || 'report.xlsx', url: this.href });
                return; // suppress the individual download; we'll zip it instead
            }
            return origClick.apply(this, arguments);
        };

        const results = [];
        try {
            for (const r of defs) {
                if (onStep) onStep(r.key, 'running');
                const before = captured.length;
                try {
                    await r.fn(year, month);
                    const ok = captured.length > before;
                    results.push({ key: r.key, ok, error: ok ? null : 'no data' });
                    if (onStep) onStep(r.key, ok ? 'done' : 'empty');
                } catch (e) {
                    results.push({ key: r.key, ok: false, error: (e && e.message) || String(e) });
                    if (onStep) onStep(r.key, 'error', (e && e.message) || String(e));
                }
            }
        } finally {
            URL.createObjectURL = origCreate;
            URL.revokeObjectURL = origRevoke;
            HTMLAnchorElement.prototype.click = origClick;
        }

        // Bundle whatever was captured
        const zip = new JSZip();
        let fileCount = 0;
        const usedNames = {};
        for (const c of captured) {
            const blob = blobMap.get(c.url);
            if (!blob) continue;
            let name = c.filename;
            if (usedNames[name]) name = name.replace(/(\.[^.]+)?$/, `_${usedNames[name] + 1}$1`); // de-dupe
            usedNames[c.filename] = (usedNames[c.filename] || 0) + 1;
            zip.file(name, blob);
            fileCount++;
        }
        // release the captured blob URLs now that we hold the Blobs
        for (const u of blobMap.keys()) { try { origRevoke.call(URL, u); } catch (e) { /* ignore */ } }

        if (fileCount === 0) return { zipDownloaded: false, fileCount: 0, results };

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `AntiGravity_Reports_${month}_${year}.zip`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);

        if (typeof window.logAudit === 'function') {
            window.logAudit('download', 'reports', zipName, `Bundle of ${fileCount} report(s)`);
        }
        return { zipDownloaded: true, fileCount, zipName, results };
    };

    // ══════════════════════════════════════════════════════════════════════
    // REPORTS PANEL UI
    // ══════════════════════════════════════════════════════════════════════

    window.renderReportsPanel = () => {
        const wrapper = document.getElementById('excel-reports-wrapper');
        if (!wrapper) return;

        const perfYears    = Object.keys(window.state.performance || {}).sort((a, b) => parseInt(b) - parseInt(a));
        const rainYears    = Object.keys(window.state.rainfall    || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        const sprayYears   = Object.keys(window.state.spraying    || {}).sort((a, b) => parseInt(b) - parseInt(a));
        const manuringYears = Object.keys(window.state.manuring  || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        if (!manuringYears.includes('2025')) manuringYears.unshift('2025');
        const ironHorseYears = Object.keys((window.state.ironHorse || {}).assets || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        const wagesYears = [...new Set([
            ...Object.keys(window.state.wages || {}).filter(k => /^\d{4}$/.test(k)),
            ...perfYears
        ])].sort((a, b) => parseInt(b) - parseInt(a));

        // Combined year list for the "Generate All" card (union of every report's years)
        const allYears = [...new Set([
            ...perfYears, ...rainYears, ...sprayYears, ...manuringYears, ...ironHorseYears, ...wagesYears
        ])].filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        const curMonth = MONTHS[new Date().getMonth()];

        const yearOpts  = years => years.map(y => `<option value="${y}">${y}</option>`).join('');
        const monthOpts = () => MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
        const SS = 'padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg-input,#fff);font-size:0.88rem;';
        const CARD = 'border:1px solid var(--border);border-radius:8px;padding:1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
        const noDataMsg = '<span style="font-size:0.82rem;color:#e67e22;">⚠ No data available. Please add data first.</span>';

        const ytdControls = perfYears.length
            ? `<select id="sel-ytd-yr" style="${SS}">${yearOpts(perfYears)}</select>
               <select id="sel-ytd-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-ytd" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-ytd-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const rainControls = rainYears.length
            ? `<select id="sel-rain-yr" style="${SS}">${yearOpts(rainYears)}</select>
               <select id="sel-rain-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-rain" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-rain-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        // Spraying is an ANNUAL report (the on-screen view shows the full year and
        // all extra chemicals), so default the month picker to "Full Year" — picking
        // a month gives an optional year-to-date cut. (Empty value = full year.)
        const sprayMonthOpts = `<option value="" selected>Full Year</option>`
            + MONTHS.map(m => `<option value="${m}">Up to ${m}</option>`).join('');
        const sprayControls = sprayYears.length
            ? `<select id="sel-spray-yr" style="${SS}">${yearOpts(sprayYears)}</select>
               <select id="sel-spray-mo" style="${SS}">${sprayMonthOpts}</select>
               <button id="btn-dl-spray" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-spray-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        // Manuring is an ANNUAL report (the on-screen view always shows the full
        // year), so default the month picker to "Full Year" — picking a month
        // gives an optional year-to-date cut. (Empty value = full year.)
        const manuringMonthOpts = `<option value="" selected>Full Year</option>`
            + MONTHS.map(m => `<option value="${m}">Up to ${m}</option>`).join('');
        const manuringControls = `<select id="sel-manuring-yr" style="${SS}">${yearOpts(manuringYears)}</select>
               <select id="sel-manuring-mo" style="${SS}">${manuringMonthOpts}</select>
               <button id="btn-dl-manuring" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-manuring-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`;

        const ironHorseControls = ironHorseYears.length
            ? `<select id="sel-ih-cpmt-yr" style="${SS}">${yearOpts(ironHorseYears)}</select>
               <button id="btn-dl-ih-cpmt" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-ih-cpmt-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const wagesControls = wagesYears.length
            ? `<select id="sel-wages-yr" style="${SS}">${yearOpts(wagesYears)}</select>
               <select id="sel-wages-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-wages" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-wages-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        wrapper.innerHTML = `
        <div style="padding:1.5rem;max-width:680px;">
          <h2 style="margin:0 0 0.25rem;color:var(--text-main);">📊 Reports</h2>
          <p style="color:var(--text-secondary);margin:0 0 1.75rem;font-size:0.85rem;">
            Download formatted Excel reports matching the official templates.
          </p>

          <div style="${CARD} border:2px solid var(--accent,#2563eb);">
            <h3 style="margin:0 0 0.35rem;font-size:1.02rem;">🗂️ Generate All Reports — one ZIP</h3>
            <p style="margin:0 0 0.9rem;color:var(--text-secondary);font-size:0.82rem;">
              Pick a year and month, choose which reports to include, then download them all bundled
              into a single ZIP. Annual reports (Spraying, Manuring, Iron Horse) use the year only.
            </p>
            ${allYears.length ? `
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;margin-bottom:0.8rem;">
              <label style="font-size:0.82rem;color:var(--text-secondary);">Year
                <select id="sel-all-yr" style="${SS} margin-left:4px;">${yearOpts(allYears)}</select></label>
              <label style="font-size:0.82rem;color:var(--text-secondary);">Month
                <select id="sel-all-mo" style="${SS} margin-left:4px;">${monthOpts()}</select></label>
              <button id="btn-all-toggle" type="button" style="${SS} cursor:pointer;">Select all / none</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem 1rem;margin-bottom:0.95rem;font-size:0.85rem;">
              ${ALL_REPORT_DEFS.map(r => `<label style="display:flex;align-items:center;gap:0.45rem;cursor:pointer;"><input type="checkbox" class="chk-all-rep" id="chk-all-${r.key}" value="${r.key}" checked> ${r.label}</label>`).join('')}
            </div>
            <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
              <button id="btn-gen-all" class="btn-primary" style="padding:0.5rem 1.3rem;">⬇ Generate ZIP</button>
              <span id="rep-all-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>
            </div>
            <div id="rep-all-results" style="margin-top:0.6rem;font-size:0.8rem;color:var(--text-secondary);line-height:1.5;"></div>
            ` : noDataMsg}
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">📈 Harvesting Performance — Overall by Gang YTD</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Yield-to-date comparison of current year vs previous year, by block and O/P phase.
              Select the year and up-to month.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${ytdControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌧 Rainfall — Current Year vs Previous Year</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Previous year shows all 12 months. Current year shows up to the selected month;
              remaining months are black-filled.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${rainControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌿 Spraying — GLY + ALLY Annual Report</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year GLY, ALY and any extra chemicals inline per block and O/P phase,
              mirroring the on-screen layout (split JAN–JUN and JUL–DEC).
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${sprayControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌿 Manuring — Annual Fertilizer Application Report</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year fertilizer application per block and O/P phase across all 5 phases.
              Color-coded by fertilizer type (MOP, SATO, COM, SPEC).
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${manuringControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🐎 Iron Horse — Expenses by Cost per FFB MT</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year cost per FFB MT (RM/MT) per gang and asset, with FFB MT and total
              expenses sub-rows. Combines Iron Horse expenses with harvesting performance.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${ironHorseControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">💵 Rate of Wages — Monthly Gang Payment</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Per-gang payment for the selected month: FFB tonnage × rate, less daily-rate
              blocks and unripe-bunch penalty, with a grand total.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${wagesControls}
            </div>
          </div>

          <p style="color:var(--text-secondary);font-size:0.78rem;margin-top:0.5rem;">
            ℹ️ Reports use the official Excel templates from "Report samples/" as the base.
            The app must be served via HTTP (not file://) for template loading to work.
          </p>
        </div>`;

        // ── Generate All Reports (ZIP) ──
        const moAll = document.getElementById('sel-all-mo');
        if (moAll) moAll.value = curMonth;          // default to current month
        const btnAllToggle = document.getElementById('btn-all-toggle');
        if (btnAllToggle) btnAllToggle.onclick = () => {
            const boxes = Array.from(document.querySelectorAll('.chk-all-rep'));
            const allOn = boxes.every(b => b.checked);
            boxes.forEach(b => { b.checked = !allOn; });
        };
        const btnGenAll = document.getElementById('btn-gen-all');
        if (btnGenAll) btnGenAll.onclick = async () => {
            const yr = document.getElementById('sel-all-yr').value;
            const mo = document.getElementById('sel-all-mo').value;
            const keys = Array.from(document.querySelectorAll('.chk-all-rep')).filter(b => b.checked).map(b => b.value);
            if (!yr || !mo) return;
            if (!keys.length) { setStatus('rep-all-status', '⚠ Select at least one report.', true); return; }
            const labelFor = {}; ALL_REPORT_DEFS.forEach(r => { labelFor[r.key] = r.label; });
            const resEl = document.getElementById('rep-all-results');
            const lines = {};
            const paint = () => { if (resEl) resEl.innerHTML = keys.map(k => `<div>${lines[k] || ('• ' + labelFor[k] + ' — queued')}</div>`).join(''); };
            keys.forEach(k => { lines[k] = '• ' + labelFor[k] + ' — queued'; });
            paint();
            btnGenAll.disabled = true;
            const oldTxt = btnGenAll.textContent;
            btnGenAll.textContent = '⏳ Generating…';
            setStatus('rep-all-status', 'Building ZIP…');
            try {
                const summary = await window.generateAllReports(yr, mo, keys, (key, st, msg) => {
                    const lbl = labelFor[key];
                    if (st === 'running')      lines[key] = '⏳ ' + lbl + ' — generating…';
                    else if (st === 'done')    lines[key] = '✅ ' + lbl;
                    else if (st === 'empty')   lines[key] = '⚠ ' + lbl + ' — no data, skipped';
                    else if (st === 'error')   lines[key] = '❌ ' + lbl + ' — ' + (msg || 'failed');
                    paint();
                });
                if (summary.zipDownloaded) {
                    setStatus('rep-all-status', `✅ ${summary.fileCount} report(s) zipped → ${summary.zipName}`);
                } else {
                    setStatus('rep-all-status', '⚠ Nothing to bundle — no data for the selected period.');
                }
            } catch (e) {
                setStatus('rep-all-status', '❌ ' + ((e && e.message) || e));
            } finally {
                btnGenAll.disabled = false;
                btnGenAll.textContent = oldTxt;
            }
        };

        const btnYtd = document.getElementById('btn-dl-ytd');
        if (btnYtd) btnYtd.onclick = () => {
            const yr = document.getElementById('sel-ytd-yr').value;
            const mo = document.getElementById('sel-ytd-mo').value;
            if (yr && mo) window.downloadYtdReport(yr, mo);
        };
        const btnRain = document.getElementById('btn-dl-rain');
        if (btnRain) btnRain.onclick = () => {
            const yr = document.getElementById('sel-rain-yr').value;
            const mo = document.getElementById('sel-rain-mo').value;
            if (yr && mo) window.downloadRainfallReport(yr, mo);
        };
        const btnSpray = document.getElementById('btn-dl-spray');
        if (btnSpray) btnSpray.onclick = () => {
            const yr = document.getElementById('sel-spray-yr').value;
            const mo = document.getElementById('sel-spray-mo').value;  // '' = full year
            if (yr) window.downloadSprayingReport(yr, mo);
        };

        const btnManuring = document.getElementById('btn-dl-manuring');
        if (btnManuring) btnManuring.onclick = async () => {
            const yr = document.getElementById('sel-manuring-yr').value;
            const mo = document.getElementById('sel-manuring-mo').value;  // '' = full year
            if (!yr) return;
            const statusEl = document.getElementById('rep-manuring-status');
            if (statusEl) statusEl.textContent = '';
            btnManuring.disabled = true;
            btnManuring.textContent = '⏳ Generating...';
            try {
                await window._downloadManuringExcel(yr, mo);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnManuring.disabled = false;
                btnManuring.textContent = '⬇ Download Excel';
            }
        };

        const btnIhCpmt = document.getElementById('btn-dl-ih-cpmt');
        if (btnIhCpmt) btnIhCpmt.onclick = async () => {
            const yr = document.getElementById('sel-ih-cpmt-yr').value;
            if (!yr) return;
            const statusEl = document.getElementById('rep-ih-cpmt-status');
            if (statusEl) statusEl.textContent = '';
            btnIhCpmt.disabled = true;
            btnIhCpmt.textContent = '⏳ Generating...';
            try {
                await window.downloadIronHorseCostPerFFBMt(yr);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnIhCpmt.disabled = false;
                btnIhCpmt.textContent = '⬇ Download Excel';
            }
        };

        const btnWages = document.getElementById('btn-dl-wages');
        if (btnWages) btnWages.onclick = async () => {
            const yr = document.getElementById('sel-wages-yr').value;
            const mo = document.getElementById('sel-wages-mo').value;
            if (!yr || !mo) return;
            const statusEl = document.getElementById('rep-wages-status');
            if (statusEl) statusEl.textContent = '';
            btnWages.disabled = true;
            btnWages.textContent = '⏳ Generating...';
            try {
                await window.downloadWagesReport(yr, mo);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnWages.disabled = false;
                btnWages.textContent = '⬇ Download Excel';
            }
        };
    };

})();
