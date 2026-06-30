// =====================================================================
// render_tree_logs.js — Tree Logs Recording module (Tree Planting WS)
// ---------------------------------------------------------------------
// Digitises the user's "Logs Species Summary" workbook:
//
//   • KU…  sheets  = one DELIVERY BATCH with a detailed species/grade
//                    breakdown (SPECIES CATEGORY | SPECIES | GRADE |
//                    QUANTITY (PCS) | VOLUME (MT), grouped + sub-totalled).
//   • ACMG… sheets = monthly SUMMARY-ONLY lists of batches that have no
//                    detail sheet (just batch no + qty + volume), tagged
//                    to a single species (Acacia Mangium).
//
// This module shows ALL batches in one ACMG-style master summary (point 2),
// lets you click a detailed batch to drill into its KU-style breakdown
// (point 3), and supports manual entry + Excel import/template (point 4).
// Plus: species/grade/category analytics, KU+ACMG Excel export, and
// editable code lists.
//
// Storage:  Firebase  shared/tree_logs_data   (window._treeLogsDb)
//           — namespaced per workspace by workspace.js, so it lives under
//             shared/ws/tree_planting/tree_logs_data in practice.
// Access:   menu key 'treelogs'  (window._canEdit / _applyReadOnly).
//           Template + Export available to read-only users.
// =====================================================================

