// =====================================================================
// render_phc.js — PHC Application module (Tree Planting workspace)
// ---------------------------------------------------------------------
// A functional twin of the PEC Application module (render_pec.js) under a
// separate name / storage / permission. PHC = Permission to Harvest Coupe
// (PEC = Permission to Enter Coupe). Digitises the "PHC applied and
// approved" register: one record per PHC application to the Forest
// Department, with its blocks nested inside (the source Excel repeats the
// application fields on every block row — here they are entered once).
//
//   Application: Forest Dept Coupe No | Internal Coupe No | Letter Ref |
//                PHC Ref No | Operation Heading | Application Date |
//                Approved Date
//   Blocks:      Block No + Block Area (Ha); total auto-summed.
//   Status:      derived — Draft (no application date) → Pending
//                (applied, not approved) → Approved.
//
// Extras: pending-approval banner with days-waiting, per-application
// letter PDF attachments (application + approval letter, stored as data
// URLs at shared/phc_files/<id>_<slot> like Tree Logs invoices), coupe
// analytics (total approved area, avg days-to-approval), and Excel
// import (the user's existing flat register) / template / export.
//
// Storage:  Firebase  shared/phc_data   (window._phcDb)
//           — namespaced per workspace by workspace.js.
// Access:   menu key 'phc'  (window._canEdit / _applyReadOnly).
//           Template + Export available to read-only users.
// =====================================================================

