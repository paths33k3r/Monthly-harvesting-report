// =====================================================================
// render_hyr.js — Half-Yearly Report module (Tree Planting workspace)
// ---------------------------------------------------------------------
// Digitises the "Half-Yearly Report" the licensee submits to the Sarawak
// Director of Forests every 6 months (Licence for Planted Forest). The
// source workbook has ~23 sheets of wildly different shapes — most are
// maintained by hand in Excel and just need their period stamp updated
// and the file renamed each half-year; a handful are genuine per-period
// DATA (planting progress, roads, silviculture, coupe summary) that the
// user wants live-editable in the app.
//
// PHASE 1 (this file): the "Report" tab (period picker + master-file
// import/export) and ONE live appendix — Appendix 9 (all-coupes planting
// summary) — as a pilot for the row-cloning export engine before the
// other three live appendices (4A/4B, 5, 6A/6B) are built on top of it.
//
// Master file requirement: the export engine edits the workbook's XML
// directly (JSZip) to preserve exact regulatory formatting — this only
// works on the ZIP-based .xlsx container, not legacy binary .xls. Users
// must upload .xlsx (Excel "Save As" once converts an old .xls losslessly).
//
// Storage: Firebase  shared/hyr_data          (window._hyrDb) — period
//          data + master-file metadata (small, JSON).
//          shared/hyr_master_file             — the master workbook itself,
//          stored as a single data URL, kept OUT of the main record (like
//          weekly_images / tree_logs_invoice_files) so hyr_data saves stay tiny.
// Access:  menu key 'hyr' (window._canEdit / _applyReadOnly). Export is
//          available to read-only users; import/edit are gated.
// =====================================================================

