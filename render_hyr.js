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
            const roads = hyrParseAppendix5(wb);
            const a4A = hyrParseAppendix4(wb, 'A');
            const a4B = hyrParseAppendix4(wb, 'B');
            const blocks6A = hyrParseAppendix6(wb, 'A');
            const blocks6B = hyrParseAppendix6(wb, 'B');

            const prevCount = hyrAppendix9(year, half).coupes.length;
            let msg = `Import master file for ${HYR_HALF_OF[half].short} ${year}:\n\n• Appendix 9: ${coupes.length} coupe(s)`;
            if (roads) msg += `\n• Appendix 5: ${roads.length} road segment(s)`;
            if (a4A) msg += `\n• Appendix 4A: ${a4A.blocks.length} block(s)`;
            if (a4B) msg += `\n• Appendix 4B: ${a4B.blocks.length} block(s)`;
            if (blocks6A) msg += `\n• Appendix 6A: ${blocks6A.length} block(s)`;
            if (blocks6B) msg += `\n• Appendix 6B: ${blocks6B.length} block(s)`;
            msg += `\n\n• This file becomes the master template for Export (any sheet above not found in this workbook keeps its existing app data; every other sheet is carried through as-is).`;
            if (prevCount) msg += `\n\n⚠ This REPLACES this period's existing data for whichever of the above were found.`;
            if (!confirm(msg + '\n\nProceed?')) return;

            const dataUrl = await hyrBlobToDataUrl(file);
            await hyrSaveMasterFile(dataUrl);

            const h = hyrEnsure();
            h.master = { fileName: file.name, importedAt: new Date().toISOString(), importedBy: window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'import' };
            hyrAppendix9(year, half).coupes = coupes;
            if (roads) hyrA5Roads(year, half).splice(0, Infinity, ...roads);
            if (a4A) Object.assign(hyrA4Coupe(year, half, 'A'), a4A);
            if (a4B) Object.assign(hyrA4Coupe(year, half, 'B'), a4B);
            if (blocks6A) hyrA6Blocks(year, half, 'A').splice(0, Infinity, ...blocks6A);
            if (blocks6B) hyrA6Blocks(year, half, 'B').splice(0, Infinity, ...blocks6B);
            await saveHyrData(false);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'hyr', `${HYR_HALF_OF[half].short} ${year}: master file + Appendix 9/5/4A/4B/6A/6B data`, year);
            window.renderHyrReportView();
            if (window.notify) window.notify(`Imported master file for ${HYR_HALF_OF[half].short} ${year}.`, 'success');
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
                // compute(rec, i, records) — the extra args let a column carry a
                // value down only on the group's first row (e.g. Appendix 5's
                // road type, shown once then blank until the type changes).
                const val = c.compute ? c.compute(rec, i, records) : rec[c.field];
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

    // Grouped variant of hyrRegenSheetRows for appendices where each record
    // (a block, a coupe…) expands into a VARIABLE number of sub-rows — e.g.
    // Appendix 6's Slashing/Spraying/Fertilizing/Pruning lines per block.
    // The group's key columns (Coupe No, Block No…) are written once on the
    // group's first row and MERGED across its row span (mirroring the
    // template's own A4:A6-style merges) instead of repeated per line.
    //
    // opts: { dataStartRow, origDataRowCount, hasTotalsRow, keyColumns,
    //         lineColumns, groups: [{key, lines}], totalsFn,
    //         wholeTableColumns?, wholeTableValues? }
    //   wholeTableColumns/-Values: for fields that apply to the ENTIRE
    //   regenerated table, not per-group (e.g. Appendix 4's single Coupe
    //   No / felling-date columns spanning every data row) — written once
    //   on the very first data row and merged across the whole region.
    const hyrRegenGroupedRows = (sheetXml, opts) => {
        const { dataStartRow, origDataRowCount, hasTotalsRow, keyColumns, lineColumns, groups, totalsFn,
            wholeTableColumns, wholeTableValues } = opts;
        const origAfterBlockRowNum = dataStartRow + origDataRowCount + (hasTotalsRow ? 1 : 0);

        const sdMatch = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml);
        if (!sdMatch) throw new Error('Could not locate sheet data — the master file may be corrupted.');
        const rowRe = /<row r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
        const rows = [];
        let rm;
        while ((rm = rowRe.exec(sdMatch[1]))) rows.push({ num: parseInt(rm[1], 10), xml: rm[0] });

        const headerRows = rows.filter(r => r.num < dataStartRow);
        const dataRowsOrig = rows.filter(r => r.num >= dataStartRow && r.num < origAfterBlockRowNum);
        const afterRows = rows.filter(r => r.num >= origAfterBlockRowNum);

        const allCols = [...(wholeTableColumns || []), ...keyColumns, ...lineColumns];
        const colStyle = {};
        allCols.forEach(c => {
            for (const r of dataRowsOrig) {
                const cm = new RegExp(`<c r="${c.col}\\d+"([^>]*)>`).exec(r.xml);
                if (cm) { const sm = /s="(\d+)"/.exec(cm[1]); colStyle[c.col] = sm ? sm[1] : null; break; }
            }
        });
        const dataRowHt = dataRowsOrig[0] ? (/ht="([\d.]+)"/.exec(dataRowsOrig[0].xml) || [])[1] : null;

        const buildCell = (col, rowNum, val, type, styleId) => {
            if (val === undefined || val === null || val === '') return '';
            const ref = col + rowNum;
            const sAttr = styleId ? ` s="${styleId}"` : '';
            if (type === 'str') return `<c r="${ref}"${sAttr} t="str"><v>${hyrXmlEsc(val)}</v></c>`;
            const n = typeof val === 'number' ? val : parseFloat(val);
            if (isNaN(n)) return '';
            return `<c r="${ref}"${sAttr}><v>${n}</v></c>`;
        };

        let rowNum = dataStartRow;
        const builtRows = []; // { num, cellsArr: [xmlStrings] }
        const newMerges = [];

        groups.forEach(g => {
            const groupStart = rowNum;
            g.lines.forEach((line, li) => {
                const cells = [];
                if (li === 0) keyColumns.forEach(c => cells.push(buildCell(c.col, rowNum, g.key[c.field], c.type, colStyle[c.col])));
                lineColumns.forEach(c => {
                    const val = c.compute ? c.compute(line, g) : line[c.field];
                    cells.push(buildCell(c.col, rowNum, val, c.type, colStyle[c.col]));
                });
                builtRows.push({ num: rowNum, cells });
                rowNum++;
            });
            const groupEnd = rowNum - 1;
            if (groupEnd > groupStart) keyColumns.forEach(c => newMerges.push({ c1: c.col, r1: groupStart, c2: c.col, r2: groupEnd }));
        });

        if (wholeTableColumns && wholeTableValues && builtRows.length) {
            wholeTableColumns.forEach(c => {
                builtRows[0].cells.unshift(buildCell(c.col, builtRows[0].num, wholeTableValues[c.field], c.type, colStyle[c.col]));
            });
            const lastRow = builtRows[builtRows.length - 1].num;
            if (lastRow > dataStartRow) wholeTableColumns.forEach(c => newMerges.push({ c1: c.col, r1: dataStartRow, c2: c.col, r2: lastRow }));
        }

        let newRowsXml = builtRows.map(r => `<row r="${r.num}"${dataRowHt ? ` ht="${dataRowHt}" customHeight="1"` : ''}>${r.cells.join('')}</row>`).join('');

        let newTotalsXml = '';
        if (hasTotalsRow && totalsFn) {
            const totalsRowNum = rowNum;
            const totalsVals = totalsFn(groups);
            let cells = '';
            allCols.forEach(c => {
                const tv = totalsVals[c.col];
                if (tv === undefined) return;
                cells += buildCell(c.col, totalsRowNum, tv.value, tv.type || c.type, colStyle[c.col]);
            });
            newTotalsXml = `<row r="${totalsRowNum}"${dataRowHt ? ` ht="${dataRowHt}" customHeight="1"` : ''}>${cells}</row>`;
            rowNum++;
        }

        const newAfterStart = rowNum;
        const delta = newAfterStart - origAfterBlockRowNum;

        const shiftRowXml = (xml, newNum) => xml
            .replace(/^<row r="\d+"/, `<row r="${newNum}"`)
            .replace(/ r="([A-Z]+)\d+"/g, (mm, col) => ` r="${col}${newNum}"`);

        let shiftedAfterXml = '';
        afterRows.forEach(r => { shiftedAfterXml += shiftRowXml(r.xml, r.num + delta); });

        const newInner = headerRows.map(r => r.xml).join('') + newRowsXml + newTotalsXml + shiftedAfterXml;
        let newSheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${newInner}</sheetData>`);

        // Merge cells: drop every ORIGINAL merge whose start row fell inside the
        // managed data region (those describe the old grouping and would now
        // point at wrong/stale rows), shift merges below it by delta, then
        // append the freshly computed group/whole-table merges.
        const mcRe = /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g;
        const keptMerges = [];
        let mcm;
        while ((mcm = mcRe.exec(newSheetXml))) {
            let [, c1, r1, c2, r2] = mcm; r1 = parseInt(r1, 10); r2 = parseInt(r2, 10);
            if (r1 >= dataStartRow && r1 < origAfterBlockRowNum) continue; // old in-region merge — dropped
            if (r1 >= origAfterBlockRowNum) { r1 += delta; r2 += delta; }
            keptMerges.push({ c1, r1, c2, r2 });
        }
        // A header-area merge can extend one row into the data region (seen in
        // the wild: a "Start/Completed" header cell merged B9:B10, spilling
        // into row10 — the first DATA row). Excel forbids overlapping merged
        // ranges, so any newly generated merge that would collide with one of
        // those is dropped — its value still renders correctly in the first
        // (unmerged) cell of the range, just without the extra visual merge.
        const headerMerges = keptMerges.filter(m => m.r1 < dataStartRow);
        const safeNewMerges = newMerges.filter(nm =>
            !headerMerges.some(hm => hm.c1 === nm.c1 && hm.r1 <= nm.r2 && nm.r1 <= hm.r2));
        const allMerges = [...keptMerges, ...safeNewMerges];
        const mergesXml = allMerges.map(m => `<mergeCell ref="${m.c1}${m.r1}:${m.c2}${m.r2}"/>`).join('');
        if (/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/.test(newSheetXml)) {
            newSheetXml = newSheetXml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, `<mergeCells count="${allMerges.length}">${mergesXml}</mergeCells>`);
        } else if (allMerges.length) {
            newSheetXml = newSheetXml.replace('</worksheet>', `<mergeCells count="${allMerges.length}">${mergesXml}</mergeCells></worksheet>`);
        }

        newSheetXml = newSheetXml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (mm, c1, r1, c2, r2) => {
            const endRow = Math.max(parseInt(r2, 10) + delta, rowNum - 1);
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

    // =====================================================================
    // Appendix 6 — silviculture operations by month, per block
    // =====================================================================
    // Two coupes get their own sheet (6A = T/2015, 6B = T/2016), same
    // SHAPE (one row per operation — Slashing/Spraying/Fertilizing/Pruning/…
    // — Coupe No + Block No shown once per block and merged across that
    // block's operation rows) but 6A's columns sit ONE LETTER RIGHT of 6B's
    // in the real template (confirmed against the source: 6A = B/C/D/E-P/Q,
    // 6B = A/B/C/D-O/P) — a genuine irregularity between the two sheets, not
    // a typo, so the layout is looked up per coupe rather than hardcoded.
    const HYR_MONTHS_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const HYR_A6_LAYOUT = {
        A: { dataStartRow: 3, coupeCell: 2, blockCell: 3, typeCell: 4, monthStartCell: 5,
             coupeCol: 'B', blockCol: 'C', typeCol: 'D', monthCols: ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'], totalCol: 'Q' },
        B: { dataStartRow: 4, coupeCell: 1, blockCell: 2, typeCell: 3, monthStartCell: 4,
             coupeCol: 'A', blockCol: 'B', typeCol: 'C', monthCols: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'], totalCol: 'P' },
    };
    const hyrA6LineTotal = (line) => HYR_MONTHS_3.reduce((s, m) => s + hyrNum(line.months[m]), 0);

    const hyrA6Blocks = (year, half, which) => {
        const p = hyrPeriodObj(year, half);
        if (!p.appendix6 || typeof p.appendix6 !== 'object') p.appendix6 = { blocks6A: [], blocks6B: [] };
        const key = which === 'A' ? 'blocks6A' : 'blocks6B';
        if (!Array.isArray(p.appendix6[key])) p.appendix6[key] = [];
        return p.appendix6[key];
    };

    const hyrParseAppendix6 = (workbook, which) => {
        const ws = workbook.worksheets.find(w => hyrNormHeader(w.name) === `APPENDIX6${which}`);
        if (!ws) return null;
        const L = HYR_A6_LAYOUT[which];
        let headerRow = -1;
        for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
            const row = ws.getRow(r);
            if (hyrNormHeader(row.getCell(L.coupeCell).value) === 'COUPENO' && hyrNormHeader(row.getCell(L.typeCell).value).indexOf('TYPEOFSILVICULTURE') !== -1) { headerRow = r; break; }
        }
        if (headerRow === -1) return null;

        // Coupe No / Block No are real MERGED cells in the template (A4:A6-style),
        // and ExcelJS resolves a read on any cell inside a merge to the anchor's
        // value — so blockNo reads non-empty on EVERY row of a group, not just
        // its first. A new group is therefore detected by the (coupe,block) pair
        // CHANGING from the previous row, not by truthiness.
        const blocks = [];
        let current = null;
        let prevKey = null;
        for (let r = headerRow + 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const coupeNo = hyrText(row.getCell(L.coupeCell).value);
            const blockNo = hyrText(row.getCell(L.blockCell).value);
            const opType = hyrText(row.getCell(L.typeCell).value);
            // Some templates (6A) put the "Note: ..." footer under a WIDE merge
            // (e.g. B21:L21) that also covers the block/type columns, so ExcelJS
            // resolves those reads to the same note text instead of blank —
            // must be checked explicitly, not inferred from emptiness.
            if (hyrNormHeader(opType) === 'TOTAL' || hyrNormHeader(opType).indexOf('NOTE') === 0 ||
                hyrNormHeader(coupeNo).indexOf('NOTE') === 0 || (!coupeNo && !blockNo && !opType)) break;
            const key = coupeNo + '|' + blockNo;
            if (!current || key !== prevKey) {
                current = { id: hyrUid(), coupeNo, blockNo, operations: [] };
                blocks.push(current);
                prevKey = key;
            }
            if (!opType) continue;
            const months = {};
            HYR_MONTHS_3.forEach((m, i) => { months[m] = hyrNum(row.getCell(L.monthStartCell + i).value); });
            current.operations.push({ type: opType, months });
        }
        return blocks;
    };

    const hyrA6Totals = (which) => (groups) => {
        const L = HYR_A6_LAYOUT[which];
        let grand = 0;
        groups.forEach(g => g.lines.forEach(line => { grand += hyrA6LineTotal(line); }));
        // "TOTAL" sits one column left of the grand-total figure on both sheets.
        const labelCol = L.monthCols[L.monthCols.length - 1];
        return { [labelCol]: { value: 'TOTAL', type: 'str' }, [L.totalCol]: { value: grand } };
    };

    const hyrA6ExportGroups = (blocks) => blocks.map(b => ({
        key: { coupeNo: b.coupeNo, blockNo: b.blockNo },
        lines: b.operations,
    }));
    const hyrA6KeyCols = (which) => {
        const L = HYR_A6_LAYOUT[which];
        return [{ col: L.coupeCol, field: 'coupeNo', type: 'str' }, { col: L.blockCol, field: 'blockNo', type: 'str' }];
    };
    const hyrA6LineCols = (which) => {
        const L = HYR_A6_LAYOUT[which];
        return [
            { col: L.typeCol, field: 'type', type: 'str' },
            ...HYR_MONTHS_3.map((m, i) => ({ col: L.monthCols[i], type: 'num', compute: (line) => hyrNum(line.months[m]) || undefined })),
            { col: L.totalCol, type: 'num', compute: (line) => hyrA6LineTotal(line) },
        ];
    };

    // =====================================================================
    // Appendix 5 — road construction / upgrade
    // =====================================================================
    // Flat list; "Type of Road" (Main/Secondary/Feeder) is shown once then
    // left blank on subsequent same-type rows (simple carry-down, no real
    // cell merge in the template — unlike Appendix 6's block grouping).
    const hyrA5Roads = (year, half) => {
        const p = hyrPeriodObj(year, half);
        if (!p.appendix5 || typeof p.appendix5 !== 'object') p.appendix5 = { roads: [] };
        if (!Array.isArray(p.appendix5.roads)) p.appendix5.roads = [];
        return p.appendix5.roads;
    };

    const hyrParseAppendix5 = (workbook) => {
        const ws = workbook.worksheets.find(w => hyrNormHeader(w.name) === 'APPENDIX5');
        if (!ws) return null;
        let headerRow = -1;
        for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
            const row = ws.getRow(r);
            if (hyrNormHeader(row.getCell(2).value) === 'TYPEOFROAD' && hyrNormHeader(row.getCell(3).value) === 'ROADINDEX') { headerRow = r; break; }
        }
        if (headerRow === -1) return null;
        const dataStart = headerRow + 2; // a 2-row header (main label row + To-Previous/Period/YTD sub-row)

        const roads = [];
        let carriedType = '';
        for (let r = dataStart; r <= Math.min(ws.rowCount, dataStart + 60); r++) {
            const row = ws.getRow(r);
            const type = hyrText(row.getCell(2).value);
            const index = hyrText(row.getCell(3).value);
            const prevKm = row.getCell(4).value, thisKm = row.getCell(5).value;
            const worksType = hyrText(row.getCell(7).value);
            const remarks = hyrText(row.getCell(8).value);
            if (hyrNormHeader(type).indexOf('NOTE') === 0) break; // reached the notes section
            if (!index && !hyrText(prevKm) && !hyrText(thisKm) && !worksType && !remarks) continue; // stray blank row — skip, keep scanning
            if (type) carriedType = type;
            roads.push({ id: hyrUid(), type: carriedType, index, prevKm: hyrNum(prevKm), thisKm: hyrNum(thisKm), typeOfWorks: worksType, remarks });
        }
        return roads;
    };

    const HYR_A5_COLS = [
        { col: 'C', field: 'index', type: 'str' },
        { col: 'D', field: 'prevKm', type: 'num' },
        { col: 'E', field: 'thisKm', type: 'num' },
        { col: 'F', type: 'num', compute: (rec) => hyrNum(rec.prevKm) + hyrNum(rec.thisKm) },
        { col: 'G', field: 'typeOfWorks', type: 'str' },
        { col: 'H', field: 'remarks', type: 'str' },
        // "Type of Road" carries down: only written when it differs from the previous record's type.
        { col: 'B', type: 'str', compute: (rec, i, records) => (i === 0 || records[i - 1].type !== rec.type) ? rec.type : undefined },
    ];

    // =====================================================================
    // Appendix 4 — planting progress by block (two coupes: A = T/2015, B = T/2016)
    // =====================================================================
    // Coupe No (B) and felling-endorsement date (E) apply to the WHOLE
    // table in the template (one giant merge down the entire data region)
    // — modelled as appendix-level fields, not per-block. Block No/Area/
    // Type of planting are per-block (merged across that block's own
    // species/phase sub-rows in the template); the source occasionally
    // merges those cosmetically ACROSS adjacent blocks too (e.g. two
    // blocks sharing "Monocrop") — simplified here to per-block-only
    // merges, which keeps every value correct without guessing at
    // one-off manual formatting choices in the original file.
    const hyrA4Coupe = (year, half, which) => {
        const p = hyrPeriodObj(year, half);
        if (!p.appendix4 || typeof p.appendix4 !== 'object') p.appendix4 = {};
        const key = which === 'A' ? 'A' : 'B';
        if (!p.appendix4[key] || typeof p.appendix4[key] !== 'object') p.appendix4[key] = { coupeNo: '', dateEndorsedForFelling: '', blocks: [] };
        if (!Array.isArray(p.appendix4[key].blocks)) p.appendix4[key].blocks = [];
        return p.appendix4[key];
    };

    const hyrParseAppendix4 = (workbook, which) => {
        const ws = workbook.worksheets.find(w => hyrNormHeader(w.name) === `APPENDIX4${which}`);
        if (!ws) return null;
        let headerRow = -1;
        for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
            const row = ws.getRow(r);
            if (hyrNormHeader(row.getCell(2).value) === 'COUPENO' && hyrNormHeader(row.getCell(3).value) === 'BLOCKNO') { headerRow = r; break; }
        }
        if (headerRow === -1) return null;
        const dataStart = headerRow + 2; // header + Start/Completed sub-row

        // Block No / Area / Type of planting are merged cells within a block's
        // own species-line rows (C11:C12-style) — ExcelJS resolves a read on
        // any cell inside a merge to the anchor's value, so blockNo reads
        // non-empty on every line of a block, not just its first. A new block
        // is detected by blockNo CHANGING from the previous row, not by
        // truthiness (mirrors the same fix in hyrParseAppendix6).
        let coupeNo = '', dateEndorsedForFelling = '';
        const blocks = [];
        let current = null;
        let prevBlockNo = null;
        for (let r = dataStart; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const rCoupeNo = hyrText(row.getCell(2).value);
            const blockNo = hyrText(row.getCell(3).value);
            const areaHa = row.getCell(4).value;
            const typeOfPlanting = hyrText(row.getCell(6).value);
            if (hyrNormHeader(blockNo) === 'TOTAL' || (r > dataStart + 1 && hyrNormHeader(row.getCell(2).value) === 'TOTAL')) break;
            if (rCoupeNo) coupeNo = rCoupeNo;
            const felling = row.getCell(5).value;
            if (hyrText(felling)) dateEndorsedForFelling = hyrText(felling);
            if (!current || blockNo !== prevBlockNo) {
                current = { id: hyrUid(), blockNo, areaHa: hyrNum(areaHa), typeOfPlanting, lines: [] };
                blocks.push(current);
                prevBlockNo = blockNo;
            }
            const species = hyrText(row.getCell(11).value);
            const anyLineVal = species || hyrText(row.getCell(7).value) || hyrText(row.getCell(13).value) || hyrNum(row.getCell(14).value);
            if (!current || !anyLineVal) continue;
            current.lines.push({
                id: hyrUid(),
                dateStart: hyrText(row.getCell(7).value),
                dateCompleted: hyrText(row.getCell(8).value),
                spacing: hyrText(row.getCell(9).value),
                soilType: hyrText(row.getCell(10).value),
                species,
                provenance: hyrText(row.getCell(12).value),
                seedlot: hyrText(row.getCell(13).value),
                seedlingsPlanted: hyrNum(row.getCell(14).value),
                pctPlanted: hyrNum(row.getCell(15).value),
                remarks: hyrText(row.getCell(16).value),
            });
        }
        if (!blocks.length) return null;
        return { coupeNo, dateEndorsedForFelling, blocks };
    };

    const hyrA4Totals = (groups) => {
        const totalArea = groups.reduce((s, g) => s + hyrNum(g.key.areaHa), 0);
        const totalSeedlings = groups.reduce((s, g) => s + g.lines.reduce((ls, l) => ls + hyrNum(l.seedlingsPlanted), 0), 0);
        return { B: { value: 'TOTAL', type: 'str' }, D: { value: totalArea }, N: { value: totalSeedlings } };
    };

    const hyrA4ExportGroups = (blocks) => blocks.map(b => ({
        key: { blockNo: b.blockNo, areaHa: b.areaHa, typeOfPlanting: b.typeOfPlanting },
        lines: b.lines,
    }));
    const HYR_A4_KEY_COLS = [
        { col: 'C', field: 'blockNo', type: 'str' },
        { col: 'D', field: 'areaHa', type: 'num' },
        { col: 'F', field: 'typeOfPlanting', type: 'str' },
    ];
    const HYR_A4_LINE_COLS = [
        { col: 'G', field: 'dateStart', type: 'str' },
        { col: 'H', field: 'dateCompleted', type: 'str' },
        { col: 'I', field: 'spacing', type: 'str' },
        { col: 'J', field: 'soilType', type: 'str' },
        { col: 'K', field: 'species', type: 'str' },
        { col: 'L', field: 'provenance', type: 'str' },
        { col: 'M', field: 'seedlot', type: 'str' },
        { col: 'N', field: 'seedlingsPlanted', type: 'num' },
        { col: 'O', field: 'pctPlanted', type: 'num' },
        { col: 'P', field: 'remarks', type: 'str' },
    ];
    const HYR_A4_WHOLE_COLS = [
        { col: 'B', field: 'coupeNo', type: 'str' },
        { col: 'E', field: 'dateEndorsedForFelling', type: 'str' },
    ];

    const hyrMonthAbbrevOf = (half) => {
        const [a, b] = half === 'JAN-JUN' ? ['Jan', 'Jun'] : ['Jul', 'Dec'];
        return { a, b };
    };

    // Scans a sheet's raw XML for a text cell in `col` whose normalised value
    // STARTS WITH `needleNorm` (e.g. "TOTAL", "GROSS", "NOTE") — used to find
    // the template's OWN totals-row (or notes-section) position at export
    // time, so origDataRowCount is never a guessed/hardcoded number that
    // could silently corrupt the row-shift math on a real file whose block
    // count differs from the sample used to build this module.
    const hyrFindRowByCellText = (sheetXml, col, needleNorm, fromRow, maxScan) => {
        for (let r = fromRow; r <= fromRow + maxScan; r++) {
            const m = new RegExp(`<c r="${col}${r}"[^>]*t="str"><v>([^<]*)</v>`).exec(sheetXml);
            if (m && hyrNormHeader(m[1]).indexOf(needleNorm) === 0) return r;
        }
        return null;
    };

    // boundaryCol/boundaryNeedle mark the first row AFTER the managed data
    // region — the totals-row label when totalsFn is set (e.g. "GROSS"),
    // or the notes-section heading when there's no totals row to emit
    // (e.g. Appendix 5's "Note:" text) — either way it's where
    // origDataRowCount and the row-shift boundary come from.
    const hyrRegenFlatSheet = async (zip, sheetName, dataStartRow, boundaryCol, boundaryNeedle, columns, records, totalsFn) => {
        const path = await hyrFindSheetPath(zip, sheetName);
        if (!path || !zip.file(path)) return { ok: false, reason: `sheet "${sheetName}" not found in the master template` };
        let xml = await zip.file(path).async('string');
        const boundaryRow = hyrFindRowByCellText(xml, boundaryCol, boundaryNeedle, dataStartRow, 100);
        if (boundaryRow === null) return { ok: false, reason: `couldn't locate the ${totalsFn ? 'totals row' : 'end of the data region'} on "${sheetName}" — left as imported` };
        const origDataRowCount = boundaryRow - dataStartRow;
        xml = hyrRegenSheetRows(xml, { dataStartRow, origDataRowCount, hasTotalsRow: !!totalsFn, columns, records, totalsFn });
        zip.file(path, xml);
        return { ok: true };
    };

    const hyrRegenGroupedSheet = async (zip, sheetName, dataStartRow, totalsCol, totalsNeedle, keyColumns, lineColumns, groups, totalsFn, wholeTableColumns, wholeTableValues) => {
        const path = await hyrFindSheetPath(zip, sheetName);
        if (!path || !zip.file(path)) return { ok: false, reason: `sheet "${sheetName}" not found in the master template` };
        let xml = await zip.file(path).async('string');
        const totalsRow = totalsFn ? hyrFindRowByCellText(xml, totalsCol, totalsNeedle, dataStartRow, 120) : null;
        if (totalsFn && totalsRow === null) return { ok: false, reason: `couldn't locate the totals row on "${sheetName}" — left as imported` };
        const origDataRowCount = totalsRow - dataStartRow;
        xml = hyrRegenGroupedRows(xml, {
            dataStartRow, origDataRowCount, hasTotalsRow: !!totalsFn, keyColumns, lineColumns, groups, totalsFn,
            wholeTableColumns, wholeTableValues,
        });
        zip.file(path, xml);
        return { ok: true };
    };

    window.downloadHyrReport = async (year, half) => {
        try {
            await hyrEnsureJSZip();
            const buf = await hyrLoadMasterFile();
            const zip = await window.JSZip.loadAsync(buf);
            const skipped = [];

            const r9 = await hyrRegenFlatSheet(zip, 'Appendix 9', 4, 'A', 'GROSS', HYR_A9_CLONE_COLS, hyrAppendix9(year, half).coupes, hyrA9Totals);
            if (!r9.ok) skipped.push(r9.reason);

            const r5 = await hyrRegenFlatSheet(zip, 'Appendix 5', 4, 'B', 'NOTE', HYR_A5_COLS, hyrA5Roads(year, half), null);
            if (!r5.ok) skipped.push(r5.reason);

            const a4A = hyrA4Coupe(year, half, 'A');
            const r4a = await hyrRegenGroupedSheet(zip, ' Appendix 4A', 10, 'B', 'TOTAL', HYR_A4_KEY_COLS, HYR_A4_LINE_COLS, hyrA4ExportGroups(a4A.blocks), hyrA4Totals, HYR_A4_WHOLE_COLS, a4A);
            if (!r4a.ok) skipped.push(r4a.reason);
            const a4B = hyrA4Coupe(year, half, 'B');
            const r4b = await hyrRegenGroupedSheet(zip, ' Appendix 4B', 10, 'B', 'TOTAL', HYR_A4_KEY_COLS, HYR_A4_LINE_COLS, hyrA4ExportGroups(a4B.blocks), hyrA4Totals, HYR_A4_WHOLE_COLS, a4B);
            if (!r4b.ok) skipped.push(r4b.reason);

            const L6A = HYR_A6_LAYOUT.A, L6B = HYR_A6_LAYOUT.B;
            const r6a = await hyrRegenGroupedSheet(zip, 'Appendix 6A', L6A.dataStartRow, L6A.monthCols[L6A.monthCols.length - 1], 'TOTAL',
                hyrA6KeyCols('A'), hyrA6LineCols('A'), hyrA6ExportGroups(hyrA6Blocks(year, half, 'A')), hyrA6Totals('A'));
            if (!r6a.ok) skipped.push(r6a.reason);
            const r6b = await hyrRegenGroupedSheet(zip, 'Appendix 6B', L6B.dataStartRow, L6B.monthCols[L6B.monthCols.length - 1], 'TOTAL',
                hyrA6KeyCols('B'), hyrA6LineCols('B'), hyrA6ExportGroups(hyrA6Blocks(year, half, 'B')), hyrA6Totals('B'));
            if (!r6b.ok) skipped.push(r6b.reason);

            if (skipped.length && window.notify) window.notify('Some sheets kept their imported data as-is (structure not recognised): ' + skipped.join('; '), 'warn', 8000);

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

    // ── Appendix 5 tab (roads) — flat table, same pattern as Appendix 9 ──
    let _hyr5EditId = null;

    window.renderHyrAppendix5View = () => {
        const host = document.getElementById('hyr-appendix5-wrapper');
        if (!host) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const years = hyrYearList();
        const yearOpts = years.map(y => `<option value="${y}" ${y === h.year ? 'selected' : ''}>${y}</option>`).join('');
        const halfOpts = HYR_HALVES.map(hf => `<option value="${hf.key}" ${hf.key === h.half ? 'selected' : ''}>${hyrEsc(hf.label)}</option>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1300px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🛣️ Appendix 5: Roads</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Road construction / upgrade — length to previous period, this period, and year-to-date.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="hyr5-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Half
              <select id="hyr5-half" style="${SS} margin-left:4px;">${halfOpts}</select></label>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="hyr5-add" class="btn-primary" style="padding:0.45rem 1rem;">➕ Add road</button>` : ''}
          </div>
          <div id="hyr5-body"></div>
        </div>`;

        host.querySelector('#hyr5-year').onchange = (e) => { h.year = e.target.value; saveHyrData(true); _hyr5EditId = null; window.renderHyrAppendix5View(); };
        host.querySelector('#hyr5-half').onchange = (e) => { h.half = e.target.value; saveHyrData(true); _hyr5EditId = null; window.renderHyrAppendix5View(); };
        const addBtn = host.querySelector('#hyr5-add');
        if (addBtn) addBtn.onclick = () => { _hyr5EditId = 'new'; hyr5RenderBody(); };

        hyr5RenderBody();
    };

    const HYR_A5_FORM_FIELDS = [
        { field: 'type', label: 'Type of Road (Main/Secondary/Feeder)', type: 'str' },
        { field: 'index', label: 'Road Index', type: 'str' },
        { field: 'prevKm', label: 'To Previous (KM)', type: 'num' },
        { field: 'thisKm', label: 'This Period (KM)', type: 'num' },
        { field: 'typeOfWorks', label: 'Type of Works', type: 'str' },
        { field: 'remarks', label: 'Remarks', type: 'str' },
    ];

    const hyr5RenderForm = (rec) => `
        <div style="${CARD} border-color:var(--accent-color,#16a34a);">
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px,1fr)); gap:0.6rem 0.8rem; margin-bottom:0.8rem;">
            ${HYR_A5_FORM_FIELDS.map(f => hyr9FieldRow(f.label, f.field, rec[f.field], f.type)).join('')}
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button id="hyr5-save" class="btn-primary" style="padding:0.4rem 1rem;">💾 Save</button>
            <button id="hyr5-cancel" style="${BTN}">Cancel</button>
          </div>
        </div>`;

    const hyr5RenderBody = () => {
        const body = document.getElementById('hyr5-body');
        if (!body) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const roads = hyrA5Roads(h.year, h.half);

        let formHtml = '';
        if (_hyr5EditId === 'new') formHtml = hyr5RenderForm({});
        else if (_hyr5EditId) { const rec = roads.find(r => r.id === _hyr5EditId); if (rec) formHtml = hyr5RenderForm(rec); }

        if (!roads.length && !formHtml) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No Appendix 5 data for this period yet.<br><br>
                Import the master workbook on the <strong>Report</strong> tab, or ${canEdit ? 'click <strong>➕ Add road</strong> above.' : 'ask an editor to add roads.'}
            </div>`;
            return;
        }

        const TH = 'padding:6px 8px; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); z-index:1; white-space:nowrap; text-align:left;';
        const TD = 'padding:4px 8px; border-bottom:1px solid var(--border-color,#eee); white-space:nowrap;';
        const num = (n) => n ? hyrNum(n).toLocaleString('en-MY', { maximumFractionDigits: 2 }) : '';

        let rowsHtml = '', lastType = null;
        roads.forEach(rec => {
            const showType = rec.type !== lastType; lastType = rec.type;
            const ytd = hyrNum(rec.prevKm) + hyrNum(rec.thisKm);
            rowsHtml += `<tr>
                <td style="${TD} font-weight:600;">${showType ? hyrEsc(rec.type) : ''}</td>
                <td style="${TD}">${hyrEsc(rec.index)}</td>
                <td style="${TD} text-align:right;">${num(rec.prevKm)}</td>
                <td style="${TD} text-align:right;">${num(rec.thisKm)}</td>
                <td style="${TD} text-align:right; font-weight:600;">${num(ytd)}</td>
                <td style="${TD}">${hyrEsc(rec.typeOfWorks)}</td>
                <td style="${TD}">${hyrEsc(rec.remarks)}</td>
                <td style="${TD}">${canEdit ? `
                    <button class="hyr5-edit" data-id="${hyrEsc(rec.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">✏</button>
                    <button class="hyr5-del" data-id="${hyrEsc(rec.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">🗑</button>` : ''}</td>
            </tr>`;
        });

        body.innerHTML = formHtml + `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="max-height:600px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.84rem; color:var(--text-primary);">
              <thead><tr>
                <th style="${TH}">Type of Road</th><th style="${TH}">Index</th><th style="${TH}">To Previous</th>
                <th style="${TH}">This Period</th><th style="${TH}">Year to Date</th><th style="${TH}">Type of Works</th>
                <th style="${TH}">Remarks</th><th style="${TH}"></th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;

        const form = body.querySelector('#hyr5-save');
        if (form) {
            form.onclick = () => {
                const rec = {};
                HYR_A5_FORM_FIELDS.forEach(f => {
                    const input = body.querySelector(`[data-field="${f.field}"]`);
                    const v = input ? input.value : '';
                    rec[f.field] = f.type === 'num' ? hyrNum(v) : hyrText(v);
                });
                if (!rec.type) { if (window.notify) window.notify('Type of Road is required.', 'warn'); return; }
                if (_hyr5EditId === 'new') { rec.id = hyrUid(); roads.push(rec); }
                else { const idx = roads.findIndex(r => r.id === _hyr5EditId); if (idx !== -1) roads[idx] = { ...roads[idx], ...rec }; }
                _hyr5EditId = null;
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('edit', 'hyr', `Appendix 5 road ${rec.type} ${rec.index}`, h.year);
                hyr5RenderBody();
            };
        }
        const cancel = body.querySelector('#hyr5-cancel');
        if (cancel) cancel.onclick = () => { _hyr5EditId = null; hyr5RenderBody(); };
        body.querySelectorAll('.hyr5-edit').forEach(btn => { btn.onclick = () => { _hyr5EditId = btn.dataset.id; hyr5RenderBody(); }; });
        body.querySelectorAll('.hyr5-del').forEach(btn => {
            btn.onclick = () => {
                const idx = roads.findIndex(r => r.id === btn.dataset.id);
                if (idx === -1) return;
                const rec = roads[idx];
                roads.splice(idx, 1);
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('delete', 'hyr', `Appendix 5 road ${rec.type} ${rec.index}`, h.year);
                if (window.notifyUndo) window.notifyUndo(`Deleted road "${rec.type} ${rec.index}".`, () => { roads.splice(idx, 0, rec); saveHyrData(true); hyr5RenderBody(); });
                hyr5RenderBody();
            };
        });
    };

    // ── Appendix 6 tab (silviculture) — coupe A/B toggle, block cards with a monthly operation-line mini-table ──
    let _hyr6Which = 'A';
    let _hyr6OpenBlockId = null;

    window.renderHyrAppendix6View = () => {
        const host = document.getElementById('hyr-appendix6-wrapper');
        if (!host) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const years = hyrYearList();
        const yearOpts = years.map(y => `<option value="${y}" ${y === h.year ? 'selected' : ''}>${y}</option>`).join('');
        const halfOpts = HYR_HALVES.map(hf => `<option value="${hf.key}" ${hf.key === h.half ? 'selected' : ''}>${hyrEsc(hf.label)}</option>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1500px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🌿 Appendix 6: Silviculture</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Slashing / Spraying / Fertilizing / Pruning hectares by month, per block. 6A = Coupe T/2015, 6B = Coupe T/2016.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <button id="hyr6-tab-a" style="${BTN} ${_hyr6Which === 'A' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">6A — T/2015</button>
            <button id="hyr6-tab-b" style="${BTN} ${_hyr6Which === 'B' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">6B — T/2016</button>
            <label style="font-size:0.82rem; color:var(--text-secondary); margin-left:1rem;">Year
              <select id="hyr6-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Half
              <select id="hyr6-half" style="${SS} margin-left:4px;">${halfOpts}</select></label>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="hyr6-add" class="btn-primary" style="padding:0.45rem 1rem;">➕ Add block</button>` : ''}
          </div>
          <div id="hyr6-body"></div>
        </div>`;

        host.querySelector('#hyr6-tab-a').onclick = () => { _hyr6Which = 'A'; _hyr6OpenBlockId = null; window.renderHyrAppendix6View(); };
        host.querySelector('#hyr6-tab-b').onclick = () => { _hyr6Which = 'B'; _hyr6OpenBlockId = null; window.renderHyrAppendix6View(); };
        host.querySelector('#hyr6-year').onchange = (e) => { h.year = e.target.value; saveHyrData(true); window.renderHyrAppendix6View(); };
        host.querySelector('#hyr6-half').onchange = (e) => { h.half = e.target.value; saveHyrData(true); window.renderHyrAppendix6View(); };
        const addBtn = host.querySelector('#hyr6-add');
        if (addBtn) addBtn.onclick = () => {
            const blocks = hyrA6Blocks(h.year, h.half, _hyr6Which);
            const rec = { id: hyrUid(), coupeNo: _hyr6Which === 'A' ? 'T/2015' : 'T/2016', blockNo: '', operations: [{ type: 'Slashing', months: {} }, { type: 'Spraying', months: {} }, { type: 'Fertilizing', months: {} }] };
            blocks.push(rec);
            saveHyrData(true);
            _hyr6OpenBlockId = rec.id;
            hyr6RenderBody();
        };

        hyr6RenderBody();
    };

    const hyr6MonthInputs = (line) => HYR_MONTHS_3.map(m => `
        <input data-month="${m}" type="number" step="0.01" value="${line.months[m] ? hyrEsc(line.months[m]) : ''}" placeholder="${m}"
          style="width:56px; padding:3px 4px; font-size:0.76rem; border:1px solid var(--border-color,#ccc); border-radius:3px; background:var(--bg-card,#fff); color:var(--text-primary);">`).join('');

    const hyr6RenderBody = () => {
        const body = document.getElementById('hyr6-body');
        if (!body) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const blocks = hyrA6Blocks(h.year, h.half, _hyr6Which);

        if (!blocks.length) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No Appendix ${_hyr6Which === 'A' ? '6A' : '6B'} data for this period yet.<br><br>
                Import the master workbook on the <strong>Report</strong> tab, or ${canEdit ? 'click <strong>➕ Add block</strong> above.' : 'ask an editor to add a block.'}
            </div>`;
            return;
        }

        let html = '';
        blocks.forEach(b => {
            const open = _hyr6OpenBlockId === b.id;
            html += `<div style="${CARD}">
              <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap; cursor:pointer;" class="hyr6-toggle" data-id="${hyrEsc(b.id)}">
                <strong style="color:var(--text-primary);">${hyrEsc(b.coupeNo)} — Block ${hyrEsc(b.blockNo) || '(unnamed)'}</strong>
                <span style="font-size:0.78rem; color:var(--text-secondary);">${b.operations.length} operation line(s)</span>
                <div style="flex:1;"></div>
                ${canEdit ? `<button class="hyr6-del-block" data-id="${hyrEsc(b.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">🗑 block</button>` : ''}
                <span>${open ? '▲' : '▼'}</span>
              </div>
              ${open ? `
              <div style="margin-top:0.8rem;">
                <label style="font-size:0.78rem; color:var(--text-secondary); display:block; margin-bottom:0.6rem;">Block No.
                  <input class="hyr6-blockno" data-id="${hyrEsc(b.id)}" value="${hyrEsc(b.blockNo)}" style="${SS} margin-left:4px; width:120px;"></label>
                <div style="overflow-x:auto;">
                <table style="border-collapse:collapse; font-size:0.78rem; color:var(--text-primary);">
                  <thead><tr>
                    <th style="text-align:left; padding:3px 6px;">Operation</th>
                    ${HYR_MONTHS_3.map(m => `<th style="padding:3px 4px; text-align:center;">${m}</th>`).join('')}
                    <th style="padding:3px 6px; text-align:right;">Total</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${b.operations.map((op, li) => `<tr data-block="${hyrEsc(b.id)}" data-line="${li}">
                        <td style="padding:3px 6px;"><input class="hyr6-optype" value="${hyrEsc(op.type)}" style="width:100px; padding:2px 4px; font-size:0.76rem; border:1px solid var(--border-color,#ccc); border-radius:3px; background:var(--bg-card,#fff); color:var(--text-primary);"></td>
                        <td colspan="12" style="padding:2px 0;"><div style="display:flex; gap:3px;">${hyr6MonthInputs(op)}</div></td>
                        <td style="padding:3px 6px; text-align:right; font-weight:600;">${hyrNum(hyrA6LineTotal(op)).toLocaleString('en-MY', { maximumFractionDigits: 2 })}</td>
                        <td>${canEdit ? `<button class="hyr6-del-line" data-block="${hyrEsc(b.id)}" data-line="${li}" style="${BTN} padding:1px 6px; font-size:0.74rem;">✕</button>` : ''}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
                </div>
                ${canEdit ? `<button class="hyr6-add-line" data-id="${hyrEsc(b.id)}" style="${BTN} margin-top:0.5rem; font-size:0.8rem;">➕ operation line</button>` : ''}
              </div>` : ''}
            </div>`;
        });
        body.innerHTML = html;

        body.querySelectorAll('.hyr6-toggle').forEach(el => {
            el.onclick = (ev) => { if (ev.target.closest('.hyr6-del-block')) return; _hyr6OpenBlockId = _hyr6OpenBlockId === el.dataset.id ? null : el.dataset.id; hyr6RenderBody(); };
        });
        body.querySelectorAll('.hyr6-del-block').forEach(btn => {
            btn.onclick = () => {
                const idx = blocks.findIndex(b => b.id === btn.dataset.id);
                if (idx === -1) return;
                const rec = blocks[idx];
                blocks.splice(idx, 1);
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('delete', 'hyr', `Appendix 6${_hyr6Which} block ${rec.blockNo}`, h.year);
                if (window.notifyUndo) window.notifyUndo(`Deleted block "${rec.blockNo}".`, () => { blocks.splice(idx, 0, rec); saveHyrData(true); hyr6RenderBody(); });
                hyr6RenderBody();
            };
        });
        body.querySelectorAll('.hyr6-blockno').forEach(inp => {
            inp.onchange = () => { const b = blocks.find(x => x.id === inp.dataset.id); if (b) { b.blockNo = inp.value.trim(); saveHyrData(true); } };
        });
        body.querySelectorAll('.hyr6-add-line').forEach(btn => {
            btn.onclick = () => {
                const b = blocks.find(x => x.id === btn.dataset.id);
                if (b) { b.operations.push({ type: '', months: {} }); saveHyrData(true); hyr6RenderBody(); }
            };
        });
        body.querySelectorAll('.hyr6-del-line').forEach(btn => {
            btn.onclick = () => {
                const b = blocks.find(x => x.id === btn.dataset.block);
                if (b) { b.operations.splice(parseInt(btn.dataset.line, 10), 1); saveHyrData(true); hyr6RenderBody(); }
            };
        });
        body.querySelectorAll('.hyr6-optype').forEach(inp => {
            const tr = inp.closest('tr');
            inp.onchange = () => {
                const b = blocks.find(x => x.id === tr.dataset.block);
                if (b) { b.operations[parseInt(tr.dataset.line, 10)].type = inp.value.trim(); saveHyrData(true); }
            };
        });
        body.querySelectorAll('[data-month]').forEach(inp => {
            const tr = inp.closest('tr');
            inp.onchange = () => {
                const b = blocks.find(x => x.id === tr.dataset.block);
                if (!b) return;
                const line = b.operations[parseInt(tr.dataset.line, 10)];
                line.months[inp.dataset.month] = hyrNum(inp.value);
                saveHyrData(true);
                hyr6RenderBody();
            };
        });
    };

    // ── Appendix 4 tab (planting progress) — coupe A/B toggle, whole-table fields + block cards ──
    let _hyr4Which = 'A';
    let _hyr4OpenBlockId = null;

    window.renderHyrAppendix4View = () => {
        const host = document.getElementById('hyr-appendix4-wrapper');
        if (!host) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const years = hyrYearList();
        const yearOpts = years.map(y => `<option value="${y}" ${y === h.year ? 'selected' : ''}>${y}</option>`).join('');
        const halfOpts = HYR_HALVES.map(hf => `<option value="${hf.key}" ${hf.key === h.half ? 'selected' : ''}>${hyrEsc(hf.label)}</option>`).join('');
        const coupe = hyrA4Coupe(h.year, h.half, _hyr4Which);

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1600px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🌱 Appendix 4: Planting Progress</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Planting progress by block — dates, spacing, species, seedlings planted. 4A = Coupe T/2015, 4B = Coupe T/2016.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <button id="hyr4-tab-a" style="${BTN} ${_hyr4Which === 'A' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">4A — T/2015</button>
            <button id="hyr4-tab-b" style="${BTN} ${_hyr4Which === 'B' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">4B — T/2016</button>
            <label style="font-size:0.82rem; color:var(--text-secondary); margin-left:1rem;">Year
              <select id="hyr4-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Half
              <select id="hyr4-half" style="${SS} margin-left:4px;">${halfOpts}</select></label>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="hyr4-add" class="btn-primary" style="padding:0.45rem 1rem;">➕ Add block</button>` : ''}
          </div>
          <div style="${CARD} display:flex; gap:1.2rem; flex-wrap:wrap;">
            <label style="font-size:0.8rem; color:var(--text-secondary);">Coupe No.
              <input id="hyr4-coupeno" value="${hyrEsc(coupe.coupeNo)}" ${canEdit ? '' : 'disabled'} style="${SS} margin-left:4px; width:120px;"></label>
            <label style="font-size:0.8rem; color:var(--text-secondary);">Date endorsed for felling
              <input id="hyr4-felling" value="${hyrEsc(coupe.dateEndorsedForFelling)}" ${canEdit ? '' : 'disabled'} style="${SS} margin-left:4px; width:160px;"></label>
          </div>
          <div id="hyr4-body"></div>
        </div>`;

        host.querySelector('#hyr4-tab-a').onclick = () => { _hyr4Which = 'A'; _hyr4OpenBlockId = null; window.renderHyrAppendix4View(); };
        host.querySelector('#hyr4-tab-b').onclick = () => { _hyr4Which = 'B'; _hyr4OpenBlockId = null; window.renderHyrAppendix4View(); };
        host.querySelector('#hyr4-year').onchange = (e) => { h.year = e.target.value; saveHyrData(true); window.renderHyrAppendix4View(); };
        host.querySelector('#hyr4-half').onchange = (e) => { h.half = e.target.value; saveHyrData(true); window.renderHyrAppendix4View(); };
        host.querySelector('#hyr4-coupeno').onchange = (e) => { coupe.coupeNo = e.target.value.trim(); saveHyrData(true); };
        host.querySelector('#hyr4-felling').onchange = (e) => { coupe.dateEndorsedForFelling = e.target.value.trim(); saveHyrData(true); };
        const addBtn = host.querySelector('#hyr4-add');
        if (addBtn) addBtn.onclick = () => {
            const rec = { id: hyrUid(), blockNo: '', areaHa: 0, typeOfPlanting: '', lines: [{ id: hyrUid(), dateStart: '', dateCompleted: '', spacing: '', soilType: '', species: '', provenance: '', seedlot: '', seedlingsPlanted: 0, pctPlanted: 0, remarks: '' }] };
            coupe.blocks.push(rec);
            saveHyrData(true);
            _hyr4OpenBlockId = rec.id;
            hyr4RenderBody();
        };

        hyr4RenderBody();
    };

    const HYR_A4_LINE_FIELDS = [
        { field: 'dateStart', label: 'Date Start', type: 'str' }, { field: 'dateCompleted', label: 'Date Completed', type: 'str' },
        { field: 'spacing', label: 'Spacing', type: 'str' }, { field: 'soilType', label: 'Soil Type', type: 'str' },
        { field: 'species', label: 'Species', type: 'str' }, { field: 'provenance', label: 'Provenance', type: 'str' },
        { field: 'seedlot', label: 'Seedlot', type: 'str' }, { field: 'seedlingsPlanted', label: 'Seedlings Planted', type: 'num' },
        { field: 'pctPlanted', label: '% Planted', type: 'num' }, { field: 'remarks', label: 'Remarks', type: 'str' },
    ];

    const hyr4RenderBody = () => {
        const body = document.getElementById('hyr4-body');
        if (!body) return;
        const h = hyrEnsure();
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('hyr');
        const coupe = hyrA4Coupe(h.year, h.half, _hyr4Which);
        const blocks = coupe.blocks;

        if (!blocks.length) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary); margin-top:1rem;">
                No Appendix ${_hyr4Which === 'A' ? '4A' : '4B'} data for this period yet.<br><br>
                Import the master workbook on the <strong>Report</strong> tab, or ${canEdit ? 'click <strong>➕ Add block</strong> above.' : 'ask an editor to add a block.'}
            </div>`;
            return;
        }

        const TH = 'padding:3px 6px; text-align:left; white-space:nowrap;';
        const TD = 'padding:2px 4px;';
        const inp = (id, li, field, val, type) => `<input data-block="${hyrEsc(id)}" data-line="${li}" data-field="${field}" type="${type === 'num' ? 'number' : 'text'}" ${type === 'num' ? 'step="0.01"' : ''}
            value="${hyrEsc(val == null ? '' : val)}" style="width:${type === 'num' ? '70px' : '100px'}; padding:2px 4px; font-size:0.76rem; border:1px solid var(--border-color,#ccc); border-radius:3px; background:var(--bg-card,#fff); color:var(--text-primary);">`;

        let html = '';
        blocks.forEach(b => {
            const open = _hyr4OpenBlockId === b.id;
            const areaTotal = hyrNum(b.areaHa);
            const seedlingsTotal = b.lines.reduce((s, l) => s + hyrNum(l.seedlingsPlanted), 0);
            html += `<div style="${CARD} margin-top:1rem;">
              <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap; cursor:pointer;" class="hyr4-toggle" data-id="${hyrEsc(b.id)}">
                <strong style="color:var(--text-primary);">Block ${hyrEsc(b.blockNo) || '(unnamed)'}</strong>
                <span style="font-size:0.78rem; color:var(--text-secondary);">${areaTotal.toLocaleString('en-MY', { maximumFractionDigits: 2 })} ha · ${b.lines.length} line(s) · ${seedlingsTotal.toLocaleString()} seedlings</span>
                <div style="flex:1;"></div>
                ${canEdit ? `<button class="hyr4-del-block" data-id="${hyrEsc(b.id)}" style="${BTN} padding:2px 8px; font-size:0.78rem;">🗑 block</button>` : ''}
                <span>${open ? '▲' : '▼'}</span>
              </div>
              ${open ? `
              <div style="margin-top:0.8rem; display:flex; gap:0.8rem; flex-wrap:wrap;">
                <label style="font-size:0.78rem; color:var(--text-secondary);">Block No.
                  <input class="hyr4-field" data-id="${hyrEsc(b.id)}" data-field="blockNo" value="${hyrEsc(b.blockNo)}" style="${SS} margin-left:4px; width:100px;"></label>
                <label style="font-size:0.78rem; color:var(--text-secondary);">Area (ha)
                  <input class="hyr4-field" data-id="${hyrEsc(b.id)}" data-field="areaHa" type="number" step="0.01" value="${hyrEsc(b.areaHa)}" style="${SS} margin-left:4px; width:90px;"></label>
                <label style="font-size:0.78rem; color:var(--text-secondary);">Type of Planting
                  <input class="hyr4-field" data-id="${hyrEsc(b.id)}" data-field="typeOfPlanting" value="${hyrEsc(b.typeOfPlanting)}" style="${SS} margin-left:4px; width:120px;"></label>
              </div>
              <div style="overflow-x:auto; margin-top:0.8rem;">
                <table style="border-collapse:collapse; font-size:0.76rem; color:var(--text-primary);">
                  <thead><tr>${HYR_A4_LINE_FIELDS.map(f => `<th style="${TH}">${hyrEsc(f.label)}</th>`).join('')}<th></th></tr></thead>
                  <tbody>
                    ${b.lines.map((line, li) => `<tr>
                        ${HYR_A4_LINE_FIELDS.map(f => `<td style="${TD}">${inp(b.id, li, f.field, line[f.field], f.type)}</td>`).join('')}
                        <td>${canEdit ? `<button class="hyr4-del-line" data-block="${hyrEsc(b.id)}" data-line="${li}" style="${BTN} padding:1px 6px; font-size:0.74rem;">✕</button>` : ''}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              ${canEdit ? `<button class="hyr4-add-line" data-id="${hyrEsc(b.id)}" style="${BTN} margin-top:0.5rem; font-size:0.8rem;">➕ species/line</button>` : ''}
              ` : ''}
            </div>`;
        });
        body.innerHTML = html;

        body.querySelectorAll('.hyr4-toggle').forEach(el => {
            el.onclick = (ev) => { if (ev.target.closest('.hyr4-del-block')) return; _hyr4OpenBlockId = _hyr4OpenBlockId === el.dataset.id ? null : el.dataset.id; hyr4RenderBody(); };
        });
        body.querySelectorAll('.hyr4-del-block').forEach(btn => {
            btn.onclick = () => {
                const idx = blocks.findIndex(b => b.id === btn.dataset.id);
                if (idx === -1) return;
                const rec = blocks[idx];
                blocks.splice(idx, 1);
                saveHyrData(true);
                if (typeof window.logAudit === 'function') window.logAudit('delete', 'hyr', `Appendix 4${_hyr4Which} block ${rec.blockNo}`, h.year);
                if (window.notifyUndo) window.notifyUndo(`Deleted block "${rec.blockNo}".`, () => { blocks.splice(idx, 0, rec); saveHyrData(true); hyr4RenderBody(); });
                hyr4RenderBody();
            };
        });
        body.querySelectorAll('.hyr4-field').forEach(el => {
            el.onchange = () => {
                const b = blocks.find(x => x.id === el.dataset.id);
                if (!b) return;
                b[el.dataset.field] = el.type === 'number' ? hyrNum(el.value) : el.value.trim();
                saveHyrData(true);
                if (el.dataset.field !== 'blockNo') hyr4RenderBody(); // refresh the summary line for area/type edits
            };
        });
        body.querySelectorAll('.hyr4-add-line').forEach(btn => {
            btn.onclick = () => {
                const b = blocks.find(x => x.id === btn.dataset.id);
                if (b) { b.lines.push({ id: hyrUid(), dateStart: '', dateCompleted: '', spacing: '', soilType: '', species: '', provenance: '', seedlot: '', seedlingsPlanted: 0, pctPlanted: 0, remarks: '' }); saveHyrData(true); hyr4RenderBody(); }
            };
        });
        body.querySelectorAll('.hyr4-del-line').forEach(btn => {
            btn.onclick = () => {
                const b = blocks.find(x => x.id === btn.dataset.block);
                if (b) { b.lines.splice(parseInt(btn.dataset.line, 10), 1); saveHyrData(true); hyr4RenderBody(); }
            };
        });
        body.querySelectorAll('[data-block][data-line][data-field]').forEach(el => {
            el.onchange = () => {
                const b = blocks.find(x => x.id === el.dataset.block);
                if (!b) return;
                const line = b.lines[parseInt(el.dataset.line, 10)];
                if (!line) return;
                line[el.dataset.field] = el.type === 'number' ? hyrNum(el.value) : el.value.trim();
                saveHyrData(true);
            };
        });
    };

})();