(function () {
    'use strict';

    const PHC_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // Module-local navigation state (NOT persisted into state.phc).
    let _pcMode = 'list';    // list | edit
    let _pcEditId = null;    // application id being edited (null = new)
    let _pcSearch = '';      // list search text (session only)
    let _pcStatusFilter = 'all'; // all | pending | approved | draft

    // ── Small helpers ───────────────────────────────────────────────────
    const pcEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const pcNum = (v) => {
        if (v && typeof v === 'object' && 'result' in v) v = v.result;
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };
    const pcText = (v) => {
        if (v && typeof v === 'object') {
            if ('result' in v) v = v.result;
            else if ('text' in v) v = v.text;
            else if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
        }
        return String(v == null ? '' : v).trim();
    };
    const pcPad = (n) => String(n).padStart(2, '0');
    const pcHa = (n) => pcNum(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const pcNormHeader = (h) => pcText(h).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pcUid = () => 'phc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // Excel cell (Date / ISO string / serial) → 'YYYY-MM-DD'. Mirrors tlToISO.
    const pcToISO = (v) => {
        if (v == null || v === '') return '';
        if (v instanceof Date) return `${v.getFullYear()}-${pcPad(v.getMonth() + 1)}-${pcPad(v.getDate())}`;
        if (typeof v === 'object' && v !== null && 'result' in v) return pcToISO(v.result);
        if (typeof v === 'number') {
            const d = new Date(Math.round((v - 25569) * 86400000));
            return `${d.getUTCFullYear()}-${pcPad(d.getUTCMonth() + 1)}-${pcPad(d.getUTCDate())}`;
        }
        const s = String(v).trim();
        if (s === '-' || s === '') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!isNaN(d)) return `${d.getFullYear()}-${pcPad(d.getMonth() + 1)}-${pcPad(d.getDate())}`;
        return s;
    };
    const pcFmtDate = (iso) => {
        if (!iso) return '—';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        if (!m) return pcEsc(iso);
        const mi = parseInt(m[2], 10) - 1;
        return `${m[3]} ${PHC_MONTHS[mi] ? PHC_MONTHS[mi][0] + PHC_MONTHS[mi].slice(1).toLowerCase() : m[2]} ${m[1]}`;
    };
    const pcDaysBetween = (fromIso, toIso) => {
        const a = new Date(fromIso), b = new Date(toIso);
        if (isNaN(a) || isNaN(b)) return null;
        return Math.round((b - a) / 86400000);
    };
    const pcTodayISO = () => {
        const d = new Date();
        return `${d.getFullYear()}-${pcPad(d.getMonth() + 1)}-${pcPad(d.getDate())}`;
    };

    // ── State access ─────────────────────────────────────────────────────
    const pcEnsure = () => {
        const s = window.state;
        if (!s.phc || typeof s.phc !== 'object') s.phc = {};
        if (!Array.isArray(s.phc.applications)) s.phc.applications = [];
        return s.phc;
    };
    const pcApps = () => pcEnsure().applications;
    const pcFindApp = (id) => pcApps().find(a => a.id === id) || null;

    // Derived status of an application.
    const pcStatus = (app) => {
        if (app.approvedDate) return 'approved';
        if (app.applicationDate) return 'pending';
        return 'draft';
    };
    const pcStatusChip = (app) => {
        const st = pcStatus(app);
        if (st === 'approved') {
            const days = pcDaysBetween(app.applicationDate, app.approvedDate);
            return `<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:12px;background:#d9f2d9;color:#1a7a1a;font-size:0.78rem;font-weight:600;">✓ Approved${days != null ? ` (${days}d)` : ''}</span>`;
        }
        if (st === 'pending') {
            const days = pcDaysBetween(app.applicationDate, pcTodayISO());
            const hot = days != null && days > 90;
            return `<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:12px;background:${hot ? '#fde0e0' : '#fdeed4'};color:${hot ? '#b02a2a' : '#a06a00'};font-size:0.78rem;font-weight:600;">⏳ Pending${days != null ? ` — ${days}d waiting` : ''}</span>`;
        }
        return `<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:12px;background:var(--bg-hover,#eee);color:var(--text-secondary,#666);font-size:0.78rem;font-weight:600;">✎ Draft</span>`;
    };
    const pcTotalHa = (app) => (app.blocks || []).reduce((s, b) => s + pcNum(b.areaHa), 0);

    // ── Firebase save ────────────────────────────────────────────────────
    const savePhcData = (silent) => {
        const db = window._phcDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — PHC data not saved.', 'error'); return Promise.resolve(); }
        // Safety: never overwrite the cloud copy until this session has confirmed
        // a successful load (same guard as every other shared section).
        if (window._phcLoaded === false) {
            if (window.notify) window.notify('PHC data still loading — change not saved (protecting your data). Please reload and try again.', 'error');
            return Promise.resolve();
        }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/phc_data').set(JSON.stringify(window.state.phc))
            .then(() => { if (!silent && window.notify) window.notify('PHC data saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.savePhcData = savePhcData;

    // ── Letter PDF attachments ────────────────────────────────────────────
    // Two named slots per application: 'app' (application letter) and 'apr'
    // (approval letter). Bytes stored as data URLs OUTSIDE the main record at
    // shared/phc_files/<appId>_<slot> (mirrors Tree Logs invoice PDFs); the
    // application record only carries { fileName, uploadedAt, uploadedBy }.
    const PHC_FILE_PATH = 'shared/phc_files';
    const _pcFileCache = {};   // '<id>_<slot>' -> data URL (in-memory only)
    const PC_SLOTS = { app: 'Application letter', apr: 'Approval letter' };

    const pcReadFileDataUrl = (file) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read failed'));
        fr.readAsDataURL(file);
    });
    const pcFileKey = (appId, slot) => `${appId}_${slot}`;
    const pcUploadFile = (appId, slot, dataUrl) => {
        const key = pcFileKey(appId, slot);
        _pcFileCache[key] = dataUrl;
        const db = window._phcDb;
        return db ? db.ref(`${PHC_FILE_PATH}/${key}`).set(dataUrl) : Promise.resolve();
    };
    const pcLoadFile = async (appId, slot) => {
        const key = pcFileKey(appId, slot);
        if (_pcFileCache[key]) return _pcFileCache[key];
        const db = window._phcDb;
        if (!db) return null;
        const snap = await db.ref(`${PHC_FILE_PATH}/${key}`).once('value');
        const v = snap.val();
        if (v) _pcFileCache[key] = v;
        return v;
    };
    const pcDeleteFile = (appId, slot) => {
        delete _pcFileCache[pcFileKey(appId, slot)];
        const db = window._phcDb;
        return db ? db.ref(`${PHC_FILE_PATH}/${pcFileKey(appId, slot)}`).set(null) : Promise.resolve();
    };
    // Open a stored PDF in a new tab (data URL → Blob URL, like tlOpenInvoice).
    const pcOpenFile = async (appId, slot) => {
        try {
            const dataUrl = await pcLoadFile(appId, slot);
            if (!dataUrl) { if (window.notify) window.notify('No PDF stored yet — attach it first.', 'warn'); return; }
            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (!w && window.notify) window.notify('Pop-up blocked — allow pop-ups to view the letter.', 'warn');
        } catch (e) {
            if (window.notify) window.notify('Could not open letter: ' + e.message, 'error');
        }
    };
    const pcAttachFile = async (appId, slot, file) => {
        if (!pcCanEdit()) { if (window.notify) window.notify('You do not have edit access for PHC applications.', 'warn'); return; }
        const app = pcFindApp(appId);
        if (!app || !file) return;
        if (!/\.pdf$/i.test(file.name)) { if (window.notify) window.notify('Please choose a PDF file.', 'warn'); return; }
        try {
            const dataUrl = await pcReadFileDataUrl(file);
            await pcUploadFile(appId, slot, dataUrl);
            if (!app.files || typeof app.files !== 'object') app.files = {};
            const me = (window.state && window.state.currentUserEmail) || (window._fb && window._fb.auth && window._fb.auth.currentUser && window._fb.auth.currentUser.email) || '';
            app.files[slot] = { fileName: file.name, uploadedAt: new Date().toISOString(), uploadedBy: me };
            app.updatedAt = new Date().toISOString();
            await savePhcData(true);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'phc', `${PC_SLOTS[slot]} PDF attached — ${app.phcRefNo || app.letterRef || appId}`, '');
            window.renderPhcView();
            if (window.notify) window.notify(`${PC_SLOTS[slot]} attached.`, 'success');
        } catch (e) {
            if (window.notify) window.notify('Attach failed: ' + e.message, 'error');
        }
    };
    const pcRemoveFile = (appId, slot) => {
        if (!pcCanEdit()) return;
        const app = pcFindApp(appId);
        if (!app || !app.files || !app.files[slot]) return;
        const removed = app.files[slot];
        const cached = _pcFileCache[pcFileKey(appId, slot)] || null;
        delete app.files[slot];
        pcDeleteFile(appId, slot);
        savePhcData(true);
        window.renderPhcView();
        const undo = () => {
            app.files = app.files || {};
            app.files[slot] = removed;
            if (cached) pcUploadFile(appId, slot, cached); // restore bytes from cache
            savePhcData(true);
            window.renderPhcView();
        };
        if (typeof window.notifyUndo === 'function') window.notifyUndo(`${PC_SLOTS[slot]} removed.`, undo);
        else if (window.notify) window.notify(`${PC_SLOTS[slot]} removed.`, 'info');
    };

    const pcEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    // ── Styling (match the tree logs / wages look) ────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;font-size:0.85rem;';
    const TH = 'padding:0.5rem 0.6rem;border-bottom:2px solid var(--border-color,#ccc);text-align:left;font-size:0.8rem;color:var(--text-secondary,#666);white-space:nowrap;';
    const TD = 'padding:0.5rem 0.6rem;border-bottom:1px solid var(--border-color,#eee);font-size:0.88rem;vertical-align:top;';

    const pcCanEdit = () => (typeof window._canEdit !== 'function') || window._canEdit('phc');

    // =====================================================================
    // Main render — dispatches on _pcMode
    // =====================================================================
    window.renderPhcView = () => {
        const host = document.getElementById('phc-wrapper');
        if (!host) return;
        pcEnsure();
        if (_pcMode === 'edit') return pcRenderEditor(host);
        return pcRenderList(host);
    };

    const pcGoList = () => { _pcMode = 'list'; _pcEditId = null; window.renderPhcView(); };

    // ── Pending-approval banner ───────────────────────────────────────────
    const pcPendingBanner = () => {
        const pending = pcApps().filter(a => pcStatus(a) === 'pending')
            .map(a => ({ a, days: pcDaysBetween(a.applicationDate, pcTodayISO()) || 0 }))
            .sort((x, y) => y.days - x.days);
        if (!pending.length) return '';
        const chips = pending.map(p =>
            `<span style="display:inline-block;margin:0.15rem 0.3rem 0.15rem 0;padding:0.25rem 0.7rem;border-radius:14px;background:${p.days > 90 ? '#fde0e0' : '#fdeed4'};color:${p.days > 90 ? '#b02a2a' : '#a06a00'};font-size:0.82rem;font-weight:600;">${pcEsc(a2Label(p.a))} — ${p.days} day${p.days === 1 ? '' : 's'} waiting</span>`
        ).join('');
        return `<div style="${CARD}border-left:4px solid #e8a33d;">
            <div style="font-weight:700;margin-bottom:0.35rem;">⏳ ${pending.length} application${pending.length === 1 ? '' : 's'} awaiting Forest Department approval</div>
            ${chips}
        </div>`;
    };
    const a2Label = (app) => app.phcRefNo || app.letterRef || app.internalCoupeNo || app.forestCoupeNo || '(untitled)';

    // ── Analytics card (per-coupe summary + approval-time stats) ─────────
    const pcAnalyticsCard = () => {
        const apps = pcApps();
        if (!apps.length) return '';
        // Per Forest Dept coupe.
        const map = {}; const order = [];
        apps.forEach(a => {
            const key = a.forestCoupeNo || '(no coupe)';
            if (!map[key]) { map[key] = { coupe: key, internal: a.internalCoupeNo || '', count: 0, blocks: 0, ha: 0, approvedHa: 0, pending: 0 }; order.push(key); }
            const m = map[key];
            m.count++;
            m.blocks += (a.blocks || []).length;
            m.ha += pcTotalHa(a);
            if (pcStatus(a) === 'approved') m.approvedHa += pcTotalHa(a);
            if (pcStatus(a) === 'pending') m.pending++;
        });
        const approvalDays = apps.filter(a => a.applicationDate && a.approvedDate)
            .map(a => pcDaysBetween(a.applicationDate, a.approvedDate)).filter(d => d != null && d >= 0);
        const avgDays = approvalDays.length ? Math.round(approvalDays.reduce((s, d) => s + d, 0) / approvalDays.length) : null;
        const minDays = approvalDays.length ? Math.min(...approvalDays) : null;
        const maxDays = approvalDays.length ? Math.max(...approvalDays) : null;
        const rows = order.map(k => {
            const m = map[k];
            return `<tr>
                <td style="${TD}">${pcEsc(m.coupe)}</td>
                <td style="${TD}">${pcEsc(m.internal)}</td>
                <td style="${TD}text-align:center;">${m.count}${m.pending ? ` <span style="color:#a06a00;">(${m.pending} pending)</span>` : ''}</td>
                <td style="${TD}text-align:center;">${m.blocks}</td>
                <td style="${TD}text-align:right;">${pcHa(m.ha)}</td>
                <td style="${TD}text-align:right;">${pcHa(m.approvedHa)}</td>
            </tr>`;
        }).join('');
        return `<div style="${CARD}">
            <div style="font-weight:700;margin-bottom:0.6rem;">📊 Coupe summary</div>
            <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;min-width:560px;">
                <thead><tr>
                    <th style="${TH}">Forest Dept Coupe</th><th style="${TH}">Internal Coupe</th>
                    <th style="${TH}text-align:center;">Applications</th><th style="${TH}text-align:center;">Blocks</th>
                    <th style="${TH}text-align:right;">Area (Ha)</th><th style="${TH}text-align:right;">Approved area (Ha)</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            ${avgDays != null ? `<div style="margin-top:0.6rem;color:var(--text-secondary,#666);font-size:0.85rem;">Approval time: average <b>${avgDays} days</b> (fastest ${minDays}, slowest ${maxDays}) across ${approvalDays.length} approved application${approvalDays.length === 1 ? '' : 's'}.</div>` : ''}
        </div>`;
    };

    // ── File chips shown per application (attach / open / remove) ────────
    const pcFileChips = (app) => {
        const canEdit = pcCanEdit();
        return Object.keys(PC_SLOTS).map(slot => {
            const meta = app.files && app.files[slot];
            if (meta) {
                return `<span style="white-space:nowrap;margin-right:0.6rem;">
                    <a href="#" data-phc-open="${app.id}" data-slot="${slot}" title="${pcEsc(meta.fileName)}" style="text-decoration:none;font-size:0.82rem;">📎 ${pcEsc(PC_SLOTS[slot])}</a>
                    ${canEdit ? `<a href="#" data-phc-rmfile="${app.id}" data-slot="${slot}" title="Remove ${pcEsc(PC_SLOTS[slot])}" style="text-decoration:none;color:#b02a2a;font-size:0.8rem;margin-left:0.15rem;">✕</a>` : ''}
                </span>`;
            }
            if (!canEdit) return '';
            return `<label style="white-space:nowrap;margin-right:0.6rem;cursor:pointer;color:var(--text-secondary,#888);font-size:0.82rem;" title="Attach ${pcEsc(PC_SLOTS[slot])} (PDF)">
                ➕ ${pcEsc(PC_SLOTS[slot])}<input type="file" accept=".pdf" data-phc-attach="${app.id}" data-slot="${slot}" style="display:none;">
            </label>`;
        }).join('');
    };

    // =====================================================================
    // LIST view — the register
    // =====================================================================
    const pcRenderList = (host) => {
        const canEdit = pcCanEdit();
        let apps = pcApps().slice();
        // newest application first; drafts (no date) on top
        apps.sort((a, b) => String(b.applicationDate || '9999') .localeCompare(String(a.applicationDate || '9999')));
        const q = _pcSearch.trim().toLowerCase();
        if (q) {
            apps = apps.filter(a => [a.forestCoupeNo, a.internalCoupeNo, a.letterRef, a.phcRefNo, a.operationHeading]
                .some(v => String(v || '').toLowerCase().includes(q)));
        }
        if (_pcStatusFilter !== 'all') apps = apps.filter(a => pcStatus(a) === _pcStatusFilter);

        const rows = apps.map(a => {
            const blocks = a.blocks || [];
            const blockList = blocks.map(b => `<span style="display:inline-block;margin:0.1rem 0.25rem 0.1rem 0;padding:0.1rem 0.5rem;border-radius:4px;background:var(--bg-hover,#f2f2f2);font-size:0.8rem;">${pcEsc(b.blockNo)}${b.areaHa !== '' && b.areaHa != null ? ` · ${pcHa(b.areaHa)} Ha` : ''}</span>`).join('');
            const tot = pcTotalHa(a);
            return `<tr>
                <td style="${TD}">
                    <div style="font-weight:700;">${pcEsc(a.forestCoupeNo || '—')} <span style="font-weight:400;color:var(--text-secondary,#666);">${pcEsc(a.internalCoupeNo || '')}</span></div>
                    <div style="font-size:0.8rem;color:var(--text-secondary,#666);">${pcEsc(a.operationHeading || '')}</div>
                </td>
                <td style="${TD}">
                    <div>${pcEsc(a.letterRef || '—')}</div>
                    <div style="font-size:0.8rem;color:var(--text-secondary,#666);">${pcEsc(a.phcRefNo || '')}</div>
                </td>
                <td style="${TD}">${blockList || '—'}${blocks.length ? `<div style="font-size:0.8rem;color:var(--text-secondary,#666);margin-top:0.2rem;">${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${pcHa(tot)} Ha</div>` : ''}</td>
                <td style="${TD}white-space:nowrap;">${pcFmtDate(a.applicationDate)}</td>
                <td style="${TD}white-space:nowrap;">${pcFmtDate(a.approvedDate)}</td>
                <td style="${TD}">${pcStatusChip(a)}<div style="margin-top:0.3rem;">${pcFileChips(a)}</div></td>
                <td style="${TD}white-space:nowrap;text-align:right;">
                    ${canEdit ? `<button data-phc-edit="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Edit">✏️</button>
                    <button data-phc-del="${a.id}" style="${BTN}padding:0.3rem 0.7rem;color:#b02a2a;" title="Delete">🗑</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        host.innerHTML = `
        <div style="padding:0.5rem 0;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.25rem;">📜 PHC Applications</h2>
                <span style="flex:1;"></span>
                ${canEdit ? `<button id="phc-new" style="${BTN}background:var(--accent-color,#2e7d32);color:#fff;border-color:transparent;">➕ New Application</button>` : ''}
                ${canEdit ? `<label style="${BTN}display:inline-block;">📥 Import<input type="file" id="phc-import" accept=".xlsx" style="display:none;"></label>` : ''}
                <button id="phc-template" style="${BTN}">⬇️ Template</button>
                <button id="phc-export" style="${BTN}">📤 Export</button>
            </div>
            ${pcPendingBanner()}
            <div style="${CARD}">
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:0.75rem;">
                    <input id="phc-search" type="text" placeholder="Search coupe / ref / operation…" value="${pcEsc(_pcSearch)}" style="${SS}min-width:220px;">
                    <select id="phc-status" style="${SS}">
                        <option value="all"${_pcStatusFilter === 'all' ? ' selected' : ''}>All statuses</option>
                        <option value="pending"${_pcStatusFilter === 'pending' ? ' selected' : ''}>⏳ Pending</option>
                        <option value="approved"${_pcStatusFilter === 'approved' ? ' selected' : ''}>✓ Approved</option>
                        <option value="draft"${_pcStatusFilter === 'draft' ? ' selected' : ''}>✎ Draft</option>
                    </select>
                    <span style="color:var(--text-secondary,#666);font-size:0.85rem;">${apps.length} application${apps.length === 1 ? '' : 's'}</span>
                </div>
                <div style="overflow-x:auto;">
                <table style="border-collapse:collapse;width:100%;min-width:840px;">
                    <thead><tr>
                        <th style="${TH}">Coupe / Operation</th>
                        <th style="${TH}">Letter Ref / PHC Ref</th>
                        <th style="${TH}">Blocks</th>
                        <th style="${TH}">Applied</th>
                        <th style="${TH}">Approved</th>
                        <th style="${TH}">Status / Letters</th>
                        <th style="${TH}"></th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="7" style="${TD}text-align:center;color:var(--text-secondary,#888);padding:2rem;">No PHC applications yet.${canEdit ? ' Click ➕ New Application, or 📥 Import your existing register.' : ''}</td></tr>`}</tbody>
                </table>
                </div>
            </div>
            ${pcAnalyticsCard()}
        </div>`;

        // ── wire up ──
        const searchEl = host.querySelector('#phc-search');
        if (searchEl) searchEl.oninput = () => { _pcSearch = searchEl.value; clearTimeout(searchEl._t); searchEl._t = setTimeout(() => { const pos = searchEl.selectionStart; pcRenderList(host); const el = host.querySelector('#phc-search'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); };
        const statusEl = host.querySelector('#phc-status');
        if (statusEl) statusEl.onchange = () => { _pcStatusFilter = statusEl.value; pcRenderList(host); };
        const newBtn = host.querySelector('#phc-new');
        if (newBtn) newBtn.onclick = () => { _pcMode = 'edit'; _pcEditId = null; window.renderPhcView(); };
        const tplBtn = host.querySelector('#phc-template');
        if (tplBtn) tplBtn.onclick = () => window.downloadPhcTemplate();
        const expBtn = host.querySelector('#phc-export');
        if (expBtn) expBtn.onclick = () => window.downloadPhcReport();
        const impInput = host.querySelector('#phc-import');
        if (impInput) impInput.onchange = () => { if (impInput.files && impInput.files[0]) window.importPhcApplications(impInput.files[0]); impInput.value = ''; };
        host.querySelectorAll('[data-phc-edit]').forEach(btn => btn.onclick = () => { _pcMode = 'edit'; _pcEditId = btn.getAttribute('data-phc-edit'); window.renderPhcView(); });
        host.querySelectorAll('[data-phc-del]').forEach(btn => btn.onclick = () => pcDeleteApp(btn.getAttribute('data-phc-del')));
        host.querySelectorAll('[data-phc-open]').forEach(a => a.onclick = (e) => { e.preventDefault(); pcOpenFile(a.getAttribute('data-phc-open'), a.getAttribute('data-slot')); });
        host.querySelectorAll('[data-phc-rmfile]').forEach(a => a.onclick = (e) => { e.preventDefault(); pcRemoveFile(a.getAttribute('data-phc-rmfile'), a.getAttribute('data-slot')); });
        host.querySelectorAll('[data-phc-attach]').forEach(inp => inp.onchange = () => { if (inp.files && inp.files[0]) pcAttachFile(inp.getAttribute('data-phc-attach'), inp.getAttribute('data-slot'), inp.files[0]); });
    };

    const pcDeleteApp = (id) => {
        if (!pcCanEdit()) return;
        const apps = pcApps();
        const idx = apps.findIndex(a => a.id === id);
        if (idx < 0) return;
        const removed = apps.splice(idx, 1)[0];
        savePhcData(true);
        window.renderPhcView();
        const undo = () => { pcApps().splice(Math.min(idx, pcApps().length), 0, removed); savePhcData(true); window.renderPhcView(); };
        if (typeof window.notifyUndo === 'function') window.notifyUndo(`PHC application ${a2Label(removed)} deleted.`, undo);
        else if (window.notify) window.notify(`PHC application ${a2Label(removed)} deleted.`, 'info');
    };

    // =====================================================================
    // EDITOR — one application (fields + block rows)
    // =====================================================================
    const pcRenderEditor = (host) => {
        if (!pcCanEdit()) { pcGoList(); return; }
        const existing = _pcEditId ? pcFindApp(_pcEditId) : null;
        // Working copy — nothing touches state.phc until Save.
        const w = existing ? JSON.parse(JSON.stringify(existing)) : {
            id: pcUid(), forestCoupeNo: '', internalCoupeNo: '', letterRef: '', phcRefNo: '',
            operationHeading: '', applicationDate: '', approvedDate: '', blocks: [], remarks: ''
        };
        if (!Array.isArray(w.blocks)) w.blocks = [];
        if (!w.blocks.length) w.blocks.push({ blockNo: '', areaHa: '' });

        const field = (label, key, type, placeholder) => `
            <div style="display:flex;flex-direction:column;gap:0.2rem;min-width:170px;flex:1;">
                <label style="font-size:0.78rem;color:var(--text-secondary,#666);">${label}</label>
                <input type="${type || 'text'}" data-phc-f="${key}" value="${pcEsc(w[key] || '')}" placeholder="${pcEsc(placeholder || '')}" style="${SS}">
            </div>`;

        const blockRows = () => w.blocks.map((b, i) => `
            <tr>
                <td style="${TD}"><input type="text" data-phc-bno="${i}" value="${pcEsc(b.blockNo)}" placeholder="e.g. 001" style="${SS}width:110px;"></td>
                <td style="${TD}"><input type="number" step="any" data-phc-bha="${i}" value="${pcEsc(b.areaHa)}" placeholder="Ha" style="${SS}width:110px;"></td>
                <td style="${TD}"><button data-phc-brm="${i}" style="${BTN}padding:0.25rem 0.6rem;color:#b02a2a;" title="Remove block">✕</button></td>
            </tr>`).join('');

        const draw = () => {
            host.innerHTML = `
            <div style="padding:0.5rem 0;max-width:860px;">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
                    <button id="phc-back" style="${BTN}">← Back</button>
                    <h2 style="margin:0;font-size:1.2rem;">${existing ? '✏️ Edit' : '➕ New'} PHC Application</h2>
                </div>
                <div style="${CARD}">
                    <div style="display:flex;gap:0.9rem;flex-wrap:wrap;margin-bottom:0.9rem;">
                        ${field('Forest Dept Coupe No.', 'forestCoupeNo', 'text', 'e.g. 04A')}
                        ${field('Internal Coupe No.', 'internalCoupeNo', 'text', 'e.g. COUPE 2016')}
                        ${field('Letter Ref.', 'letterRef', 'text', 'e.g. PFB/21/020')}
                        ${field('PHC Ref. No.', 'phcRefNo', 'text', 'e.g. LPF0042/21/04A')}
                    </div>
                    <div style="display:flex;gap:0.9rem;flex-wrap:wrap;margin-bottom:0.9rem;">
                        ${field('Operation Heading', 'operationHeading', 'text', 'e.g. 1-4 (HILL/RAMP)')}
                        ${field('Application Date', 'applicationDate', 'date')}
                        ${field('Approved Date', 'approvedDate', 'date')}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.2rem;">
                        <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Remarks</label>
                        <textarea data-phc-f="remarks" rows="2" style="${SS}resize:vertical;">${pcEsc(w.remarks || '')}</textarea>
                    </div>
                </div>
                <div style="${CARD}">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                        <div style="font-weight:700;">Blocks</div>
                        <span style="flex:1;"></span>
                        <span id="phc-tot" style="color:var(--text-secondary,#666);font-size:0.88rem;">Total: ${pcHa(w.blocks.reduce((s, b) => s + pcNum(b.areaHa), 0))} Ha</span>
                        <button id="phc-badd" style="${BTN}">➕ Add block</button>
                    </div>
                    <table style="border-collapse:collapse;">
                        <thead><tr><th style="${TH}">Block No.</th><th style="${TH}">Area (Ha)</th><th style="${TH}"></th></tr></thead>
                        <tbody id="phc-blocks">${blockRows()}</tbody>
                    </table>
                </div>
                <div style="display:flex;gap:0.75rem;">
                    <button id="phc-save" style="${BTN}background:var(--accent-color,#2e7d32);color:#fff;border-color:transparent;font-weight:600;">💾 Save</button>
                    <button id="phc-cancel" style="${BTN}">Cancel</button>
                </div>
            </div>`;
            wire();
        };

        const readFields = () => {
            host.querySelectorAll('[data-phc-f]').forEach(inp => { w[inp.getAttribute('data-phc-f')] = inp.value.trim(); });
            host.querySelectorAll('[data-phc-bno]').forEach(inp => { w.blocks[parseInt(inp.getAttribute('data-phc-bno'), 10)].blockNo = inp.value.trim(); });
            host.querySelectorAll('[data-phc-bha]').forEach(inp => { const v = inp.value.trim(); w.blocks[parseInt(inp.getAttribute('data-phc-bha'), 10)].areaHa = v === '' ? '' : pcNum(v); });
        };
        const refreshTotal = () => {
            readFields();
            const el = host.querySelector('#phc-tot');
            if (el) el.textContent = `Total: ${pcHa(w.blocks.reduce((s, b) => s + pcNum(b.areaHa), 0))} Ha`;
        };

        const wire = () => {
            host.querySelector('#phc-back').onclick = pcGoList;
            host.querySelector('#phc-cancel').onclick = pcGoList;
            host.querySelector('#phc-badd').onclick = () => { readFields(); w.blocks.push({ blockNo: '', areaHa: '' }); draw(); };
            host.querySelectorAll('[data-phc-brm]').forEach(btn => btn.onclick = () => { readFields(); w.blocks.splice(parseInt(btn.getAttribute('data-phc-brm'), 10), 1); if (!w.blocks.length) w.blocks.push({ blockNo: '', areaHa: '' }); draw(); });
            host.querySelectorAll('[data-phc-bha]').forEach(inp => inp.oninput = refreshTotal);
            host.querySelector('#phc-save').onclick = () => {
                readFields();
                if (!w.forestCoupeNo && !w.internalCoupeNo && !w.letterRef && !w.phcRefNo) {
                    if (window.notify) window.notify('Enter at least a coupe number or letter/PHC reference.', 'warn'); return;
                }
                if (w.approvedDate && !w.applicationDate) {
                    if (window.notify) window.notify('An approved application needs its Application Date too.', 'warn'); return;
                }
                if (w.applicationDate && w.approvedDate && w.approvedDate < w.applicationDate) {
                    if (window.notify) window.notify('Approved Date is before the Application Date — please check.', 'warn'); return;
                }
                w.blocks = w.blocks.filter(b => b.blockNo !== '' || b.areaHa !== '');
                const me = (window.state && window.state.currentUserEmail) || (window._fb && window._fb.auth && window._fb.auth.currentUser && window._fb.auth.currentUser.email) || '';
                w.updatedAt = new Date().toISOString();
                w.updatedBy = me;
                const apps = pcApps();
                const idx = apps.findIndex(a => a.id === w.id);
                if (idx >= 0) apps[idx] = w;
                else { w.createdAt = w.updatedAt; apps.push(w); }
                savePhcData(false);
                if (typeof window.logAudit === 'function') window.logAudit(idx >= 0 ? 'edit' : 'add', 'phc', `PHC application ${a2Label(w)}`, '');
                pcGoList();
            };
        };
        draw();
    };

    // =====================================================================
    // Excel — Template / Import / Export (the user's flat register layout)
    // =====================================================================
    const PHC_HEADERS = ['Forest Dept Coupe No.', 'Internal Coupe No.', 'Letter Ref.', 'PHC Ref. No.',
        'Operation Heading', 'Block No.', 'Block Area (Ha)', 'Total Block Area (Ha)', 'Application Date', 'Approved Date'];

    // header token -> field (normalised via pcNormHeader)
    const PHC_HEADER_MAP = {
        FORESTDEPTCOUPENO: 'forestCoupeNo',
        INTERNALCOUPENO: 'internalCoupeNo',
        LETTERREF: 'letterRef',
        PECREFNO: 'phcRefNo',
        OPERATIONHEADING: 'operationHeading',
        BLOCKNO: 'blockNo',
        BLOCKAREAHA: 'areaHa',
        TOTALBLOCKAREAHA: 'totalHa',
        APPLICATIONDATE: 'applicationDate',
        APPROVEDDATE: 'approvedDate'
    };

    const pcDeferredDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    };

    window.downloadPhcTemplate = async () => {
        try {
            await pcEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            const ws = wb.addWorksheet('PHC Applications');
            ws.getRow(1).values = ['PHC APPLICATION REGISTER — one row per block; repeat the application fields on each of its block rows'];
            ws.getRow(1).font = { bold: true };
            ws.getRow(2).values = ['Dates as YYYY-MM-DD. Total Block Area is optional (the app sums the blocks itself).'];
            ws.getRow(2).font = { italic: true, size: 9 };
            ws.getRow(4).values = PHC_HEADERS;
            ws.getRow(4).font = { bold: true };
            ws.getRow(4).border = { bottom: { style: 'thin' } };
            // example row (realistic values from the user's own register)
            ws.getRow(5).values = ['04A', 'COUPE 2016', 'PFB/21/020', 'LPF0042/21/04A', '1-4 (HILL/RAMP)', '001', 49, 240, '2021-09-08', '2021-11-19'];
            ws.getRow(5).font = { italic: true, color: { argb: 'FF888888' } };
            [14, 16, 14, 18, 24, 10, 14, 18, 16, 16].forEach((wid, i) => { ws.getColumn(i + 1).width = wid; });
            ws.getColumn(9).numFmt = 'yyyy-mm-dd';
            ws.getColumn(10).numFmt = 'yyyy-mm-dd';
            const buf = await wb.xlsx.writeBuffer();
            pcDeferredDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'PHC_Application_Template.xlsx');
        } catch (e) {
            if (window.notify) window.notify('Template failed: ' + e.message, 'error');
        }
    };

    // Import the user's flat register: rows grouped into applications by
    // (letterRef | phcRefNo | forestCoupeNo). Re-import is idempotent — an
    // existing application with the same group key is REPLACED (blocks and
    // dates refreshed); others are appended. Attachments survive (matched
    // application keeps its id + files).
    window.importPhcApplications = async (file) => {
        if (!pcCanEdit()) { if (window.notify) window.notify('You do not have edit access for PHC applications.', 'warn'); return; }
        try {
            await pcEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            await wb.xlsx.load(await file.arrayBuffer());
            const groups = {}; const order = [];
            let rowsRead = 0, totalMismatch = 0;
            wb.eachSheet(ws => {
                // find the header row (first row whose cells include FORESTDEPTCOUPENO or PECREFNO + BLOCKNO)
                let headerRow = 0; const colMap = {};
                ws.eachRow((row, rn) => {
                    if (headerRow) return;
                    const tokens = {};
                    row.eachCell((cell, cn) => { tokens[pcNormHeader(cell.value)] = cn; });
                    if ((tokens.FORESTDEPTCOUPENO || tokens.PECREFNO) && tokens.BLOCKNO) {
                        headerRow = rn;
                        Object.keys(PHC_HEADER_MAP).forEach(tok => { if (tokens[tok]) colMap[PHC_HEADER_MAP[tok]] = tokens[tok]; });
                    }
                });
                if (!headerRow) return;
                ws.eachRow((row, rn) => {
                    if (rn <= headerRow) return;
                    const get = (f) => colMap[f] ? row.getCell(colMap[f]).value : null;
                    const blockNo = pcText(get('blockNo'));
                    const letterRef = pcText(get('letterRef'));
                    const phcRefNo = pcText(get('phcRefNo'));
                    const forestCoupeNo = pcText(get('forestCoupeNo'));
                    if (!blockNo && !letterRef && !phcRefNo && !forestCoupeNo) return; // blank / spacer row
                    if (!blockNo) return;   // an application row needs its block
                    rowsRead++;
                    const key = (letterRef || phcRefNo || forestCoupeNo).toUpperCase();
                    if (!groups[key]) {
                        groups[key] = {
                            forestCoupeNo, internalCoupeNo: pcText(get('internalCoupeNo')),
                            letterRef, phcRefNo,
                            operationHeading: pcText(get('operationHeading')),
                            applicationDate: pcToISO(get('applicationDate')),
                            approvedDate: pcToISO(get('approvedDate')),
                            statedTotalHa: pcText(get('totalHa')) === '' ? null : pcNum(get('totalHa')),
                            blocks: []
                        };
                        order.push(key);
                    }
                    const g = groups[key];
                    // later rows may fill fields the first row lacked
                    if (!g.phcRefNo && phcRefNo) g.phcRefNo = phcRefNo;
                    if (!g.operationHeading) g.operationHeading = pcText(get('operationHeading'));
                    if (!g.approvedDate) g.approvedDate = pcToISO(get('approvedDate'));
                    const areaRaw = get('areaHa');
                    g.blocks.push({ blockNo, areaHa: pcText(areaRaw) === '' ? '' : pcNum(areaRaw) });
                });
            });
            if (!order.length) { if (window.notify) window.notify('No PHC rows recognised — expected the register headers (Forest Dept Coupe No. / PHC Ref. No. / Block No. …).', 'warn'); return; }
            // stated-total sanity check
            order.forEach(k => {
                const g = groups[k];
                if (g.statedTotalHa != null) {
                    const sum = g.blocks.reduce((s, b) => s + pcNum(b.areaHa), 0);
                    if (Math.abs(sum - g.statedTotalHa) > 0.01 && sum > 0) totalMismatch++;
                }
            });
            const apps = pcApps();
            const findExisting = (g) => apps.find(a =>
                (g.letterRef && String(a.letterRef || '').toUpperCase() === g.letterRef.toUpperCase()) ||
                (g.phcRefNo && String(a.phcRefNo || '').toUpperCase() === g.phcRefNo.toUpperCase()));
            let added = 0, updated = 0;
            order.forEach(k => { if (findExisting(groups[k])) updated++; else added++; });
            const msg = `Import ${order.length} PHC application(s) from ${rowsRead} block row(s)?\n` +
                `• ${added} new, ${updated} will be updated (blocks & dates replaced)` +
                (totalMismatch ? `\n⚠ ${totalMismatch} application(s) whose stated Total Block Area differs from the sum of its blocks — the app uses the summed value.` : '');
            if (!confirm(msg)) return;
            const me = (window.state && window.state.currentUserEmail) || (window._fb && window._fb.auth && window._fb.auth.currentUser && window._fb.auth.currentUser.email) || '';
            const now = new Date().toISOString();
            order.forEach(k => {
                const g = groups[k];
                const existing = findExisting(g);
                if (existing) {
                    Object.assign(existing, {
                        forestCoupeNo: g.forestCoupeNo || existing.forestCoupeNo,
                        internalCoupeNo: g.internalCoupeNo || existing.internalCoupeNo,
                        letterRef: g.letterRef || existing.letterRef,
                        phcRefNo: g.phcRefNo || existing.phcRefNo,
                        operationHeading: g.operationHeading || existing.operationHeading,
                        applicationDate: g.applicationDate || existing.applicationDate,
                        approvedDate: g.approvedDate || existing.approvedDate,
                        blocks: g.blocks, updatedAt: now, updatedBy: me
                    });
                } else {
                    apps.push({
                        id: pcUid(), forestCoupeNo: g.forestCoupeNo, internalCoupeNo: g.internalCoupeNo,
                        letterRef: g.letterRef, phcRefNo: g.phcRefNo, operationHeading: g.operationHeading,
                        applicationDate: g.applicationDate, approvedDate: g.approvedDate,
                        blocks: g.blocks, remarks: '', createdAt: now, updatedAt: now, updatedBy: me
                    });
                }
            });
            await savePhcData(true);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'phc', `${order.length} PHC application(s): ${added} new, ${updated} updated`, '');
            pcGoList();
            if (window.notify) window.notify(`Imported ${order.length} PHC application(s): ${added} new, ${updated} updated.`, 'success');
        } catch (e) {
            console.error('PHC import', e);
            if (window.notify) window.notify('Import failed: ' + e.message, 'error');
        }
    };

    // Export back to the user's flat register layout (one row per block).
    window.downloadPhcReport = async () => {
        try {
            await pcEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            const ws = wb.addWorksheet('PHC Applications');
            ws.getRow(1).values = PHC_HEADERS;
            ws.getRow(1).font = { bold: true };
            ws.getRow(1).border = { bottom: { style: 'thin' } };
            [14, 16, 14, 18, 28, 10, 14, 18, 16, 16].forEach((wid, i) => { ws.getColumn(i + 1).width = wid; });
            ws.getColumn(9).numFmt = 'yyyy-mm-dd';
            ws.getColumn(10).numFmt = 'yyyy-mm-dd';
            const apps = pcApps().slice().sort((a, b) => String(a.applicationDate || '9999').localeCompare(String(b.applicationDate || '9999')));
            let r = 2;
            apps.forEach(a => {
                const tot = pcTotalHa(a);
                const blocks = (a.blocks && a.blocks.length) ? a.blocks : [{ blockNo: '', areaHa: '' }];
                blocks.forEach(b => {
                    const row = ws.getRow(r++);
                    row.values = [
                        a.forestCoupeNo || '', a.internalCoupeNo || '', a.letterRef || '', a.phcRefNo || '',
                        a.operationHeading || '', b.blockNo || '',
                        b.areaHa === '' || b.areaHa == null ? null : pcNum(b.areaHa),
                        tot || null,
                        a.applicationDate ? new Date(a.applicationDate + 'T00:00:00') : null,
                        a.approvedDate ? new Date(a.approvedDate + 'T00:00:00') : null
                    ];
                });
            });
            const buf = await wb.xlsx.writeBuffer();
            pcDeferredDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'PHC_Applications.xlsx');
        } catch (e) {
            if (window.notify) window.notify('Export failed: ' + e.message, 'error');
        }
    };
})();
