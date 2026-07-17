// =====================================================================
// render_leave.js — Leave Management module (both workspaces)
// ---------------------------------------------------------------------
// Digitises the bilingual (中文/English) paper Leave Application Form:
//   • Applications entered ON BEHALF of staff (picked from the Employee
//     Master, render_wages_employees.js) — one-step approval flow:
//     pending → approved / rejected (menu key 'leaveApprove'); cancelled
//     kept in history but excluded from totals.
//   • Monthly calendar view — who is on leave each day + manpower count.
//   • Per-employee history with entitlement / taken / balance per type.
//   • Print — half-A4 replica of the paper form (new window + print).
//   • Share — form image via the Web Share API (Teams/WhatsApp/email),
//     PNG download fallback.
//   • Scan — photo/PDF of the handwritten form stored as an attachment
//     (shared/leave_files/<id>_form) + Google Vision OCR prefill.
//   • Google Calendar sync — approved leaves pushed as all-day events
//     (GIS OAuth, same client id as the Drive backup).
//
// Storage:  Firebase  shared/leave_data   (window._leaveDb)
//           attachments at shared/leave_files/<id>_<slot>
//           — namespaced per workspace by workspace.js.
// Access:   menu key 'leave' (apply/edit) + 'leaveApprove' (approve).
//           Export available to read-only users.
// =====================================================================

