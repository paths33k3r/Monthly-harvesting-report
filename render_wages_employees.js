// =====================================================================
// render_wages_employees.js — Employee Master module
// ---------------------------------------------------------------------
// Digitises the EMS "Employee Master Listing" export — the register of
// every worker on the estate. Its key column for wage work is the
// VENDOR CODE (the agent, e.g. "RONI AGENT"), which is the gang a
// worker's pay is allocated under: it lets Wage-Ledger employee rows be
// differentiated / rolled up per agent.
//
// The EMS export is an OLD BINARY .xls (BIFF) file, which ExcelJS can
// NOT read — so the import lazy-loads SheetJS (xlsx.full.min.js), which
// reads both .xls and .xlsx. Template + export still use ExcelJS like
// every other module. Of the export's 55 columns, ~30 are completely
// empty (addresses, phones, emergency contacts, Grade, Job Function…)
// and are not stored.
//
// Storage: Firebase  shared/wages_employees_data  (window._wagesEmployeesDb)
// Surfaced as the "Employees" sub-tab at the TOP of 💵 Rate of Wages.
// Access:  menu key 'wages' (shared with the calculator/ledgers);
//          template + export available to read-only users.
// =====================================================================

(function () {
    'use strict';

    // HTML-escape DB/user free text before innerHTML (shared data → untrusted).
    const weEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const weText = (v) => String(v == null ? '' : v).trim();
    const weNormHeader = (h) => weText(h).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const wePad = (n) => String(n).padStart(2, '0');

    // Source dates are dd/mm/yyyy text (Malaysian EMS export) → ISO.
    // Also tolerates ISO passthrough, Date objects and Excel serials.
    const weToISO = (v) => {
        if (v == null || v === '') return '';
        if (v instanceof Date) return `${v.getFullYear()}-${wePad(v.getMonth() + 1)}-${wePad(v.getDate())}`;
        if (typeof v === 'number') {
            const d = new Date(Math.round((v - 25569) * 86400000));   // Excel 1900 epoch
            return `${d.getUTCFullYear()}-${wePad(d.getUTCMonth() + 1)}-${wePad(d.getUTCDate())}`;
        }
        const s = String(v).trim();
        if (!s || s === '-') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          // dd/mm/yyyy
        if (m) return `${m[3]}-${wePad(m[2])}-${wePad(m[1])}`;
        return s;   // keep unparseable text rather than dropping it
    };

    // ── Column spec (single source of truth: import map, template, export, view) ──
    // header = the exact EMS export header the importer matches on.
    const WE_COLS = [
        { key: 'no', header: 'No.', w: 6 },
        { key: 'employeeId', header: 'Employee ID', w: 14 },
        { key: 'type', header: 'Type', w: 16 },
        { key: 'vendor', header: 'Vendor Code', w: 26 },
        { key: 'firstName', header: 'First Name', w: 16 },
        { key: 'middleName', header: 'Middle Name', w: 10 },
        { key: 'lastName', header: 'Last Name', w: 16 },
        { key: 'title', header: 'Title', w: 7 },
        { key: 'displayName', header: 'Display Name', w: 30 },
        { key: 'centralization', header: 'Centralization Code', w: 16 },
        { key: 'icNo', header: 'New IC No.', w: 14, date: false },
        { key: 'dob', header: 'Date Of Birth', w: 12, date: true },
        { key: 'gender', header: 'Gender', w: 8 },
        { key: 'maritalStatus', header: 'Marital Status', w: 11 },
        { key: 'nationality', header: 'Nationality', w: 11 },
        { key: 'race', header: 'Race', w: 8 },
        { key: 'email', header: 'Email', w: 22 },
        { key: 'dateJoin', header: 'Date Join', w: 12, date: true },
        { key: 'dateConfirm', header: 'Date Confirm', w: 12, date: true },
        { key: 'employmentType', header: 'Employment Type', w: 13 },
        { key: 'dateLeave', header: 'Date Leave', w: 12, date: true },
        { key: 'position', header: 'Position', w: 26 },
        { key: 'staffCategory', header: 'Staff Category', w: 26 },
        { key: 'staffStatus', header: 'Staff Status', w: 12 },
        { key: 'remark', header: 'Remark', w: 12 },
    ];
    const WE_FIELD_MAP = {};
    WE_COLS.forEach(c => { WE_FIELD_MAP[weNormHeader(c.header)] = c.key; });
    // tolerate common variants
    Object.assign(WE_FIELD_MAP, {
        'NO': 'no', 'EMPLOYEENO': 'employeeId', 'IC': 'icNo', 'ICNO': 'icNo', 'NEWIC': 'icNo',
        'AGENT': 'vendor', 'VENDOR': 'vendor', 'NAME': 'displayName', 'FULLNAME': 'displayName',
        'DOB': 'dob', 'CATEGORY': 'staffCategory', 'STATUS': 'staffStatus',
    });

    // Statuses counted as still on the payroll
    const WE_ACTIVE = ['CONFIRMED', 'PROBATION'];
    const weIsActive = (e) => WE_ACTIVE.includes(weText(e.staffStatus).toUpperCase());

    // Status chip colours (bg / text) — semantic tints kept light in dark mode by design
    const WE_STATUS_STYLE = {
        CONFIRMED: 'background:#dcfce7;color:#166534;', PROBATION: 'background:#dbeafe;color:#1e40af;',
        RESIGNED: 'background:#f1f5f9;color:#475569;', INACTIVE: 'background:#f1f5f9;color:#475569;',
        ABSCONDED: 'background:#fee2e2;color:#b91c1c;', TERMINATED: 'background:#fee2e2;color:#b91c1c;',
        DECEASED: 'background:#e2e8f0;color:#1e293b;',
    };
    const weStatusChip = (s) => {
        const up = weText(s).toUpperCase();
        const st = WE_STATUS_STYLE[up] || 'background:#f1f5f9;color:#475569;';
        return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;${st}">${weEsc(up || '—')}</span>`;
    };

    // ── State helpers ───────────────────────────────────────────────────
    const weEnsure = () => {
        if (!window.state.wagesEmployees) window.state.wagesEmployees = {};
        if (!Array.isArray(window.state.wagesEmployees.list)) window.state.wagesEmployees.list = [];
        return window.state.wagesEmployees;
    };
    const weList = () => weEnsure().list;

    // Public lookup hooks for the other wages tabs (ledger employee name →
    // master record → vendor/agent). Name match: exact case-insensitive on
    // the collapsed display name.
    const weNormName = (s) => weText(s).toUpperCase().replace(/\s+/g, ' ');
    window.weFindEmployee = (nameOrId) => {
        const q = weNormName(nameOrId);
        if (!q) return null;
        return weList().find(e => weText(e.employeeId).toUpperCase() === q) ||
               weList().find(e => weNormName(e.displayName) === q) || null;
    };
    window.weAgentOf = (nameOrId) => {
        const e = window.weFindEmployee(nameOrId);
        return e ? weText(e.vendor) : '';
    };

    // ── Firebase save ───────────────────────────────────────────────────
    const saveWagesEmployeesData = (silent) => {
        const db = window._wagesEmployeesDb || window._wagesDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — not saved.', 'error'); return Promise.resolve(); }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/wages_employees_data').set(JSON.stringify(window.state.wagesEmployees))
            .then(() => { if (!silent && window.notify) window.notify('Employee master saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveWagesEmployeesData = saveWagesEmployeesData;

    // ── Lazy CDN loaders ────────────────────────────────────────────────
    const weEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };
    // SheetJS — the only in-browser reader for the binary .xls the EMS exports.
    const weEnsureSheetJS = async () => {
        if (typeof window.XLSX !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load SheetJS (xlsx)'));
            document.head.appendChild(s);
        });
    };

    // =====================================================================
    // Import — reads the raw EMS "Employee Master Listing" (.xls or .xlsx)
    // =====================================================================
    const weParseFile = async (file) => {
        await weEnsureSheetJS();
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });

        for (const name of wb.SheetNames) {
            // raw:false → formatted text, so IC numbers keep leading zeros
            // and the dd/mm/yyyy date text arrives exactly as displayed.
            const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
            let hdrIdx = -1, colMap = null;
            for (let i = 0; i < Math.min(rows.length, 20); i++) {
                const toks = rows[i].map(weNormHeader);
                if (toks.includes('EMPLOYEEID') && (toks.includes('DISPLAYNAME') || toks.includes('STAFFCATEGORY'))) {
                    hdrIdx = i; colMap = {};
                    // first occurrence wins — the export repeats Country/State/… headers
                    toks.forEach((t, c) => { const f = WE_FIELD_MAP[t]; if (f && colMap[f] === undefined) colMap[f] = c; });
                    break;
                }
            }
            if (!colMap) continue;

            const list = [];
            const seen = new Set();
            let dupes = 0;
            for (let i = hdrIdx + 1; i < rows.length; i++) {
                const vals = rows[i];
                const get = (f) => (colMap[f] === undefined ? '' : weText(vals[colMap[f]]));
                const employeeId = get('employeeId');
                const displayName = get('displayName');
                if (!employeeId && !displayName) continue;             // blank / stray row
                if (/^TOTAL/i.test(employeeId)) continue;
                if (employeeId && seen.has(employeeId)) { dupes++; continue; }
                if (employeeId) seen.add(employeeId);
                const rec = {};
                WE_COLS.forEach(c => {
                    if (c.key === 'no') { rec.no = parseInt(get('no')) || list.length + 1; return; }
                    const v = get(c.key);
                    rec[c.key] = c.date ? weToISO(v) : v;
                });
                if (!rec.displayName) rec.displayName = [rec.firstName, rec.middleName, rec.lastName].filter(Boolean).join(' ');
                list.push(rec);
            }
            if (list.length) return { list, dupes, sheet: name };
        }
        throw new Error('No recognisable sheet found — expected the EMS Employee Master Listing headers ("Employee ID", "Display Name", "Staff Category", …).');
    };

    const importWagesEmployees = async (file) => {
        if (!file) return;
        if (typeof window._canEdit === 'function' && !window._canEdit('wages')) {
            if (window.notify) window.notify('You do not have edit access for wages.', 'warn');
            return;
        }
        try {
            const parsed = await weParseFile(file);
            const nActive = parsed.list.filter(weIsActive).length;
            const vendors = new Set(parsed.list.map(e => weText(e.vendor)).filter(Boolean));
            const prev = weList().length;

            let msg = `Import employee master listing:\n\n• ${parsed.list.length} employees (${nActive} active, ${parsed.list.length - nActive} left)\n• ${vendors.size} agents / vendors`;
            if (parsed.dupes) msg += `\n• ${parsed.dupes} duplicate Employee ID row(s) skipped`;
            if (prev) msg += `\n\n⚠ This REPLACES the current list of ${prev} employees.`;
            if (!confirm(msg + '\n\nProceed?')) return;

            window.state.wagesEmployees = {
                list: parsed.list,
                importedAt: new Date().toISOString(),
                importedBy: window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'import',
                sourceFile: file.name,
            };
            await saveWagesEmployeesData(false);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'wages_employees', `${parsed.list.length} employees (${nActive} active)`, '');
            window.renderWagesEmployeesView();
            if (window.notify) window.notify(`Imported ${parsed.list.length} employee(s).`, 'success');
        } catch (err) {
            console.error('Employee master import error:', err);
            if (window.notify) window.notify('Import error: ' + err.message, 'error');
        }
    };
    window.importWagesEmployees = importWagesEmployees;

    // =====================================================================
    // Template download — same headers the importer recognises
    // =====================================================================
    const downloadWagesEmployeesTemplate = async () => {
        await weEnsureExcelJS();
        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet('Employees');
        ws.getCell('A1').value = 'Employee Master Listing — import template';
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A2').value = 'One row per employee. Vendor Code = the agent the worker is paid under. Dates as dd/mm/yyyy or yyyy-mm-dd. The raw EMS "Employee Master Listing" .xls export also imports directly — no need to fill this by hand.';
        ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF666666' } };

        const HR = 4;
        const hdr = ws.getRow(HR);
        hdr.values = WE_COLS.map(c => c.header);
        hdr.height = 28;
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        hdr.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
            cell.border = border;
        });
        WE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
        const ex = ws.getRow(HR + 1);
        ex.values = [1, 'GTG-A00001', 'Draft(Without Doc)', 'RONI AGENT', 'ANDI', '', 'SAPUTRA', 'Mr', 'ANDI SAPUTRA', 'GLOBAL',
            '', '01/01/1990', 'Male', 'Married', 'Indonesian', '', '', '01/01/2025', '', 'Permanent', '', 'HARVESTER', 'DAILY FOREIGN', 'CONFIRMED', 'AG-R001'];
        ex.font = { italic: true, color: { argb: 'FF999999' } };
        // IC / date columns stay text so leading zeros & dd/mm/yyyy survive
        const txtCols = WE_COLS.map((c, i) => (c.date || c.key === 'icNo' ? i + 1 : null)).filter(Boolean);
        for (let r = HR + 1; r <= HR + 600; r++) txtCols.forEach(c => { ws.getRow(r).getCell(c).numFmt = '@'; });
        ws.views = [{ state: 'frozen', ySplit: HR }];

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Employee_Master_Template.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        if (window.notify) window.notify('Template downloaded.', 'success');
    };
    window.downloadWagesEmployeesTemplate = downloadWagesEmployeesTemplate;

    // =====================================================================
    // Excel export — the stored master list
    // =====================================================================
    const downloadWagesEmployeesReport = async () => {
        const list = weList();
        if (!list.length) {
            if (window.notify) window.notify('No employees to export yet.', 'warn');
            return;
        }
        await weEnsureExcelJS();
        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet('Employees');
        ws.getCell('A1').value = 'Employee Master Listing';
        ws.getCell('A1').font = { bold: true, size: 14 };
        const d = weEnsure();
        ws.getCell('A2').value = `${list.length} employees · ${list.filter(weIsActive).length} active` +
            (d.importedAt ? ` · imported ${String(d.importedAt).slice(0, 10)}` : '');
        ws.getCell('A2').font = { size: 9, color: { argb: 'FF666666' } };

        let r = 4;
        const hdr = ws.getRow(r++);
        hdr.values = WE_COLS.map(c => c.header);
        hdr.font = { bold: true };
        hdr.border = { bottom: { style: 'medium' } };
        WE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
        list.forEach(e => { ws.getRow(r++).values = WE_COLS.map(c => e[c.key] == null ? '' : e[c.key]); });

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Employee_Master_Listing.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        if (window.notify) window.notify('Employee list exported.', 'success');
    };
    window.downloadWagesEmployeesReport = downloadWagesEmployeesReport;

    // =====================================================================
    // Main render
    // =====================================================================
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;';

    // Session-only view state
    const _weF = { q: '', status: 'ACTIVE', vendor: '', category: '', mode: 'list' };
    let _weShowAll = false;
    let _weOpenId = null;          // employee whose detail row is expanded
    const WE_MAX_ROWS = 200;

    window.renderWagesEmployeesView = () => {
        const host = document.getElementById('wages-employees-wrapper');
        if (!host) return;
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('wages');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1300px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">👥 Employees</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            The estate's <em>Employee Master Listing</em> — every worker with the <strong>agent (vendor)</strong>
            their wages are allocated under, position, category and status. Import the raw EMS
            <em>.xls</em> export directly; re-importing replaces the list.
          </p>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <button id="we-mode-list" style="${BTN} ${_weF.mode === 'list' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">☰ List</button>
            <button id="we-mode-agent" style="${BTN} ${_weF.mode === 'agent' ? 'background:var(--accent-color,#16a34a);color:#fff;border-color:transparent;' : ''}">🤝 By agent</button>
            <div style="flex:1;"></div>
            <button id="we-dl-template" style="${BTN}" title="Download a blank Excel import template">⬇ Template</button>
            <button id="we-dl-report" style="${BTN}" title="Export the stored list to Excel">📤 Export</button>
            <button id="we-import" class="btn-primary" style="padding:0.45rem 1rem; ${canEdit ? '' : 'opacity:.5; cursor:not-allowed;'}" ${canEdit ? '' : 'disabled'} title="${canEdit ? 'Import the EMS Employee Master Listing (.xls / .xlsx)' : 'You do not have edit access for wages'}">📥 Import</button>
            <input type="file" id="we-file-input" accept=".xls,.xlsx" style="display:none;">
          </div>

          <div id="we-body"></div>
        </div>`;

        const busy = async (id, fn) => {
            const btn = host.querySelector(id);
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ …';
            try { await fn(); }
            catch (err) { if (window.notify) window.notify(err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = old; }
        };
        host.querySelector('#we-mode-list').onclick = () => { _weF.mode = 'list'; window.renderWagesEmployeesView(); };
        host.querySelector('#we-mode-agent').onclick = () => { _weF.mode = 'agent'; window.renderWagesEmployeesView(); };
        host.querySelector('#we-dl-template').onclick = () => busy('#we-dl-template', downloadWagesEmployeesTemplate);
        host.querySelector('#we-dl-report').onclick = () => busy('#we-dl-report', downloadWagesEmployeesReport);
        if (canEdit) {
            const fin = host.querySelector('#we-file-input');
            host.querySelector('#we-import').onclick = () => fin.click();
            fin.onchange = async () => { const f = fin.files[0]; fin.value = ''; if (f) await busy('#we-import', () => importWagesEmployees(f)); };
        }

        weRenderBody();
    };

    // Filters applied to the master list (search + dropdowns)
    const weFiltered = () => {
        const q = _weF.q.toLowerCase().trim();
        return weList().filter(e => {
            if (_weF.status === 'ACTIVE' && !weIsActive(e)) return false;
            if (_weF.status && _weF.status !== 'ACTIVE' && _weF.status !== 'ALL' &&
                weText(e.staffStatus).toUpperCase() !== _weF.status) return false;
            if (_weF.vendor && weText(e.vendor) !== _weF.vendor) return false;
            if (_weF.category && weText(e.staffCategory) !== _weF.category) return false;
            if (q && !(`${e.employeeId} ${e.displayName} ${e.icNo} ${e.position} ${e.vendor}`.toLowerCase().includes(q))) return false;
            return true;
        });
    };

    const weRenderBody = () => {
        const body = document.getElementById('we-body');
        if (!body) return;
        const d = weEnsure();
        const list = d.list;

        if (!list.length) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No employee master listing imported yet.<br><br>
                Click <strong>📥 Import</strong> and pick the EMS <em>Employee Master Listing</em> export
                (the original <em>.xls</em> works directly — no conversion needed).
            </div>`;
            return;
        }

        // ── Summary cards ──
        const nActive = list.filter(weIsActive).length;
        const nForeign = list.filter(e => /INDONESIAN/i.test(e.nationality)).length;
        const vendors = [...new Set(list.map(e => weText(e.vendor)).filter(Boolean))].sort();
        const categories = [...new Set(list.map(e => weText(e.staffCategory)).filter(Boolean))].sort();
        const statuses = [...new Set(list.map(e => weText(e.staffStatus).toUpperCase()).filter(Boolean))].sort();

        const meta = [];
        if (d.sourceFile) meta.push(`from <em>${weEsc(d.sourceFile)}</em>`);
        if (d.importedAt) meta.push(`imported ${weEsc(String(d.importedAt).slice(0, 10))}`);

        const tile = (label, val, sub) => `
            <div style="flex:1; min-width:130px; text-align:center; padding:0.6rem 0.4rem;">
              <div style="font-size:1.55rem; font-weight:700; color:var(--text-primary);">${val}</div>
              <div style="font-size:0.78rem; color:var(--text-secondary);">${label}${sub ? `<br><span style="font-size:0.7rem;">${sub}</span>` : ''}</div>
            </div>`;
        const summary = `
        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.2rem; font-size:1rem; color:var(--text-primary);">Employee Master</h3>
          ${meta.length ? `<div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:0.4rem;">${meta.join(' · ')}</div>` : ''}
          <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
            ${tile('Employees', list.length)}
            ${tile('Active', nActive, 'confirmed + probation')}
            ${tile('Left', list.length - nActive, 'resigned / absconded / …')}
            ${tile('Foreign / Local', `${nForeign} / ${list.length - nForeign}`)}
            ${tile('Agents', vendors.length)}
          </div>
        </div>`;

        if (_weF.mode === 'agent') {
            body.innerHTML = summary + weAgentTable(list);
            return;
        }

        // ── List mode: filter bar + table ──
        const opt = (v, cur, label) => `<option value="${weEsc(v)}" ${v === cur ? 'selected' : ''}>${weEsc(label || v)}</option>`;
        const filtered = weFiltered();
        const shown = _weShowAll ? filtered : filtered.slice(0, WE_MAX_ROWS);

        const TH = 'padding:6px 8px; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); z-index:1; white-space:nowrap; text-align:left;';
        const TD = 'padding:4px 8px; border-bottom:1px solid var(--border-color,#eee); white-space:nowrap;';

        let rowsHtml = '';
        shown.forEach(e => {
            const id = weText(e.employeeId);
            rowsHtml += `<tr class="we-row" data-id="${weEsc(id)}" style="cursor:pointer;">
                <td style="${TD} color:var(--text-secondary);">${weEsc(String(e.no || ''))}</td>
                <td style="${TD} font-family:monospace;">${weEsc(id)}</td>
                <td style="${TD}">${weEsc(e.displayName)}</td>
                <td style="${TD}">${weEsc(e.vendor) || '<span style="color:var(--text-secondary);">—</span>'}</td>
                <td style="${TD}">${weEsc(e.position)}</td>
                <td style="${TD}">${weEsc(e.staffCategory)}</td>
                <td style="${TD}">${weEsc(e.nationality)}</td>
                <td style="${TD}">${weEsc(e.dateJoin)}</td>
                <td style="${TD}">${weEsc(e.dateLeave) || ''}</td>
                <td style="${TD}">${weStatusChip(e.staffStatus)}</td></tr>`;
            if (_weOpenId === id) {
                const dl = (k, v) => v ? `<div><span style="color:var(--text-secondary);">${k}:</span> ${weEsc(v)}</div>` : '';
                rowsHtml += `<tr><td colspan="10" style="${TD} background:var(--bg-main,#f7f9f7); white-space:normal;">
                    <div style="display:flex; flex-wrap:wrap; gap:0.3rem 2rem; font-size:0.8rem; padding:0.3rem 0.2rem;">
                      ${dl('Type', e.type)}${dl('IC No.', e.icNo)}${dl('Date of birth', e.dob)}${dl('Gender', e.gender)}
                      ${dl('Marital status', e.maritalStatus)}${dl('Race', e.race)}${dl('Email', e.email)}
                      ${dl('Centralization', e.centralization)}${dl('Employment', e.employmentType)}
                      ${dl('Date confirm', e.dateConfirm)}${dl('Remark', e.remark)}
                    </div></td></tr>`;
            }
        });
        if (!rowsHtml) rowsHtml = `<tr><td colspan="10" style="padding:16px; text-align:center; color:var(--text-secondary);">No employees match the current filters.</td></tr>`;

        body.innerHTML = summary + `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:0.8rem 1.1rem; background:var(--bg-main,#f3f5f3); border-bottom:1px solid var(--border-color,#e0e0e0);">
            <input type="text" id="we-q" value="${weEsc(_weF.q)}" placeholder="🔎 name / ID / IC / position" style="${SS} font-size:0.8rem; width:210px;">
            <select id="we-status" style="${SS} font-size:0.8rem;">
              ${opt('ACTIVE', _weF.status, '✅ Active only')}${opt('ALL', _weF.status, 'All statuses')}
              ${statuses.map(s => opt(s, _weF.status)).join('')}
            </select>
            <select id="we-vendor" style="${SS} font-size:0.8rem; max-width:220px;">
              ${opt('', _weF.vendor, 'All agents')}${vendors.map(v => opt(v, _weF.vendor)).join('')}
            </select>
            <select id="we-category" style="${SS} font-size:0.8rem; max-width:220px;">
              ${opt('', _weF.category, 'All categories')}${categories.map(c => opt(c, _weF.category)).join('')}
            </select>
            <div style="flex:1;"></div>
            <span style="font-size:0.78rem; color:var(--text-secondary);">${filtered.length} shown${filtered.length !== list.length ? ` of ${list.length}` : ''}</span>
          </div>
          <div style="max-height:600px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.83rem; color:var(--text-primary);">
              <thead><tr>
                <th style="${TH} width:38px;">No.</th><th style="${TH}">Employee ID</th><th style="${TH}">Name</th>
                <th style="${TH}">Agent / Vendor</th><th style="${TH}">Position</th><th style="${TH}">Category</th>
                <th style="${TH}">Nationality</th><th style="${TH}">Join</th><th style="${TH}">Leave</th><th style="${TH}">Status</th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          ${filtered.length > WE_MAX_ROWS ? `<div style="padding:0.55rem; text-align:center; border-top:1px solid var(--border-color,#e0e0e0);">
              <button id="we-showall" style="${BTN} font-size:0.8rem;">${_weShowAll ? 'Show fewer' : `Show all ${filtered.length}`}</button></div>` : ''}
        </div>`;

        // filter events — re-render only the body; restore search focus/caret
        const rerender = () => weRenderBody();
        const qIn = body.querySelector('#we-q');
        qIn.oninput = () => {
            _weF.q = qIn.value;
            const pos = qIn.selectionStart;
            rerender();
            const again = document.getElementById('we-q');
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        };
        body.querySelector('#we-status').onchange = (e) => { _weF.status = e.target.value; rerender(); };
        body.querySelector('#we-vendor').onchange = (e) => { _weF.vendor = e.target.value; rerender(); };
        body.querySelector('#we-category').onchange = (e) => { _weF.category = e.target.value; rerender(); };
        const showAllBtn = body.querySelector('#we-showall');
        if (showAllBtn) showAllBtn.onclick = () => { _weShowAll = !_weShowAll; rerender(); };
        body.querySelectorAll('.we-row').forEach(tr => {
            tr.onclick = () => { const id = tr.dataset.id; _weOpenId = (_weOpenId === id ? null : id); rerender(); };
        });
    };

    // ── By-agent mode: headcount per vendor (the wage-allocation grouping) ──
    const weAgentTable = (list) => {
        const by = new Map();
        list.forEach(e => {
            const v = weText(e.vendor) || '(no agent — direct / local staff)';
            if (!by.has(v)) by.set(v, { active: 0, left: 0, positions: new Map() });
            const g = by.get(v);
            if (weIsActive(e)) {
                g.active++;
                const p = weText(e.position) || '?';
                g.positions.set(p, (g.positions.get(p) || 0) + 1);
            } else g.left++;
        });
        const rows = [...by.entries()].sort((a, b) => b[1].active - a[1].active || (a[0] > b[0] ? 1 : -1));

        const TH = 'padding:6px 10px; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); z-index:1; white-space:nowrap; text-align:left;';
        const TD = 'padding:5px 10px; border-bottom:1px solid var(--border-color,#eee); vertical-align:top;';
        let html = '';
        let tA = 0, tL = 0;
        rows.forEach(([v, g]) => {
            tA += g.active; tL += g.left;
            const pos = [...g.positions.entries()].sort((a, b) => b[1] - a[1])
                .map(([p, n]) => `${weEsc(p)} × ${n}`).join(' · ');
            html += `<tr>
                <td style="${TD} font-weight:600; white-space:nowrap;">${weEsc(v)}</td>
                <td style="${TD} text-align:right; font-weight:700;">${g.active}</td>
                <td style="${TD} text-align:right; color:var(--text-secondary);">${g.left}</td>
                <td style="${TD} font-size:0.78rem; color:var(--text-secondary);">${pos || '—'}</td></tr>`;
        });
        return `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="padding:0.8rem 1.1rem; background:var(--bg-main,#f3f5f3); border-bottom:1px solid var(--border-color,#e0e0e0);">
            <h3 style="margin:0; font-size:0.98rem; color:var(--text-primary);">Headcount by agent / vendor</h3>
            <div style="font-size:0.76rem; color:var(--text-secondary);">Wages are allocated per agent — active workers under each, with what they do.</div>
          </div>
          <div style="max-height:600px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">
              <thead><tr>
                <th style="${TH}">Agent / Vendor</th><th style="${TH} text-align:right;">Active</th>
                <th style="${TH} text-align:right;">Left</th><th style="${TH}">Active positions</th>
              </tr></thead>
              <tbody>${html}
                <tr style="font-weight:700; border-top:2px solid var(--border-color,#ccc);">
                  <td style="${TD}">Total</td><td style="${TD} text-align:right;">${tA}</td>
                  <td style="${TD} text-align:right;">${tL}</td><td style="${TD}"></td></tr>
              </tbody>
            </table>
          </div>
        </div>`;
    };

})();