(function () {
    'use strict';

    const TL_COMPANY = 'POLIMA FOREST BINTULU SDN BHD';
    const TL_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const TL_MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Seed values extracted from the user's workbook (editable afterwards).
    const TL_DEFAULT_CATEGORIES = ['MLH', 'MKK', 'SLGB'];
    const TL_DEFAULT_GRADES = ['REG', 'SG', 'SSG', 'BSG'];
    const TL_DEFAULT_SPECIES = ['ACMG', 'ASAM', 'EMPN', 'GERO', 'KAPX', 'KEBA', 'KERANJI', 'MEDANG',
        'MEDN', 'MLH', 'MRTX', 'NGILAS', 'NYTO', 'PELI', 'PEPK', 'REHU', 'RESAK', 'RESK', 'SLGB',
        'TERA', 'TERE', 'UBAH'];

    // ── Invoice mapping (pre-built offline) ───────────────────────────────
    // The customer's invoices are scanned-image PDFs (no text layer), so they
    // can't be parsed in-browser. This map was built by OCR-ing every invoice
    // and cross-checking each line against the workbook's batch sub-totals
    // (105/105 batches matched, zero mismatches). Keyed by invoice number
    // (= PDF filename without extension):  invNo -> { d:date, t:totalRM, b:[batchNos] }.
    // b:[] means the invoice has no batch in this system (orphan → archive).
    // When the user imports the invoice PDFs, this drives the batch↔invoice
    // links; the PDF bytes are stored separately (see tlInvoiceDb paths).
    const TL_INVOICE_MAP = {"PFB202407002":{"d":"2024-07-31","t":229237.06,"b":["KU0624A01","KU0624A02","KU0624A03","KU0624A04","KU0624A05"]},"PFB202408003":{"d":"2024-08-30","t":142679.55,"b":["KU0624A06","KU0724A01","KU0724A02"]},"PFB202410003":{"d":"2024-10-31","t":190019.65,"b":["KU0924A01","KU0924A02","KU0924A03","KU0924A04","KU0924A05","KU0924A06"]},"PFB202412005":{"d":"2024-12-31","t":214221.46,"b":["KU1124A02","KU1124A03","KU1124A04","KU1124A05","KU1124A06","KU1124A07","KU1124A08"]},"PFB202501005":{"d":"2025-01-31","t":166926.05,"b":["KU1224A01","KU1224A02","KU1224A03","KU1224A04","KU1224A05","KU1224A06"]},"PFB202503001":{"d":"2025-03-15","t":152378.5,"b":["KU1224A07","KU0225A01","KU0225A02"]},"PFB202504005":{"d":"2025-04-30","t":95031.3,"b":["KU0325A01","KU0325A02"]},"PFB202505005":{"d":"2025-05-31","t":62692.42,"b":["KU0325A03","KU0425A01"]},"PFB202506005":{"d":"2025-06-30","t":34890.35,"b":["KU0425A02"]},"PFB202507005":{"d":"2025-07-31","t":121600.2,"b":["KU0625A01","KU0625A02"]},"PFB202509003":{"d":"2025-09-30","t":100813.95,"b":["KU0825AP01","KU0925AP01","KU0925AP02","KU0925AP03","KU0925AP04","KU0925AP05","KU0925AP06","KU0925AP07","KU0925AP08","KU0925AP09","KU0925AP10","KU0925AP11","KU0925AP12","KU0925AP13","KU0925AP14","KU0925AP15","KU0925AP16","KU0925AP17"]},"PFB202510006":{"d":"2025-10-31","t":107257.05,"b":["KU1025AP01","KU1025AP02","KU1025AP03","KU1025AP04","KU1025AP05","KU1025AP06","KU1025AP07","KU1025AP08","KU1025AP09","KU1025AP10","KU1025AP11","KU1025AP12","KU1025AP13","KU1025AP14","KU1025AP15","KU1025AP16","KU1025AP17","KU1025AP18","KU1025AP19","KU1025AP20","KU1025AP21","KU1025AP22","KU1025AP23","KU1025AP24","KU1025AP25","KU1025AP26","KU1025AP27"]},"PFB202511005":{"d":"2025-11-30","t":11982.6,"b":["KU1025AP28","KU1025AP29","KU1025AP30","KU1025AP31"]},"PFB202402001":{"d":"2024-02-05","t":87091.05,"b":["KU1223A01"]},"PFB202402004":{"d":"2024-02-29","t":101517.76,"b":["KU1223A02"]},"PFB202403002":{"d":"2024-03-18","t":99173.34,"b":["KU1223A03"]},"PFB202406005":{"d":"2024-06-30","t":184422.12,"b":["KU0524A01","KU0524A02","KU0524A03","KU0524A04"]},"PFB202411005":{"d":"2024-11-30","t":127080.91,"b":["KU1024A01","KU1024A02","KU1024A03","KU1024A04","KU1124A01"]},"PFB202309004":{"d":"2023-09-29","t":107746.01,"b":["KU0823A03"]},"PFB202310005":{"d":"2023-10-31","t":93236.81,"b":["KU1023A01"]},"PFB202311002":{"d":"2023-11-20","t":77218.0,"b":["KU1023A02"]},"PFB202311003":{"d":"2023-11-20","t":33869.6,"b":["KU1023A03"]},"PFB202311004":{"d":"2023-11-24","t":34870.5,"b":["KU1023A04"]},"PFB202311005":{"d":"2023-11-28","t":40943.9,"b":["KU1023A05"]},"PFB202312002":{"d":"2023-12-18","t":98780.15,"b":["KU1023A06"]},"PFB202308001":{"d":"2023-08-15","t":100647.79,"b":[]},"PFB202309001":{"d":"2023-09-08","t":113362.49,"b":[]},"PFB202309002":{"d":"2023-09-15","t":109615.25,"b":[]},"PFB202305002":{"d":"2023-05-18","t":46819.91,"b":[]},"PFB202305004":{"d":"2023-05-26","t":52403.94,"b":[]}};

    // batchNo -> invoiceNo (inverted from the map; each batch is billed once).
    const TL_BATCH2INV = {};
    Object.keys(TL_INVOICE_MAP).forEach(inv => {
        (TL_INVOICE_MAP[inv].b || []).forEach(bn => { TL_BATCH2INV[bn] = inv; });
    });

    // Module-local navigation state (NOT persisted into state.treeLogs).
    let _tlMode = 'list';     // list | detail | edit | analytics | codes
    let _tlDetailId = null;   // batch id being viewed
    let _tlEditId = null;     // batch id being edited (null = new)
    let _tlYearCorrected = false; // first-render year auto-correct ran (per page load)

    // ── Small helpers ───────────────────────────────────────────────────
    const tlEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const tlNum = (v) => {
        if (v && typeof v === 'object' && 'result' in v) v = v.result;
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };
    const tlText = (v) => {
        if (v && typeof v === 'object') {
            if ('result' in v) v = v.result;
            else if ('text' in v) v = v.text;
            else if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
        }
        return String(v == null ? '' : v).trim();
    };
    const tlPad = (n) => String(n).padStart(2, '0');
    const tlInt = (n) => tlNum(n).toLocaleString('en-US');
    const tlVol = (n) => tlNum(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const tlNormHeader = (h) => tlText(h).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tlCurrentYear = () => String(new Date().getFullYear());
    const tlUid = () => 'tl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // Excel cell (Date / ISO string / serial) → 'YYYY-MM-DD'. Mirrors wlToISO.
    const tlToISO = (v) => {
        if (v == null || v === '') return '';
        if (v instanceof Date) return `${v.getFullYear()}-${tlPad(v.getMonth() + 1)}-${tlPad(v.getDate())}`;
        if (typeof v === 'object' && v !== null && 'result' in v) return tlToISO(v.result);
        if (typeof v === 'number') {
            const d = new Date(Math.round((v - 25569) * 86400000));
            return `${d.getUTCFullYear()}-${tlPad(d.getUTCMonth() + 1)}-${tlPad(d.getUTCDate())}`;
        }
        const s = String(v).trim();
        if (s === '-' || s === '') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!isNaN(d)) return `${d.getFullYear()}-${tlPad(d.getMonth() + 1)}-${tlPad(d.getDate())}`;
        return s;
    };
    // ISO 'YYYY-MM-DD' → 'DD Mon YYYY' for display; '' → '—'.
    const tlFmtDate = (iso) => {
        if (!iso) return '—';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        if (!m) return tlEsc(iso);
        const mi = parseInt(m[2], 10) - 1;
        return `${m[3]} ${TL_MONTHS[mi] ? TL_MONTHS[mi][0] + TL_MONTHS[mi].slice(1).toLowerCase() : m[2]} ${m[1]}`;
    };
    const tlMonthKey = (iso) => (/^\d{4}-\d{2}/.test(iso || '') ? iso.slice(0, 7) : '');

    // ── State access ─────────────────────────────────────────────────────
    const tlEnsure = () => {
        const s = window.state;
        if (!s.treeLogs || typeof s.treeLogs !== 'object') s.treeLogs = {};
        const t = s.treeLogs;
        if (!t.company) t.company = TL_COMPANY;
        if (!t.codes || typeof t.codes !== 'object') {
            t.codes = {
                categories: [...TL_DEFAULT_CATEGORIES],
                grades: [...TL_DEFAULT_GRADES],
                species: [...TL_DEFAULT_SPECIES]
            };
        }
        if (!Array.isArray(t.codes.categories)) t.codes.categories = [...TL_DEFAULT_CATEGORIES];
        if (!Array.isArray(t.codes.grades)) t.codes.grades = [...TL_DEFAULT_GRADES];
        if (!Array.isArray(t.codes.species)) t.codes.species = [...TL_DEFAULT_SPECIES];
        if (!t.years || typeof t.years !== 'object') t.years = {};
        return t;
    };
    const tlYearObj = (year) => {
        const t = tlEnsure();
        if (!t.years[year]) t.years[year] = { batches: [] };
        if (!Array.isArray(t.years[year].batches)) t.years[year].batches = [];
        return t.years[year];
    };
    const tlBatches = (year) => tlYearObj(year).batches;
    const tlFindBatch = (year, id) => tlBatches(year).find(b => b.id === id);

    // Import-merge identity: same batch no AND same delivery date. The source
    // workbook legitimately reuses a batch number across two different delivery
    // days (e.g. KU0925AP01 on 09-09 and 09-10), so batch-no alone would wrongly
    // collapse distinct deliveries; including the date keeps them separate while
    // still making a re-import of the same file idempotent.
    const tlSameBatch = (a, b) =>
        String(a.batchNo).trim().toUpperCase() === String(b.batchNo).trim().toUpperCase() &&
        (a.deliveryDate || '') === (b.deliveryDate || '');

    const tlYearList = () => {
        const t = tlEnsure();
        const set = new Set(Object.keys(t.years).filter(k => /^\d{4}$/.test(k)));
        set.add(tlCurrentYear());
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // Default selected year: the most recent year that actually HAS batches,
    // so a fresh load lands on real data instead of an empty current year
    // (the workbook's data is 2024/2025 while the calendar year may be later).
    // Falls back to the most recent year, then the current year.
    const tlDefaultYear = () => {
        const t = tlEnsure();
        const withData = Object.keys(t.years)
            .filter(k => /^\d{4}$/.test(k) && (t.years[k].batches || []).length > 0)
            .sort((a, b) => parseInt(b) - parseInt(a));
        return withData[0] || tlYearList()[0] || tlCurrentYear();
    };

    const tlBatchTotals = (b) => {
        if (!b) return { qty: 0, volume: 0 };
        if (b.detailed) {
            let q = 0, v = 0;
            (b.lines || []).forEach(l => { q += tlNum(l.qty); v += tlNum(l.volume); });
            return { qty: q, volume: v };
        }
        return { qty: tlNum(b.totalQty), volume: tlNum(b.totalVolume) };
    };

    // Sort by delivery date ascending (undated last), then batch no.
    const tlSortBatches = (arr) => [...arr].sort((a, b) => {
        const da = a.deliveryDate || '', db = b.deliveryDate || '';
        if (da && db && da !== db) return da < db ? -1 : 1;
        if (da && !db) return -1;
        if (!da && db) return 1;
        return String(a.batchNo).localeCompare(String(b.batchNo));
    });

    // Group detailed lines by (category, grade) preserving first-appearance order.
    const tlGroupLines = (lines) => {
        const order = [];
        const map = {};
        (lines || []).forEach(l => {
            const cat = tlText(l.category) || '—';
            const grade = tlText(l.grade) || '—';
            const key = cat + ' ' + grade;
            if (!map[key]) { map[key] = { category: cat, grade, rows: [], qty: 0, volume: 0 }; order.push(key); }
            map[key].rows.push(l);
            map[key].qty += tlNum(l.qty);
            map[key].volume += tlNum(l.volume);
        });
        return order.map(k => map[k]);
    };

    // ── Firebase save ────────────────────────────────────────────────────
    const saveTreeLogsData = (silent) => {
        const db = window._treeLogsDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — tree logs not saved.', 'error'); return Promise.resolve(); }
        // Safety: never overwrite the cloud copy until this session has confirmed a
        // successful load. If the initial read failed (e.g. auth/network race on a
        // page reload), state.treeLogs may be empty and saving it would wipe real
        // data. _treeLogsLoaded is set true by init() only after a read succeeds.
        if (window._treeLogsLoaded === false) {
            if (window.notify) window.notify('Tree logs still loading — change not saved (protecting your data). Please reload and try again.', 'error');
            return Promise.resolve();
        }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/tree_logs_data').set(JSON.stringify(window.state.treeLogs))
            .then(() => { if (!silent && window.notify) window.notify('Tree logs saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveTreeLogsData = saveTreeLogsData;

    // ── Invoices (billed-out PDFs) ────────────────────────────────────────
    // Registry lives in state.treeLogs.invoices keyed by invoiceNo:
    //   { date, total, batchNos:[], fileName, hasPdf, uploadedAt, uploadedBy }
    // PDF bytes are stored SEPARATELY (kept out of the main record so saves stay
    // small) as data URLs under shared/tree_logs_invoice_files/<invoiceNo>,
    // mirroring the Weekly module's image handling.
    const TL_INV_FILE_PATH = 'shared/tree_logs_invoice_files';
    const _tlInvCache = {};   // invoiceNo -> data URL (in-memory, never serialised)

    const tlInvoicesObj = () => {
        const t = tlEnsure();
        if (!t.invoices || typeof t.invoices !== 'object') t.invoices = {};
        return t.invoices;
    };
    // invoiceNo for a batch: prefer a user-saved registry link, else the built-in map.
    const tlBatchInvoice = (batchNo) => {
        const reg = tlInvoicesObj();
        for (const inv in reg) { if ((reg[inv].batchNos || []).indexOf(batchNo) >= 0) return inv; }
        return TL_BATCH2INV[batchNo] || null;
    };
    // Derive an invoice number from a PDF filename ("PFB202402001.pdf" -> "PFB202402001").
    const tlInvNoFromName = (name) => String(name || '').replace(/\.[^.]+$/, '').trim().toUpperCase();
    // Date for an invoice not in the map: from the filename PFB<YYYY><MM><seq>.
    const tlInvDateFromNo = (invNo) => {
        const m = /^PFB(\d{4})(\d{2})\d+$/.exec(invNo);
        return m ? `${m[1]}-${m[2]}-01` : '';
    };

    const tlReadFileDataUrl = (file) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read failed'));
        fr.readAsDataURL(file);
    });
    const tlUploadInvoicePdf = (invNo, dataUrl) => {
        const db = window._treeLogsDb;
        _tlInvCache[invNo] = dataUrl;
        if (!db) return Promise.resolve();
        return db.ref(`${TL_INV_FILE_PATH}/${invNo}`).set(dataUrl);
    };
    const tlLoadInvoicePdf = async (invNo) => {
        if (_tlInvCache[invNo]) return _tlInvCache[invNo];
        const db = window._treeLogsDb;
        if (!db) return null;
        const snap = await db.ref(`${TL_INV_FILE_PATH}/${invNo}`).once('value');
        const v = snap.val();
        if (v) _tlInvCache[invNo] = v;
        return v;
    };
    const tlDeleteInvoicePdf = (invNo) => {
        delete _tlInvCache[invNo];
        const db = window._treeLogsDb;
        return db ? db.ref(`${TL_INV_FILE_PATH}/${invNo}`).set(null) : Promise.resolve();
    };
    // Open a stored invoice PDF in a new tab (data URL → Blob URL so the browser
    // renders it inline instead of blocking a long data: navigation).
    const tlOpenInvoice = async (invNo) => {
        try {
            const dataUrl = await tlLoadInvoicePdf(invNo);
            if (!dataUrl) { if (window.notify) window.notify(`No PDF stored for ${invNo} yet — import it first.`, 'warn'); return; }
            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (!w && window.notify) window.notify('Pop-up blocked — allow pop-ups to view the bill.', 'warn');
        } catch (e) {
            if (window.notify) window.notify('Could not open invoice: ' + e.message, 'error');
        }
    };

    // Import one or many invoice PDFs. Filenames are the invoice numbers; the
    // built-in map supplies date/total/linked-batches, with filename fallback
    // for orphans (stored as a viewable, unlinked archive entry).
    const importInvoices = async (fileList) => {
        if (typeof window._canEdit === 'function' && !window._canEdit('treelogs')) {
            if (window.notify) window.notify('You do not have edit access for tree logs.', 'warn'); return;
        }
        const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name));
        if (!files.length) { if (window.notify) window.notify('Please choose one or more invoice PDF files.', 'warn'); return; }
        const reg = tlInvoicesObj();
        let linked = 0, archived = 0, failed = 0;
        const me = (window.state && window.state.currentUserEmail) || (window._fb && window._fb.auth && window._fb.auth.currentUser && window._fb.auth.currentUser.email) || '';
        for (const f of files) {
            const invNo = tlInvNoFromName(f.name);
            try {
                const dataUrl = await tlReadFileDataUrl(f);
                await tlUploadInvoicePdf(invNo, dataUrl);
                const mapped = TL_INVOICE_MAP[invNo];
                const batchNos = mapped ? (mapped.b || []).slice() : [];
                reg[invNo] = {
                    date: mapped ? mapped.d : tlInvDateFromNo(invNo),
                    total: mapped ? mapped.t : null,
                    batchNos: batchNos,
                    fileName: f.name,
                    hasPdf: true,
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: me
                };
                if (batchNos.length) linked++; else archived++;
            } catch (e) { console.error('invoice import', invNo, e); failed++; }
        }
        await saveTreeLogsData(true);
        if (typeof window.logAudit === 'function') window.logAudit('import', 'tree_logs_invoices', `${files.length} PDF(s): ${linked} linked, ${archived} archive`, '');
        window.renderTreeLogs();
        if (window.notify) window.notify(`Imported ${files.length - failed} invoice PDF(s): ${linked} linked to batches, ${archived} archive${failed ? `, ${failed} failed` : ''}.`, failed ? 'warn' : 'success');
    };
    window.importTreeLogInvoices = importInvoices;

    const tlEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    // ── Styling (match the wages / reports look) ─────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;font-size:0.85rem;';

    const tlCanEdit = () => (typeof window._canEdit !== 'function') || window._canEdit('treelogs');

    // =====================================================================
    // Main render — dispatches on _tlMode
    // =====================================================================
    window.renderTreeLogs = () => {
        const host = document.getElementById('tree-logs-wrapper');
        if (!host) return;
        const state = window.state;
        tlEnsure();
        if (!state.treeLogsYear || !/^\d{4}$/.test(state.treeLogsYear)) {
            state.treeLogsYear = tlDefaultYear();
        } else if (!_tlYearCorrected && !tlBatches(state.treeLogsYear).length) {
            // First render after a page load: if the remembered year is empty
            // but another year has batches (e.g. defaulted/remembered as the
            // current calendar year), jump to the most recent year with data.
            const dy = tlDefaultYear();
            if (dy !== state.treeLogsYear && tlBatches(dy).length) state.treeLogsYear = dy;
        }
        _tlYearCorrected = true;
        if (_tlMode === 'detail') return tlRenderDetail(host);
        if (_tlMode === 'edit') return tlRenderEditor(host);
        if (_tlMode === 'analytics') return tlRenderAnalytics(host);
        if (_tlMode === 'codes') return tlRenderCodeLists(host);
        if (_tlMode === 'invoices') return tlRenderInvoices(host);
        return tlRenderList(host);
    };

    const tlGoList = () => { _tlMode = 'list'; _tlDetailId = null; _tlEditId = null; window.renderTreeLogs(); };

    // ── List / master summary (ACMG style) ───────────────────────────────
    const tlRenderList = (host) => {
        const state = window.state;
        const year = state.treeLogsYear;
        const canEdit = tlCanEdit();
        const batches = tlSortBatches(tlBatches(year));

        const yearOpts = tlYearList().map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');

        let grandQty = 0, grandVol = 0;
        // Group by delivery month (undated last).
        const groups = {}; const order = [];
        batches.forEach(b => {
            const mk = tlMonthKey(b.deliveryDate) || 'zzz-none';
            if (!groups[mk]) { groups[mk] = []; order.push(mk); }
            groups[mk].push(b);
        });
        order.sort((a, b) => a.localeCompare(b));

        let rowsHtml = '';
        if (!batches.length) {
            rowsHtml = `<tr><td colspan="8" style="padding:2rem; text-align:center; color:var(--text-secondary);">
                No log batches for <strong>${tlEsc(year)}</strong> yet.<br><br>
                Click <strong>➕ New Batch</strong> to add one, or <strong>📥 Import</strong> to load your Excel.</td></tr>`;
        } else {
            order.forEach(mk => {
                const list = groups[mk];
                let mq = 0, mv = 0;
                const label = mk === 'zzz-none'
                    ? 'No delivery date'
                    : `${TL_MONTH_LONG[parseInt(mk.slice(5, 7), 10) - 1]} ${mk.slice(0, 4)}`;
                rowsHtml += `<tr style="background:var(--bg-main,#f1f5f1);"><td colspan="8" style="padding:6px 10px; font-weight:700; color:var(--text-primary); border-top:2px solid var(--border-color,#ccc);">${tlEsc(label)} <span style="font-weight:400; color:var(--text-secondary);">· ${list.length} batch(es)</span></td></tr>`;
                list.forEach((b, i) => {
                    const t = tlBatchTotals(b);
                    mq += t.qty; mv += t.volume;
                    const speciesCell = b.detailed
                        ? `<span style="color:var(--text-secondary);">${(b.lines || []).length} line(s)</span>`
                        : tlEsc(b.species || '—');
                    const batchCell = b.detailed
                        ? `<a href="#" class="tl-open" data-id="${tlEsc(b.id)}" style="color:var(--accent,#16a34a); font-weight:600; text-decoration:none;">📋 ${tlEsc(b.batchNo)}</a>`
                        : `<span title="Summary-only batch (no detail)">Σ ${tlEsc(b.batchNo)}</span>`;
                    // Invoice cell: 🧾 + invoice no. Clickable when the PDF is stored;
                    // greyed (PDF not uploaded yet) when only the link is known.
                    const invNo = tlBatchInvoice(b.batchNo);
                    let invCell = '<span style="color:var(--text-secondary);">—</span>';
                    if (invNo) {
                        const reg = tlInvoicesObj()[invNo];
                        if (reg && reg.hasPdf) {
                            invCell = `<a href="#" class="tl-inv" data-inv="${tlEsc(invNo)}" title="Open bill ${tlEsc(invNo)}" style="color:var(--accent,#16a34a); font-weight:600; text-decoration:none; white-space:nowrap;">🧾 ${tlEsc(invNo)}</a>`;
                        } else {
                            invCell = `<span title="Billed on ${tlEsc(invNo)} — PDF not imported yet" style="color:var(--text-secondary); white-space:nowrap;">🧾 ${tlEsc(invNo)}</span>`;
                        }
                    }
                    const actions = canEdit
                        ? `<button class="tl-edit" data-id="${tlEsc(b.id)}" title="Edit batch" style="${BTN} padding:2px 8px;">✏</button>
                           <button class="tl-del" data-id="${tlEsc(b.id)}" title="Delete batch" style="${BTN} padding:2px 8px; color:var(--danger,#dc2626);">🗑</button>`
                        : '';
                    rowsHtml += `<tr style="border-bottom:1px solid var(--border-color,#eee);">
                        <td style="padding:5px 10px; text-align:right; color:var(--text-secondary);">${i + 1}</td>
                        <td style="padding:5px 10px; white-space:nowrap;">${tlFmtDate(b.deliveryDate)}</td>
                        <td style="padding:5px 10px; white-space:nowrap;">${batchCell}</td>
                        <td style="padding:5px 10px;">${invCell}</td>
                        <td style="padding:5px 10px;">${speciesCell}</td>
                        <td style="padding:5px 10px; text-align:right;">${tlInt(t.qty)}</td>
                        <td style="padding:5px 10px; text-align:right;">${tlVol(t.volume)}</td>
                        <td style="padding:5px 10px; text-align:center; white-space:nowrap;">${actions}</td></tr>`;
                });
                grandQty += mq; grandVol += mv;
                rowsHtml += `<tr style="background:var(--bg-card,#fff); font-weight:600;">
                    <td colspan="5" style="padding:5px 10px; text-align:right; color:var(--text-secondary);">Sub-total</td>
                    <td style="padding:5px 10px; text-align:right;">${tlInt(mq)}</td>
                    <td style="padding:5px 10px; text-align:right;">${tlVol(mv)}</td><td></td></tr>`;
            });
        }

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1200px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🪵 Tree Logs Recording</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Summary of all delivery batches (like your ACMG sheets). Click a 📋 batch to see its detailed
            species / grade breakdown. Σ rows are summary-only batches with no detail.</p>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="tl-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="tl-new" style="${BTN} background:var(--accent,#16a34a); color:#fff; border-color:var(--accent,#16a34a);">➕ New Batch</button>` : ''}
            ${canEdit ? `<button id="tl-import" style="${BTN}">📥 Import</button><input type="file" id="tl-import-input" accept=".xlsx,.xls" style="display:none;">` : ''}
            <button id="tl-template" style="${BTN}">⬇ Template</button>
            <button id="tl-export" style="${BTN}">⬇ Excel</button>
            <button id="tl-invoices" style="${BTN}">🧾 Invoices</button>
            <button id="tl-analytics" style="${BTN}">📊 Analytics</button>
            <button id="tl-codes" style="${BTN}">⚙ Code Lists</button>
          </div>

          <div style="${CARD} padding:0; overflow:hidden;">
            <div style="overflow:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
                <thead><tr style="background:var(--bg-card,#fff);">
                  <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">No.</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Delivery Date</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Batch No.</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Invoice</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Species / Detail</th>
                  <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">Quantity (PCS)</th>
                  <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">Volume (MT)</th>
                  <th style="padding:8px 10px; border-bottom:2px solid var(--border-color,#ccc);"></th>
                </tr></thead>
                <tbody>${rowsHtml}</tbody>
                ${batches.length ? `<tfoot><tr style="font-weight:800; font-size:1rem; border-top:3px double var(--border-color,#999);">
                  <td colspan="5" style="padding:10px; text-align:right;">GRAND TOTAL (${year})</td>
                  <td style="padding:10px; text-align:right;">${tlInt(grandQty)}</td>
                  <td style="padding:10px; text-align:right;">${tlVol(grandVol)}</td><td></td></tr></tfoot>` : ''}
              </table>
            </div>
          </div>
        </div>`;

        // Wiring
        host.querySelector('#tl-year').onchange = (e) => { state.treeLogsYear = e.target.value; window.renderTreeLogs(); };
        const byId = (id) => host.querySelector(id);
        if (byId('#tl-template')) byId('#tl-template').onclick = () => tlGuardBtn(byId('#tl-template'), () => downloadTreeLogsTemplate(year));
        if (byId('#tl-export')) byId('#tl-export').onclick = () => tlGuardBtn(byId('#tl-export'), () => downloadTreeLogsReport(year));
        if (byId('#tl-invoices')) byId('#tl-invoices').onclick = () => { _tlMode = 'invoices'; window.renderTreeLogs(); };
        if (byId('#tl-analytics')) byId('#tl-analytics').onclick = () => { _tlMode = 'analytics'; window.renderTreeLogs(); };
        if (byId('#tl-codes')) byId('#tl-codes').onclick = () => { _tlMode = 'codes'; window.renderTreeLogs(); };
        if (canEdit && byId('#tl-new')) byId('#tl-new').onclick = () => { _tlMode = 'edit'; _tlEditId = null; window.renderTreeLogs(); };
        if (canEdit && byId('#tl-import')) {
            const input = byId('#tl-import-input');
            byId('#tl-import').onclick = () => input.click();
            input.onchange = async () => { const f = input.files[0]; input.value = ''; if (f) await importTreeLogs(f, year); };
        }
        host.querySelectorAll('.tl-inv').forEach(a => a.onclick = (e) => { e.preventDefault(); tlOpenInvoice(a.dataset.inv); });
        host.querySelectorAll('.tl-open').forEach(a => a.onclick = (e) => { e.preventDefault(); _tlDetailId = a.dataset.id; _tlMode = 'detail'; window.renderTreeLogs(); });
        host.querySelectorAll('.tl-edit').forEach(b => b.onclick = () => { _tlEditId = b.dataset.id; _tlMode = 'edit'; window.renderTreeLogs(); });
        host.querySelectorAll('.tl-del').forEach(b => b.onclick = () => tlDeleteBatch(year, b.dataset.id));
    };

    const tlGuardBtn = async (btn, fn) => {
        if (!btn) return fn();
        btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ …';
        try { await fn(); }
        catch (err) { if (window.notify) window.notify('Failed: ' + err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = old; }
    };

    const tlDeleteBatch = (year, id) => {
        const arr = tlBatches(year);
        const idx = arr.findIndex(b => b.id === id);
        if (idx < 0) return;
        const removed = arr[idx];
        arr.splice(idx, 1);
        saveTreeLogsData(true);
        window.renderTreeLogs();
        const msg = `Batch "${removed.batchNo}" deleted.`;
        if (typeof window.notifyUndo === 'function') {
            window.notifyUndo(msg, () => {
                tlBatches(year).push(removed);
                saveTreeLogsData(true);
                window.renderTreeLogs();
            });
        } else if (window.notify) {
            window.notify(msg, 'info');
        }
        if (typeof window.logAudit === 'function') window.logAudit('delete', 'tree_logs', `${year}: ${removed.batchNo}`, year);
    };

    const tlMoney = (n) => (n == null || n === '') ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const tlDeleteInvoice = (invNo) => {
        const reg = tlInvoicesObj();
        const removed = reg[invNo];
        if (!removed) return;
        const cachedPdf = _tlInvCache[invNo];   // keep for undo within this session
        delete reg[invNo];
        tlDeleteInvoicePdf(invNo);
        if (cachedPdf) _tlInvCache[invNo] = cachedPdf;
        saveTreeLogsData(true);
        window.renderTreeLogs();
        const restore = () => {
            reg[invNo] = removed;
            if (cachedPdf) tlUploadInvoicePdf(invNo, cachedPdf);
            saveTreeLogsData(true);
            window.renderTreeLogs();
        };
        if (typeof window.notifyUndo === 'function') window.notifyUndo(`Invoice "${invNo}" removed.`, restore);
        else if (window.notify) window.notify(`Invoice "${invNo}" removed.`, 'info');
        if (typeof window.logAudit === 'function') window.logAudit('delete', 'tree_logs_invoices', invNo, '');
    };

    // ── Invoice Manager ───────────────────────────────────────────────────
    const tlRenderInvoices = (host) => {
        const canEdit = tlCanEdit();
        const reg = tlInvoicesObj();
        // Union of the built-in map + anything already uploaded (e.g. 2022 archive).
        const nos = Array.from(new Set([...Object.keys(TL_INVOICE_MAP), ...Object.keys(reg)]));
        const info = (no) => {
            const r = reg[no], m = TL_INVOICE_MAP[no];
            const batchNos = (r && r.batchNos) ? r.batchNos : (m ? (m.b || []) : []);
            return {
                date: (r && r.date) || (m && m.d) || tlInvDateFromNo(no),
                total: (r && r.total != null) ? r.total : (m ? m.t : null),
                batchNos, hasPdf: !!(r && r.hasPdf)
            };
        };
        nos.sort((a, b) => (info(b).date || '').localeCompare(info(a).date || '') || a.localeCompare(b));

        let uploaded = 0, linkedCnt = 0, archiveCnt = 0;
        let rows = '';
        nos.forEach(no => {
            const x = info(no);
            if (x.hasPdf) uploaded++;
            const isArchive = !x.batchNos.length;
            if (isArchive) archiveCnt++; else linkedCnt++;
            const linkCell = isArchive
                ? `<span style="color:var(--text-secondary);">Archive (no batch)</span>`
                : `<span title="${tlEsc(x.batchNos.join(', '))}">${x.batchNos.length} batch(es)</span>`;
            const pdfCell = x.hasPdf
                ? `<a href="#" class="tl-inv-open" data-inv="${tlEsc(no)}" style="color:var(--accent,#16a34a); font-weight:600; text-decoration:none;">📄 View</a>`
                : `<span style="color:var(--text-secondary);">not imported</span>`;
            const del = (canEdit && x.hasPdf) ? `<button class="tl-inv-del" data-inv="${tlEsc(no)}" title="Remove invoice" style="${BTN} padding:2px 8px; color:var(--danger,#dc2626);">🗑</button>` : '';
            rows += `<tr style="border-bottom:1px solid var(--border-color,#eee); ${x.hasPdf ? '' : 'opacity:0.7;'}">
                <td style="padding:5px 10px; white-space:nowrap; font-weight:600;">${tlEsc(no)}</td>
                <td style="padding:5px 10px; white-space:nowrap;">${tlFmtDate(x.date)}</td>
                <td style="padding:5px 10px; text-align:right; white-space:nowrap;">${tlMoney(x.total)}</td>
                <td style="padding:5px 10px;">${linkCell}</td>
                <td style="padding:5px 10px; text-align:center;">${pdfCell}</td>
                <td style="padding:5px 10px; text-align:center;">${del}</td></tr>`;
        });

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1000px;">
          <div style="display:flex; gap:0.6rem; align-items:center; margin-bottom:1rem;">
            <button id="tl-back" style="${BTN}">← Back to summary</button>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="tl-inv-import" style="${BTN} background:var(--accent,#16a34a); color:#fff; border-color:var(--accent,#16a34a);">📥 Import invoice PDFs</button>
            <input type="file" id="tl-inv-input" accept="application/pdf,.pdf" multiple style="display:none;">` : ''}
          </div>
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">🧾 Invoices</h2>
          <p style="color:var(--text-secondary); margin:0 0 1rem; font-size:0.85rem;">
            Billed-out invoices. Each links to its delivery batch(es); the batch list shows 🧾 with a link to open the bill.
            ${canEdit ? 'Import your invoice PDFs (file names like <code>PFB202402001.pdf</code>) — they auto-link to batches and store in the cloud.' : ''}</p>
          <div style="${CARD} display:flex; gap:1.5rem; flex-wrap:wrap;">
            <div><div style="font-size:1.4rem; font-weight:800; color:var(--text-primary);">${nos.length}</div><div style="font-size:0.78rem; color:var(--text-secondary);">invoices known</div></div>
            <div><div style="font-size:1.4rem; font-weight:800; color:var(--accent,#16a34a);">${uploaded}</div><div style="font-size:0.78rem; color:var(--text-secondary);">PDFs imported</div></div>
            <div><div style="font-size:1.4rem; font-weight:800; color:var(--text-primary);">${linkedCnt}</div><div style="font-size:0.78rem; color:var(--text-secondary);">linked to batches</div></div>
            <div><div style="font-size:1.4rem; font-weight:800; color:var(--text-primary);">${archiveCnt}</div><div style="font-size:0.78rem; color:var(--text-secondary);">archive (no batch)</div></div>
          </div>
          <div style="${CARD} padding:0; overflow:hidden;">
            <div style="overflow:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
                <thead><tr style="background:var(--bg-card,#fff);">
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Invoice No.</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Date</th>
                  <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">Amount (RM)</th>
                  <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Linked</th>
                  <th style="padding:8px 10px; text-align:center; border-bottom:2px solid var(--border-color,#ccc);">Bill PDF</th>
                  <th style="padding:8px 10px; border-bottom:2px solid var(--border-color,#ccc);"></th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>`;

        host.querySelector('#tl-back').onclick = tlGoList;
        host.querySelectorAll('.tl-inv-open').forEach(a => a.onclick = (e) => { e.preventDefault(); tlOpenInvoice(a.dataset.inv); });
        if (canEdit) {
            host.querySelectorAll('.tl-inv-del').forEach(b => b.onclick = () => tlDeleteInvoice(b.dataset.inv));
            const imp = host.querySelector('#tl-inv-import'), inp = host.querySelector('#tl-inv-input');
            if (imp && inp) {
                imp.onclick = () => inp.click();
                // NB: snapshot to an array BEFORE clearing inp.value — setting
                // value='' empties the live FileList reference (so `inp.files`
                // grabbed beforehand would already be length 0).
                inp.onchange = async () => { const fs = Array.from(inp.files || []); inp.value = ''; if (fs.length) await tlGuardBtn(imp, () => importInvoices(fs)); };
            }
        }
    };

    // ── Detail (KU style) ─────────────────────────────────────────────────
    const tlRenderDetail = (host) => {
        const state = window.state;
        const year = state.treeLogsYear;
        const b = tlFindBatch(year, _tlDetailId);
        if (!b) return tlGoList();
        const canEdit = tlCanEdit();
        const t = tlEnsure();

        if (!b.detailed) {
            host.innerHTML = `<div style="padding:1.25rem 1.5rem; max-width:900px;">
                <button id="tl-back" style="${BTN} margin-bottom:1rem;">← Back to summary</button>
                <div style="${CARD}">This is a <strong>summary-only</strong> batch — no species/grade detail was recorded.</div></div>`;
            host.querySelector('#tl-back').onclick = tlGoList;
            return;
        }

        const groups = tlGroupLines(b.lines);
        let gQty = 0, gVol = 0;
        let body = '';
        groups.forEach(g => {
            gQty += g.qty; gVol += g.volume;
            g.rows.forEach((l, i) => {
                body += `<tr style="border-bottom:1px solid var(--border-color,#f0f0f0);">
                    <td style="padding:4px 10px;">${i === 0 ? tlEsc(g.category) : ''}</td>
                    <td style="padding:4px 10px;">${tlEsc(l.species)}</td>
                    <td style="padding:4px 10px;">${tlEsc(l.grade)}</td>
                    <td style="padding:4px 10px; text-align:right;">${tlInt(l.qty)}</td>
                    <td style="padding:4px 10px; text-align:right;">${tlVol(l.volume)}</td></tr>`;
            });
            body += `<tr style="font-weight:600; background:var(--bg-main,#f6f8f6);">
                <td colspan="3" style="padding:4px 10px; text-align:right; color:var(--text-secondary);">Sub-Total:</td>
                <td style="padding:4px 10px; text-align:right;">${tlInt(g.qty)}</td>
                <td style="padding:4px 10px; text-align:right;">${tlVol(g.volume)}</td></tr>`;
        });

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:900px;">
          <div style="display:flex; gap:0.6rem; align-items:center; margin-bottom:1rem;">
            <button id="tl-back" style="${BTN}">← Back to summary</button>
            <div style="flex:1;"></div>
            ${canEdit ? `<button id="tl-edit" style="${BTN}">✏ Edit</button>` : ''}
            <button id="tl-batch-xls" style="${BTN}">⬇ Excel</button>
          </div>
          <div style="${CARD} text-align:center;">
            <div style="font-weight:700; font-size:1.05rem; color:var(--text-primary);">${tlEsc(t.company)}</div>
            <div style="color:var(--text-secondary); margin:2px 0;">SUMMARIZED LOGS SPECIES</div>
            <div style="font-weight:600; color:var(--text-primary);">BATCH: ${tlEsc(b.batchNo)}</div>
            <div style="color:var(--text-secondary); font-size:0.85rem;">Delivery Completed Date: ${tlFmtDate(b.deliveryDate)}</div>
            ${(() => {
                const invNo = tlBatchInvoice(b.batchNo);
                if (!invNo) return '';
                const reg = tlInvoicesObj()[invNo];
                return (reg && reg.hasPdf)
                    ? `<div style="font-size:0.85rem; margin-top:2px;">Invoice: <a href="#" id="tl-detail-inv" data-inv="${tlEsc(invNo)}" style="color:var(--accent,#16a34a); font-weight:600; text-decoration:none;">🧾 ${tlEsc(invNo)}</a></div>`
                    : `<div style="font-size:0.85rem; margin-top:2px; color:var(--text-secondary);">Invoice: 🧾 ${tlEsc(invNo)} <span style="font-size:0.78rem;">(PDF not imported)</span></div>`;
            })()}
          </div>
          <div style="${CARD} padding:0; overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
              <thead><tr style="background:var(--bg-card,#fff);">
                <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Species Category</th>
                <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Species</th>
                <th style="padding:8px 10px; text-align:left; border-bottom:2px solid var(--border-color,#ccc);">Grade</th>
                <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">Quantity (PCS)</th>
                <th style="padding:8px 10px; text-align:right; border-bottom:2px solid var(--border-color,#ccc);">Volume (MT)</th>
              </tr></thead>
              <tbody>${body}</tbody>
              <tfoot><tr style="font-weight:800; border-top:3px double var(--border-color,#999);">
                <td colspan="3" style="padding:10px; text-align:right;">GRAND TOTAL:</td>
                <td style="padding:10px; text-align:right;">${tlInt(gQty)}</td>
                <td style="padding:10px; text-align:right;">${tlVol(gVol)}</td></tr></tfoot>
            </table>
          </div>
        </div>`;

        host.querySelector('#tl-back').onclick = tlGoList;
        if (canEdit && host.querySelector('#tl-edit')) host.querySelector('#tl-edit').onclick = () => { _tlEditId = b.id; _tlMode = 'edit'; window.renderTreeLogs(); };
        host.querySelector('#tl-batch-xls').onclick = () => tlGuardBtn(host.querySelector('#tl-batch-xls'), () => downloadTreeLogsBatch(year, b.id));
        const dInv = host.querySelector('#tl-detail-inv');
        if (dInv) dInv.onclick = (e) => { e.preventDefault(); tlOpenInvoice(dInv.dataset.inv); };
    };

    // ── Editor (manual entry) ─────────────────────────────────────────────
    const tlRenderEditor = (host) => {
        const state = window.state;
        const year = state.treeLogsYear;
        if (!tlCanEdit()) { tlGoList(); return; }
        const t = tlEnsure();
        const existing = _tlEditId ? tlFindBatch(year, _tlEditId) : null;
        // working copy
        const draft = existing
            ? JSON.parse(JSON.stringify(existing))
            : { id: null, batchNo: '', deliveryDate: '', detailed: true, species: '', totalQty: '', totalVolume: '', lines: [] };
        if (!Array.isArray(draft.lines)) draft.lines = [];

        const dl = (id, items) => `<datalist id="${id}">${items.map(x => `<option value="${tlEsc(x)}"></option>`).join('')}</datalist>`;

        const renderLinesTable = () => {
            const rows = draft.lines.map((l, i) => `
              <tr data-i="${i}">
                <td style="padding:3px 4px;"><input class="tl-l-cat" list="tl-cat-list" value="${tlEsc(l.category || '')}" style="${SS} width:110px;"></td>
                <td style="padding:3px 4px;"><input class="tl-l-sp" list="tl-sp-list" value="${tlEsc(l.species || '')}" style="${SS} width:120px;"></td>
                <td style="padding:3px 4px;"><input class="tl-l-gr" list="tl-gr-list" value="${tlEsc(l.grade || '')}" style="${SS} width:90px;"></td>
                <td style="padding:3px 4px;"><input class="tl-l-qty" type="number" step="1" value="${l.qty != null ? l.qty : ''}" style="${SS} width:90px; text-align:right;"></td>
                <td style="padding:3px 4px;"><input class="tl-l-vol" type="number" step="0.001" value="${l.volume != null ? l.volume : ''}" style="${SS} width:100px; text-align:right;"></td>
                <td style="padding:3px 4px;"><button class="tl-l-del" title="Remove line" style="${BTN} padding:2px 8px; color:var(--danger,#dc2626);">✕</button></td>
              </tr>`).join('');
            return `
              <table style="border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
                <thead><tr style="color:var(--text-secondary);">
                  <th style="padding:4px; text-align:left;">Species Category</th>
                  <th style="padding:4px; text-align:left;">Species</th>
                  <th style="padding:4px; text-align:left;">Grade</th>
                  <th style="padding:4px; text-align:right;">Qty (PCS)</th>
                  <th style="padding:4px; text-align:right;">Volume (MT)</th>
                  <th style="padding:4px;"></th>
                </tr></thead>
                <tbody id="tl-lines-body">${rows || `<tr><td colspan="6" style="padding:8px; color:var(--text-secondary);">No lines yet — click “➕ Add line”.</td></tr>`}</tbody>
              </table>`;
        };

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:900px;">
          <button id="tl-cancel" style="${BTN} margin-bottom:1rem;">← Cancel</button>
          <h2 style="margin:0 0 1rem; color:var(--text-primary);">${existing ? '✏ Edit Batch' : '➕ New Batch'} <span style="font-weight:400; color:var(--text-secondary); font-size:0.9rem;">(${year})</span></h2>

          <div style="${CARD}">
            <div style="display:flex; gap:1rem; flex-wrap:wrap;">
              <label style="font-size:0.82rem; color:var(--text-secondary);">Batch No.<br>
                <input id="tl-batchno" value="${tlEsc(draft.batchNo)}" placeholder="e.g. KU0825A01" style="${SS} width:200px; margin-top:3px;"></label>
              <label style="font-size:0.82rem; color:var(--text-secondary);">Delivery Completed Date<br>
                <input id="tl-date" type="date" value="${tlEsc(draft.deliveryDate || '')}" style="${SS} margin-top:3px;"></label>
              <label style="font-size:0.82rem; color:var(--text-secondary);">Detail level<br>
                <select id="tl-detailed" style="${SS} margin-top:3px;">
                  <option value="1" ${draft.detailed ? 'selected' : ''}>Detailed (species / grade breakdown)</option>
                  <option value="0" ${!draft.detailed ? 'selected' : ''}>Summary only (totals)</option>
                </select></label>
            </div>
          </div>

          <div id="tl-detail-card" style="${CARD} ${draft.detailed ? '' : 'display:none;'}">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.6rem;">
              <strong style="color:var(--text-primary);">Species / Grade lines</strong>
              <button id="tl-addline" style="${BTN}">➕ Add line</button>
            </div>
            <div id="tl-lines-wrap">${renderLinesTable()}</div>
            <div style="margin-top:0.7rem; font-weight:700; color:var(--text-primary);">
              Totals: <span id="tl-sum-qty">0</span> PCS · <span id="tl-sum-vol">0.000</span> MT</div>
          </div>

          <div id="tl-summary-card" style="${CARD} ${draft.detailed ? 'display:none;' : ''}">
            <div style="display:flex; gap:1rem; flex-wrap:wrap;">
              <label style="font-size:0.82rem; color:var(--text-secondary);">Species<br>
                <input id="tl-s-species" list="tl-sp-list" value="${tlEsc(draft.species || '')}" placeholder="e.g. ACMG" style="${SS} width:160px; margin-top:3px;"></label>
              <label style="font-size:0.82rem; color:var(--text-secondary);">Total Quantity (PCS)<br>
                <input id="tl-s-qty" type="number" step="1" value="${draft.totalQty != null ? draft.totalQty : ''}" style="${SS} width:140px; margin-top:3px; text-align:right;"></label>
              <label style="font-size:0.82rem; color:var(--text-secondary);">Total Volume (MT)<br>
                <input id="tl-s-vol" type="number" step="0.001" value="${draft.totalVolume != null ? draft.totalVolume : ''}" style="${SS} width:140px; margin-top:3px; text-align:right;"></label>
            </div>
          </div>

          <div style="display:flex; gap:0.6rem; margin-top:0.5rem;">
            <button id="tl-save" style="${BTN} background:var(--accent,#16a34a); color:#fff; border-color:var(--accent,#16a34a);">💾 Save Batch</button>
            <button id="tl-cancel2" style="${BTN}">Cancel</button>
          </div>

          ${dl('tl-cat-list', t.codes.categories)}
          ${dl('tl-sp-list', t.codes.species)}
          ${dl('tl-gr-list', t.codes.grades)}
        </div>`;

        const q = (s) => host.querySelector(s);
        const recompute = () => {
            let qty = 0, vol = 0;
            host.querySelectorAll('#tl-lines-body tr[data-i]').forEach(tr => {
                qty += tlNum(tr.querySelector('.tl-l-qty').value);
                vol += tlNum(tr.querySelector('.tl-l-vol').value);
            });
            q('#tl-sum-qty').textContent = tlInt(qty);
            q('#tl-sum-vol').textContent = tlVol(vol);
        };
        // Sync draft.lines from current inputs (called before structural re-render).
        const syncLines = () => {
            const out = [];
            host.querySelectorAll('#tl-lines-body tr[data-i]').forEach(tr => {
                out.push({
                    category: tr.querySelector('.tl-l-cat').value.trim(),
                    species: tr.querySelector('.tl-l-sp').value.trim(),
                    grade: tr.querySelector('.tl-l-gr').value.trim(),
                    qty: tlNum(tr.querySelector('.tl-l-qty').value),
                    volume: tlNum(tr.querySelector('.tl-l-vol').value)
                });
            });
            draft.lines = out;
        };
        const rerenderLines = () => { q('#tl-lines-wrap').innerHTML = renderLinesTable(); bindLineEvents(); recompute(); };
        const bindLineEvents = () => {
            host.querySelectorAll('.tl-l-del').forEach(btn => btn.onclick = () => {
                const i = parseInt(btn.closest('tr').dataset.i, 10);
                syncLines(); draft.lines.splice(i, 1); rerenderLines();
            });
            const body = q('#tl-lines-body');
            if (body) body.oninput = recompute;
        };
        bindLineEvents();
        recompute();   // show correct totals for any pre-existing lines on load

        q('#tl-detailed').onchange = (e) => {
            draft.detailed = e.target.value === '1';
            q('#tl-detail-card').style.display = draft.detailed ? '' : 'none';
            q('#tl-summary-card').style.display = draft.detailed ? 'none' : '';
        };
        q('#tl-addline').onclick = () => { syncLines(); draft.lines.push({ category: '', species: '', grade: '', qty: '', volume: '' }); rerenderLines(); };
        q('#tl-cancel').onclick = q('#tl-cancel2').onclick = () => { if (existing) { _tlMode = 'detail'; _tlDetailId = existing.id; if (!existing.detailed) _tlMode = 'list'; } else { _tlMode = 'list'; } window.renderTreeLogs(); };

        q('#tl-save').onclick = () => {
            const batchNo = q('#tl-batchno').value.trim();
            if (!batchNo) { if (window.notify) window.notify('Batch No. is required.', 'warn'); return; }
            const detailed = q('#tl-detailed').value === '1';
            const rec = existing || { id: tlUid(), createdAt: new Date().toISOString() };
            rec.batchNo = batchNo;
            rec.deliveryDate = q('#tl-date').value || '';
            rec.detailed = detailed;
            if (detailed) {
                syncLines();
                rec.lines = draft.lines.filter(l => l.species || l.category || l.grade || l.qty || l.volume);
                if (!rec.lines.length) { if (window.notify) window.notify('Add at least one species line (or switch to Summary only).', 'warn'); return; }
                delete rec.species; delete rec.totalQty; delete rec.totalVolume;
            } else {
                rec.species = q('#tl-s-species').value.trim();
                rec.totalQty = tlNum(q('#tl-s-qty').value);
                rec.totalVolume = tlNum(q('#tl-s-vol').value);
                rec.lines = [];
            }
            rec.updatedAt = new Date().toISOString();
            rec.updatedBy = window.currentUserEmail || 'user';
            tlLearnCodes(rec);
            if (!existing) tlBatches(year).push(rec);
            saveTreeLogsData(false);
            if (typeof window.logAudit === 'function') window.logAudit(existing ? 'edit' : 'create', 'tree_logs', `${year}: ${rec.batchNo}`, year);
            _tlEditId = null;
            if (rec.detailed) { _tlMode = 'detail'; _tlDetailId = rec.id; } else { _tlMode = 'list'; }
            window.renderTreeLogs();
        };
    };

    // Add any new category/species/grade codes seen on a batch to the code lists.
    const tlLearnCodes = (b) => {
        const t = tlEnsure();
        const addTo = (arr, v) => { v = tlText(v); if (v && !arr.some(x => x.toUpperCase() === v.toUpperCase())) arr.push(v); };
        if (b.detailed) (b.lines || []).forEach(l => { addTo(t.codes.categories, l.category); addTo(t.codes.species, l.species); addTo(t.codes.grades, l.grade); });
        else addTo(t.codes.species, b.species);
    };

    // ── Analytics ─────────────────────────────────────────────────────────
    const tlRenderAnalytics = (host) => {
        const state = window.state;
        const year = state.treeLogsYear;
        const batches = tlBatches(year);
        const agg = (keyFn) => {
            const map = {};
            batches.forEach(b => {
                if (b.detailed) {
                    (b.lines || []).forEach(l => {
                        const k = tlText(keyFn(l)) || '(blank)';
                        if (!map[k]) map[k] = { qty: 0, vol: 0 };
                        map[k].qty += tlNum(l.qty); map[k].vol += tlNum(l.volume);
                    });
                } else if (keyFn === keySpecies) {
                    const k = tlText(b.species) || '(unspecified)';
                    if (!map[k]) map[k] = { qty: 0, vol: 0 };
                    map[k].qty += tlNum(b.totalQty); map[k].vol += tlNum(b.totalVolume);
                }
            });
            return map;
        };
        const keySpecies = (l) => l.species;
        const keyGrade = (l) => l.grade;
        const keyCat = (l) => l.category;

        const totalVol = batches.reduce((s, b) => s + tlBatchTotals(b).volume, 0) || 1;
        const tableFor = (title, map, note) => {
            const rows = Object.entries(map).sort((a, b) => b[1].vol - a[1].vol);
            if (!rows.length) return `<div style="${CARD}"><strong>${title}</strong><br><span style="color:var(--text-secondary);">No data.</span></div>`;
            let tot = { qty: 0, vol: 0 };
            const body = rows.map(([k, v]) => {
                tot.qty += v.qty; tot.vol += v.vol;
                const pct = (v.vol / totalVol * 100).toFixed(1);
                return `<tr style="border-bottom:1px solid var(--border-color,#eee);">
                    <td style="padding:4px 10px;">${tlEsc(k)}</td>
                    <td style="padding:4px 10px; text-align:right;">${tlInt(v.qty)}</td>
                    <td style="padding:4px 10px; text-align:right;">${tlVol(v.vol)}</td>
                    <td style="padding:4px 10px; text-align:right; color:var(--text-secondary);">${pct}%</td></tr>`;
            }).join('');
            return `<div style="${CARD} padding:0; overflow:hidden;">
              <div style="padding:0.7rem 1rem; background:var(--bg-main,#f3f5f3); border-bottom:1px solid var(--border-color,#e0e0e0); font-weight:700; color:var(--text-primary);">${title} ${note || ''}</div>
              <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
                <thead><tr style="color:var(--text-secondary);">
                  <th style="padding:6px 10px; text-align:left;">Name</th>
                  <th style="padding:6px 10px; text-align:right;">Qty (PCS)</th>
                  <th style="padding:6px 10px; text-align:right;">Volume (MT)</th>
                  <th style="padding:6px 10px; text-align:right;">% Vol</th></tr></thead>
                <tbody>${body}</tbody>
                <tfoot><tr style="font-weight:700; border-top:2px solid var(--border-color,#ccc);">
                  <td style="padding:6px 10px; text-align:right;">Total</td>
                  <td style="padding:6px 10px; text-align:right;">${tlInt(tot.qty)}</td>
                  <td style="padding:6px 10px; text-align:right;">${tlVol(tot.vol)}</td><td></td></tr></tfoot>
              </table></div>`;
        };

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1100px;">
          <button id="tl-back" style="${BTN} margin-bottom:1rem;">← Back to summary</button>
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">📊 Tree Logs Analytics <span style="font-weight:400; color:var(--text-secondary); font-size:0.9rem;">(${year})</span></h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Aggregated from detailed (KU) batches; summary-only batches contribute to the species table only.</p>
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1rem;">
            ${tableFor('By Species', agg(keySpecies), '<span style="font-weight:400; color:var(--text-secondary);">(incl. summary)</span>')}
            ${tableFor('By Grade', agg(keyGrade))}
            ${tableFor('By Category', agg(keyCat))}
          </div>
        </div>`;
        host.querySelector('#tl-back').onclick = tlGoList;
    };

    // ── Code Lists editor ─────────────────────────────────────────────────
    const tlRenderCodeLists = (host) => {
        const t = tlEnsure();
        const canEdit = tlCanEdit();
        const listCard = (title, key) => {
            const items = t.codes[key];
            const chips = items.map((v, i) => `
              <span style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; margin:3px; border:1px solid var(--border-color,#ccc); border-radius:14px; font-size:0.82rem; color:var(--text-primary);">
                ${tlEsc(v)} ${canEdit ? `<button class="tl-code-del" data-key="${key}" data-i="${i}" title="Remove" style="border:none; background:none; cursor:pointer; color:var(--danger,#dc2626); font-size:0.9rem; line-height:1;">✕</button>` : ''}
              </span>`).join('') || `<span style="color:var(--text-secondary);">none</span>`;
            return `<div style="${CARD}">
              <strong style="color:var(--text-primary);">${title}</strong>
              <div style="margin:0.5rem 0;">${chips}</div>
              ${canEdit ? `<div style="display:flex; gap:0.4rem;">
                <input class="tl-code-new" data-key="${key}" placeholder="Add ${title.toLowerCase()}…" style="${SS} flex:1;">
                <button class="tl-code-add" data-key="${key}" style="${BTN}">➕ Add</button></div>` : ''}
            </div>`;
        };
        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:800px;">
          <button id="tl-back" style="${BTN} margin-bottom:1rem;">← Back to summary</button>
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">⚙ Code Lists</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            These feed the dropdowns used when entering batches and building templates.</p>
          ${listCard('Species Categories', 'categories')}
          ${listCard('Species', 'species')}
          ${listCard('Grades', 'grades')}
        </div>`;
        host.querySelector('#tl-back').onclick = tlGoList;
        if (canEdit) {
            const commitAdd = (key) => {
                const inp = host.querySelector(`.tl-code-new[data-key="${key}"]`);
                const v = inp.value.trim();
                if (!v) return;
                if (!t.codes[key].some(x => x.toUpperCase() === v.toUpperCase())) t.codes[key].push(v);
                saveTreeLogsData(true);
                window.renderTreeLogs();
            };
            host.querySelectorAll('.tl-code-add').forEach(b => b.onclick = () => commitAdd(b.dataset.key));
            host.querySelectorAll('.tl-code-new').forEach(inp => inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(inp.dataset.key); } });
            host.querySelectorAll('.tl-code-del').forEach(b => b.onclick = () => {
                t.codes[b.dataset.key].splice(parseInt(b.dataset.i, 10), 1);
                saveTreeLogsData(true);
                window.renderTreeLogs();
            });
        }
    };

    // =====================================================================
    // Excel helpers (shared by export + template)
    // =====================================================================
    const TL_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const TL_HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };

    const tlSafeSheetName = (name, used) => {
        let n = String(name).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 28) || 'Batch';
        let base = n, i = 2;
        while (used.has(n.toLowerCase())) { n = (base.slice(0, 25) + '_' + i).slice(0, 28); i++; }
        used.add(n.toLowerCase());
        return n;
    };
    const tlISOToDate = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
        return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    };

    // Build a KU-style detail sheet for one batch.
    const tlBuildBatchSheet = (wb, batch, used) => {
        const t = tlEnsure();
        const ws = wb.addWorksheet(tlSafeSheetName(batch.batchNo, used));
        ws.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 14 }];
        ws.mergeCells('A1:E1'); ws.getCell('A1').value = t.company;
        ws.mergeCells('A3:E3'); ws.getCell('A3').value = 'SUMMARIZED LOGS SPECIES';
        ws.getCell('A5').value = 'BATCH: ' + batch.batchNo;
        ws.getCell('D5').value = 'DELIVERY COMPLETED DATE:';
        const dd = tlISOToDate(batch.deliveryDate);
        if (dd) { ws.getCell('E5').value = dd; ws.getCell('E5').numFmt = 'yyyy-mm-dd'; }
        ['A1', 'A3', 'A5', 'D5'].forEach(c => ws.getCell(c).font = { bold: true });
        ws.getCell('A1').alignment = ws.getCell('A3').alignment = { horizontal: 'center' };

        const hr = 7;
        ['SPECIES CATEGORY', 'SPECIES', 'GRADE', 'QUANTITY (PCS)', 'VOLUME (MT)'].forEach((h, i) => {
            const cell = ws.getCell(hr, i + 1);
            cell.value = h; cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.fill = TL_HDR_FILL; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = TL_BORDER;
        });
        let r = hr + 1, gQty = 0, gVol = 0;
        tlGroupLines(batch.lines).forEach(g => {
            g.rows.forEach((l, i) => {
                ws.getCell(r, 1).value = i === 0 ? g.category : null;
                ws.getCell(r, 2).value = tlText(l.species);
                ws.getCell(r, 3).value = tlText(l.grade);
                ws.getCell(r, 4).value = tlNum(l.qty);
                ws.getCell(r, 5).value = tlNum(l.volume); ws.getCell(r, 5).numFmt = '#,##0.000';
                for (let c = 1; c <= 5; c++) ws.getCell(r, c).border = TL_BORDER;
                r++;
            });
            ws.getCell(r, 3).value = 'Sub-Total:'; ws.getCell(r, 3).font = { bold: true };
            ws.getCell(r, 4).value = g.qty; ws.getCell(r, 4).font = { bold: true };
            ws.getCell(r, 5).value = g.volume; ws.getCell(r, 5).numFmt = '#,##0.000'; ws.getCell(r, 5).font = { bold: true };
            r++; gQty += g.qty; gVol += g.volume;
        });
        r++;
        ws.getCell(r, 3).value = 'GRAND TOTAL:'; ws.getCell(r, 3).font = { bold: true };
        ws.getCell(r, 4).value = gQty; ws.getCell(r, 4).font = { bold: true };
        ws.getCell(r, 5).value = gVol; ws.getCell(r, 5).numFmt = '#,##0.000'; ws.getCell(r, 5).font = { bold: true };
        return ws;
    };

    // Build an ACMG-style summary sheet for a whole year.
    const tlBuildSummarySheet = (wb, year, batches) => {
        const ws = wb.addWorksheet('Summary ' + year);
        ws.columns = [{ width: 6 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 14 }];
        ws.mergeCells('A1:E1'); ws.getCell('A1').value = 'SUMMARIZED LOGS — ' + year;
        ws.getCell('A1').font = { bold: true }; ws.getCell('A1').alignment = { horizontal: 'center' };
        const hr = 3;
        ['NO.', 'DELIVERY COMPLETED DATE', 'BATCH NO.', 'QUANTITY (PCS)', 'VOLUME (MT)'].forEach((h, i) => {
            const cell = ws.getCell(hr, i + 1);
            cell.value = h; cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.fill = TL_HDR_FILL; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = TL_BORDER;
        });
        let r = hr + 1, gQty = 0, gVol = 0;
        tlSortBatches(batches).forEach((b, i) => {
            const t = tlBatchTotals(b);
            ws.getCell(r, 1).value = i + 1;
            const dd = tlISOToDate(b.deliveryDate);
            if (dd) { ws.getCell(r, 2).value = dd; ws.getCell(r, 2).numFmt = 'yyyy-mm-dd'; }
            ws.getCell(r, 3).value = b.batchNo;
            ws.getCell(r, 4).value = t.qty;
            ws.getCell(r, 5).value = t.volume; ws.getCell(r, 5).numFmt = '#,##0.000';
            for (let c = 1; c <= 5; c++) ws.getCell(r, c).border = TL_BORDER;
            gQty += t.qty; gVol += t.volume; r++;
        });
        ws.getCell(r, 2).value = 'GRAND TOTAL'; ws.getCell(r, 2).font = { bold: true };
        ws.getCell(r, 4).value = gQty; ws.getCell(r, 4).font = { bold: true };
        ws.getCell(r, 5).value = gVol; ws.getCell(r, 5).numFmt = '#,##0.000'; ws.getCell(r, 5).font = { bold: true };
        return ws;
    };

    const tlDownloadWb = async (wb, filename) => {
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    };

    // ── Export: year summary + per-batch detail sheets ───────────────────
    const downloadTreeLogsReport = async (year) => {
        await tlEnsureExcelJS();
        const batches = tlBatches(year);
        if (!batches.length) { if (window.notify) window.notify('No batches to export for ' + year + '.', 'warn'); return; }
        const wb = new window.ExcelJS.Workbook();
        tlBuildSummarySheet(wb, year, batches);
        const used = new Set(['summary ' + year]);
        tlSortBatches(batches).filter(b => b.detailed).forEach(b => tlBuildBatchSheet(wb, b, used));
        await tlDownloadWb(wb, `Tree_Logs_${year}.xlsx`);
        if (window.notify) window.notify('Excel exported.', 'success');
    };
    window.downloadTreeLogsReport = downloadTreeLogsReport;

    const downloadTreeLogsBatch = async (year, id) => {
        await tlEnsureExcelJS();
        const b = tlFindBatch(year, id);
        if (!b || !b.detailed) { if (window.notify) window.notify('Nothing to export.', 'warn'); return; }
        const wb = new window.ExcelJS.Workbook();
        tlBuildBatchSheet(wb, b, new Set());
        await tlDownloadWb(wb, `Batch_${String(b.batchNo).replace(/[^\w-]/g, '')}.xlsx`);
        if (window.notify) window.notify('Batch exported.', 'success');
    };
    window.downloadTreeLogsBatch = downloadTreeLogsBatch;

    // ── Template: importable blank KU + ACMG sheets w/ dropdowns ─────────
    const downloadTreeLogsTemplate = async (year) => {
        await tlEnsureExcelJS();
        const t = tlEnsure();
        const wb = new window.ExcelJS.Workbook();

        // Hidden Lists sheet feeds dropdowns
        const lists = wb.addWorksheet('Lists', { state: 'hidden' });
        lists.getCell('A1').value = 'Categories'; lists.getCell('B1').value = 'Species'; lists.getCell('C1').value = 'Grades';
        t.codes.categories.forEach((v, i) => lists.getCell(`A${i + 2}`).value = v);
        t.codes.species.forEach((v, i) => lists.getCell(`B${i + 2}`).value = v);
        t.codes.grades.forEach((v, i) => lists.getCell(`C${i + 2}`).value = v);
        const rng = (col, arr) => arr.length ? `Lists!$${col}$2:$${col}$${arr.length + 1}` : null;
        const catR = rng('A', t.codes.categories), spR = rng('B', t.codes.species), grR = rng('C', t.codes.grades);

        // Detail (KU) sheet — header layout the importer recognises.
        const ku = wb.addWorksheet('Detail Batch (KU)');
        ku.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 14 }];
        ku.getCell('A1').value = t.company; ku.getCell('A1').font = { bold: true };
        ku.getCell('A3').value = 'SUMMARIZED LOGS SPECIES'; ku.getCell('A3').font = { bold: true };
        ku.getCell('A5').value = 'BATCH: ';
        ku.getCell('D5').value = 'DELIVERY COMPLETED DATE:';
        ku.getCell('E5').numFmt = 'yyyy-mm-dd';
        ['SPECIES CATEGORY', 'SPECIES', 'GRADE', 'QUANTITY (PCS)', 'VOLUME (MT)'].forEach((h, i) => {
            const cell = ku.getCell(7, i + 1);
            cell.value = h; cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.fill = TL_HDR_FILL; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = TL_BORDER;
        });
        for (let r = 8; r <= 207; r++) {
            if (catR) ku.getCell(r, 1).dataValidation = { type: 'list', allowBlank: true, formulae: [catR] };
            if (spR) ku.getCell(r, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [spR] };
            if (grR) ku.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, formulae: [grR] };
            ku.getCell(r, 5).numFmt = '#,##0.000';
        }

        // Summary (ACMG) sheet
        const ac = wb.addWorksheet('Summary (ACMG)');
        ac.columns = [{ width: 6 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 14 }];
        ac.getCell('A1').value = 'SUMMARIZED LOGS'; ac.getCell('A1').font = { bold: true };
        ['NO.', 'DELIVERY COMPLETED DATE', 'BATCH NO.', 'QUANTITY (PCS)', 'VOLUME (MT)'].forEach((h, i) => {
            const cell = ac.getCell(3, i + 1);
            cell.value = h; cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.fill = TL_HDR_FILL; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = TL_BORDER;
        });
        for (let r = 4; r <= 203; r++) {
            ac.getCell(r, 2).numFmt = 'yyyy-mm-dd';
            ac.getCell(r, 5).numFmt = '#,##0.000';
        }

        await tlDownloadWb(wb, `Tree_Logs_Template_${year}.xlsx`);
        if (window.notify) window.notify('Template downloaded.', 'success');
    };
    window.downloadTreeLogsTemplate = downloadTreeLogsTemplate;

    // =====================================================================
    // Import — classify each sheet as KU (detail) or ACMG (summary)
    // =====================================================================
    const tlSheetRows = (ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, (row) => {
            const vals = row.values || [];      // 1-indexed; vals[0] unused
            rows.push(vals);
        });
        return rows;
    };
    const tlCell = (row, idx) => (row && row[idx] != null) ? row[idx] : null;

    const tlYearFromDivider = (name) => {
        const m = /^(?:YEAR\s+)?(\d{4})$/i.exec(String(name).trim());
        return m ? m[1] : null;
    };
    const tlYearFromBatchCode = (code) => {
        const m = /^KU(\d{2})(\d{2})/i.exec(String(code).trim());
        return m ? '20' + m[2] : null;
    };

    const tlClassifySheet = (rows) => {
        for (let i = 0; i < rows.length; i++) {
            const toks = new Set((rows[i] || []).map(tlNormHeader).filter(Boolean));
            if (toks.has('SPECIESCATEGORY') && toks.has('GRADE')) return { kind: 'KU', hdr: i };
            if (toks.has('BATCHNO') && (toks.has('DELIVERYCOMPETEDDATE') || toks.has('DELIVERYCOMPLETEDDATE') || toks.has('DELIVERYDATE'))) return { kind: 'ACMG', hdr: i };
        }
        return null;
    };

    const tlParseKuSheet = (rows, hdr, sheetName, fallbackYear, dividerYear) => {
        let batchNo = (/^KU/i.test(sheetName) ? sheetName.trim() : '');
        let deliveryDate = '';
        for (const row of rows) {
            const c0 = tlCell(row, 1);
            if (typeof c0 === 'string' && tlNormHeader(c0).startsWith('BATCH')) {
                const after = c0.indexOf(':') >= 0 ? c0.slice(c0.indexOf(':') + 1).trim() : '';
                if (after) batchNo = after;
                for (let c = 1; c < row.length; c++) {
                    const iso = tlToISO(row[c]);
                    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) deliveryDate = iso;
                }
            }
        }
        const lines = [];
        let curCat = '';
        for (let i = hdr + 1; i < rows.length; i++) {
            const row = rows[i];
            const c0 = tlText(tlCell(row, 1)), c1 = tlText(tlCell(row, 2)), c2 = tlText(tlCell(row, 3));
            const c3 = tlCell(row, 4), c4 = tlCell(row, 5);
            const u2 = c2.toUpperCase();
            if (u2.includes('GRAND TOTAL') || u2.includes('SUB-TOTAL') || u2.includes('SUBTOTAL')) continue;
            if (c0) curCat = c0;
            const hasQty = c3 != null && c3 !== '' && !isNaN(parseFloat(c3));
            if (c1 && c2 && hasQty) {
                lines.push({ category: curCat, species: c1, grade: c2, qty: tlNum(c3), volume: tlNum(c4) });
            }
        }
        if (!batchNo || !lines.length) return null;
        const year = dividerYear || deliveryDate.slice(0, 4) || tlYearFromBatchCode(batchNo) || fallbackYear;
        return { year, batch: { id: tlUid(), batchNo, deliveryDate, detailed: true, lines, createdAt: new Date().toISOString() } };
    };

    const tlParseAcmgSheet = (rows, hdr, fallbackYear, dividerYear) => {
        // species code from a "LOGS SPECIES: … (XXX)" line above the header
        let species = '';
        for (let i = 0; i < hdr; i++) {
            for (const c of (rows[i] || [])) {
                if (typeof c === 'string' && /SPECIES/i.test(c)) {
                    const m = /\(([A-Za-z]+)\)/.exec(c);
                    if (m) species = m[1].toUpperCase();
                }
            }
        }
        const out = [];
        for (let i = hdr + 1; i < rows.length; i++) {
            const row = rows[i];
            const c1 = tlCell(row, 2), c2 = tlText(tlCell(row, 3)), c3 = tlCell(row, 4), c4 = tlCell(row, 5);
            if (tlText(c1).toUpperCase().includes('GRAND TOTAL')) continue;
            if (!c2) continue;     // need a batch no
            const iso = tlToISO(c1);
            const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
            const year = dividerYear || deliveryDate.slice(0, 4) || tlYearFromBatchCode(c2) || fallbackYear;
            out.push({ year, batch: { id: tlUid(), batchNo: c2, deliveryDate, detailed: false, species, totalQty: tlNum(c3), totalVolume: tlNum(c4), createdAt: new Date().toISOString() } });
        }
        return out;
    };

    const importTreeLogs = async (file, fallbackYear) => {
        if (!file) return;
        if (typeof window._canEdit === 'function' && !window._canEdit('treelogs')) {
            if (window.notify) window.notify('You do not have edit access for tree logs.', 'warn');
            return;
        }
        try {
            await tlEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            await wb.xlsx.load(await file.arrayBuffer());

            const parsed = [];   // { year, batch }
            let dividerYear = null;
            wb.eachSheet((ws) => {
                const name = ws.name || '';
                const dv = tlYearFromDivider(name);
                if (dv) { dividerYear = dv; return; }
                // Skip the hidden dropdown-list sheet and any blank "… TEMPLATE"
                // sheet (e.g. the source workbook's "SUMMARY TEMPLATE"). My own
                // template sheets are "Detail Batch (KU)" / "Summary (ACMG)" and
                // contain no "template" token, so they still classify + import.
                const lname = name.toLowerCase();
                if (lname === 'lists' || lname.includes('template')) return;
                const rows = tlSheetRows(ws);
                const cls = tlClassifySheet(rows);
                if (!cls) return;
                if (cls.kind === 'KU') {
                    const res = tlParseKuSheet(rows, cls.hdr, name, fallbackYear, dividerYear);
                    if (res) parsed.push(res);
                } else {
                    tlParseAcmgSheet(rows, cls.hdr, fallbackYear, dividerYear).forEach(r => parsed.push(r));
                }
            });

            if (!parsed.length) {
                if (window.notify) window.notify('No recognisable log sheets found.\nExpected KU detail sheets or ACMG summary sheets.', 'warn');
                return;
            }

            // Plan merge: count add vs update (match by year + batchNo).
            let added = 0, updated = 0;
            const byYear = {};
            parsed.forEach(({ year, batch }) => {
                const arr = tlBatches(year);
                const idx = arr.findIndex(x => tlSameBatch(x, batch));
                if (idx >= 0) updated++; else added++;
                byYear[year] = (byYear[year] || 0) + 1;
            });
            const yrSummary = Object.entries(byYear).sort().map(([y, n]) => `• ${y}: ${n} batch(es)`).join('\n');
            const proceed = confirm(`Import ${parsed.length} batch(es)?\n\n${yrSummary}\n\nNew: ${added}   Updates (same batch no): ${updated}\n\nProceed?`);
            if (!proceed) return;

            parsed.forEach(({ year, batch }) => {
                const arr = tlBatches(year);
                const idx = arr.findIndex(x => tlSameBatch(x, batch));
                if (idx >= 0) { batch.id = arr[idx].id; batch.createdAt = arr[idx].createdAt; arr[idx] = batch; }
                else arr.push(batch);
                tlLearnCodes(batch);
            });

            await saveTreeLogsData(false);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'tree_logs', `${parsed.length} batches (${added} new, ${updated} updated)`, fallbackYear);
            // Jump to a year we just imported into so the user sees the result.
            const firstYear = Object.keys(byYear).sort((a, b) => parseInt(b) - parseInt(a))[0];
            if (firstYear) window.state.treeLogsYear = firstYear;
            _tlMode = 'list';
            window.renderTreeLogs();
            if (window.notify) window.notify(`Imported ${parsed.length} batch(es) (${added} new, ${updated} updated).`, 'success');
        } catch (err) {
            console.error('Tree logs import error:', err);
            if (window.notify) window.notify('Import error: ' + err.message, 'error');
        }
    };
    window.importTreeLogs = importTreeLogs;

})();