(function () {
    'use strict';

    const LV_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const LV_TYPES = [
        { id: 'annual', en: 'Annual Leave', zh: '年假' },
        { id: 'sick',   en: 'Sick Leave',   zh: '病假' },
        { id: 'casual', en: 'Casual Leave', zh: '事假' }
    ];
    const LV_DEFAULT_ENT = { annual: 14, sick: 14, casual: 6 };
    const lvTypeOf = (id) => LV_TYPES.find(t => t.id === id) || { id, en: id || '—', zh: '' };

    // Module-local navigation state (NOT persisted into state.leave).
    let _lvMode = 'list';        // list | month | employee | edit | settings
    let _lvEditId = null;        // application id being edited (null = new)
    let _lvSearch = '';
    let _lvStatusFilter = 'all'; // all | pending | approved | rejected | cancelled
    let _lvMonthFilter = 'all';  // 'all' | 'YYYY-MM'
    let _lvEmpSel = '';          // employee view selection (raw picker text)
    let _lvOcrPrefill = null;    // { fields, notes } from a scan, consumed by the editor
    let _lvScanPending = null;   // { dataUrl, fileName } waiting to be attached on Save

    // ── Small helpers ───────────────────────────────────────────────────
    const lvEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const lvNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const lvPad = (n) => String(n).padStart(2, '0');
    const lvUid = () => 'lv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const lvTodayISO = () => { const d = new Date(); return `${d.getFullYear()}-${lvPad(d.getMonth() + 1)}-${lvPad(d.getDate())}`; };
    const lvMe = () => (window._fb && window._fb.auth && window._fb.auth.currentUser && window._fb.auth.currentUser.email) || '';
    const lvFmtDMY = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
        return m ? `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}` : (iso || '');
    };
    const lvFmtDate = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
        if (!m) return '—';
        const mo = LV_MONTHS[parseInt(m[2], 10) - 1] || m[2];
        return `${parseInt(m[3], 10)} ${mo[0] + mo.slice(1).toLowerCase()} ${m[1]}`;
    };
    // Compact list of leave dates: "5, 12, 19, 26 Jul 2026" when one month.
    const lvFmtDates = (dates) => {
        const ds = (dates || []).slice().sort();
        if (!ds.length) return '—';
        const months = new Set(ds.map(d => d.slice(0, 7)));
        if (months.size === 1) {
            const m = /^(\d{4})-(\d{2})/.exec(ds[0]);
            const mo = LV_MONTHS[parseInt(m[2], 10) - 1];
            return ds.map(d => parseInt(d.slice(8), 10)).join(', ') + ` ${mo[0] + mo.slice(1).toLowerCase()} ${m[1]}`;
        }
        return ds.map(lvFmtDMY).join(', ');
    };
    const lvDaysBetween = (a, b) => {
        const x = new Date(a), y = new Date(b);
        return (isNaN(x) || isNaN(y)) ? null : Math.round((y - x) / 86400000);
    };
    const lvAddDays = (iso, n) => {
        const d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return `${d.getFullYear()}-${lvPad(d.getMonth() + 1)}-${lvPad(d.getDate())}`;
    };

    // ── State access ─────────────────────────────────────────────────────
    const lvEnsure = () => {
        const s = window.state;
        if (!s.leave || typeof s.leave !== 'object') s.leave = {};
        if (!Array.isArray(s.leave.applications)) s.leave.applications = [];
        if (!s.leave.entitlements || typeof s.leave.entitlements !== 'object') s.leave.entitlements = {};
        if (!Array.isArray(s.leave.gcalOrphans)) s.leave.gcalOrphans = [];
        return s.leave;
    };
    const lvApps = () => lvEnsure().applications;
    const lvFindApp = (id) => lvApps().find(a => a.id === id) || null;
    // Identity key for totals: employeeId when known, else the (uppercased) name.
    const lvEmpKey = (a) => a.employeeId || ('NAME:' + String(a.name || '').trim().toUpperCase());

    const lvCanEdit = () => (typeof window._canEdit !== 'function') || window._canEdit('leave');
    const lvCanApprove = () => (typeof window._canEdit !== 'function') || window._canEdit('leaveApprove');

    // ── Entitlements ─────────────────────────────────────────────────────
    const lvEntYear = (year) => {
        const e = lvEnsure().entitlements;
        if (!e[year] || typeof e[year] !== 'object') e[year] = {};
        if (!e[year].defaults || typeof e[year].defaults !== 'object') e[year].defaults = { ...LV_DEFAULT_ENT };
        if (!e[year].perEmployee || typeof e[year].perEmployee !== 'object') e[year].perEmployee = {};
        return e[year];
    };
    const lvEntFor = (year, empKey) => {
        const y = lvEntYear(year);
        const ovr = y.perEmployee[empKey] || {};
        const out = {};
        LV_TYPES.forEach(t => { out[t.id] = (ovr[t.id] != null && ovr[t.id] !== '') ? lvNum(ovr[t.id]) : lvNum(y.defaults[t.id]); });
        return out;
    };
    // Approved leave days taken per type, counting only dates that fall in `year`.
    const lvTakenFor = (year, empKey, excludeId) => {
        const out = {}; LV_TYPES.forEach(t => { out[t.id] = 0; });
        lvApps().forEach(a => {
            if (a.status !== 'approved' || a.id === excludeId || lvEmpKey(a) !== empKey) return;
            (a.dates || []).forEach(d => { if (d.slice(0, 4) === String(year) && out[a.type] != null) out[a.type]++; });
        });
        return out;
    };

    // ── Firebase save ────────────────────────────────────────────────────
    const saveLeaveData = (silent) => {
        const db = window._leaveDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — leave data not saved.', 'error'); return Promise.resolve(); }
        if (window._leaveLoaded === false) {
            if (window.notify) window.notify('Leave data still loading — change not saved (protecting your data). Please reload and try again.', 'error');
            return Promise.resolve();
        }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/leave_data').set(JSON.stringify(window.state.leave))
            .then(() => { if (!silent && window.notify) window.notify('Leave data saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveLeaveData = saveLeaveData;

    // ── Attachments (mirror render_pec.js pcUploadFile & co.) ────────────
    // Two named slots per application: 'form' (photo/PDF of the signed paper
    // form) and 'mc' (medical certificate for sick leave). Bytes stored as
    // data URLs OUTSIDE the main record at shared/leave_files/<id>_<slot>.
    const LV_FILE_PATH = 'shared/leave_files';
    const _lvFileCache = {};   // '<id>_<slot>' -> data URL (in-memory only)
    const LV_SLOTS = { form: 'Signed form', mc: 'Medical cert (MC)' };

    const lvReadFileDataUrl = (file) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read failed'));
        fr.readAsDataURL(file);
    });
    const lvFileKey = (appId, slot) => `${appId}_${slot}`;
    const lvUploadFile = (appId, slot, dataUrl) => {
        const key = lvFileKey(appId, slot);
        _lvFileCache[key] = dataUrl;
        const db = window._leaveDb;
        return db ? db.ref(`${LV_FILE_PATH}/${key}`).set(dataUrl) : Promise.resolve();
    };
    const lvLoadFile = async (appId, slot) => {
        const key = lvFileKey(appId, slot);
        if (_lvFileCache[key]) return _lvFileCache[key];
        const db = window._leaveDb;
        if (!db) return null;
        const snap = await db.ref(`${LV_FILE_PATH}/${key}`).once('value');
        const v = snap.val();
        if (v) _lvFileCache[key] = v;
        return v;
    };
    const lvDeleteFile = (appId, slot) => {
        delete _lvFileCache[lvFileKey(appId, slot)];
        const db = window._leaveDb;
        return db ? db.ref(`${LV_FILE_PATH}/${lvFileKey(appId, slot)}`).set(null) : Promise.resolve();
    };
    const lvOpenFile = async (appId, slot) => {
        try {
            const dataUrl = await lvLoadFile(appId, slot);
            if (!dataUrl) { if (window.notify) window.notify('No file stored yet — attach it first.', 'warn'); return; }
            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (!w && window.notify) window.notify('Pop-up blocked — allow pop-ups to view the file.', 'warn');
        } catch (e) {
            if (window.notify) window.notify('Could not open file: ' + e.message, 'error');
        }
    };
    const lvAttachFile = async (appId, slot, file) => {
        if (!lvCanEdit()) { if (window.notify) window.notify('You do not have edit access for Leave.', 'warn'); return; }
        const app = lvFindApp(appId);
        if (!app || !file) return;
        if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) { if (window.notify) window.notify('Please choose a PDF or photo (JPG/PNG).', 'warn'); return; }
        try {
            let dataUrl;
            if (/\.pdf$/i.test(file.name)) dataUrl = await lvReadFileDataUrl(file);
            else dataUrl = await lvReadFileDataUrl(await lvResizeImage(file));
            await lvUploadFile(appId, slot, dataUrl);
            if (!app.files || typeof app.files !== 'object') app.files = {};
            app.files[slot] = { fileName: file.name, uploadedAt: new Date().toISOString(), uploadedBy: lvMe() };
            app.updatedAt = new Date().toISOString();
            await saveLeaveData(true);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'leave', `${LV_SLOTS[slot]} attached — ${app.name || appId}`, '');
            window.renderLeaveView();
            if (window.notify) window.notify(`${LV_SLOTS[slot]} attached.`, 'success');
        } catch (e) {
            if (window.notify) window.notify('Attach failed: ' + e.message, 'error');
        }
    };
    // Purge a slot's bytes, but ONLY if nothing has taken its place — the
    // storage key is <id>_<slot>, so a re-attach to the same slot reuses the
    // path; deleting blindly on expiry would destroy the replacement file.
    const lvPurgeSlotIfVacant = (appId, slot) => {
        const cur = lvFindApp(appId);
        if (cur && cur.files && cur.files[slot]) return;   // replaced — keep the new bytes
        lvDeleteFile(appId, slot);
    };

    const lvRemoveFile = (appId, slot) => {
        if (!lvCanEdit()) return;
        const app = lvFindApp(appId);
        if (!app || !app.files || !app.files[slot]) return;
        const removed = app.files[slot];
        delete app.files[slot];
        saveLeaveData(true);
        window.renderLeaveView();
        const undo = () => {
            app.files = app.files || {};
            app.files[slot] = removed;
            saveLeaveData(true);
            window.renderLeaveView();
        };
        // Bytes are purged only once the undo entry expires (tray eviction or
        // pagehide) — mirrors the weekly-photo pattern, so Undo can restore the
        // attachment without depending on the in-memory cache still holding it.
        if (typeof window.notifyUndo === 'function') {
            window.notifyUndo(`${LV_SLOTS[slot]} removed.`, undo, 7000, () => lvPurgeSlotIfVacant(appId, slot));
        } else {
            lvDeleteFile(appId, slot);
            if (window.notify) window.notify(`${LV_SLOTS[slot]} removed.`, 'info');
        }
    };

    // ── Lazy CDN loaders ─────────────────────────────────────────────────
    const lvLoadScript = (src, ready) => new Promise((res, rej) => {
        if (ready && ready()) return res();
        const s = document.createElement('script');
        s.src = src;
        s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
        document.head.appendChild(s);
    });
    const lvEnsureExcelJS = () => lvLoadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', () => typeof window.ExcelJS !== 'undefined');
    const lvEnsureHtmlToImage = () => lvLoadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', () => typeof window.htmlToImage !== 'undefined');
    const LV_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    const lvEnsurePdfJs = async () => {
        if (window.pdfjsLib) return;
        await lvLoadScript(LV_PDFJS + 'pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = LV_PDFJS + 'pdf.worker.min.js';
    };

    // Downscale a photo to <= maxDim / JPEG (mirrors wkResizeImage in
    // render_weekly.js — phone photos are 5–10 MB; this keeps the DB small).
    const lvResizeImage = (blob, maxDim = 1600, quality = 0.82) => new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const { width: w, height: h } = img;
                const scale = Math.min(1, maxDim / Math.max(w, h));
                if (scale >= 1 && blob.size < 1.2 * 1024 * 1024) { URL.revokeObjectURL(url); return resolve(blob); }
                const cw = Math.round(w * scale), ch = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = cw; canvas.height = ch;
                canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                URL.revokeObjectURL(url);
                canvas.toBlob(b => resolve(b && b.size < blob.size ? b : blob), 'image/jpeg', quality);
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
            img.src = url;
        } catch (e) { resolve(blob); }
    });

    // ── Employee Master helpers ──────────────────────────────────────────
    const lvEmployees = () => {
        const list = (window.state && window.state.wagesEmployees && Array.isArray(window.state.wagesEmployees.list))
            ? window.state.wagesEmployees.list : [];
        // active first (CONFIRMED/PROBATION), then the rest — leave can also be
        // recorded for staff who have since left
        const active = [], rest = [];
        list.forEach(e => (['CONFIRMED', 'PROBATION'].includes(String(e.staffStatus || '').toUpperCase()) ? active : rest).push(e));
        return active.concat(rest);
    };
    const lvEmpLabel = (e) => `${e.displayName || ''}${e.employeeId ? ` (${e.employeeId})` : ''}`;
    const lvEmpDatalist = (id) => `<datalist id="${id}">${lvEmployees().map(e => `<option value="${lvEsc(lvEmpLabel(e))}">`).join('')}</datalist>`;
    // Resolve a picker value "NAME (ID)" (or free text) → { employeeId, name, position }
    const lvResolvePicker = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return { employeeId: '', name: '', position: '' };
        const m = /^(.*)\(([^()]+)\)\s*$/.exec(s);
        const name = (m ? m[1] : s).trim();
        const id = m ? m[2].trim() : '';
        let emp = null;
        if (typeof window.weFindEmployee === 'function') emp = window.weFindEmployee(id || name);
        if (!emp && id) emp = lvEmployees().find(e => String(e.employeeId || '').toUpperCase() === id.toUpperCase()) || null;
        if (emp) return { employeeId: emp.employeeId || '', name: emp.displayName || name, position: emp.position || '' };
        return { employeeId: '', name, position: '' };
    };

    // Fuzzy name match against the Employee Master (for OCR: "BABOH AE
    // LONDEK" → "BABOH AK LONDEK"). Token overlap with 1-edit tolerance.
    const lvEditDist1 = (a, b) => {           // true if edit distance <= 1
        if (a === b) return true;
        const la = a.length, lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        let i = 0, j = 0, edits = 0;
        while (i < la && j < lb) {
            if (a[i] === b[j]) { i++; j++; continue; }
            if (++edits > 1) return false;
            if (la === lb) { i++; j++; }
            else if (la > lb) i++;
            else j++;
        }
        return edits + (la - i) + (lb - j) <= 1;
    };
    const lvNameScore = (a, b) => {
        const ta = String(a).toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 1);
        const tb = String(b).toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 1);
        if (!ta.length || !tb.length) return 0;
        let hit = 0;
        ta.forEach(x => { if (tb.some(y => x === y || (x.length > 2 && y.length > 2 && lvEditDist1(x, y)))) hit++; });
        return hit / Math.max(ta.length, tb.length);
    };
    const lvFuzzyEmployee = (name) => {
        let best = null, bestScore = 0;
        lvEmployees().forEach(e => {
            const sc = lvNameScore(name, e.displayName || '');
            if (sc > bestScore) { bestScore = sc; best = e; }
        });
        return bestScore >= 0.6 ? best : null;
    };

    // ── Status chip ──────────────────────────────────────────────────────
    const lvChip = (bg, fg, label) => `<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:12px;background:${bg};color:${fg};font-size:0.78rem;font-weight:600;white-space:nowrap;">${label}</span>`;
    const lvStatusChip = (a) => {
        if (a.status === 'approved') return lvChip('#d9f2d9', '#1a7a1a', '✓ Approved');
        if (a.status === 'rejected') return lvChip('#fde0e0', '#b02a2a', '✗ Rejected');
        if (a.status === 'cancelled') return lvChip('var(--bg-hover,#eee)', 'var(--text-secondary,#666)', '⊘ Cancelled');
        const days = lvDaysBetween(a.appliedDate || lvTodayISO(), lvTodayISO());
        return lvChip('#fdeed4', '#a06a00', `⏳ Pending${days > 0 ? ` — ${days}d` : ''}`);
    };

    // ── Styling (match PEC / wages look) ─────────────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const BTN = 'padding:0.45rem 1rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);cursor:pointer;font-size:0.85rem;';
    const TH = 'padding:0.5rem 0.6rem;border-bottom:2px solid var(--border-color,#ccc);text-align:left;font-size:0.8rem;color:var(--text-secondary,#666);white-space:nowrap;';
    const TD = 'padding:0.5rem 0.6rem;border-bottom:1px solid var(--border-color,#eee);font-size:0.88rem;vertical-align:top;';

    // =====================================================================
    // Main render — dispatches on _lvMode
    // =====================================================================
    window.renderLeaveView = () => {
        const host = document.getElementById('leave-wrapper');
        if (!host) return;
        lvEnsure();
        if (!window.state.leaveYear) window.state.leaveYear = new Date().getFullYear();
        if (window.state.leaveMonth == null) window.state.leaveMonth = new Date().getMonth();
        if (_lvMode === 'edit') return lvRenderEditor(host);
        if (_lvMode === 'month') return lvRenderMonth(host);
        if (_lvMode === 'employee') return lvRenderEmployee(host);
        if (_lvMode === 'settings') return lvRenderSettings(host);
        return lvRenderList(host);
    };
    const lvGoList = () => { _lvMode = 'list'; _lvEditId = null; _lvOcrPrefill = null; _lvScanPending = null; window.renderLeaveView(); };

    // Mode-switch chips shown on every top-level view.
    const lvModeTabs = () => {
        const tab = (mode, label) => `<button data-lv-mode="${mode}" style="${BTN}${_lvMode === mode ? 'background:var(--accent-color,#2e7d32);color:#fff;border-color:transparent;' : ''}">${label}</button>`;
        return `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">${tab('list', '📋 Applications')}${tab('month', '📆 Monthly view')}${tab('employee', '👤 By employee')}${tab('settings', '⚙️ Entitlements')}</div>`;
    };
    const lvWireModeTabs = (host) => {
        host.querySelectorAll('[data-lv-mode]').forEach(b => b.onclick = () => { _lvMode = b.getAttribute('data-lv-mode'); window.renderLeaveView(); });
    };

    // ── Pending banner ────────────────────────────────────────────────────
    const lvPendingBanner = () => {
        const pending = lvApps().filter(a => a.status === 'pending')
            .map(a => ({ a, days: lvDaysBetween(a.appliedDate || lvTodayISO(), lvTodayISO()) || 0 }))
            .sort((x, y) => y.days - x.days);
        if (!pending.length) return '';
        const chips = pending.map(p =>
            `<span style="display:inline-block;margin:0.15rem 0.3rem 0.15rem 0;padding:0.25rem 0.7rem;border-radius:14px;background:${p.days > 7 ? '#fde0e0' : '#fdeed4'};color:${p.days > 7 ? '#b02a2a' : '#a06a00'};font-size:0.82rem;font-weight:600;">${lvEsc(p.a.name || '(no name)')} — ${(p.a.dates || []).length} day${(p.a.dates || []).length === 1 ? '' : 's'} ${lvTypeOf(p.a.type).en.toLowerCase()}, waiting ${p.days}d</span>`
        ).join('');
        return `<div style="${CARD}border-left:4px solid #e8a33d;">
            <div style="font-weight:700;margin-bottom:0.35rem;">⏳ ${pending.length} leave application${pending.length === 1 ? '' : 's'} awaiting approval</div>
            ${chips}
        </div>`;
    };

    // ── File chips (attach / open / remove) ───────────────────────────────
    const lvFileChips = (a) => {
        const canEdit = lvCanEdit();
        const slots = a.type === 'sick' ? ['form', 'mc'] : ['form'];
        return slots.map(slot => {
            const meta = a.files && a.files[slot];
            if (meta) {
                return `<span style="white-space:nowrap;margin-right:0.6rem;">
                    <a href="#" data-lv-open="${a.id}" data-slot="${slot}" title="${lvEsc(meta.fileName)}" style="text-decoration:none;font-size:0.82rem;">📎 ${lvEsc(LV_SLOTS[slot])}</a>
                    ${canEdit ? `<a href="#" data-lv-rmfile="${a.id}" data-slot="${slot}" title="Remove ${lvEsc(LV_SLOTS[slot])}" style="text-decoration:none;color:#b02a2a;font-size:0.8rem;margin-left:0.15rem;">✕</a>` : ''}
                </span>`;
            }
            if (!canEdit) return '';
            return `<label style="white-space:nowrap;margin-right:0.6rem;cursor:pointer;color:var(--text-secondary,#888);font-size:0.82rem;" title="Attach ${lvEsc(LV_SLOTS[slot])} (photo or PDF)">
                ➕ ${lvEsc(LV_SLOTS[slot])}<input type="file" accept=".pdf,image/*" data-lv-attach="${a.id}" data-slot="${slot}" style="display:none;">
            </label>`;
        }).join('');
    };

    // =====================================================================
    // LIST view — the register
    // =====================================================================
    const lvRenderList = (host) => {
        const canEdit = lvCanEdit();
        const canApprove = lvCanApprove();
        let apps = lvApps().slice();
        apps.sort((a, b) => String(b.appliedDate || '9999').localeCompare(String(a.appliedDate || '9999')));
        const q = _lvSearch.trim().toLowerCase();
        if (q) apps = apps.filter(a => [a.name, a.employeeId, a.position, a.remarks].some(v => String(v || '').toLowerCase().includes(q)));
        if (_lvStatusFilter !== 'all') apps = apps.filter(a => a.status === _lvStatusFilter);
        // month filter options from all leave dates present
        const monthKeys = [...new Set(lvApps().flatMap(a => (a.dates || []).map(d => d.slice(0, 7))))].sort().reverse();
        if (_lvMonthFilter !== 'all') apps = apps.filter(a => (a.dates || []).some(d => d.slice(0, 7) === _lvMonthFilter));

        // Year-to-date summary (approved man-days per type, current year)
        const thisYear = String(new Date().getFullYear());
        const ytd = {}; LV_TYPES.forEach(t => { ytd[t.id] = 0; });
        lvApps().forEach(a => { if (a.status === 'approved') (a.dates || []).forEach(d => { if (d.slice(0, 4) === thisYear && ytd[a.type] != null) ytd[a.type]++; }); });
        const ytdTotal = LV_TYPES.reduce((s, t) => s + ytd[t.id], 0);

        const rows = apps.map(a => {
            const t = lvTypeOf(a.type);
            const actions = [];
            if (a.status === 'pending' && canApprove) {
                actions.push(`<button data-lv-approve="${a.id}" style="${BTN}padding:0.3rem 0.7rem;color:#1a7a1a;" title="Approve">✓</button>`);
                actions.push(`<button data-lv-reject="${a.id}" style="${BTN}padding:0.3rem 0.7rem;color:#b02a2a;" title="Reject">✗</button>`);
            }
            if ((a.status === 'approved' || a.status === 'rejected') && canApprove) {
                actions.push(`<button data-lv-reopen="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Reset to pending">↩</button>`);
            }
            if (a.status === 'pending' && canEdit) actions.push(`<button data-lv-cancel="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Cancel application">⊘</button>`);
            actions.push(`<button data-lv-print="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Print form">🖨</button>`);
            actions.push(`<button data-lv-share="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Share (Teams / WhatsApp)">📤</button>`);
            if (canEdit) {
                actions.push(`<button data-lv-edit="${a.id}" style="${BTN}padding:0.3rem 0.7rem;" title="Edit">✏️</button>`);
                actions.push(`<button data-lv-del="${a.id}" style="${BTN}padding:0.3rem 0.7rem;color:#b02a2a;" title="Delete">🗑</button>`);
            }
            const statusNote =
                a.status === 'approved' && a.approvedBy ? `<div style="font-size:0.75rem;color:var(--text-secondary,#888);margin-top:0.2rem;">by ${lvEsc(a.approvedBy)}${a.approvedAt ? ' · ' + lvFmtDate(a.approvedAt.slice(0, 10)) : ''}</div>` :
                a.status === 'rejected' && a.rejectReason ? `<div style="font-size:0.75rem;color:#b02a2a;margin-top:0.2rem;">${lvEsc(a.rejectReason)}</div>` : '';
            return `<tr>
                <td style="${TD}white-space:nowrap;">${lvFmtDate(a.appliedDate)}</td>
                <td style="${TD}">
                    <div style="font-weight:700;">${lvEsc(a.name || '—')}</div>
                    <div style="font-size:0.8rem;color:var(--text-secondary,#666);">${lvEsc(a.position || '')}${a.employeeId ? ` · ${lvEsc(a.employeeId)}` : ''}</div>
                </td>
                <td style="${TD}white-space:nowrap;">${lvEsc(t.en)} <span style="color:var(--text-secondary,#888);">${t.zh}</span></td>
                <td style="${TD}">${lvEsc(lvFmtDates(a.dates))}</td>
                <td style="${TD}text-align:center;">${(a.dates || []).length}</td>
                <td style="${TD}">${lvStatusChip(a)}${statusNote}<div style="margin-top:0.3rem;">${lvFileChips(a)}</div></td>
                <td style="${TD}white-space:nowrap;text-align:right;">${actions.join(' ')}</td>
            </tr>`;
        }).join('');

        host.innerHTML = `
        <div style="padding:0.5rem 0;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.25rem;">🏖️ Leave Applications</h2>
                <span style="flex:1;"></span>
                ${canEdit ? `<button id="lv-new" style="${BTN}background:var(--accent-color,#2e7d32);color:#fff;border-color:transparent;">➕ New Application</button>` : ''}
                ${canEdit ? `<label style="${BTN}display:inline-block;" title="Photo or PDF of a handwritten form — OCR prefills a new application">📷 Scan paper form<input type="file" id="lv-scan" accept=".pdf,image/*" style="display:none;"></label>` : ''}
                <button id="lv-gcal" style="${BTN}" title="Push approved leaves to Google Calendar">📅 Sync Calendar</button>
                <button id="lv-export" style="${BTN}">⬇️ Export</button>
            </div>
            ${lvModeTabs()}
            <div style="margin-top:1rem;">${lvPendingBanner()}</div>
            <div style="${CARD}">
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:0.75rem;">
                    <input id="lv-search" type="text" placeholder="Search name / ID / remarks…" value="${lvEsc(_lvSearch)}" style="${SS}min-width:220px;">
                    <select id="lv-status" style="${SS}">
                        <option value="all"${_lvStatusFilter === 'all' ? ' selected' : ''}>All statuses</option>
                        <option value="pending"${_lvStatusFilter === 'pending' ? ' selected' : ''}>⏳ Pending</option>
                        <option value="approved"${_lvStatusFilter === 'approved' ? ' selected' : ''}>✓ Approved</option>
                        <option value="rejected"${_lvStatusFilter === 'rejected' ? ' selected' : ''}>✗ Rejected</option>
                        <option value="cancelled"${_lvStatusFilter === 'cancelled' ? ' selected' : ''}>⊘ Cancelled</option>
                    </select>
                    <select id="lv-monthf" style="${SS}">
                        <option value="all"${_lvMonthFilter === 'all' ? ' selected' : ''}>All months</option>
                        ${monthKeys.map(mk => {
                            const [y, m] = mk.split('-');
                            const mo = LV_MONTHS[parseInt(m, 10) - 1];
                            return `<option value="${mk}"${_lvMonthFilter === mk ? ' selected' : ''}>${mo[0] + mo.slice(1).toLowerCase()} ${y}</option>`;
                        }).join('')}
                    </select>
                    <span style="color:var(--text-secondary,#666);font-size:0.85rem;">${apps.length} application${apps.length === 1 ? '' : 's'}</span>
                    <span style="flex:1;"></span>
                    <span style="color:var(--text-secondary,#666);font-size:0.85rem;" title="Approved man-days, ${thisYear}">
                        ${thisYear} taken: <b>${ytdTotal}</b> day${ytdTotal === 1 ? '' : 's'} (${LV_TYPES.map(t => `${t.en.split(' ')[0]} ${ytd[t.id]}`).join(' · ')})
                    </span>
                </div>
                <div style="overflow-x:auto;">
                <table style="border-collapse:collapse;width:100%;min-width:900px;">
                    <thead><tr>
                        <th style="${TH}">Applied</th>
                        <th style="${TH}">Applicant</th>
                        <th style="${TH}">Type</th>
                        <th style="${TH}">Leave dates</th>
                        <th style="${TH}text-align:center;">Days</th>
                        <th style="${TH}">Status / Files</th>
                        <th style="${TH}"></th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="7" style="${TD}text-align:center;color:var(--text-secondary,#888);padding:2rem;">No leave applications yet.${canEdit ? ' Click ➕ New Application, or 📷 Scan a paper form.' : ''}</td></tr>`}</tbody>
                </table>
                </div>
            </div>
        </div>`;

        lvWireModeTabs(host);
        const searchEl = host.querySelector('#lv-search');
        if (searchEl) searchEl.oninput = () => { _lvSearch = searchEl.value; clearTimeout(searchEl._t); searchEl._t = setTimeout(() => { const pos = searchEl.selectionStart; lvRenderList(host); const el = host.querySelector('#lv-search'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); };
        const statusEl = host.querySelector('#lv-status');
        if (statusEl) statusEl.onchange = () => { _lvStatusFilter = statusEl.value; lvRenderList(host); };
        const monthfEl = host.querySelector('#lv-monthf');
        if (monthfEl) monthfEl.onchange = () => { _lvMonthFilter = monthfEl.value; lvRenderList(host); };
        const newBtn = host.querySelector('#lv-new');
        if (newBtn) newBtn.onclick = () => { _lvMode = 'edit'; _lvEditId = null; _lvOcrPrefill = null; _lvScanPending = null; window.renderLeaveView(); };
        const scanInp = host.querySelector('#lv-scan');
        if (scanInp) scanInp.onchange = () => { if (scanInp.files && scanInp.files[0]) lvScanForm(scanInp.files[0]); scanInp.value = ''; };
        const gcalBtn = host.querySelector('#lv-gcal');
        if (gcalBtn) gcalBtn.onclick = () => lvSyncGcal();
        const expBtn = host.querySelector('#lv-export');
        if (expBtn) expBtn.onclick = () => window.downloadLeaveReport();
        host.querySelectorAll('[data-lv-edit]').forEach(b => b.onclick = () => { _lvMode = 'edit'; _lvEditId = b.getAttribute('data-lv-edit'); _lvOcrPrefill = null; _lvScanPending = null; window.renderLeaveView(); });
        host.querySelectorAll('[data-lv-del]').forEach(b => b.onclick = () => lvDeleteApp(b.getAttribute('data-lv-del')));
        host.querySelectorAll('[data-lv-approve]').forEach(b => b.onclick = () => lvSetStatus(b.getAttribute('data-lv-approve'), 'approved'));
        host.querySelectorAll('[data-lv-reject]').forEach(b => b.onclick = () => lvSetStatus(b.getAttribute('data-lv-reject'), 'rejected'));
        host.querySelectorAll('[data-lv-reopen]').forEach(b => b.onclick = () => lvSetStatus(b.getAttribute('data-lv-reopen'), 'pending'));
        host.querySelectorAll('[data-lv-cancel]').forEach(b => b.onclick = () => lvSetStatus(b.getAttribute('data-lv-cancel'), 'cancelled'));
        host.querySelectorAll('[data-lv-print]').forEach(b => b.onclick = () => lvPrintForm(b.getAttribute('data-lv-print')));
        host.querySelectorAll('[data-lv-share]').forEach(b => b.onclick = () => lvShareApp(b.getAttribute('data-lv-share')));
        host.querySelectorAll('[data-lv-open]').forEach(a => a.onclick = (e) => { e.preventDefault(); lvOpenFile(a.getAttribute('data-lv-open'), a.getAttribute('data-slot')); });
        host.querySelectorAll('[data-lv-rmfile]').forEach(a => a.onclick = (e) => { e.preventDefault(); lvRemoveFile(a.getAttribute('data-lv-rmfile'), a.getAttribute('data-slot')); });
        host.querySelectorAll('[data-lv-attach]').forEach(inp => inp.onchange = () => { if (inp.files && inp.files[0]) lvAttachFile(inp.getAttribute('data-lv-attach'), inp.getAttribute('data-slot'), inp.files[0]); inp.value = ''; });
    };

    // ── Status transitions ────────────────────────────────────────────────
    const lvSetStatus = (id, status) => {
        const a = lvFindApp(id);
        if (!a) return;
        if (status === 'cancelled' && !lvCanEdit()) return;
        if (status !== 'cancelled' && !lvCanApprove()) { if (window.notify) window.notify('You need the Leave Approval permission to approve/reject.', 'warn'); return; }
        const me = lvMe();
        const now = new Date().toISOString();
        if (status === 'approved') {
            a.status = 'approved'; a.approvedBy = me; a.approvedAt = now;
            delete a.rejectedBy; delete a.rejectReason;
        } else if (status === 'rejected') {
            const reason = prompt('Reason for rejection (shown to the applicant):', a.rejectReason || '');
            if (reason === null) return;
            a.status = 'rejected'; a.rejectedBy = me; a.rejectReason = reason.trim(); a.rejectedAt = now;
            delete a.approvedBy; delete a.approvedAt;
        } else if (status === 'cancelled') {
            if (!confirm(`Cancel ${a.name || 'this'}'s leave application (${lvFmtDates(a.dates)})?`)) return;
            a.status = 'cancelled'; a.cancelledBy = me; a.cancelledAt = now;
        } else { // back to pending
            a.status = 'pending';
            delete a.approvedBy; delete a.approvedAt; delete a.rejectedBy; delete a.rejectReason; delete a.rejectedAt;
        }
        a.updatedAt = now; a.updatedBy = me;
        saveLeaveData(true);
        if (typeof window.logAudit === 'function') window.logAudit(status === 'pending' ? 'edit' : status, 'leave', `Leave ${a.name || a.id} (${lvFmtDates(a.dates)}) → ${status}`, '');
        window.renderLeaveView();
        if (window.notify) window.notify(`Application ${status === 'pending' ? 'reset to pending' : status}.`, status === 'approved' ? 'success' : 'info');
    };

    const lvDeleteApp = (id) => {
        if (!lvCanEdit()) return;
        const apps = lvApps();
        const idx = apps.findIndex(a => a.id === id);
        if (idx < 0) return;
        const removed = apps.splice(idx, 1)[0];
        // Google Calendar events created for this application must be cleaned
        // up on the next sync — remember their ids.
        if (removed.gcal) lvEnsure().gcalOrphans.push(...Object.values(removed.gcal));
        saveLeaveData(true);
        window.renderLeaveView();
        const undo = () => { lvApps().splice(Math.min(idx, lvApps().length), 0, removed); const or = lvEnsure().gcalOrphans; Object.values(removed.gcal || {}).forEach(ev => { const i = or.indexOf(ev); if (i >= 0) or.splice(i, 1); }); saveLeaveData(true); window.renderLeaveView(); };
        // The record is gone, but its attachment BYTES live at a separate path
        // (shared/leave_files/<id>_<slot>) with nothing else referencing them —
        // purge them once the undo entry expires, or they orphan forever.
        const slots = Object.keys(removed.files || {});
        const purgeFiles = () => { if (!lvFindApp(removed.id)) slots.forEach(slot => lvDeleteFile(removed.id, slot)); };
        if (typeof window.notifyUndo === 'function') {
            window.notifyUndo(`Leave application for ${removed.name || '(no name)'} deleted.`, undo, 7000, purgeFiles);
        } else {
            purgeFiles();
            if (window.notify) window.notify('Leave application deleted.', 'info');
        }
    };

    // =====================================================================
    // MONTHLY view — calendar grid with manpower-on-leave counts
    // =====================================================================
    const lvRenderMonth = (host) => {
        const year = window.state.leaveYear;
        const month = window.state.leaveMonth;    // 0-based
        const mk = `${year}-${lvPad(month + 1)}`;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDow = new Date(year, month, 1).getDay();   // 0 = Sunday

        // day -> [{app, pending}]
        const byDay = {};
        lvApps().forEach(a => {
            if (a.status !== 'approved' && a.status !== 'pending') return;
            (a.dates || []).forEach(d => {
                if (d.slice(0, 7) !== mk) return;
                const day = parseInt(d.slice(8), 10);
                (byDay[day] = byDay[day] || []).push({ a, pending: a.status === 'pending' });
            });
        });

        let manDays = 0, manDaysPending = 0;
        const staff = new Set();
        const byType = {}; LV_TYPES.forEach(t => { byType[t.id] = 0; });
        Object.values(byDay).forEach(list => list.forEach(x => {
            if (x.pending) { manDaysPending++; return; }
            manDays++; staff.add(lvEmpKey(x.a));
            if (byType[x.a.type] != null) byType[x.a.type]++;
        }));

        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push('<td style="border:1px solid var(--border-color,#eee);"></td>');
        const today = lvTodayISO();
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${mk}-${lvPad(d)}`;
            const list = (byDay[d] || []);
            const approvedCount = list.filter(x => !x.pending).length;
            const chips = list.map(x =>
                `<div title="${lvEsc(x.a.name)} — ${lvEsc(lvTypeOf(x.a.type).en)}${x.pending ? ' (pending)' : ''}" style="margin-top:2px;padding:1px 5px;border-radius:4px;font-size:0.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;${x.pending ? 'background:var(--bg-hover,#f2f2f2);color:var(--text-secondary,#888);border:1px dashed var(--border-color,#ccc);' : 'background:#d9f2d9;color:#1a7a1a;'}">${x.pending ? '? ' : ''}${lvEsc((x.a.name || '').split(' ')[0])}</div>`
            ).join('');
            cells.push(`<td style="border:1px solid var(--border-color,#eee);vertical-align:top;padding:4px;min-width:110px;height:76px;${iso === today ? 'background:var(--bg-hover,#f6fbf6);box-shadow:inset 0 0 0 2px var(--accent-color,#2e7d32);' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;font-size:0.85rem;">${d}</span>
                    ${approvedCount ? `<span style="background:#e8a33d;color:#fff;border-radius:10px;padding:0 7px;font-size:0.72rem;font-weight:700;" title="${approvedCount} on approved leave">${approvedCount}</span>` : ''}
                </div>
                ${chips}
            </td>`);
        }
        // pad the final row
        while ((cells.length % 7) !== 0) cells.push('<td style="border:1px solid var(--border-color,#eee);"></td>');
        const weeks = [];
        for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);

        const mo = LV_MONTHS[month];
        host.innerHTML = `
        <div style="padding:0.5rem 0;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.25rem;">📆 Leave — Monthly view</h2>
                <span style="flex:1;"></span>
                <button id="lv-prev" style="${BTN}">❮</button>
                <b style="min-width:110px;text-align:center;">${mo[0] + mo.slice(1).toLowerCase()} ${year}</b>
                <button id="lv-next" style="${BTN}">❯</button>
            </div>
            ${lvModeTabs()}
            <div style="${CARD}margin-top:1rem;">
                <div style="overflow-x:auto;">
                <table style="border-collapse:collapse;width:100%;table-layout:fixed;min-width:790px;">
                    <thead><tr>${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => `<th style="${TH}text-align:center;">${d}</th>`).join('')}</tr></thead>
                    <tbody>${weeks.join('')}</tbody>
                </table>
                </div>
                <div style="margin-top:0.8rem;color:var(--text-secondary,#666);font-size:0.88rem;">
                    <b>${manDays}</b> approved man-day${manDays === 1 ? '' : 's'} on leave this month
                    (${LV_TYPES.map(t => `${t.en.split(' ')[0]} ${byType[t.id]}`).join(' · ')}) ·
                    <b>${staff.size}</b> staff${manDaysPending ? ` · <span style="color:#a06a00;">${manDaysPending} pending man-day${manDaysPending === 1 ? '' : 's'} (shown dimmed “?”)</span>` : ''}
                </div>
            </div>
        </div>`;
        lvWireModeTabs(host);
        host.querySelector('#lv-prev').onclick = () => { let m = month - 1, y = year; if (m < 0) { m = 11; y--; } window.state.leaveMonth = m; window.state.leaveYear = y; window.renderLeaveView(); };
        host.querySelector('#lv-next').onclick = () => { let m = month + 1, y = year; if (m > 11) { m = 0; y++; } window.state.leaveMonth = m; window.state.leaveYear = y; window.renderLeaveView(); };
    };

    // =====================================================================
    // EMPLOYEE view — per-employee history + entitlement balances
    // =====================================================================
    const lvRenderEmployee = (host) => {
        const year = window.state.leaveYear;

        // All employees that appear in leave data this year (plus overrides)
        const summary = {};   // empKey -> { name, employeeId, taken:{}, apps:[] }
        lvApps().forEach(a => {
            const key = lvEmpKey(a);
            if (!summary[key]) summary[key] = { name: a.name || '(no name)', employeeId: a.employeeId || '', apps: [] };
            summary[key].apps.push(a);
        });
        Object.values(summary).forEach(s => { s.taken = lvTakenFor(year, s.employeeId || ('NAME:' + s.name.trim().toUpperCase())); });

        const sel = lvResolvePicker(_lvEmpSel);
        const selKey = _lvEmpSel.trim() ? (sel.employeeId || ('NAME:' + sel.name.toUpperCase())) : '';
        const selRec = selKey && summary[selKey] ? summary[selKey] : null;
        const selName = sel.name || (selRec && selRec.name) || '';

        let detailHtml = '';
        if (_lvEmpSel.trim()) {
            const ent = lvEntFor(year, selKey);
            const taken = lvTakenFor(year, selKey);
            const balCards = LV_TYPES.map(t => {
                const bal = ent[t.id] - taken[t.id];
                return `<div style="flex:1;min-width:150px;border:1px solid var(--border-color,#eee);border-radius:8px;padding:0.7rem 0.9rem;">
                    <div style="font-size:0.8rem;color:var(--text-secondary,#666);">${t.en} ${t.zh}</div>
                    <div style="font-size:1.3rem;font-weight:700;${bal < 0 ? 'color:#b02a2a;' : ''}">${bal}<span style="font-size:0.85rem;font-weight:400;color:var(--text-secondary,#888);"> / ${ent[t.id]} left</span></div>
                    <div style="font-size:0.78rem;color:var(--text-secondary,#888);">taken ${taken[t.id]} day${taken[t.id] === 1 ? '' : 's'}</div>
                </div>`;
            }).join('');
            const histApps = (selRec ? selRec.apps : []).slice().sort((a, b) => String(b.appliedDate || '').localeCompare(String(a.appliedDate || '')));
            const histRows = histApps.map(a => `<tr>
                <td style="${TD}white-space:nowrap;">${lvFmtDate(a.appliedDate)}</td>
                <td style="${TD}white-space:nowrap;">${lvEsc(lvTypeOf(a.type).en)}</td>
                <td style="${TD}">${lvEsc(lvFmtDates(a.dates))}</td>
                <td style="${TD}text-align:center;">${(a.dates || []).length}</td>
                <td style="${TD}">${lvStatusChip(a)}</td>
                <td style="${TD}">${lvEsc(a.remarks || '')}</td>
            </tr>`).join('');
            detailHtml = `<div style="${CARD}">
                <div style="font-weight:700;margin-bottom:0.6rem;">${lvEsc(selName)} — ${year} balance</div>
                <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">${balCards}</div>
                <div style="margin-top:1rem;font-weight:700;">History (all years)</div>
                <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;min-width:640px;">
                    <thead><tr><th style="${TH}">Applied</th><th style="${TH}">Type</th><th style="${TH}">Dates</th><th style="${TH}text-align:center;">Days</th><th style="${TH}">Status</th><th style="${TH}">Remarks</th></tr></thead>
                    <tbody>${histRows || `<tr><td colspan="6" style="${TD}text-align:center;color:var(--text-secondary,#888);">No leave recorded for this employee yet.</td></tr>`}</tbody>
                </table></div>
            </div>`;
        }

        const sumRows = Object.entries(summary)
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .map(([key, s]) => {
                const ent = lvEntFor(year, key);
                const cells = LV_TYPES.map(t => {
                    const bal = ent[t.id] - s.taken[t.id];
                    return `<td style="${TD}text-align:center;">${s.taken[t.id]} <span style="color:${bal < 0 ? '#b02a2a' : 'var(--text-secondary,#888)'};font-size:0.8rem;">/ ${ent[t.id]}</span></td>`;
                }).join('');
                const tot = LV_TYPES.reduce((n, t) => n + s.taken[t.id], 0);
                return `<tr style="cursor:pointer;" data-lv-emp="${lvEsc(s.employeeId ? `${s.name} (${s.employeeId})` : s.name)}">
                    <td style="${TD}"><b>${lvEsc(s.name)}</b>${s.employeeId ? ` <span style="color:var(--text-secondary,#888);font-size:0.8rem;">${lvEsc(s.employeeId)}</span>` : ''}</td>
                    ${cells}
                    <td style="${TD}text-align:center;font-weight:700;">${tot}</td>
                </tr>`;
            }).join('');

        host.innerHTML = `
        <div style="padding:0.5rem 0;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.25rem;">👤 Leave — By employee</h2>
                <span style="flex:1;"></span>
                <button id="lv-yprev" style="${BTN}">❮</button>
                <b>${year}</b>
                <button id="lv-ynext" style="${BTN}">❯</button>
            </div>
            ${lvModeTabs()}
            <div style="${CARD}margin-top:1rem;">
                <label style="font-size:0.85rem;color:var(--text-secondary,#666);">Employee:</label>
                <input id="lv-empsel" type="text" list="lv-empsel-dl" placeholder="Type a name…" value="${lvEsc(_lvEmpSel)}" style="${SS}min-width:280px;">
                ${lvEmpDatalist('lv-empsel-dl')}
            </div>
            ${detailHtml}
            <div style="${CARD}">
                <div style="font-weight:700;margin-bottom:0.6rem;">All staff with recorded leave — taken / entitlement, ${year} (click a row for history)</div>
                <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;min-width:620px;">
                    <thead><tr><th style="${TH}">Employee</th>${LV_TYPES.map(t => `<th style="${TH}text-align:center;">${t.en}</th>`).join('')}<th style="${TH}text-align:center;">Total taken</th></tr></thead>
                    <tbody>${sumRows || `<tr><td colspan="5" style="${TD}text-align:center;color:var(--text-secondary,#888);">No leave recorded yet.</td></tr>`}</tbody>
                </table></div>
            </div>
        </div>`;
        lvWireModeTabs(host);
        host.querySelector('#lv-yprev').onclick = () => { window.state.leaveYear = year - 1; window.renderLeaveView(); };
        host.querySelector('#lv-ynext').onclick = () => { window.state.leaveYear = year + 1; window.renderLeaveView(); };
        const empEl = host.querySelector('#lv-empsel');
        if (empEl) empEl.onchange = () => { _lvEmpSel = empEl.value; window.renderLeaveView(); };
        host.querySelectorAll('[data-lv-emp]').forEach(tr => tr.onclick = () => { _lvEmpSel = tr.getAttribute('data-lv-emp'); window.renderLeaveView(); });
    };

    // =====================================================================
    // SETTINGS view — entitlement defaults + per-employee overrides
    // =====================================================================
    const lvRenderSettings = (host) => {
        const canEdit = lvCanEdit();
        const year = window.state.leaveYear;
        const y = lvEntYear(year);

        const ovrRows = Object.entries(y.perEmployee).map(([key, o]) => {
            const emp = (typeof window.weFindEmployee === 'function' && !key.startsWith('NAME:')) ? window.weFindEmployee(key) : null;
            const label = emp ? lvEmpLabel(emp) : (key.startsWith('NAME:') ? key.slice(5) : key);
            return `<tr>
                <td style="${TD}">${lvEsc(label)}</td>
                ${LV_TYPES.map(t => `<td style="${TD}"><input type="number" min="0" data-lv-ovr="${lvEsc(key)}" data-type="${t.id}" value="${o[t.id] != null ? lvEsc(o[t.id]) : ''}" placeholder="${lvNum(y.defaults[t.id])}" style="${SS}width:85px;" ${canEdit ? '' : 'readonly'}></td>`).join('')}
                <td style="${TD}">${canEdit ? `<button data-lv-ovrrm="${lvEsc(key)}" style="${BTN}padding:0.25rem 0.6rem;color:#b02a2a;">✕</button>` : ''}</td>
            </tr>`;
        }).join('');

        host.innerHTML = `
        <div style="padding:0.5rem 0;max-width:900px;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1.25rem;">⚙️ Leave entitlements</h2>
                <span style="flex:1;"></span>
                <button id="lv-yprev" style="${BTN}">❮</button>
                <b>${year}</b>
                <button id="lv-ynext" style="${BTN}">❯</button>
            </div>
            ${lvModeTabs()}
            <div style="${CARD}margin-top:1rem;">
                <div style="font-weight:700;margin-bottom:0.6rem;">Default entitlement per employee, ${year} (days / year)</div>
                <div style="display:flex;gap:1rem;flex-wrap:wrap;">
                    ${LV_TYPES.map(t => `<div style="display:flex;flex-direction:column;gap:0.2rem;">
                        <label style="font-size:0.78rem;color:var(--text-secondary,#666);">${t.en} ${t.zh}</label>
                        <input type="number" min="0" data-lv-def="${t.id}" value="${lvEsc(y.defaults[t.id])}" style="${SS}width:110px;" ${canEdit ? '' : 'readonly'}>
                    </div>`).join('')}
                </div>
                <div style="margin-top:0.5rem;color:var(--text-secondary,#888);font-size:0.82rem;">Adjust these once you confirm the company's actual entitlements — balances everywhere update automatically.</div>
            </div>
            <div style="${CARD}">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem;">
                    <div style="font-weight:700;">Per-employee overrides</div>
                    <span style="flex:1;"></span>
                    ${canEdit ? `<input id="lv-ovradd-name" type="text" list="lv-ovradd-dl" placeholder="Employee…" style="${SS}min-width:230px;">${lvEmpDatalist('lv-ovradd-dl')}
                    <button id="lv-ovradd" style="${BTN}">➕ Add override</button>` : ''}
                </div>
                <table style="border-collapse:collapse;width:100%;">
                    <thead><tr><th style="${TH}">Employee</th>${LV_TYPES.map(t => `<th style="${TH}">${t.en}</th>`).join('')}<th style="${TH}"></th></tr></thead>
                    <tbody>${ovrRows || `<tr><td colspan="5" style="${TD}color:var(--text-secondary,#888);">No overrides — everyone uses the defaults.</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
        lvWireModeTabs(host);
        host.querySelector('#lv-yprev').onclick = () => { window.state.leaveYear = year - 1; window.renderLeaveView(); };
        host.querySelector('#lv-ynext').onclick = () => { window.state.leaveYear = year + 1; window.renderLeaveView(); };
        if (!canEdit) return;
        host.querySelectorAll('[data-lv-def]').forEach(inp => inp.onchange = () => {
            y.defaults[inp.getAttribute('data-lv-def')] = inp.value === '' ? 0 : lvNum(inp.value);
            saveLeaveData(true);
        });
        host.querySelectorAll('[data-lv-ovr]').forEach(inp => inp.onchange = () => {
            const key = inp.getAttribute('data-lv-ovr'), t = inp.getAttribute('data-type');
            if (!y.perEmployee[key]) y.perEmployee[key] = {};
            if (inp.value === '') delete y.perEmployee[key][t];
            else y.perEmployee[key][t] = lvNum(inp.value);
            saveLeaveData(true);
        });
        host.querySelectorAll('[data-lv-ovrrm]').forEach(b => b.onclick = () => {
            delete y.perEmployee[b.getAttribute('data-lv-ovrrm')];
            saveLeaveData(true);
            window.renderLeaveView();
        });
        const addBtn = host.querySelector('#lv-ovradd');
        if (addBtn) addBtn.onclick = () => {
            const raw = host.querySelector('#lv-ovradd-name').value;
            const r = lvResolvePicker(raw);
            if (!r.name) { if (window.notify) window.notify('Pick or type an employee name first.', 'warn'); return; }
            const key = r.employeeId || ('NAME:' + r.name.toUpperCase());
            if (!y.perEmployee[key]) y.perEmployee[key] = {};
            saveLeaveData(true);
            window.renderLeaveView();
        };
    };

    // =====================================================================
    // EDITOR — one application (working copy; Save commits)
    // =====================================================================
    const lvRenderEditor = (host) => {
        if (!lvCanEdit()) { lvGoList(); return; }
        const existing = _lvEditId ? lvFindApp(_lvEditId) : null;
        const pre = _lvOcrPrefill;   // scan prefill (new applications only)
        const w = existing ? JSON.parse(JSON.stringify(existing)) : {
            id: lvUid(), appliedDate: (pre && pre.appliedDate) || lvTodayISO(),
            employeeId: (pre && pre.employeeId) || '', name: (pre && pre.name) || '',
            position: (pre && pre.position) || '',
            type: (pre && pre.type) || 'annual',
            dates: (pre && pre.dates) ? pre.dates.slice() : [],
            addressDuringLeave: (pre && pre.addressDuringLeave) || '', phone: (pre && pre.phone) || '',
            remarks: (pre && pre.remarks) || '',
            status: 'pending'
        };
        if (!Array.isArray(w.dates)) w.dates = [];
        w.dates.sort();

        const pickerVal = () => w.employeeId ? `${w.name} (${w.employeeId})` : (w.name || '');

        const warnings = () => {
            const out = [];
            if (!w.dates.length) return out;
            // balance (per year the dates fall in)
            const key = w.employeeId || ('NAME:' + String(w.name || '').trim().toUpperCase());
            if (w.name) {
                const years = [...new Set(w.dates.map(d => d.slice(0, 4)))];
                years.forEach(yr => {
                    const ent = lvEntFor(yr, key);
                    const taken = lvTakenFor(yr, key, w.id);
                    const applying = w.dates.filter(d => d.slice(0, 4) === yr).length;
                    const left = ent[w.type] - taken[w.type];
                    if (applying > left) out.push(`⚠ ${lvTypeOf(w.type).en} ${yr}: only ${left} of ${ent[w.type]} day${ent[w.type] === 1 ? '' : 's'} left, this application uses ${applying}.`);
                });
                // duplicate dates for the same employee
                const dup = [];
                lvApps().forEach(a => {
                    if (a.id === w.id || lvEmpKey(a) !== key || a.status === 'rejected' || a.status === 'cancelled') return;
                    (a.dates || []).forEach(d => { if (w.dates.includes(d)) dup.push(d); });
                });
                if (dup.length) out.push(`⚠ ${w.name} already has leave recorded on: ${[...new Set(dup)].sort().map(lvFmtDMY).join(', ')}.`);
            }
            // overlap: other staff on leave the same days
            const overlap = {};
            lvApps().forEach(a => {
                if (a.id === w.id || (a.status !== 'approved' && a.status !== 'pending')) return;
                if (w.name && lvEmpKey(a) === key) return;
                (a.dates || []).forEach(d => { if (w.dates.includes(d)) (overlap[d] = overlap[d] || new Set()).add(a.name || '?'); });
            });
            const odays = Object.keys(overlap).sort();
            if (odays.length) out.push(`ℹ Others on leave the same day${odays.length === 1 ? '' : 's'}: ${odays.map(d => `${lvFmtDMY(d)} (${[...overlap[d]].join(', ')})`).join(' · ')}.`);
            return out;
        };

        const draw = () => {
            const dateChips = w.dates.map((d, i) =>
                `<span style="display:inline-flex;align-items:center;gap:0.3rem;margin:0.15rem 0.3rem 0.15rem 0;padding:0.25rem 0.7rem;border-radius:14px;background:var(--bg-hover,#eef4ee);font-size:0.85rem;">${lvFmtDMY(d)}
                    <a href="#" data-lv-drm="${i}" style="text-decoration:none;color:#b02a2a;">✕</a></span>`).join('');
            const warnHtml = warnings().map(t => `<div style="padding:0.4rem 0.7rem;border-radius:6px;background:${t.startsWith('ℹ') ? 'var(--bg-hover,#eef3fb)' : '#fdeed4'};color:${t.startsWith('ℹ') ? 'var(--text-secondary,#555)' : '#a06a00'};font-size:0.84rem;margin-top:0.4rem;">${lvEsc(t)}</div>`).join('');
            host.innerHTML = `
            <div style="padding:0.5rem 0;max-width:820px;">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
                    <button id="lv-back" style="${BTN}">← Back</button>
                    <h2 style="margin:0;font-size:1.2rem;">${existing ? '✏️ Edit' : '➕ New'} Leave Application</h2>
                </div>
                ${pre ? `<div style="${CARD}border-left:4px solid #e8a33d;background:#fdf6e8;color:#7a5600;">📷 Prefilled from the scanned form — <b>please check every field</b> before saving.${pre.notes && pre.notes.length ? '<br>' + pre.notes.map(lvEsc).join('<br>') : ''}</div>` : ''}
                <div style="${CARD}">
                    <div style="display:flex;gap:0.9rem;flex-wrap:wrap;margin-bottom:0.9rem;">
                        <div style="display:flex;flex-direction:column;gap:0.2rem;flex:2;min-width:260px;">
                            <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Applicant 申請人 — pick from Employee Master (or type a name)</label>
                            <input id="lv-emp" type="text" list="lv-emp-dl" value="${lvEsc(pickerVal())}" placeholder="Type a name…" style="${SS}${pre && !w.employeeId ? 'border-color:#e8a33d;' : ''}">
                            ${lvEmpDatalist('lv-emp-dl')}
                        </div>
                        <div style="display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:180px;">
                            <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Position 職位</label>
                            <input id="lv-pos" type="text" value="${lvEsc(w.position)}" style="${SS}">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:0.2rem;min-width:150px;">
                            <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Date applied</label>
                            <input id="lv-applied" type="date" value="${lvEsc(w.appliedDate)}" style="${SS}">
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.9rem;">
                        <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Type of leave 請假類型</label>
                        <div style="display:flex;gap:1.2rem;flex-wrap:wrap;">
                            ${LV_TYPES.map(t => `<label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:0.92rem;">
                                <input type="radio" name="lv-type" value="${t.id}"${w.type === t.id ? ' checked' : ''}> ${t.zh} ${t.en}
                            </label>`).join('')}
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.9rem;">
                        <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Dates of leave 請假日期 — <b id="lv-daycount">${w.dates.length}</b> 天 day${w.dates.length === 1 ? '' : 's'}</label>
                        <div id="lv-datechips">${dateChips || '<span style="color:var(--text-secondary,#999);font-size:0.85rem;">No dates yet — add below.</span>'}</div>
                        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.4rem;">
                            <input id="lv-dadd" type="date" style="${SS}">
                            <button id="lv-daddbtn" style="${BTN}">➕ Add day</button>
                            <span style="color:var(--text-secondary,#999);">|</span>
                            <input id="lv-dfrom" type="date" style="${SS}" title="Range start">
                            <span style="color:var(--text-secondary,#999);">to</span>
                            <input id="lv-dto" type="date" style="${SS}" title="Range end">
                            <button id="lv-drangebtn" style="${BTN}">➕ Add range</button>
                        </div>
                        <div id="lv-warn">${warnHtml}</div>
                    </div>
                    <div style="display:flex;gap:0.9rem;flex-wrap:wrap;margin-bottom:0.9rem;">
                        <div style="display:flex;flex-direction:column;gap:0.2rem;flex:2;min-width:240px;">
                            <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Address during leave 請假期间連絡地址</label>
                            <input id="lv-addr" type="text" value="${lvEsc(w.addressDuringLeave)}" style="${SS}">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:150px;">
                            <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Phone 電話</label>
                            <input id="lv-phone" type="text" value="${lvEsc(w.phone)}" style="${SS}">
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.2rem;">
                        <label style="font-size:0.78rem;color:var(--text-secondary,#666);">Remarks 備註</label>
                        <textarea id="lv-remarks" rows="2" style="${SS}resize:vertical;">${lvEsc(w.remarks)}</textarea>
                    </div>
                    ${_lvScanPending ? `<div style="margin-top:0.7rem;font-size:0.84rem;color:var(--text-secondary,#666);">📎 The scanned form image will be attached on Save (${lvEsc(_lvScanPending.fileName)}).</div>` : ''}
                </div>
                <div style="display:flex;gap:0.75rem;">
                    <button id="lv-save" style="${BTN}background:var(--accent-color,#2e7d32);color:#fff;border-color:transparent;font-weight:600;">💾 Save</button>
                    <button id="lv-cancel" style="${BTN}">Cancel</button>
                    <span style="flex:1;"></span>
                    <button id="lv-printw" style="${BTN}" title="Print the form as currently filled">🖨 Print form</button>
                </div>
            </div>`;
            wire();
        };

        const readFields = () => {
            const r = lvResolvePicker(host.querySelector('#lv-emp').value);
            w.employeeId = r.employeeId; w.name = r.name;
            const posEl = host.querySelector('#lv-pos');
            // employee picked from master fills position only if the field is empty
            if (r.position && !posEl.value.trim()) posEl.value = r.position;
            w.position = posEl.value.trim();
            w.appliedDate = host.querySelector('#lv-applied').value;
            const typeEl = host.querySelector('input[name="lv-type"]:checked');
            if (typeEl) w.type = typeEl.value;
            w.addressDuringLeave = host.querySelector('#lv-addr').value.trim();
            w.phone = host.querySelector('#lv-phone').value.trim();
            w.remarks = host.querySelector('#lv-remarks').value.trim();
        };

        const wire = () => {
            host.querySelector('#lv-back').onclick = lvGoList;
            host.querySelector('#lv-cancel').onclick = lvGoList;
            const empEl = host.querySelector('#lv-emp');
            empEl.onchange = () => {
                const r = lvResolvePicker(empEl.value);
                if (r.position) host.querySelector('#lv-pos').value = r.position;
                readFields(); draw();
            };
            host.querySelectorAll('input[name="lv-type"]').forEach(rb => rb.onchange = () => { readFields(); draw(); });
            host.querySelector('#lv-daddbtn').onclick = () => {
                const v = host.querySelector('#lv-dadd').value;
                if (!v) return;
                readFields();
                if (!w.dates.includes(v)) w.dates.push(v);
                w.dates.sort(); draw();
            };
            host.querySelector('#lv-drangebtn').onclick = () => {
                const from = host.querySelector('#lv-dfrom').value, to = host.querySelector('#lv-dto').value;
                if (!from || !to || to < from) { if (window.notify) window.notify('Pick a valid From/To range.', 'warn'); return; }
                if (lvDaysBetween(from, to) > 60) { if (window.notify) window.notify('Range longer than 60 days — please check.', 'warn'); return; }
                readFields();
                for (let d = from; d <= to; d = lvAddDays(d, 1)) if (!w.dates.includes(d)) w.dates.push(d);
                w.dates.sort(); draw();
            };
            host.querySelectorAll('[data-lv-drm]').forEach(a => a.onclick = (e) => {
                e.preventDefault();
                readFields();
                w.dates.splice(parseInt(a.getAttribute('data-lv-drm'), 10), 1);
                draw();
            });
            host.querySelector('#lv-printw').onclick = () => { readFields(); lvPrintFormData(w); };
            host.querySelector('#lv-save').onclick = async () => {
                readFields();
                if (!w.name) { if (window.notify) window.notify('Enter the applicant name.', 'warn'); return; }
                if (!w.dates.length) { if (window.notify) window.notify('Add at least one leave date.', 'warn'); return; }
                const me = lvMe();
                w.updatedAt = new Date().toISOString();
                w.updatedBy = me;
                const apps = lvApps();
                const idx = apps.findIndex(a => a.id === w.id);
                if (idx >= 0) apps[idx] = w;
                else { w.createdAt = w.updatedAt; w.createdBy = me; apps.push(w); }
                saveLeaveData(false);
                if (typeof window.logAudit === 'function') window.logAudit(idx >= 0 ? 'edit' : 'add', 'leave', `Leave application ${w.name} (${lvFmtDates(w.dates)})`, '');
                // scan pending? attach the stored form image now that the record exists
                if (_lvScanPending) {
                    try {
                        await lvUploadFile(w.id, 'form', _lvScanPending.dataUrl);
                        const saved = lvFindApp(w.id);
                        if (saved) {
                            saved.files = saved.files || {};
                            saved.files.form = { fileName: _lvScanPending.fileName, uploadedAt: new Date().toISOString(), uploadedBy: me };
                            saveLeaveData(true);
                        }
                    } catch (e) {
                        if (window.notify) window.notify('Form image could not be attached: ' + e.message, 'warn');
                    }
                    _lvScanPending = null;
                }
                lvGoList();
            };
        };
        draw();
    };

    // =====================================================================
    // PRINT — half-A4 replica of the bilingual paper form
    // =====================================================================
    // Shared builder: returns the inner HTML of the form box (used by the
    // print window and by Share's PNG rasteriser).
    const lvFormHtml = (a) => {
        const t = (id) => id === a.type;
        const tick = (id) => t(id) ? '✓' : '&nbsp;&nbsp;';
        const days = (a.dates || []).length;
        const dateList = (a.dates || []).slice().sort().map(d => {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
            return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1].slice(2)}`;
        }).join(', ');
        const approvedLine = a.status === 'approved' && a.approvedBy
            ? `<div class="sig-val">${lvEsc(a.approvedBy)}<br><span style="font-size:8pt;">${lvFmtDMY((a.approvedAt || '').slice(0, 10))}</span></div>` : '<div class="sig-val">&nbsp;</div>';
        return `
        <div class="lv-sheet">
            <div class="lv-datehdr">Date : <span class="lv-uval">${lvEsc(lvFmtDMY(a.appliedDate))}</span></div>
            <div class="lv-title-zh">請&nbsp;&nbsp;假&nbsp;&nbsp;申&nbsp;&nbsp;請&nbsp;&nbsp;表</div>
            <div class="lv-title-en">LEAVE APPLICATION FORM</div>
            <div class="lv-row">
                <div class="lv-lbl"><span class="zh">申 請 人</span><span class="en">APPLICANT :</span></div>
                <div class="lv-val">${lvEsc(a.name || '')}</div>
            </div>
            <div class="lv-row">
                <div class="lv-lbl"><span class="zh">職&nbsp;&nbsp;&nbsp;位</span><span class="en">POSITION :</span></div>
                <div class="lv-val">${lvEsc(a.position || '')}</div>
            </div>
            <div class="lv-row lv-types">
                <div class="lv-lbl"><span class="zh">請假類型</span><span class="en">TYPE OF LEAVE</span></div>
                <div class="lv-typeopts">
                    <span><span class="zh">年假</span><br>Annual Leave (&nbsp;${tick('annual')}&nbsp;)</span>
                    <span><span class="zh">病假</span><br>Sick Leave (&nbsp;${tick('sick')}&nbsp;)</span>
                    <span><span class="zh">事假</span><br>Casual Leave (&nbsp;${tick('casual')}&nbsp;)</span>
                </div>
            </div>
            <div class="lv-row">
                <div class="lv-lbl"><span class="zh">請假日期</span><span class="en">DATE OF LEAVE :</span></div>
                <div class="lv-val">${lvEsc(dateList)}</div>
                <div class="lv-days">(&nbsp;${days}&nbsp;) <span class="zh">天</span> DAYS</div>
            </div>
            <div class="lv-row">
                <div class="lv-lbl lv-lbl-wide"><span class="zh">請假期间&nbsp;&nbsp;連絡地址</span><span class="en">DURING LEAVE Address :</span></div>
                <div class="lv-val">${lvEsc(a.addressDuringLeave || '')}</div>
                <div class="lv-lbl" style="min-width:auto;"><span class="zh">電話</span><span class="en">To</span></div>
                <div class="lv-val" style="max-width:28mm;">${lvEsc(a.phone || '')}</div>
            </div>
            <div class="lv-row">
                <div class="lv-lbl"><span class="zh">備&nbsp;&nbsp;&nbsp;註</span><span class="en">REMARKS :</span></div>
                <div class="lv-val">${lvEsc(a.remarks || '')}</div>
            </div>
            <div class="lv-row"><div class="lv-val" style="margin-left:0;">&nbsp;</div></div>
            <div class="lv-sigs">
                <div class="lv-sig"><div class="zh">申 請 人</div><div>APPLICANT</div><div class="sig-val">&nbsp;</div><div class="sig-line"></div></div>
                <div class="lv-sig"><div class="zh">核&nbsp;&nbsp;証</div><div>CERTIFIED BY</div><div class="sig-val">&nbsp;</div><div class="sig-line"></div></div>
                <div class="lv-sig"><div class="zh">批&nbsp;&nbsp;准</div><div>APPROVED BY</div>${approvedLine}<div class="sig-line"></div></div>
            </div>
        </div>`;
    };
    const LV_FORM_CSS = `
        .lv-sheet { box-sizing:border-box; width:100%; height:100%; padding:10mm 16mm 6mm; font-family:'Times New Roman', 'SimSun', serif; color:#1a1a5e; background:#fff; position:relative; }
        .lv-sheet .zh { font-family:'SimSun','Microsoft YaHei',serif; }
        .lv-datehdr { text-align:right; font-size:11pt; margin-bottom:4mm; }
        .lv-uval { display:inline-block; min-width:38mm; border-bottom:1px solid #1a1a5e; text-align:center; padding:0 2mm; }
        .lv-title-zh { text-align:center; font-size:15pt; font-weight:700; letter-spacing:2px; }
        .lv-title-en { text-align:center; font-size:13pt; font-weight:700; text-decoration:underline; margin-bottom:6mm; }
        .lv-row { display:flex; align-items:flex-end; gap:3mm; margin-bottom:4.5mm; font-size:10.5pt; }
        .lv-lbl { min-width:34mm; line-height:1.25; }
        .lv-lbl-wide { min-width:44mm; }
        .lv-lbl .zh { display:block; font-size:10pt; }
        .lv-lbl .en { display:block; font-weight:600; font-size:9.5pt; }
        .lv-val { flex:1; border-bottom:1px dotted #1a1a5e; min-height:5.5mm; padding:0 2mm 0.5mm; font-family:'Segoe Print','Comic Sans MS',cursive; font-size:10.5pt; color:#111; }
        .lv-days { white-space:nowrap; font-size:10.5pt; }
        .lv-types .lv-typeopts { flex:1; display:flex; justify-content:space-between; gap:2mm; font-size:9.5pt; text-align:center; }
        .lv-sigs { display:flex; justify-content:space-between; gap:8mm; margin-top:8mm; text-align:center; font-size:9.5pt; }
        .lv-sig { flex:1; }
        .lv-sig .zh { font-size:10pt; }
        .lv-sig .sig-val { min-height:12mm; margin-top:2mm; font-family:'Segoe Print','Comic Sans MS',cursive; font-size:9.5pt; color:#111; display:flex; flex-direction:column; justify-content:flex-end; }
        .lv-sig .sig-line { border-bottom:1px dotted #1a1a5e; }`;

    const lvPrintFormData = (a) => {
        const win = window.open('', '_blank');
        if (!win) { if (window.notify) window.notify('Pop-up blocked — allow pop-ups to print the form.', 'warn'); return; }
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Leave Application — ${lvEsc(a.name || '')}</title>
        <style>
            @page { size: A4 portrait; margin: 0; }
            html, body { margin:0; padding:0; }
            /* the form occupies exactly the TOP HALF of an A4 page */
            .lv-half { width:210mm; height:148.5mm; }
            .lv-cut { width:210mm; border-bottom:1px dashed #999; text-align:center; color:#999; font-size:8pt; font-family:sans-serif; }
            ${LV_FORM_CSS}
        </style></head><body>
            <div class="lv-half">${lvFormHtml(a)}</div>
            <div class="lv-cut">✂</div>
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };<\/script>
        </body></html>`);
        win.document.close();
    };
    const lvPrintForm = (id) => { const a = lvFindApp(id); if (a) lvPrintFormData(a); };

    // =====================================================================
    // SHARE — Web Share API (Teams/WhatsApp/…) with PNG-download fallback
    // =====================================================================
    const lvShareApp = async (id) => {
        const a = lvFindApp(id);
        if (!a) return;
        try {
            let blob = null, fileName = `Leave_${(a.name || 'form').replace(/[^A-Za-z0-9]+/g, '_')}.png`;
            // Prefer the scanned paper form if one is attached (and it's an image)
            if (a.files && a.files.form) {
                const dataUrl = await lvLoadFile(a.id, 'form');
                if (dataUrl && /^data:image\//.test(dataUrl)) {
                    blob = await (await fetch(dataUrl)).blob();
                    fileName = a.files.form.fileName || fileName;
                }
            }
            if (!blob) {
                // Rasterise the form replica off-screen (A4 half at 96dpi ≈ 794×562)
                await lvEnsureHtmlToImage();
                const holder = document.createElement('div');
                holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;height:562px;z-index:-1;';
                const style = document.createElement('style');
                style.textContent = LV_FORM_CSS;
                holder.appendChild(style);
                const inner = document.createElement('div');
                inner.style.cssText = 'width:794px;height:562px;background:#fff;';
                inner.innerHTML = lvFormHtml(a);
                holder.appendChild(inner);
                document.body.appendChild(holder);
                try {
                    blob = await window.htmlToImage.toBlob(inner, { backgroundColor: '#ffffff', pixelRatio: 2 });
                } finally {
                    holder.remove();
                }
                if (!blob) throw new Error('could not render the form image');
            }
            const shareText = `Leave application — ${a.name || ''}, ${lvTypeOf(a.type).en}, ${lvFmtDates(a.dates)} (${a.status})`;
            const file = new File([blob], fileName, { type: blob.type || 'image/png' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text: shareText, title: 'Leave application' });
                if (typeof window.logAudit === 'function') window.logAudit('export', 'leave', `Shared leave form — ${a.name || a.id}`, '');
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = fileName;
                document.body.appendChild(link); link.click();
                setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1500);
                if (window.notify) window.notify('Sharing not supported in this browser — image downloaded, attach it in Teams manually.', 'info', 6000);
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return; // user closed the share sheet
            if (window.notify) window.notify('Share failed: ' + e.message, 'error');
        }
    };

    // =====================================================================
    // GOOGLE OAUTH (GIS) — shared by Calendar sync and Vision OCR
    // =====================================================================
    // Same OAuth client as the Drive backup (app_user_mgmt.js); each feature
    // requests only its own scope, cached separately in localStorage.
    const LV_OAUTH_CLIENT_ID = '1073324997940-8nocphvtf77673hkb3v0s5v1f1tmbeh9.apps.googleusercontent.com';
    const lvToken = (scope, store) => new Promise((resolve, reject) => {
        const t = localStorage.getItem(store), exp = localStorage.getItem(store + '_exp');
        if (t && exp && Date.now() < parseInt(exp)) return resolve(t);
        if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) return reject(new Error('Google sign-in SDK not loaded — check your internet connection.'));
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: LV_OAUTH_CLIENT_ID,
            scope,
            callback: (res) => {
                if (res.error) { reject(new Error(res.error_description || res.error)); return; }
                localStorage.setItem(store, res.access_token);
                localStorage.setItem(store + '_exp', String(Date.now() + 3500000));
                resolve(res.access_token);
            }
        });
        client.requestAccessToken({ prompt: '' });
    });
    const lvDropToken = (store) => { localStorage.removeItem(store); localStorage.removeItem(store + '_exp'); };

    // =====================================================================
    // GOOGLE CALENDAR SYNC — approved leaves → all-day events
    // =====================================================================
    const LV_GCAL_STORE = 'lv_gcal_token';
    const LV_GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

    const lvGcalReq = async (token, method, path, body) => {
        const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
            method,
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 404 || res.status === 410) return { gone: true };           // already deleted
        if (!res.ok) {
            let msg = res.statusText;
            try { const e = await res.json(); if (e.error && e.error.message) msg = e.error.message; } catch (_) { }
            const err = new Error(msg); err.httpStatus = res.status; throw err;
        }
        return res.status === 204 ? {} : await res.json();
    };

    const lvSyncGcal = async () => {
        const leave = lvEnsure();
        // What needs doing?
        const toCreate = [];   // {app, date}
        const toDelete = [];   // {app, date, eventId} — date removed or app no longer approved
        lvApps().forEach(a => {
            const gcal = a.gcal || {};
            if (a.status === 'approved') {
                (a.dates || []).forEach(d => { if (!gcal[d]) toCreate.push({ app: a, date: d }); });
                Object.keys(gcal).forEach(d => { if (!(a.dates || []).includes(d)) toDelete.push({ app: a, date: d, eventId: gcal[d] }); });
            } else {
                Object.keys(gcal).forEach(d => toDelete.push({ app: a, date: d, eventId: gcal[d] }));
            }
        });
        const orphans = leave.gcalOrphans.slice();
        if (!toCreate.length && !toDelete.length && !orphans.length) {
            if (window.notify) window.notify('Google Calendar is already up to date — nothing to sync.', 'info');
            return;
        }
        if (!confirm(`Sync with Google Calendar?\n• ${toCreate.length} event(s) to add\n• ${toDelete.length + orphans.length} event(s) to remove\n\nEvents go to the calendar of the Google account you sign in with — use the account whose calendar should show the leaves.`)) return;
        let token;
        try {
            token = await lvToken(LV_GCAL_SCOPE, LV_GCAL_STORE);
        } catch (e) {
            if (window.notify) window.notify('Google sign-in failed: ' + e.message, 'error');
            return;
        }
        if (window.notify) window.notify('Syncing with Google Calendar…', 'info');
        let created = 0, removed = 0, failed = 0, firstErr = null;
        const call = async (fn) => {
            try { return await fn(token); }
            catch (e) {
                if (e.httpStatus === 401) {         // stale token — re-auth once
                    lvDropToken(LV_GCAL_STORE);
                    token = await lvToken(LV_GCAL_SCOPE, LV_GCAL_STORE);
                    return await fn(token);
                }
                throw e;
            }
        };
        for (const job of toDelete) {
            try {
                await call(t => lvGcalReq(t, 'DELETE', `/calendars/primary/events/${encodeURIComponent(job.eventId)}`));
                delete job.app.gcal[job.date];
                removed++;
            } catch (e) { failed++; if (!firstErr) firstErr = e.message; }
        }
        for (const evId of orphans) {
            try {
                await call(t => lvGcalReq(t, 'DELETE', `/calendars/primary/events/${encodeURIComponent(evId)}`));
                const i = leave.gcalOrphans.indexOf(evId);
                if (i >= 0) leave.gcalOrphans.splice(i, 1);
                removed++;
            } catch (e) { failed++; if (!firstErr) firstErr = e.message; }
        }
        for (const job of toCreate) {
            try {
                const a = job.app;
                const ev = await call(t => lvGcalReq(t, 'POST', '/calendars/primary/events', {
                    summary: `🏖️ ${a.name} — ${lvTypeOf(a.type).en}`,
                    description: `${a.remarks ? a.remarks + '\n' : ''}Applied ${lvFmtDMY(a.appliedDate)} · ${(a.dates || []).length} day(s) total · via Harvesting Report app`,
                    start: { date: job.date },
                    end: { date: lvAddDays(job.date, 1) },
                    transparency: 'transparent'
                }));
                a.gcal = a.gcal || {};
                a.gcal[job.date] = ev.id;
                a.gcalSyncedBy = lvMe();
                created++;
            } catch (e) { failed++; if (!firstErr) firstErr = e.message; }
        }
        saveLeaveData(true);
        window.renderLeaveView();
        if (typeof window.logAudit === 'function') window.logAudit('export', 'leave', `Google Calendar sync: +${created} / −${removed}${failed ? ` / ${failed} failed` : ''}`, '');
        if (failed && window.notify) {
            window.notify(`Calendar sync finished with errors: ${created} added, ${removed} removed, ${failed} failed. ${firstErr && /not.*enabled|has not been used|disabled/i.test(firstErr) ? 'Enable the "Google Calendar API" for this project in the Google Cloud console, then retry.' : firstErr || ''}`, 'error', 10000);
        } else if (window.notify) {
            window.notify(`Google Calendar synced: ${created} event(s) added, ${removed} removed.`, 'success');
        }
    };

    // =====================================================================
    // SCAN — photo/PDF of the handwritten form → Vision OCR → prefilled editor
    // =====================================================================
    const LV_VISION_STORE = 'lv_vision_token';
    const LV_VISION_SCOPE = 'https://www.googleapis.com/auth/cloud-vision';

    // File → JPEG data URL (PDF first page rasterised via pdf.js; images downscaled).
    const lvFileToImageDataUrl = async (file) => {
        if (/\.pdf$/i.test(file.name)) {
            await lvEnsurePdfJs();
            const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
            const page = await pdf.getPage(1);
            const vp = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            return canvas.toDataURL('image/jpeg', 0.85);
        }
        return await lvReadFileDataUrl(await lvResizeImage(file));
    };

    const lvScanForm = async (file) => {
        if (!lvCanEdit()) { if (window.notify) window.notify('You do not have edit access for Leave.', 'warn'); return; }
        try {
            if (window.notify) window.notify('Reading the form image…', 'info');
            const dataUrl = await lvFileToImageDataUrl(file);
            _lvScanPending = { dataUrl, fileName: file.name.replace(/\.pdf$/i, '.jpg') };
            let text = '', fta = null;
            try {
                const token = await lvToken(LV_VISION_SCOPE, LV_VISION_STORE);
                if (window.notify) window.notify('Scanning handwriting (Google Vision)…', 'info');
                const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requests: [{
                            image: { content: dataUrl.split(',')[1] },
                            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                            // English only — the fields we extract (name, remarks, address…) are
                            // always Latin-script handwriting; hinting 'zh' too biases ambiguous
                            // strokes toward Chinese-character misreads. We don't need Vision to
                            // transcribe the printed Chinese labels — extraction anchors on the
                            // printed ENGLISH label beside each one.
                            imageContext: { languageHints: ['en'] }
                        }]
                    })
                });
                if (!res.ok) {
                    let msg = res.statusText;
                    try { const e = await res.json(); if (e.error && e.error.message) msg = e.error.message; } catch (_) { }
                    if (res.status === 401) lvDropToken(LV_VISION_STORE);
                    throw new Error(msg);
                }
                const data = await res.json();
                const r0 = data.responses && data.responses[0];
                if (r0 && r0.error) throw new Error(r0.error.message || 'Vision error');
                fta = (r0 && r0.fullTextAnnotation) || null;
                text = (fta && fta.text) || '';
            } catch (e) {
                // OCR failed — still useful: open a blank editor with the photo attached on Save.
                const hint = /has not been used|is disabled|billing|PERMISSION_DENIED/i.test(e.message)
                    ? ' To enable scanning: Google Cloud console → enable the "Cloud Vision API" and attach billing (first 1,000 scans/month are free).'
                    : '';
                if (window.notify) window.notify('OCR unavailable (' + e.message + ').' + hint + ' Opening a blank form — the photo will still be attached.', 'warn', 10000);
                _lvOcrPrefill = null;
                _lvMode = 'edit'; _lvEditId = null;
                window.renderLeaveView();
                return;
            }
            // Keep the raw response for diagnosis — handwriting OCR needs
            // tuning against real scans, and the parsed result alone doesn't
            // show WHY a field came out wrong. Inspect in the console via
            // window._lvLastOcr (text = what Vision read, parsed = our result).
            _lvOcrPrefill = lvParseFormOcr(text, fta);
            window._lvLastOcr = { text, fta, parsed: _lvOcrPrefill, fileName: file.name, at: new Date().toISOString() };
            _lvMode = 'edit'; _lvEditId = null;
            window.renderLeaveView();
            if (typeof window.logAudit === 'function') window.logAudit('import', 'leave', `Scanned paper form — ${file.name}`, '');
        } catch (e) {
            if (window.notify) window.notify('Scan failed: ' + e.message, 'error');
        }
    };

    // Tidy an OCR'd free-text value: drop stray leading/trailing punctuation
    // the scanner picks off ruled lines and field borders (quotes, colons,
    // dots), and collapse whitespace.
    const lvTidy = (s) => String(s || '')
        .replace(/^[\s:."'`,;|/\\*_-]+/, '')
        .replace(/[\s:."'`;|\\*_]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Strip CJK characters — every value field on this form (name, position,
    // address, phone, remarks) is Latin-script per the paper template, so any
    // CJK that lands in one is either a printed label bleeding across from an
    // adjacent word/line, or a misread handwriting stroke. Backstop for both
    // the geometry path (which mostly avoids this) and the text-only fallback.
    const LV_CJK_RE = /[　-〿㐀-鿿豈-﫿＀-￯]/g;
    const lvStripCJK = (s, notes, label) => {
        const raw = String(s || '');
        const stripped = raw.replace(LV_CJK_RE, '').replace(/\s+/g, ' ').trim();
        if (notes && stripped.length < raw.replace(/\s+/g, ' ').trim().length && label) {
            notes.push(`${label} contained unexpected Chinese characters that were removed — please check it read correctly.`);
        }
        return stripped;
    };

    // Reconstruct words with pixel positions from Vision's structured
    // DOCUMENT_TEXT_DETECTION output (pages→blocks→paragraphs→words→symbols),
    // then group into text rows by y-position — mirrors the coordinate-column
    // parsing used for PDFs in render_wages_daily.js. Anchoring on the
    // position of the printed ENGLISH label (not a blind "next line" guess)
    // is what keeps adjacent Chinese label text and unrelated form sections
    // out of the extracted value.
    const lvVisionWords = (fta) => {
        const out = [];
        const pages = fta && fta.pages;
        if (!Array.isArray(pages)) return out;
        pages.forEach(p => (p.blocks || []).forEach(b => (b.paragraphs || []).forEach(pa => (pa.words || []).forEach(w => {
            const txt = (w.symbols || []).map(s => s.text).join('');
            const verts = (w.boundingBox && w.boundingBox.vertices) || [];
            if (!txt || !verts.length) return;
            const xs = verts.map(v => v.x || 0), ys = verts.map(v => v.y || 0);
            out.push({ text: txt, x0: Math.min(...xs), x1: Math.max(...xs), cy: (Math.min(...ys) + Math.max(...ys)) / 2, h: Math.max(1, Math.max(...ys) - Math.min(...ys)) });
        }))));
        return out;
    };
    // Group words into rows. Used to LOCATE printed labels (which share a
    // baseline among themselves) — NOT to collect values: handwriting sits on
    // its own baseline and is much taller, so it frequently falls outside the
    // label's row band. Tolerance keys off the SMALL printed text so the
    // printed labels group tightly.
    const lvGroupLines = (words) => {
        if (!words.length) return [];
        const sorted = words.slice().sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
        const heights = sorted.map(w => w.h).sort((a, b) => a - b);
        const tol = Math.max(6, (heights[Math.floor(heights.length / 2)] || 20) * 0.6);
        const lines = [];
        sorted.forEach(w => {
            let line = lines.find(l => Math.abs(l.cy - w.cy) <= tol);
            if (!line) { line = { cy: w.cy, words: [] }; lines.push(line); }
            line.words.push(w);
            line.cy = line.words.reduce((s, x) => s + x.cy, 0) / line.words.length;
        });
        lines.forEach(l => l.words.sort((a, b) => a.x0 - b.x0));
        return lines.sort((a, b) => a.cy - b.cy);
    };
    // Locate a printed label: the first row whose accumulated left-to-right
    // text satisfies `re`. Returns the label's right edge + vertical centre,
    // which together define where its handwritten value lives.
    const lvFindLabel = (lines, re) => {
        for (const line of lines) {
            let acc = '';
            for (const w of line.words) {
                acc += (acc ? ' ' : '') + w.text;
                if (re.test(acc)) {
                    return { endX: w.x1, cy: line.cy, h: Math.max(...line.words.map(x => x.h)) };
                }
            }
        }
        return null;
    };
    const LV_LABEL_WORD_RE = /APPLICANT|POSITION|TYPE|LEAVE|DATE|DURING|Address|REMARKS|CERTIFIED|APPROVED|DAYS|請|職|申|備|核|批|連|電|年|假|天/i;
    // Collect a label's value: every word to its RIGHT whose vertical centre is
    // near the label's — searched across ALL words, not just the label's row,
    // because handwriting rarely shares the printed baseline. `boundRe` stops
    // the scan at a second label on the same line (e.g. the 電話/To phone column).
    const lvValueWordsFor = (words, lines, labelRe, boundRe) => {
        const lbl = lvFindLabel(lines, labelRe);
        if (!lbl) return null;
        // Generous band: handwriting is taller than print and often rides high.
        const tol = Math.max(lbl.h * 1.3, 16);
        let cand = words.filter(w => w.x0 > lbl.endX + 3 && Math.abs(w.cy - lbl.cy) <= tol);
        if (boundRe) {
            const stop = cand.slice().sort((a, b) => a.x0 - b.x0).find(w => boundRe.test(w.text));
            if (stop) cand = cand.filter(w => w.x0 < stop.x0);
        }
        return { words: cand.sort((a, b) => a.x0 - b.x0), lbl };
    };
    // Parse the Vision response using word positions when available (accurate,
    // avoids cross-language/cross-section bleed); falls back to a plain-text
    // line scan if the structured `pages` data is missing.
    const lvParseFormOcr = (text, fta) => {
        const notes = [];
        const out = { appliedDate: '', employeeId: '', name: '', position: '', type: '', dates: [], addressDuringLeave: '', phone: '', remarks: '', notes };
        const words = lvVisionWords(fta);
        const lines = lvGroupLines(words);

        // Geometry-based single-line value lookup: label anchor → words to its
        // right on the same row (bounded by an optional second label on that row).
        const geomValue = (labelRe, boundRe) => {
            const r = lvValueWordsFor(words, lines, labelRe, boundRe);
            if (!r) return null;
            return r.words.map(w => w.text).join(' ').replace(/^[:：.\s]+/, '').trim();
        };
        // Plain-text fallback (used only when `pages` geometry isn't present).
        const textLines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
        const textAfter = (re) => {
            for (let i = 0; i < textLines.length; i++) {
                const m = re.exec(textLines[i]);
                if (!m) continue;
                const rest = textLines[i].slice(m.index + m[0].length).replace(/^[:：.\s]+/, '').trim();
                if (rest) return rest;
                for (let j = i + 1; j < textLines.length && j <= i + 2; j++) {
                    if (textLines[j] && !/APPLICANT|POSITION|TYPE OF LEAVE|DATE OF LEAVE|DURING LEAVE|REMARKS|LEAVE APPLICATION|CERTIFIED BY|APPROVED BY|申請|職位|請假|備註|電話|核|批/i.test(textLines[j])) return textLines[j];
                }
                return '';
            }
            return '';
        };
        const valueFor = (labelRe, boundRe) => {
            const g = geomValue(labelRe, boundRe);
            if (g) return g;
            return textAfter(labelRe);
        };

        // top "Date : d/m/yyyy"
        const dateTop = /Date\s*[:：]?\s*(\d{1,2})\s*[\/|.]\s*(\d{1,2})\s*[\/|.]\s*(\d{2,4})/i.exec(text);
        if (dateTop) {
            const yy = dateTop[3].length === 2 ? '20' + dateTop[3] : dateTop[3];
            out.appliedDate = `${yy}-${lvPad(dateTop[2])}-${lvPad(dateTop[1])}`;
        }

        // applicant name → fuzzy match to Employee Master
        const rawName = lvStripCJK(valueFor(/\bAPPLICANT\b/i), null).replace(/[^A-Za-z@/'\- .]/g, ' ').replace(/\s+/g, ' ').trim();
        if (rawName) {
            const emp = lvFuzzyEmployee(rawName);
            if (emp) {
                out.employeeId = emp.employeeId || '';
                out.name = emp.displayName || rawName;
                out.position = emp.position || '';
                if (String(emp.displayName).toUpperCase() !== rawName.toUpperCase()) notes.push(`Name read as “${rawName}” → matched to ${emp.displayName} in the Employee Master.`);
            } else {
                out.name = rawName;
                notes.push(`“${rawName}” was not found in the Employee Master — check the spelling or pick from the list.`);
            }
        } else notes.push('Applicant name could not be read.');

        const pos = lvStripCJK(valueFor(/\bPOSITION\b/i), null);
        if (pos && !out.position) out.position = pos.replace(/[^A-Za-z&/'\- .]/g, ' ').replace(/\s+/g, ' ').trim();

        // type of leave — the tick sits between a "( )" bracket pair after each
        // label. Try the flat text first, then geometry: a handwritten ✓ is
        // often transcribed as some other glyph (or as its own word, breaking
        // the flat-text bracket pattern), so also treat "any word inside this
        // label's bracket pair" as a tick.
        const tickCharRe = /[✓✔√v\/x×J]/i;
        const tickRe = (label) => new RegExp(label + String.raw`\s*\(\s*([^()]*?)\s*\)`, 'i');
        const tickedText = (label) => { const m = tickRe(label).exec(text); return !!(m && tickCharRe.test(m[1].trim())); };
        // Geometry: find the label, then look for any word between the next '('
        // and ')' to its right, within the label's vertical band.
        const tickedGeom = (labelRe) => {
            const r = lvValueWordsFor(words, lines, labelRe);
            if (!r || !r.words.length) return false;
            const open = r.words.find(w => w.text.includes('('));
            if (!open) return false;
            const close = r.words.find(w => w.x0 > open.x0 && w.text.includes(')'));
            const inner = r.words.filter(w => w.x0 >= open.x1 - 1 && (!close || w.x1 <= close.x0 + 1));
            // An empty bracket pair yields no inner words; a ticked one yields
            // the mark. Only a tick-shaped, NON-CJK glyph counts: the value band
            // spans neighbouring rows, so the printed Chinese type labels
            // (年假/病假/事假) sit inside these brackets' x-range and would
            // otherwise register as ticks on every option.
            return inner.some(w => {
                const t = w.text.replace(LV_CJK_RE, '').trim();
                return t.length > 0 && t.length <= 2 && tickCharRe.test(t);
            });
        };
        const ticked = (labelStr, labelRe) => tickedText(labelStr) || tickedGeom(labelRe);
        if (ticked('Annual\\s*Leave', /Annual\s*Leave/i)) out.type = 'annual';
        if (!out.type && ticked('Sick\\s*Leave', /Sick\s*Leave/i)) out.type = 'sick';
        if (!out.type && ticked('Casual\\s*Leave', /Casual\s*Leave/i)) out.type = 'casual';
        if (!out.type) { out.type = 'annual'; notes.push('Leave type tick could not be read — defaulted to Annual, please check it against the form.'); }

        // Dates of leave. Handwritten separators ("5/7/26") are transcribed
        // very inconsistently — as / | . ) \ or a bare space — so the matcher
        // is deliberately loose about the separator but strict about shape.
        const reD = /\b(\d{1,2})\s*[\/|.,)\\l-]\s*(\d{1,2})\s*[\/|.,)\\l-]\s*(\d{2,4})\b/g;
        const collectDates = (zone, skipApplied) => {
            const found = [];
            let dm;
            reD.lastIndex = 0;
            while ((dm = reD.exec(zone)) !== null) {
                const d = parseInt(dm[1], 10), mo = parseInt(dm[2], 10);
                if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
                const yy = dm[3].length === 2 ? '20' + dm[3] : dm[3];
                const iso = `${yy}-${lvPad(mo)}-${lvPad(d)}`;
                if (skipApplied && iso === out.appliedDate) continue;
                if (isNaN(new Date(iso))) continue;
                if (!found.includes(iso)) found.push(iso);
            }
            return found;
        };
        // 1) Preferred: the DATE OF LEAVE label's own vertical band, plus any
        //    wrapped continuation row directly beneath it.
        const dlRes = lvValueWordsFor(words, lines, /DATE\s*OF\s*LEAVE/i);
        if (dlRes) {
            let zone = dlRes.words.map(w => w.text).join(' ');
            const below = words.filter(w =>
                w.cy > dlRes.lbl.cy + dlRes.lbl.h * 0.5 &&
                w.cy < dlRes.lbl.cy + dlRes.lbl.h * 3 &&
                w.x0 > dlRes.lbl.endX - 10 &&
                !LV_LABEL_WORD_RE.test(w.text));
            if (below.length) zone += ' ' + below.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' ');
            out.dates = collectDates(zone, true);
        }
        // 2) Fallback: scan the WHOLE document. The header "Date :" is the only
        //    other date on this form and is excluded, so anything else found is
        //    a leave date. Covers the case where the label band missed them.
        if (!out.dates.length) out.dates = collectDates(text, true);
        out.dates.sort();
        if (!out.dates.length) notes.push('Leave dates could not be read — add them manually.');
        else if (out.dates.length !== new Set(out.dates).size) notes.push('Some leave dates repeated — please check.');
        // Cross-check against the "( N ) DAYS" count the form states.
        const statedDays = /\(\s*(\d{1,2})\s*\)\s*(?:天\s*)?DAYS/i.exec(text);
        if (statedDays && out.dates.length && parseInt(statedDays[1], 10) !== out.dates.length) {
            notes.push(`The form states (${statedDays[1]}) days but ${out.dates.length} date${out.dates.length === 1 ? ' was' : 's were'} read — please check the dates.`);
        }

        // address / phone share a row (…Address : <value>   電話/To <phone>) —
        // bound the address value at the phone marker so it never bleeds in.
        // Full compound label phrase — a regex matching "DURING LEAVE" alone
        // would stop at "LEAVE" and let the trailing "Address :" word leak
        // into the value, since it's on the same physical row.
        const phoneMarkerRe = /^(電話|To)$/i;
        const addrRes = lvValueWordsFor(words, lines, /DURING\s*LEAVE\s*Address\s*[:：]?/i, phoneMarkerRe)
                     || lvValueWordsFor(words, lines, /\bAddress\b/i, phoneMarkerRe);
        let addr;
        if (addrRes) {
            addr = addrRes.words.map(w => w.text).join(' ');
            // The address field wraps onto the ruled line below ("…Selampit /
            // Lundu") — pull in the row beneath, left of the phone column and
            // carrying no label of its own.
            const cont = words.filter(w =>
                w.cy > addrRes.lbl.cy + addrRes.lbl.h * 0.5 &&
                w.cy < addrRes.lbl.cy + addrRes.lbl.h * 3.2 &&
                w.x0 > addrRes.lbl.endX - 10 &&
                !LV_LABEL_WORD_RE.test(w.text) &&
                !/^[\d\/|.,)\\-]+$/.test(w.text));
            if (cont.length) addr += ' ' + cont.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' ');
        } else {
            addr = textAfter(/DURING LEAVE|Address/i).replace(/^.*?Address\s*[:：]?\s*/i, '').replace(/\s*(電話|To)\s*$/, '');
        }
        out.addressDuringLeave = lvTidy(lvStripCJK(addr, notes, 'Address during leave'));

        let phone = geomValue(phoneMarkerRe);
        if (!phone) { const m = /(?:電話|To)\s*[:：]?\s*([\d\- +]{6,})/.exec(text); if (m) phone = m[1]; }
        if (phone) out.phone = phone.replace(/[^\d\- +]/g, '').trim();

        const rem = valueFor(/\bREMARKS\b/i);
        out.remarks = lvTidy(lvStripCJK(rem, notes, 'Remarks'));

        return out;
    };
    window._lvParseFormOcr = lvParseFormOcr;   // exposed for testing/tuning against real scans

    // =====================================================================
    // EXCEL export — register + per-employee summary + monthly matrix
    // =====================================================================
    window.downloadLeaveReport = async () => {
        try {
            await lvEnsureExcelJS();
            const year = window.state.leaveYear || new Date().getFullYear();
            const wb = new window.ExcelJS.Workbook();

            // Sheet 1 — register
            const ws = wb.addWorksheet('Register');
            ws.getRow(1).values = ['LEAVE APPLICATIONS REGISTER'];
            ws.getRow(1).font = { bold: true, size: 12 };
            ws.getRow(3).values = ['Applied', 'Employee ID', 'Name', 'Position', 'Type', 'Leave dates', 'Days', 'Status', 'Approved/Rejected by', 'Reason / Remarks'];
            ws.getRow(3).font = { bold: true };
            ws.getRow(3).border = { bottom: { style: 'thin' } };
            [12, 12, 26, 18, 12, 34, 7, 11, 22, 30].forEach((wid, i) => { ws.getColumn(i + 1).width = wid; });
            let r = 4;
            lvApps().slice().sort((a, b) => String(a.appliedDate || '').localeCompare(String(b.appliedDate || ''))).forEach(a => {
                ws.getRow(r++).values = [
                    a.appliedDate || '', a.employeeId || '', a.name || '', a.position || '',
                    lvTypeOf(a.type).en, (a.dates || []).slice().sort().join(', '), (a.dates || []).length,
                    a.status, a.approvedBy || a.rejectedBy || '', [a.rejectReason, a.remarks].filter(Boolean).join(' — ')
                ];
            });

            // Sheet 2 — per-employee summary for the selected year
            const ws2 = wb.addWorksheet(`Summary ${year}`);
            ws2.getRow(1).values = [`LEAVE SUMMARY ${year} — taken vs entitlement (approved leave only)`];
            ws2.getRow(1).font = { bold: true, size: 12 };
            const hdr = ['Employee ID', 'Name'];
            LV_TYPES.forEach(t => hdr.push(`${t.en} taken`, `${t.en} entitled`, `${t.en} balance`));
            hdr.push('Total taken');
            ws2.getRow(3).values = hdr;
            ws2.getRow(3).font = { bold: true };
            ws2.getRow(3).border = { bottom: { style: 'thin' } };
            ws2.getColumn(2).width = 28;
            const empKeys = {};
            lvApps().forEach(a => { empKeys[lvEmpKey(a)] = { name: a.name || '', employeeId: a.employeeId || '' }; });
            let r2 = 4;
            Object.entries(empKeys).sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([key, info]) => {
                const taken = lvTakenFor(year, key);
                const ent = lvEntFor(year, key);
                const row = [info.employeeId, info.name];
                let tot = 0;
                LV_TYPES.forEach(t => { row.push(taken[t.id], ent[t.id], ent[t.id] - taken[t.id]); tot += taken[t.id]; });
                row.push(tot);
                ws2.getRow(r2++).values = row;
            });

            // Sheet 3 — monthly man-days matrix (employee × month), selected year
            const ws3 = wb.addWorksheet(`Monthly ${year}`);
            ws3.getRow(1).values = [`MAN-DAYS ON LEAVE PER MONTH ${year} (approved only)`];
            ws3.getRow(1).font = { bold: true, size: 12 };
            ws3.getRow(3).values = ['Name', ...LV_MONTHS, 'Total'];
            ws3.getRow(3).font = { bold: true };
            ws3.getRow(3).border = { bottom: { style: 'thin' } };
            ws3.getColumn(1).width = 28;
            const matrix = {};
            lvApps().forEach(a => {
                if (a.status !== 'approved') return;
                (a.dates || []).forEach(d => {
                    if (d.slice(0, 4) !== String(year)) return;
                    const key = lvEmpKey(a);
                    if (!matrix[key]) matrix[key] = { name: a.name || '', months: new Array(12).fill(0) };
                    matrix[key].months[parseInt(d.slice(5, 7), 10) - 1]++;
                });
            });
            let r3 = 4;
            const colTot = new Array(12).fill(0);
            Object.values(matrix).sort((a, b) => a.name.localeCompare(b.name)).forEach(m => {
                m.months.forEach((v, i) => { colTot[i] += v; });
                ws3.getRow(r3++).values = [m.name, ...m.months.map(v => v || null), m.months.reduce((s, v) => s + v, 0)];
            });
            const totRow = ws3.getRow(r3);
            totRow.values = ['TOTAL', ...colTot.map(v => v || null), colTot.reduce((s, v) => s + v, 0)];
            totRow.font = { bold: true };
            totRow.border = { top: { style: 'thin' } };

            const buf = await wb.xlsx.writeBuffer();
            const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const link = document.createElement('a');
            link.href = url; link.download = `Leave_Register_${year}.xlsx`;
            document.body.appendChild(link); link.click();
            setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1500);
        } catch (e) {
            if (window.notify) window.notify('Export failed: ' + e.message, 'error');
        }
    };
})();