(function () {
    'use strict';

    const HYR_HALVES = [
        { key: 'JAN-JUN', label: 'January - June', short: 'Jan-Jun' },
        { key: 'JUL-DEC', label: 'July - December', short: 'Jul-Dec' },
    ];
    const HYR_HALF_OF = {}; HYR_HALVES.forEach(h => { HYR_HALF_OF[h.key] = h; });

    // ── Small helpers ───────────────────────────────────────────────────
    const hyrEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const hyrNum = (v) => {
        if (v && typeof v === 'object' && 'result' in v) v = v.result;
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };
    const hyrText = (v) => {
        if (v && typeof v === 'object') {
            if ('result' in v) v = v.result;
            else if ('text' in v) v = v.text;
            else if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
        }
        return String(v == null ? '' : v).trim();
    };
    const hyrNormHeader = (h) => hyrText(h).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hyrCurrentYear = () => String(new Date().getFullYear());
    const hyrCurrentHalf = () => (new Date().getMonth() < 6 ? 'JAN-JUN' : 'JUL-DEC');
    const hyrPeriodKey = (year, half) => `${year}-${half}`;
    const hyrUid = () => 'hyr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // ── State access ─────────────────────────────────────────────────────
    const hyrEnsure = () => {
        const s = window.state;
        if (!s.hyr || typeof s.hyr !== 'object') s.hyr = {};
        const h = s.hyr;
        if (!h.year || !/^\d{4}$/.test(h.year)) h.year = hyrCurrentYear();
        if (!h.half || !HYR_HALF_OF[h.half]) h.half = hyrCurrentHalf();
        if (!h.master || typeof h.master !== 'object') h.master = null;
        if (!h.periods || typeof h.periods !== 'object') h.periods = {};
        return h;
    };
    const hyrPeriodObj = (year, half) => {
        const h = hyrEnsure();
        const key = hyrPeriodKey(year, half);
        if (!h.periods[key]) h.periods[key] = {};
        return h.periods[key];
    };
    const hyrAppendix9 = (year, half) => {
        const p = hyrPeriodObj(year, half);
        if (!p.appendix9 || typeof p.appendix9 !== 'object') p.appendix9 = { coupes: [] };
        if (!Array.isArray(p.appendix9.coupes)) p.appendix9.coupes = [];
        return p.appendix9;
    };
    const hyrYearList = () => {
        const h = hyrEnsure();
        const set = new Set(Object.keys(h.periods).map(k => k.slice(0, 4)).filter(y => /^\d{4}$/.test(y)));
        set.add(h.year);
        set.add(hyrCurrentYear());
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // ── Firebase save ───────────────────────────────────────────────────
    const saveHyrData = (silent) => {
        const db = window._hyrDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — not saved.', 'error'); return Promise.resolve(); }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/hyr_data').set(JSON.stringify(window.state.hyr))
            .then(() => { if (!silent && window.notify) window.notify('Half-Yearly Report data saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveHyrData = saveHyrData;

    // ── Lazy CDN loaders ────────────────────────────────────────────────
    const hyrEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };
    const hyrEnsureJSZip = async () => {
        if (typeof window.JSZip !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load JSZip'));
            document.head.appendChild(s);
        });
    };

    // ── Master file storage (shared/hyr_master_file — kept out of hyr_data) ──
    const hyrBlobToDataUrl = (blob) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('Could not read the file'));
        r.readAsDataURL(blob);
    });
    const hyrDataUrlToArrayBuffer = async (dataUrl) => {
        const resp = await fetch(dataUrl);
        return resp.arrayBuffer();
    };
    const hyrSaveMasterFile = async (dataUrl) => {
        const db = window._hyrDb;
        if (!db) throw new Error('Not connected to cloud.');
        await db.ref('shared/hyr_master_file').set(dataUrl);
    };
    const hyrLoadMasterFile = async () => {
        const db = window._hyrDb;
        if (!db) throw new Error('Not connected to cloud.');
        const snap = await db.ref('shared/hyr_master_file').once('value');
        const dataUrl = snap.val();
        if (!dataUrl) throw new Error('No master template imported yet — use Import on the Report tab first.');
        return hyrDataUrlToArrayBuffer(dataUrl);
    };

    // =====================================================================
    // Appendix 9 — column spec + import parser + row-clone export columns
    // =====================================================================
    // "PROGRESS OF PLANTING SUMMARY" — one row per coupe. Columns E/F/G are
    // three mutually-exclusive land-status buckets that sum to H (Total);
    // I..P are the planting-progress breakdown that sums to Q (Total). Both
    // totals are DERIVED (computed on display/export), not stored fields.
    const HYR_A9_COLS = [
        { col: 'A', field: 'coupeNo', header: 'Coupe No.', type: 'str', w: 14 },
        { col: 'B', field: 'scheduledYear', header: 'Scheduled Yr. of Planting', type: 'str', w: 13 },
        { col: 'C', field: 'actualYear', header: 'Actual Planting Yr.', type: 'str', w: 15 },
        { col: 'D', field: 'typeOfPlantation', header: 'Type of Plantation', type: 'str', w: 12 },
        { col: 'E', field: 'areaNotUnderFTL', header: 'Area not under FTL (Ha)', type: 'num', w: 11 },
        { col: 'F', field: 'area', header: 'Area (Ha)', type: 'num', w: 9 },
        { col: 'G', field: 'areaUnderFTLOthers', header: 'Area under FTL of others (Ha)', type: 'num', w: 12 },
        { col: 'I', field: 'clearing', header: 'Clearing in progress / yet to start (Ha)', type: 'num', w: 12 },
        { col: 'J', field: 'planted1st', header: '1st Rotation Planted (Ha)', type: 'num', w: 11 },
        { col: 'K', field: 'planted2nd', header: '2nd Rotation Planted (Ha)', type: 'num', w: 11 },
        { col: 'L', field: 'enrichment', header: 'Enrichment Area (Ha)', type: 'num', w: 11 },
        { col: 'M', field: 'protection', header: 'Protection Area (Ha)', type: 'num', w: 11 },
        { col: 'N', field: 'notPlantedTerIV', header: 'Not Planted - Ter. IV (Ha)', type: 'num', w: 11 },
        { col: 'O', field: 'notPlantedBuffer', header: 'Not Planted - Buffer/Others (Ha)', type: 'num', w: 12 },
        { col: 'P', field: 'notPlantedNative', header: 'Not Planted - Native Problem (Ha)', type: 'num', w: 12 },
        { col: 'R', field: 'groundVerification', header: 'Ground Verification (Yes/No)', type: 'str', w: 11 },
        { col: 'S', field: 'remarks', header: 'Remarks', type: 'str', w: 22 },
    ];
    // Derived columns computed on export/display — never stored on the record.
    const hyrA9AreaTotal = (rec) => hyrNum(rec.areaNotUnderFTL) + hyrNum(rec.area) + hyrNum(rec.areaUnderFTLOthers);
    const hyrA9ProgressTotal = (rec) => ['clearing', 'planted1st', 'planted2nd', 'enrichment', 'protection', 'notPlantedTerIV', 'notPlantedBuffer', 'notPlantedNative']
        .reduce((s, f) => s + hyrNum(rec[f]), 0);
    // Full column list including the two derived/computed columns, for the row-clone engine.
    const HYR_A9_CLONE_COLS = [
        ...HYR_A9_COLS,
        { col: 'H', type: 'num', compute: hyrA9AreaTotal },
        { col: 'Q', type: 'num', compute: hyrA9ProgressTotal },
    ];

    // Import: find "Appendix 9" sheet, locate the header by signature, read
    // coupe rows until a blank row or the "Gross" totals row.
    const hyrParseAppendix9 = (workbook) => {
        const ws = workbook.worksheets.find(w => hyrNormHeader(w.name) === 'APPENDIX9');
        if (!ws) return null;

        let headerRow = -1;
        for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
            const row = ws.getRow(r);
            const a = hyrNormHeader(row.getCell(1).value);
            const c = hyrNormHeader(row.getCell(3).value);
            if (a === 'COUPENO' && c.indexOf('ACTUALPLANTINGYEAR') !== -1) { headerRow = r; break; }
        }
        if (headerRow === -1) return null;
        const dataStart = headerRow + 3; // 3-row header block (title / sub-header / J-K split)

        const coupes = [];
        const colIdx = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, I: 9, J: 10, K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, R: 18, S: 19 };
        const get = (row, col) => row.getCell(colIdx[col]).value;

        for (let r = dataStart; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const coupeNo = hyrText(get(row, 'A'));
            if (hyrNormHeader(coupeNo) === 'GROSS') break;
            const anyVal = ['B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S']
                .some(c => hyrText(get(row, c)) !== '');
            if (!coupeNo && !anyVal) break; // spacer row → end of table

            coupes.push({
                id: hyrUid(),
                coupeNo,
                scheduledYear: hyrText(get(row, 'B')),
                actualYear: hyrText(get(row, 'C')),
                typeOfPlantation: hyrText(get(row, 'D')),
                areaNotUnderFTL: hyrNum(get(row, 'E')),
                area: hyrNum(get(row, 'F')),
                areaUnderFTLOthers: hyrNum(get(row, 'G')),
                clearing: hyrNum(get(row, 'I')),
                planted1st: hyrNum(get(row, 'J')),
                planted2nd: hyrNum(get(row, 'K')),
                enrichment: hyrNum(get(row, 'L')),
                protection: hyrNum(get(row, 'M')),
                notPlantedTerIV: hyrNum(get(row, 'N')),
                notPlantedBuffer: hyrNum(get(row, 'O')),
                notPlantedNative: hyrNum(get(row, 'P')),
                groundVerification: hyrText(get(row, 'R')),
                remarks: hyrText(get(row, 'S')),
            });
        }
        return coupes;
    };

    // =====================================================================
    // Master file import — reads the whole workbook once: extracts Appendix 9
    // data AND stores the raw bytes as the new master template for export.
    // =====================================================================
    const importHyrMaster = async (file, year, half) => {
        if (!file) return;
        if (typeof window._canEdit === 'function' && !window._canEdit('hyr')) {
            if (window.notify) window.notify('You do not have edit access for Half-Yearly Report.', 'warn');
            return;
        }
        if (!/\.xlsx$/i.test(file.name)) {
            if (window.notify) window.notify('Please upload .xlsx (Excel: File → Save As → .xlsx). Legacy .xls cannot be re-exported with exact formatting.', 'error');
            return;
        }
        try {
            const buf = await file.arrayBuffer();
            await hyrEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            await wb.xlsx.load(buf);

            const coupes = hyrParseAppendix9(wb);
            if (!coupes) throw new Error('Could not find an "Appendix 9" sheet with the expected headers ("Coupe No.", "Actual planting year", …) in this workbook.');

            const prevCount = hyrAppendix9(year, half).coupes.length;
            let msg = `Import master file for ${HYR_HALF_OF[half].short} ${year}:\n\n• Appendix 9: ${coupes.length} coupe(s)\n• This file becomes the master template for Export (all other sheets carried through as-is).`;
            if (prevCount) msg += `\n\n⚠ This REPLACES the existing ${prevCount} coupe(s) for this period.`;
            if (!confirm(msg + '\n\nProceed?')) return;

            const dataUrl = await hyrBlobToDataUrl(file);
            await hyrSaveMasterFile(dataUrl);

            const h = hyrEnsure();
            h.master = { fileName: file.name, importedAt: new Date().toISOString(), importedBy: window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'import' };
            hyrAppendix9(year, half).coupes = coupes;
            await saveHyrData(false);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'hyr', `${HYR_HALF_OF[half].short} ${year}: master file + ${coupes.length} Appendix 9 coupes`, year);
            window.renderHyrReportView();
            if (window.notify) window.notify(`Imported master file — ${coupes.length} coupe(s) in Appendix 9.`, 'success');
        } catch (err) {
            console.error('HYR master import error:', err);
            if (window.notify) window.notify('Import error: ' + err.message, 'error');
        }
    };
    window.importHyrMaster = importHyrMaster;

    // =====================================================================
    // Export engine — row-cloning XML surgery (generic, reusable per appendix)
    // =====================================================================
    const hyrXmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Locate a worksheet's XML path inside the zip by its display name
    // (matches workbook.xml's <sheet name=... r:id=...> then resolves the
    // r:id via workbook.xml.rels — attribute order in the <sheet> tag isn't
    // guaranteed, so both name and r:id are extracted independently).
    const hyrFindSheetPath = async (zip, sheetName) => {
        const wbXml = await zip.file('xl/workbook.xml').async('string');
        const tagRe = /<sheet\b[^>]*\/>/g;
        let m, target = null;
        while ((m = tagRe.exec(wbXml))) {
            const tag = m[0];
            const nameM = /name="([^"]*)"/.exec(tag);
            if (!nameM || hyrNormHeader(nameM[1].replace(/&amp;/g, '&')) !== hyrNormHeader(sheetName)) continue;
            const ridM = /r:id="([^"]*)"/.exec(tag);
            if (ridM) target = ridM[1];
            break;
        }
        if (!target) return null;
        const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
        const relRe = new RegExp(`<Relationship[^>]*Id="${target}"[^>]*/>`);
        const relM = relRe.exec(relsXml);
        if (!relM) return null;
        const tgtM = /Target="([^"]*)"/.exec(relM[0]);
        if (!tgtM) return null;
        return 'xl/' + tgtM[1].replace(/^\.?\/?/, '');
    };

    // The row-count-safe regenerator: rebuilds the data-row region of a sheet
    // from app state, cloning per-column style ids from the template's own
    // data rows (so fonts/borders/number formats survive even though the
    // row COUNT can differ from the template) and shifting every row/merge
    // reference below the managed block by the resulting delta.
    //
    // opts: { dataStartRow, origDataRowCount, hasTotalsRow, columns, records, totalsFn }
    //   columns:  [{col,field,type} | {col,type,compute}]  (compute → derived cell)
    //   totalsFn: records => { COL: {value, type?} }  (label cell included, e.g. A:{value:'Gross',type:'str'})
    const hyrRegenSheetRows = (sheetXml, opts) => {
        const { dataStartRow, origDataRowCount, hasTotalsRow, columns, records, totalsFn } = opts;
        const origTotalsRowNum = dataStartRow + origDataRowCount;
        const afterBlockRowNum = origTotalsRowNum + (hasTotalsRow ? 1 : 0);

        const sdMatch = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml);
        if (!sdMatch) throw new Error('Could not locate sheet data — the master file may be corrupted.');
        const rowRe = /<row r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
        const rows = [];
        let rm;
        while ((rm = rowRe.exec(sdMatch[1]))) rows.push({ num: parseInt(rm[1], 10), xml: rm[0] });

        const headerRows = rows.filter(r => r.num < dataStartRow);
        const dataRowsOrig = rows.filter(r => r.num >= dataStartRow && r.num < origTotalsRowNum);
        const totalsRowOrig = rows.find(r => r.num === origTotalsRowNum) || null;
        const afterRows = rows.filter(r => r.num >= afterBlockRowNum);

        // Per-column style id (first non-empty occurrence in the template's data rows).
        const colStyle = {}, totalsColStyle = {};
        columns.forEach(c => {
            for (const r of dataRowsOrig) {
                const cm = new RegExp(`<c r="${c.col}\\d+"([^>]*)>`).exec(r.xml);
                if (cm) { const sm = /s="(\d+)"/.exec(cm[1]); colStyle[c.col] = sm ? sm[1] : null; break; }
            }
            if (totalsRowOrig) {
                const cm = new RegExp(`<c r="${c.col}\\d+"([^>]*)>`).exec(totalsRowOrig.xml);
                if (cm) { const sm = /s="(\d+)"/.exec(cm[1]); totalsColStyle[c.col] = sm ? sm[1] : null; }
            }
        });
        const dataRowHt = dataRowsOrig[0] ? (/ht="([\d.]+)"/.exec(dataRowsOrig[0].xml) || [])[1] : null;
        const totalsRowHt = totalsRowOrig ? (/ht="([\d.]+)"/.exec(totalsRowOrig.xml) || [])[1] : null;

        const buildCell = (col, rowNum, val, type, styleId) => {
            if (val === undefined || val === null || val === '') return '';
            const ref = col + rowNum;
            const sAttr = styleId ? ` s="${styleId}"` : '';
            if (type === 'str') return `<c r="${ref}"${sAttr} t="str"><v>${hyrXmlEsc(val)}</v></c>`;
            const n = typeof val === 'number' ? val : parseFloat(val);
            if (isNaN(n)) return '';
            return `<c r="${ref}"${sAttr}><v>${n}</v></c>`;
        };

        let newRowsXml = '';
        records.forEach((rec, i) => {
            const rowNum = dataStartRow + i;
            let cells = '';
            columns.forEach(c => {
                const val = c.compute ? c.compute(rec) : rec[c.field];
                cells += buildCell(c.col, rowNum, val, c.type, colStyle[c.col]);
            });
            newRowsXml += `<row r="${rowNum}"${dataRowHt ? ` ht="${dataRowHt}" customHeight="1"` : ''}>${cells}</row>`;
        });

        let newTotalsXml = '';
        if (hasTotalsRow && totalsFn) {
            const totalsRowNum = dataStartRow + records.length;
            const totalsVals = totalsFn(records);
            let cells = '';
            columns.forEach(c => {
                const tv = totalsVals[c.col];
                if (tv === undefined) return;
                cells += buildCell(c.col, totalsRowNum, tv.value, tv.type || c.type, totalsColStyle[c.col] || colStyle[c.col]);
            });
            newTotalsXml = `<row r="${totalsRowNum}"${totalsRowHt ? ` ht="${totalsRowHt}" customHeight="1"` : ''}>${cells}</row>`;
        }

        const newAfterStart = dataStartRow + records.length + (hasTotalsRow ? 1 : 0);
        const delta = newAfterStart - afterBlockRowNum;

        const shiftRowXml = (xml, newNum) => xml
            .replace(/^<row r="\d+"/, `<row r="${newNum}"`)
            .replace(/ r="([A-Z]+)\d+"/g, (mm, col) => ` r="${col}${newNum}"`);

        let shiftedAfterXml = '';
        afterRows.forEach(r => { shiftedAfterXml += shiftRowXml(r.xml, r.num + delta); });

        const newInner = headerRows.map(r => r.xml).join('') + newRowsXml + newTotalsXml + shiftedAfterXml;
        let newSheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${newInner}</sheetData>`);

        newSheetXml = newSheetXml.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (mm, c1, r1, c2, r2) => {
            r1 = parseInt(r1, 10); r2 = parseInt(r2, 10);
            if (r1 >= afterBlockRowNum) { r1 += delta; r2 += delta; }
            return `<mergeCell ref="${c1}${r1}:${c2}${r2}"/>`;
        });
        newSheetXml = newSheetXml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (mm, c1, r1, c2, r2) => {
            const endRow = Math.max(parseInt(r2, 10) + delta, dataStartRow + records.length + (hasTotalsRow ? 1 : 0));
            return `<dimension ref="${c1}${r1}:${c2}${endRow}"/>`;
        });
        return newSheetXml;
    };

    const hyrA9Totals = (records) => {
        const sum = (f) => records.reduce((s, r) => s + hyrNum(r[f]), 0);
        const E = sum('areaNotUnderFTL'), F = sum('area'), G = sum('areaUnderFTLOthers');
        const I = sum('clearing'), J = sum('planted1st'), K = sum('planted2nd'), L = sum('enrichment'),
            M = sum('protection'), N = sum('notPlantedTerIV'), O = sum('notPlantedBuffer'), P = sum('notPlantedNative');
        return {
            A: { value: 'Gross', type: 'str' },
            E: { value: E }, F: { value: F }, G: { value: G }, H: { value: E + F + G },
            I: { value: I }, J: { value: J }, K: { value: K }, L: { value: L },
            M: { value: M }, N: { value: N }, O: { value: O }, P: { value: P },
            Q: { value: I + J + K + L + M + N + O + P },
        };
    };

    const hyrMonthAbbrevOf = (half) => {
        const [a, b] = half === 'JAN-JUN' ? ['Jan', 'Jun'] : ['Jul', 'Dec'];
        return { a, b };
    };

    window.downloadHyrReport = async (year, half) => {
        try {
            await hyrEnsureJSZip();
            const buf = await hyrLoadMasterFile();
            const zip = await window.JSZip.loadAsync(buf);

            const a9Path = await hyrFindSheetPath(zip, 'Appendix 9');
            if (a9Path && zip.file(a9Path)) {
                const coupes = hyrAppendix9(year, half).coupes;
                let xml = await zip.file(a9Path).async('string');
                xml = hyrRegenSheetRows(xml, {
                    dataStartRow: 4, origDataRowCount: 13, hasTotalsRow: true,
                    columns: HYR_A9_CLONE_COLS, records: coupes, totalsFn: hyrA9Totals,
                });
                zip.file(a9Path, xml);
            }

            const out = await zip.generateAsync({ type: 'blob' });
            const { a, b } = hyrMonthAbbrevOf(half);
            const filename = `HYR (${a}-${b} ${year}).xlsx`;
            const url = URL.createObjectURL(out);
            const link = document.createElement('a');
            link.href = url; link.download = filename;
            document.body.appendChild(link); link.click();
            setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
            if (typeof window.logAudit === 'function') window.logAudit('download', 'hyr', filename, year);
            if (window.notify) window.notify(`Exported ${filename}.`, 'success');
        } catch (err) {
            console.error('HYR export error:', err);
            if (window.notify) window.notify('Export error: ' + err.message, 'error');
        }
    };

    // =====================================================================
    // Views
    // =====================================================================
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;';

    // ── Report tab ──────────────────────────────────────────────────────
    window.renderHyrReportView = () => {
        const host = document.getElementById('hyr-report-wrapper');
        if (!host) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const years = hyrYearList();

        const yearOpts = years.map(y => `<option value="${y}" ${y === h.year ? 'selected' : ''}>${y}</option>`).join('');
        const halfOpts = HYR_HALVES.map(hf => `<option value="${hf.key}" ${hf.key === h.half ? 'selected' : ''}>${hyrEsc(hf.label)}</option>`).join('');

        const masterInfo = h.master
            ? `imported <em>${hyrEsc(h.master.fileName)}</em> on ${hyrEsc(String(h.master.importedAt).slice(0, 10))} by ${hyrEsc(h.master.importedBy)}`
            : 'no master template imported yet';

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1100px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">📄 Half-Yearly Report</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Submission to the Director of Forests. Import the filled workbook (<strong>.xlsx only</strong> — Excel:
            File → Save As → .xlsx if you still have the old .xls) to set the master template and pull in
            Appendix 9's coupe data; Export rebuilds the full workbook with Appendix 9 refreshed from the app and
            renames it to match the period.
          </p>

          <div style="${CARD}">
            <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:0.9rem;">
              <label style="font-size:0.82rem; color:var(--text-secondary);">Year
                <select id="hyr-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
              <label style="font-size:0.82rem; color:var(--text-secondary);">Half
                <select id="hyr-half" style="${SS} margin-left:4px;">${halfOpts}</select></label>
              <div style="flex:1;"></div>
              <button id="hyr-import" class="btn-primary" style="padding:0.45rem 1rem; ${canEdit ? '' : 'opacity:.5; cursor:not-allowed;'}" ${canEdit ? '' : 'disabled'} title="${canEdit ? 'Import the filled HYR workbook (.xlsx)' : 'You do not have edit access for Half-Yearly Report'}">📥 Import Master (.xlsx)</button>
              <button id="hyr-export" style="${BTN}">📤 Export</button>
              <input type="file" id="hyr-import-input" accept=".xlsx" style="display:none;">
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">Master template: ${masterInfo}</div>
          </div>

          <div style="${CARD} background:var(--bg-main,#f7f9f7);">
            <strong>Phase 1 scope:</strong> Appendix 9 (Planting Summary) is live-editable — see the sub-tab.
            All other sheets (FRONT, Appendix 1–8, 10–12, Bamboo, PLANTED AREA, Appendix 13–16) are carried
            through from the master template exactly as imported.
          </div>
        </div>`;

        host.querySelector('#hyr-year').onchange = (e) => { h.year = e.target.value; saveHyrData(true); window.renderHyrReportView(); };
        host.querySelector('#hyr-half').onchange = (e) => { h.half = e.target.value; saveHyrData(true); window.renderHyrReportView(); };

        host.querySelector('#hyr-export').onclick = async () => {
            const btn = host.querySelector('#hyr-export');
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ …';
            try { await window.downloadHyrReport(h.year, h.half); }
            finally { btn.disabled = false; btn.textContent = old; }
        };

        if (canEdit) {
            const fin = host.querySelector('#hyr-import-input');
            host.querySelector('#hyr-import').onclick = () => fin.click();
            fin.onchange = async () => {
                const f = fin.files[0]; fin.value = '';
                if (!f) return;
                const btn = host.querySelector('#hyr-import');
                btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ …';
                try { await importHyrMaster(f, h.year, h.half); }
                finally { btn.disabled = false; btn.textContent = old; }
            };
        }
    };

    // ── Appendix 9 tab ──────────────────────────────────────────────────
    let _hyrA9EditId = null; // coupe id being edited (null = not editing / new-row form closed)

    window.renderHyrAppendix9View = () => {
        const host = document.getElementById('hyr-appendix9-wrapper');
        if (!host) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const years = hyrYearList();
        const yearOpts = years.map(y => `<option value="${y}" ${y === h.year ? 'selected' : ''}>${y}</option>`).join('');
        const halfOpts = HYR_HALVES.map(hf => `<option value="${hf.key}" ${hf.key === h.half ? 'selected' : ''}>${hyrEsc(hf.label)}</option>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1500px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">📊 Appendix 9: Planting Summary</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Progress of planting, per coupe, for the period below. Imported from the master workbook on the
            Report tab — add or correct rows here without re-uploading the whole file.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="hyr9-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Half
              <select id="hyr9-half" style="${SS} margin-left:4px;">${halfOpts}</select></label>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="hyr9-add" class="btn-primary" style="padding:0.45rem 1rem;">➕ Add coupe</button>` : ''}
          </div>
          <div id="hyr9-body"></div>
        </div>`;

        host.querySelector('#hyr9-year').onchange = (e) => { h.year = e.target.value; saveHyrData(true); _hyrA9EditId = null; window.renderHyrAppendix9View(); };
        host.querySelector('#hyr9-half').onchange = (e) => { h.half = e.target.value; saveHyrData(true); _hyrA9EditId = null; window.renderHyrAppendix9View(); };
        const addBtn = host.querySelector('#hyr9-add');
        if (addBtn) addBtn.onclick = () => { _hyrA9EditId = 'new'; hyr9RenderBody(); };

        hyr9RenderBody();
    };

    const hyr9FieldRow = (label, key, val, type) => `
        <label style="display:flex; flex-direction:column; gap:2px; font-size:0.78rem; color:var(--text-secondary);">
          ${hyrEsc(label)}
          <input data-field="${key}" type="${type === 'num' ? 'number' : 'text'}" ${type === 'num' ? 'step="0.01"' : ''}
            value="${hyrEsc(val == null ? '' : val)}" style="${SS}">
        </label>`;

    const hyr9RenderForm = (rec) => {
        const html = HYR_A9_COLS.map(c => hyr9FieldRow(c.header, c.field, rec[c.field], c.type)).join('');
        return `
        <div style="${CARD} border-color:var(--accent-color,#16a34a);">
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px,1fr)); gap:0.6rem 0.8rem; margin-bottom:0.8rem;">
            ${html}
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button id="hyr9-save" class="btn-primary" style="padding:0.4rem 1rem;">💾 Save</button>
            <button id="hyr9-cancel" style="${BTN}">Cancel</button>
          </div>
        </div>`;
    };

    const hyr9RenderBody = () => {
        const body = document.getElementById('hyr9-body');
        if (!body) return;
        const state = window.state;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const a9 = hyrAppendix9(h.year, h.half);
        const coupes = a9.coupes;

        let formHtml = '';
        if (_hyrA9EditId === 'new') {
            formHtml = hyr9RenderForm({});
        } else if (_hyrA9EditId) {
            const rec = coupes.find(c => c.id === _hyrA9EditId);
            if (rec) formHtml = hyr9RenderForm(rec);
        }

        if (!coupes.length && !formHtml) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No Appendix 9 data for this period yet.<br><br>
                Import the master workbook on the <strong>Report</strong> tab, or ${canEdit ? 'click <strong>➕ Add coupe</strong> above.' : 'ask an editor to add coupes.'}
            </div>`;
            return;
        }

        const TH = 'padding:6px 8px; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); z-index:1; white-space:nowrap; text-align:left;';
        const TD = 'padding:4px 8px; border-bottom:1px solid var(--border-color,#eee); white-space:nowrap;';
        const num = (n) => n ? hyrNum(n).toLocaleString('en-MY', { maximumFractionDigits: 2 }) : '';

        let rowsHtml = '';
        coupes.forEach(rec => {
            const areaTotal = hyrA9AreaTotal(rec), progTotal = hyrA9ProgressTotal(rec);
            rowsHtml += `<tr>
                <td style="${TD} font-weight:600;">${hyrEsc(rec.coupeNo)}</td>
                <td style="${TD}">${hyrEsc(rec.scheduledYear)}</td>
                <td style="${TD}">${hyrEsc(rec.actualYear)}</td>
                <td style="${TD}">${hyrEsc(rec.typeOfPlantation)}</td>
                <td style="${TD} text-align:right;">${num(rec.areaNotUnderFTL)}</td>
                <td style="${TD} text-align:right;">${num(rec.area)}</td>
                <td style="${TD} text-align:right;">${num(rec.areaUnderFTLOthers)}</td>
                <td style="${TD} text-align:right; font-weight:600;">${num(areaTotal)}</td>
                <td style="${TD} text-align:right;">${num(rec.clearing)}</td>
                <td style="${TD} text-align:right;">${num(rec.planted1st)}</td>
                <td style="${TD} text-align:right;">${num(rec.planted2nd)}</td>
                <td style="${TD} text-align:right;">${num(rec.enrichment)}</td>
                <td style="${TD} text-align:right;">${num(rec.protection)}</td>
                <td style="${TD} text-align:right;">${num(rec.notPlantedTerIV)}</td>
                <td style="${TD} text-align:right;">${num(rec.notPlantedBuffer)}</td>
                <td style="${TD} text-align:right;">${num(rec.notPlantedNative)}</td>
                <td style="${TD} text-align:right; font-weight:600;">${num(progTotal)}</td>
                <td style="${TD}">${hyrEsc(rec.groundVerification)}</td>
                <td style="${TD}">${hyrEsc(rec.remarks)}</td>
                <td style="${TD}">${canEdit ? `
                    <button class="hyr9-edit" data-id="${hyrEsc(rec.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">✏</button>
                    <button class="hyr9-del" data-id="${hyrEsc(rec.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">🗑</button>` : ''}</td>
            </tr>`;
        });

        const gross = coupes.length ? hyrA9Totals(coupes) : null;
        let grossHtml = '';
        if (gross) {
            const gv = (k) => gross[k] ? num(gross[k].value) : '';
            grossHtml = `<tr style="font-weight:700; border-top:2px solid var(--border-color,#ccc); background:var(--bg-main,#eef4ee);">
                <td style="${TD}">Gross</td><td style="${TD}"></td><td style="${TD}"></td><td style="${TD}"></td>
                <td style="${TD} text-align:right;">${gv('E')}</td><td style="${TD} text-align:right;">${gv('F')}</td>
                <td style="${TD} text-align:right;">${gv('G')}</td><td style="${TD} text-align:right;">${gv('H')}</td>
                <td style="${TD} text-align:right;">${gv('I')}</td><td style="${TD} text-align:right;">${gv('J')}</td>
                <td style="${TD} text-align:right;">${gv('K')}</td><td style="${TD} text-align:right;">${gv('L')}</td>
                <td style="${TD} text-align:right;">${gv('M')}</td><td style="${TD} text-align:right;">${gv('N')}</td>
                <td style="${TD} text-align:right;">${gv('O')}</td><td style="${TD} text-align:right;">${gv('Q')}</td>
                <td style="${TD}"></td><td style="${TD}"></td><td style="${TD}"></td></tr>`;
        }

        body.innerHTML = formHtml + `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="max-height:600px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.82rem; color:var(--text-primary);">
              <thead><tr>
                <th style="${TH}">Coupe No.</th><th style="${TH}">Sched. Yr.</th><th style="${TH}">Actual Yr.</th><th style="${TH}">Type</th>
                <th style="${TH}">Not under FTL</th><th style="${TH}">Area</th><th style="${TH}">FTL Others</th><th style="${TH}">Total</th>
                <th style="${TH}">Clearing</th><th style="${TH}">1st Rot.</th><th style="${TH}">2nd Rot.</th><th style="${TH}">Enrichment</th>
                <th style="${TH}">Protection</th><th style="${TH}">Ter. IV</th><th style="${TH}">Buffer/Others</th><th style="${TH}">Native</th>
                <th style="${TH}">Total</th><th style="${TH}">Ground Verif.</th><th style="${TH}">Remarks</th><th style="${TH}"></th>
              </tr></thead>
              <tbody>${rowsHtml}${grossHtml}</tbody>
            </table>
          </div>
        </div>`;

        const form = body.querySelector('#hyr9-save');
        if (form) {
            form.onclick = () => {
                const rec = {};
                HYR_A9_COLS.forEach(c => {
                    const input = body.querySelector(`[data-field="${c.field}"]`);
                    const v = input ? input.value : '';
                    rec[c.field] = c.type === 'num' ? hyrNum(v) : hyrText(v);
                });
                if (!rec.coupeNo) { if (window.notify) window.notify('Coupe No. is required.', 'warn'); return; }
                if (_hyrA9EditId === 'new') {
                    rec.id = hyrUid();
                    coupes.push(rec);
                } else {
                    const idx = coupes.findIndex(c => c.id === _hyrA9EditId);
                    if (idx !== -1) coupes[idx] = { ...coupes[idx], ...rec };
                }
                _hyrA9EditId = null;
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('edit', 'hyr', `Appendix 9 coupe ${rec.coupeNo}`, h.year);
                hyr9RenderBody();
            };
        }
        const cancel = body.querySelector('#hyr9-cancel');
        if (cancel) cancel.onclick = () => { _hyrA9EditId = null; hyr9RenderBody(); };

        body.querySelectorAll('.hyr9-edit').forEach(btn => {
            btn.onclick = () => { _hyrA9EditId = btn.dataset.id; hyr9RenderBody(); };
        });
        body.querySelectorAll('.hyr9-del').forEach(btn => {
            btn.onclick = () => {
                const idx = coupes.findIndex(c => c.id === btn.dataset.id);
                if (idx === -1) return;
                const rec = coupes[idx];
                coupes.splice(idx, 1);
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('delete', 'hyr', `Appendix 9 coupe ${rec.coupeNo}`, h.year);
                if (window.notifyUndo) {
                    window.notifyUndo(`Deleted coupe "${rec.coupeNo}".`, () => {
                        coupes.splice(idx, 0, rec);
                        saveHyrData(true);
                        hyr9RenderBody();
                    });
                }
                hyr9RenderBody();
            };
        });
    };

})();
