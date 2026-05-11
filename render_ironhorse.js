// =====================================================================
// render_ironhorse.js — Iron Horse Asset Numbers & Expenses
// =====================================================================

const IH_MONTHS     = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const IH_CATS       = ['DC','FUEL','LUBE','PART','SR1','TOOL'];
const IH_CAT_LABELS = { DC:'D.C/', FUEL:'FUEL', LUBE:'LUBE', PART:'PART', SR1:'SR/1', TOOL:'TOOL' };

const IH_DEFAULT_ASSET_NOS = ['GT06','GT07','GT08','GT09','GT10','GT12','GT13','GT16','GT17','GT20','GT22'];

const getDefaultIronHorseAssets = () => IH_DEFAULT_ASSET_NOS.map(no => ({
    assetNo: no, description: 'IRON HORSE', gangAssignments: []
}));

// ─────────────────────────────────────────────────────────────────────
// Expense category helpers (base + per-year extras like "PET")
// Year structure: { extraCategories: [...], months: { JAN: {...} } }
// ─────────────────────────────────────────────────────────────────────
const ihNormalizeHeader = h => String(h || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Map a normalized Excel header to a canonical category key (base or extra),
// or 'TOTAL' to skip, or null to flag as unknown.
const ihMatchHeaderToCategory = (norm, existingExtras) => {
    if (!norm) return { kind: 'skip' };
    if (norm === 'TOTAL' || norm === 'GRANDTOTAL') return { kind: 'skip' };
    if (norm === 'ASSETNO' || norm === 'ASSET' || norm === 'ROWLABELS') return { kind: 'asset' };
    if (IH_CATS.includes(norm))           return { kind: 'base',  key: norm };
    if (norm === 'PARTS')                 return { kind: 'base',  key: 'PART' };
    if (norm === 'TOOLS')                 return { kind: 'base',  key: 'TOOL' };
    if (existingExtras.includes(norm))    return { kind: 'extra', key: norm };
    return { kind: 'unknown', key: norm };
};

// Ensure year has nested {extraCategories, months} structure, migrating old flat data
const ihEnsureExpenseYear = (yearStr) => {
    if (!window.state.ironHorse) window.state.ironHorse = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};
    let yd = window.state.ironHorse.expenses[yearStr];
    if (!yd) {
        window.state.ironHorse.expenses[yearStr] = { extraCategories: [], months: {} };
        return window.state.ironHorse.expenses[yearStr];
    }
    if (yd.months !== undefined) {
        if (!yd.extraCategories) yd.extraCategories = [];
        return yd;
    }
    // Old flat structure — migrate
    const migrated = { extraCategories: [], months: {} };
    Object.keys(yd).forEach(k => { if (IH_MONTHS.includes(k)) migrated.months[k] = yd[k]; });
    window.state.ironHorse.expenses[yearStr] = migrated;
    return migrated;
};

const ihGetYearCategories = (yearStr) => {
    const yd = ihEnsureExpenseYear(yearStr);
    return yd.extraCategories || [];
};

const ihGetAllCategories = (yearStr) => [...IH_CATS, ...ihGetYearCategories(yearStr)];

const ihGetCatLabel = (cat) => IH_CAT_LABELS[cat] || cat;

// ─────────────────────────────────────────────────────────────────────
// Gang assignment modal — shows gangs from gangsByYear for the year
// ─────────────────────────────────────────────────────────────────────
// prefill = { gang, from, to, remark } for edit mode, null for new
const ihShowGangAssignModal = (assetNo, yearStr, onConfirm, prefill = null) => {
    const existing = document.getElementById('ih-gang-modal');
    if (existing) existing.remove();

    const gangs = (window.state.gangsByYear && window.state.gangsByYear[yearStr]) || [];

    const overlay = document.createElement('div');
    overlay.id = 'ih-gang-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); z-index:9999; display:flex; justify-content:center; align-items:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card); border-radius:8px; padding:1.5rem; width:400px; box-shadow:0 4px 24px rgba(0,0,0,0.35); border:1px solid var(--border-color);';

    const gangOptions = gangs.length > 0
        ? gangs.map(g => `<option value="${g}">${g}</option>`).join('')
        : '<option value="" disabled>No gangs found for ' + yearStr + '</option>';

    const isEdit = !!prefill;
    const defaultFrom = prefill ? prefill.from : `${yearStr}-01-01`;
    const defaultTo   = prefill ? (prefill.to || '') : '';
    const defaultRemark = prefill ? (prefill.remark || '') : '';

    modal.innerHTML = `
        <h3 style="margin:0 0 1.25rem; font-size:1rem; color:var(--text-primary); border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
            ${isEdit ? 'Edit Assignment' : 'Assign Gang'} — <span style="color:var(--accent);">${assetNo}</span>
        </h3>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Gang *</label>
            <select id="ih-gang-select" class="edit-input" style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem;">
                <option value="">— Select gang —</option>
                ${gangOptions}
            </select>
        </div>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">From Date *</label>
            <input id="ih-gang-from" type="date" class="edit-input" value="${defaultFrom}"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">To Date <span style="font-weight:400;">(leave blank if ongoing)</span></label>
            <input id="ih-gang-to" type="date" class="edit-input" value="${defaultTo}"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="margin-bottom:1.25rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Remark <span style="font-weight:400;">(optional)</span></label>
            <input id="ih-gang-remark" type="text" class="edit-input" value="${defaultRemark}" placeholder="e.g. transferred after breakdown"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
            <button id="ih-gang-cancel" class="btn-secondary" style="padding:0.4rem 1.25rem;">Cancel</button>
            <button id="ih-gang-confirm" class="btn-primary" style="padding:0.4rem 1.25rem; background:#10b981; border-color:#10b981;">${isEdit ? 'Save Changes' : 'Confirm'}</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Pre-select gang when editing
    if (prefill && prefill.gang) {
        const sel = document.getElementById('ih-gang-select');
        if (sel) sel.value = prefill.gang;
    }

    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    document.getElementById('ih-gang-cancel').onclick = () => overlay.remove();
    document.getElementById('ih-gang-confirm').onclick = () => {
        const gang   = document.getElementById('ih-gang-select').value.trim();
        const from   = document.getElementById('ih-gang-from').value.trim();
        const to     = document.getElementById('ih-gang-to').value.trim() || null;
        const remark = document.getElementById('ih-gang-remark').value.trim();
        if (!gang) { alert('Please select a gang.'); return; }
        if (!from) { alert('Please enter a from date.'); return; }
        overlay.remove();
        onConfirm({ gang, from, to, remark });
    };
};

// Resolve which gang an asset belongs to for a given month (0-indexed)
const resolveGangForMonth = (gangAssignments, yearStr, monthIdx) => {
    if (!gangAssignments || gangAssignments.length === 0) return null;
    const midMonth = new Date(parseInt(yearStr), monthIdx, 15);
    const firstOfMonth = new Date(parseInt(yearStr), monthIdx, 1);
    const active = gangAssignments.filter(g => {
        if (!g.from) return false;
        if (new Date(g.from) > midMonth) return false;
        if (g.to && new Date(g.to) < firstOfMonth) return false;
        return true;
    });
    if (active.length === 0) return null;
    return active.sort((a, b) => new Date(b.from) - new Date(a.from))[0];
};

// ─────────────────────────────────────────────────────────────────────
// Shared helper: build a label + <select> row
// ─────────────────────────────────────────────────────────────────────
const ihMakeSelector = (labelText, options, currentVal, onChange) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    lbl.textContent = labelText;
    const sel = document.createElement('select');
    sel.className = 'edit-input';
    sel.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';
    options.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if (value === currentVal) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.onchange = e => onChange(e.target.value);
    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    return wrap;
};

// Sort/filter state for assets table (persists across re-renders)
let _ihAssetsSort = { col: 'assetNo', dir: 'asc' };
let _ihAssetsFilter = '';

// ─────────────────────────────────────────────────────────────────────
// Asset Numbers View
// ─────────────────────────────────────────────────────────────────────
const renderIronHorseAssets = () => {
    const wrapper = document.getElementById('ironhorse-assets-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!window.state.ironHorse)          window.state.ironHorse = {};
    if (!window.state.ironHorse.assets)   window.state.ironHorse.assets = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};

    const assetYears = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr    = window.state.ihAssetsYear || assetYears[0] || String(new Date().getFullYear());
    const monthStr   = window.state.ihAssetsMonth || 'JAN';

    if (!window.state.ironHorse.assets[yearStr]) {
        window.state.ironHorse.assets[yearStr] = getDefaultIronHorseAssets();
    }
    const assets   = window.state.ironHorse.assets[yearStr];
    const monthIdx = IH_MONTHS.indexOf(monthStr);

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Iron Horse — Asset Numbers';
    leftGroup.appendChild(titleEl);

    const yearOpts = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort().map(y => ({ value: y, label: y }));
    if (yearOpts.length === 0) yearOpts.push({ value: yearStr, label: yearStr });
    leftGroup.appendChild(ihMakeSelector('Year:', yearOpts, yearStr, v => {
        window.state.ihAssetsYear = v; renderIronHorseAssets();
    }));

    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const latest = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort().pop() || yearStr;
        const newY = prompt('Enter year (e.g. 2027):', String(parseInt(latest) + 1));
        if (!newY || !newY.trim()) return;
        const ny = newY.trim();
        if (window.state.ironHorse.assets[ny]) { alert(`Year ${ny} already exists.`); return; }
        window.state.ironHorse.assets[ny] = getDefaultIronHorseAssets();
        window.state.ihAssetsYear = ny;
        saveIronHorseData(); renderIronHorseAssets();
    };
    leftGroup.appendChild(btnAddYear);

    leftGroup.appendChild(ihMakeSelector('Month:', IH_MONTHS.map(m => ({ value: m, label: m })), monthStr, v => {
        window.state.ihAssetsMonth = v; renderIronHorseAssets();
    }));

    toolbar.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; gap:0.5rem;';

    const btnAddAsset = document.createElement('button');
    btnAddAsset.className = 'btn-secondary';
    btnAddAsset.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddAsset.innerHTML = '➕ Add Asset';
    btnAddAsset.onclick = () => {
        const no = prompt('Asset number (e.g. GT25):');
        if (!no || !no.trim()) return;
        const desc = prompt('Description:', 'IRON HORSE') || 'IRON HORSE';
        const newAssetNo = no.trim().toUpperCase();
        assets.push({ assetNo: newAssetNo, description: desc.trim(), gangAssignments: [] });
        if (typeof window.logAudit === 'function') window.logAudit('add', 'ironhorse', `Asset ${newAssetNo} — Year ${yearStr}`, desc.trim());
        saveIronHorseData(); renderIronHorseAssets();
    };
    rightGroup.appendChild(btnAddAsset);

    const btnSave = document.createElement('button');
    btnSave.className = 'btn-primary';
    btnSave.style.cssText = 'background:#10b981; border-color:#10b981; padding:0.4rem 1rem; font-size:0.85rem;';
    btnSave.innerHTML = '💾 Save';
    btnSave.onclick = () => saveIronHorseData(false);
    rightGroup.appendChild(btnSave);

    toolbar.appendChild(rightGroup);
    wrapper.appendChild(toolbar);

    // ── Filter bar ───────────────────────────────────────────────────
    const filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem; flex-wrap:wrap;';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter by asset no or gang…';
    filterInput.value = _ihAssetsFilter;
    filterInput.style.cssText = 'padding:0.4rem 0.7rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card); min-width:220px;';
    filterInput.oninput = () => { _ihAssetsFilter = filterInput.value; renderIronHorseAssets(); };
    filterBar.appendChild(filterInput);

    if (_ihAssetsFilter) {
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '✕ Clear';
        clearBtn.style.cssText = 'padding:0.35rem 0.7rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.82rem; background:var(--bg-secondary); cursor:pointer;';
        clearBtn.onclick = () => { _ihAssetsFilter = ''; renderIronHorseAssets(); };
        filterBar.appendChild(clearBtn);
    }

    const filterNote = document.createElement('span');
    filterNote.style.cssText = 'font-size:0.78rem; color:var(--text-secondary);';
    filterNote.textContent = 'Click a column header to sort';
    filterBar.appendChild(filterNote);

    wrapper.appendChild(filterBar);

    // ── Asset Table ──────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.85rem;';

    const hS = 'background:#1e293b; color:#f8fafc; padding:8px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; white-space:nowrap;';
    const sortArrow = (col) => {
        if (_ihAssetsSort.col !== col) return ' <span style="opacity:0.35;">⇅</span>';
        return _ihAssetsSort.dir === 'asc' ? ' <span>▲</span>' : ' <span>▼</span>';
    };
    const sortStyle = 'cursor:pointer; user-select:none;';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
        <th style="${hS}${sortStyle}text-align:center;" data-sort="assetNo">Asset No${sortArrow('assetNo')}</th>
        <th style="${hS}${sortStyle}text-align:left;" data-sort="description">Description${sortArrow('description')}</th>
        <th style="${hS}${sortStyle}text-align:center;" data-sort="gang">Gang — ${monthStr} ${yearStr}${sortArrow('gang')}</th>
        <th style="${hS}text-align:left;">Assignment History</th>
        <th style="${hS}text-align:center;">Actions</th>
    </tr>`;
    thead.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const col = th.dataset.sort;
            if (_ihAssetsSort.col === col) {
                _ihAssetsSort.dir = _ihAssetsSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                _ihAssetsSort = { col, dir: 'asc' };
            }
            renderIronHorseAssets();
        };
    });
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const cS = 'border:1px solid var(--border-color); padding:8px 12px; vertical-align:top;';

    // Apply filter
    const filterLow = _ihAssetsFilter.trim().toLowerCase();
    let displayAssets = assets.filter(asset => {
        if (!filterLow) return true;
        const gang = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        const gangName = (gang && gang.gang) ? gang.gang.toLowerCase() : '';
        return asset.assetNo.toLowerCase().includes(filterLow) ||
               (asset.description || '').toLowerCase().includes(filterLow) ||
               gangName.includes(filterLow);
    });

    // Apply sort
    displayAssets = displayAssets.slice().sort((a, b) => {
        let av, bv;
        if (_ihAssetsSort.col === 'gang') {
            const ag = resolveGangForMonth(a.gangAssignments || [], yearStr, monthIdx);
            const bg = resolveGangForMonth(b.gangAssignments || [], yearStr, monthIdx);
            av = (ag && ag.gang) ? ag.gang : 'zzz';
            bv = (bg && bg.gang) ? bg.gang : 'zzz';
        } else {
            av = (a[_ihAssetsSort.col] || '').toLowerCase();
            bv = (b[_ihAssetsSort.col] || '').toLowerCase();
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return _ihAssetsSort.dir === 'asc' ? cmp : -cmp;
    });

    if (displayAssets.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="${cS}text-align:center; color:var(--text-secondary); padding:2rem;">
            ${filterLow ? `No assets match "<strong>${_ihAssetsFilter}</strong>"` : `No assets for ${yearStr}. Click <strong>Add Asset</strong> to begin.`}</td>`;
        tbody.appendChild(tr);
    }

    displayAssets.forEach((asset, ai) => {
        const active = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        const tr = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        // Asset No
        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:center;';
        tdNo.textContent = asset.assetNo;
        tr.appendChild(tdNo);

        // Description
        const tdDesc = document.createElement('td');
        tdDesc.style.cssText = cS;
        tdDesc.textContent = asset.description || 'IRON HORSE';
        tr.appendChild(tdDesc);

        // Active Gang this month
        const tdGang = document.createElement('td');
        tdGang.style.cssText = cS + 'text-align:center;';
        if (active) {
            const badge = document.createElement('div');
            badge.style.cssText = 'display:inline-block; background:#1d4ed8; color:#fff; padding:3px 12px; border-radius:12px; font-size:0.78rem; font-weight:600;';
            badge.textContent = active.gang;
            tdGang.appendChild(badge);
            if (active.remark) {
                const rem = document.createElement('div');
                rem.style.cssText = 'font-size:0.72rem; color:var(--text-secondary); margin-top:4px; font-style:italic;';
                rem.textContent = active.remark;
                tdGang.appendChild(rem);
            }
        } else {
            tdGang.innerHTML = '<span style="color:#94a3b8; font-size:0.78rem;">— Unassigned —</span>';
        }
        tr.appendChild(tdGang);

        // Assignment History
        const tdHist = document.createElement('td');
        tdHist.style.cssText = cS + 'min-width:260px;';
        const assignments = (asset.gangAssignments || []).slice().sort((a, b) => new Date(a.from) - new Date(b.from));
        if (assignments.length === 0) {
            tdHist.innerHTML = '<span style="color:#94a3b8; font-size:0.78rem;">No assignments yet</span>';
        } else {
            assignments.forEach(g => {
                const row = document.createElement('div');
                row.style.cssText = 'font-size:0.75rem; margin-bottom:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;';

                const badge = document.createElement('span');
                badge.style.cssText = 'background:#0f172a; color:#94a3b8; padding:2px 8px; border-radius:10px; font-weight:600;';
                badge.textContent = g.gang;
                row.appendChild(badge);

                const dates = document.createElement('span');
                dates.style.cssText = 'color:var(--text-secondary);';
                dates.textContent = `${g.from} → ${g.to || 'present'}`;
                row.appendChild(dates);

                if (g.remark) {
                    const rem = document.createElement('span');
                    rem.style.cssText = 'color:#64748b; font-style:italic;';
                    rem.textContent = `(${g.remark})`;
                    row.appendChild(rem);
                }

                // Edit button
                const btnEditAssign = document.createElement('button');
                btnEditAssign.style.cssText = 'background:none; border:none; cursor:pointer; color:#3b82f6; font-size:0.72rem; padding:1px 4px; line-height:1;';
                btnEditAssign.textContent = '✏';
                btnEditAssign.title = 'Edit this assignment';
                btnEditAssign.onclick = () => {
                    ihShowGangAssignModal(asset.assetNo, yearStr, ({ gang, from, to, remark }) => {
                        const orig = asset.gangAssignments.find(a => a.gang === g.gang && a.from === g.from);
                        if (orig) {
                            if (typeof window.logAudit === 'function') window.logAudit('edit', 'ironhorse', `${asset.assetNo} gang assignment`, `Before: ${orig.gang} (${orig.from}→${orig.to}), After: ${gang} (${from}→${to})`);
                            orig.gang = gang; orig.from = from; orig.to = to; orig.remark = remark;
                        }
                        saveIronHorseData(); renderIronHorseAssets();
                    }, g);
                };
                row.appendChild(btnEditAssign);

                // Delete button
                const btnDelAssign = document.createElement('button');
                btnDelAssign.style.cssText = 'background:none; border:none; cursor:pointer; color:#dc2626; font-size:0.75rem; padding:1px 4px; line-height:1;';
                btnDelAssign.textContent = '✕';
                btnDelAssign.title = 'Remove this assignment';
                btnDelAssign.onclick = () => {
                    if (!confirm(`Remove gang assignment "${g.gang}" for ${asset.assetNo}?`)) return;
                    const origIdx = asset.gangAssignments.findIndex(a => a.gang === g.gang && a.from === g.from);
                    if (origIdx > -1) {
                        if (typeof window.logAudit === 'function') window.logAudit('delete', 'ironhorse', `${asset.assetNo} gang assignment`, `Removed: ${g.gang} (${g.from}→${g.to})`);
                        asset.gangAssignments.splice(origIdx, 1);
                    }
                    saveIronHorseData(); renderIronHorseAssets();
                };
                row.appendChild(btnDelAssign);
                tdHist.appendChild(row);
            });
        }
        tr.appendChild(tdHist);

        // Actions
        const tdAct = document.createElement('td');
        tdAct.style.cssText = cS + 'text-align:center; white-space:nowrap;';

        const btnAssign = document.createElement('button');
        btnAssign.className = 'btn-secondary';
        btnAssign.style.cssText = 'padding:3px 10px; font-size:0.78rem; display:block; width:100%; margin-bottom:4px;';
        btnAssign.textContent = '+ Assign Gang';
        btnAssign.onclick = () => {
            ihShowGangAssignModal(asset.assetNo, yearStr, ({ gang, from, to, remark }) => {
                if (!asset.gangAssignments) asset.gangAssignments = [];
                asset.gangAssignments.push({ gang, from, to, remark });
                if (typeof window.logAudit === 'function') window.logAudit('add', 'ironhorse', `${asset.assetNo} gang assignment`, `${gang} (${from}→${to})`);
                saveIronHorseData(); renderIronHorseAssets();
            });
        };
        tdAct.appendChild(btnAssign);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn-secondary';
        btnDel.style.cssText = 'padding:3px 10px; font-size:0.78rem; background:#dc2626; border-color:#dc2626; color:#fff; display:block; width:100%;';
        btnDel.textContent = '✕ Remove Asset';
        btnDel.onclick = () => {
            if (!confirm(`Remove ${asset.assetNo} from year ${yearStr}?\nAll gang assignments for this asset will be lost.`)) return;
            const currentList = window.state.ironHorse.assets[yearStr];
            const idx = currentList.findIndex(a => a.assetNo === asset.assetNo);
            if (idx > -1) {
                if (typeof window.logAudit === 'function') window.logAudit('delete', 'ironhorse', `Asset ${asset.assetNo} — Year ${yearStr}`, 'Asset removed with all gang assignments');
                currentList.splice(idx, 1);
                saveIronHorseData(); renderIronHorseAssets();
            }
        };
        tdAct.appendChild(btnDel);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrapper.appendChild(tableWrap);
};

// ─────────────────────────────────────────────────────────────────────
// Expenses View
// ─────────────────────────────────────────────────────────────────────
const renderIronHorseExpenses = () => {
    const wrapper = document.getElementById('ironhorse-expenses-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!window.state.ironHorse)          window.state.ironHorse = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};
    if (!window.state.ironHorse.assets)   window.state.ironHorse.assets = {};

    const expYears = Object.keys(window.state.ironHorse.expenses).filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr  = window.state.ihExpensesYear || expYears[0] || String(new Date().getFullYear());
    const monthStr = window.state.ihExpensesMonth || 'JAN';

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Iron Horse — Expenses';
    leftGroup.appendChild(titleEl);

    // Year selector
    const yearSel = document.createElement('div');
    yearSel.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const yearLbl = document.createElement('span');
    yearLbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    yearLbl.textContent = 'Year:';
    const yearSelect = document.createElement('select');
    yearSelect.className = 'edit-input';
    yearSelect.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';
    if (expYears.length === 0) {
        const opt = document.createElement('option'); opt.textContent = 'No data yet'; yearSelect.appendChild(opt); yearSelect.disabled = true;
    } else {
        expYears.forEach(y => {
            const opt = document.createElement('option'); opt.value = y; opt.textContent = y;
            if (y === yearStr) opt.selected = true; yearSelect.appendChild(opt);
        });
        yearSelect.onchange = () => { window.state.ihExpensesYear = yearSelect.value; renderIronHorseExpenses(); };
    }
    yearSel.appendChild(yearLbl); yearSel.appendChild(yearSelect);
    leftGroup.appendChild(yearSel);

    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const latest = expYears.length > 0 ? expYears[expYears.length - 1] : String(new Date().getFullYear() - 1);
        const newY = prompt('Enter year:', String(parseInt(latest) + 1));
        if (!newY || !newY.trim()) return;
        const ny = newY.trim();
        if (window.state.ironHorse.expenses[ny]) { alert(`Year ${ny} already exists.`); return; }
        window.state.ironHorse.expenses[ny] = { extraCategories: [], months: {} };
        window.state.ihExpensesYear = ny;
        saveIronHorseData(); renderIronHorseExpenses();
    };
    leftGroup.appendChild(btnAddYear);

    leftGroup.appendChild(ihMakeSelector('Month:', IH_MONTHS.map(m => ({ value: m, label: m })), monthStr, v => {
        window.state.ihExpensesMonth = v; renderIronHorseExpenses();
    }));

    toolbar.appendChild(leftGroup);

    // Right: action buttons
    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; gap:0.5rem; flex-wrap:wrap;';

    // Add Category
    const btnAddCat = document.createElement('button');
    btnAddCat.className = 'btn-secondary';
    btnAddCat.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddCat.innerHTML = '➕ Add Category';
    btnAddCat.onclick = () => {
        const name = prompt('New category name (e.g. PET):');
        if (!name || !name.trim()) return;
        const norm = ihNormalizeHeader(name);
        if (!norm) return;
        if (IH_CATS.includes(norm)) { alert(`"${norm}" is already a base category.`); return; }
        const yd = ihEnsureExpenseYear(yearStr);
        if (yd.extraCategories.includes(norm)) { alert(`"${norm}" already exists for ${yearStr}.`); return; }
        yd.extraCategories.push(norm);
        saveIronHorseData(); renderIronHorseExpenses();
    };
    rightGroup.appendChild(btnAddCat);

    // Remove Category (only show when extras exist)
    const yearExtras = ihGetYearCategories(yearStr);
    if (yearExtras.length > 0) {
        const btnRemCat = document.createElement('button');
        btnRemCat.className = 'btn-secondary';
        btnRemCat.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#dc2626; border-color:#dc2626; color:#fff;';
        btnRemCat.innerHTML = '✕ Remove Category';
        btnRemCat.onclick = () => {
            const list = yearExtras.map((c, i) => `${i + 1}. ${c}`).join('\n');
            const choice = prompt(`Remove which category from ${yearStr}?\n\n${list}\n\nEnter number:`);
            if (!choice) return;
            const idx = parseInt(choice) - 1;
            if (isNaN(idx) || idx < 0 || idx >= yearExtras.length) { alert('Invalid selection.'); return; }
            const removed = yearExtras[idx];
            if (!confirm(`Remove "${removed}" from year ${yearStr}?\nAll data for this category will be deleted.`)) return;
            const yd = ihEnsureExpenseYear(yearStr);
            yd.extraCategories.splice(idx, 1);
            // Strip the removed key from every asset/month
            Object.values(yd.months || {}).forEach(monthMap => {
                Object.values(monthMap || {}).forEach(assetRow => { delete assetRow[removed]; });
            });
            saveIronHorseData(); renderIronHorseExpenses();
        };
        rightGroup.appendChild(btnRemCat);
    }

    // Download Template button
    const btnDlTpl = document.createElement('button');
    btnDlTpl.className = 'btn-secondary';
    btnDlTpl.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnDlTpl.innerHTML = '📄 Download Template';
    btnDlTpl.onclick = () => downloadIronHorseTemplate(yearStr, monthStr);
    rightGroup.appendChild(btnDlTpl);

    // Import button
    const btnImport = document.createElement('button');
    btnImport.className = 'btn-secondary';
    btnImport.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#1d4ed8; border-color:#1d4ed8; color:#fff;';
    btnImport.innerHTML = '📥 Import Excel';
    const importFileInput = document.createElement('input');
    importFileInput.type = 'file'; importFileInput.accept = '.xlsx,.xls'; importFileInput.style.display = 'none';
    importFileInput.onchange = async () => {
        if (!importFileInput.files[0]) return;
        const yr = prompt('Import to year:', yearStr);
        if (!yr || !yr.trim()) return;
        const mn = prompt('Import to month (e.g. JAN):', monthStr);
        if (!mn || !mn.trim()) return;
        await importIronHorseExpenses(importFileInput.files[0], yr.trim(), mn.trim().toUpperCase());
        importFileInput.value = '';
    };
    btnImport.onclick = () => importFileInput.click();
    rightGroup.appendChild(btnImport);
    rightGroup.appendChild(importFileInput);
    toolbar.appendChild(rightGroup);
    wrapper.appendChild(toolbar);

    // ── Expense Table ────────────────────────────────────────────────
    const activeYearStr = window.state.ihExpensesYear || yearStr;
    const yd = ihEnsureExpenseYear(activeYearStr);
    const monthData = (yd.months || {})[monthStr] || {};
    const allCats = ihGetAllCategories(activeYearStr);
    const baseCount = IH_CATS.length;

    const assetNosInData = Object.keys(monthData);
    const assetsForYear  = (window.state.ironHorse.assets[activeYearStr] || []).map(a => a.assetNo);
    const allAssetNos = [...new Set([...assetNosInData, ...assetsForYear])].sort((a, b) => {
        const na = parseInt(a.replace(/\D/g,'')) || 0;
        const nb = parseInt(b.replace(/\D/g,'')) || 0;
        return na - nb;
    });

    if (allAssetNos.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:3rem; text-align:center; color:var(--text-secondary);';
        empty.innerHTML = `<div style="font-size:2.5rem; margin-bottom:1rem;">📭</div>
            <div style="font-size:1rem; font-weight:600; margin-bottom:0.5rem;">No expense data for ${monthStr} ${activeYearStr}</div>
            <div style="font-size:0.85rem;">Use <strong>Import Excel</strong> above to upload data,<br>or add assets under <strong>Asset Numbers</strong> first.</div>`;
        wrapper.appendChild(empty);
        return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden;';
    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem;';

    const hS         = 'background:#1e293b; color:#f8fafc; padding:7px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right; min-width:90px;';
    const hExtraS    = 'background:#1e3a5f; color:#dbeafe; padding:7px 12px; border:1px solid #2d4f7c; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right; min-width:90px;';
    const headerCells = allCats.map((c, i) =>
        `<th style="${i < baseCount ? hS : hExtraS}">${ihGetCatLabel(c)}</th>`
    ).join('');

    table.innerHTML = `<thead><tr>
        <th style="${hS}text-align:left; min-width:110px;">Asset No</th>
        ${headerCells}
        <th style="${hS}background:#14532d; color:#dcfce7; min-width:110px;">Total</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    const cS = 'border:1px solid var(--border-color); padding:6px 12px; text-align:right;';
    const cExtraS = cS + 'background:#eff6ff;';

    const grandTotals = {}; allCats.forEach(c => { grandTotals[c] = 0; });
    let grandTotal = 0;

    allAssetNos.forEach((assetNo, ai) => {
        const row = monthData[assetNo] || {};
        const tr = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:left;';
        tdNo.textContent = assetNo;
        tr.appendChild(tdNo);

        let rowTotal = 0;
        allCats.forEach((c, i) => {
            const val = parseFloat(row[c]) || 0;
            grandTotals[c] += val; rowTotal += val;
            const td = document.createElement('td');
            td.style.cssText = i < baseCount ? cS : cExtraS;
            td.textContent = val > 0 ? val.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
            tr.appendChild(td);
        });
        grandTotal += rowTotal;

        const tdTot = document.createElement('td');
        tdTot.style.cssText = cS + 'background:#f0fdf4; font-weight:700; color:#166534;';
        tdTot.textContent = rowTotal > 0 ? rowTotal.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
        tr.appendChild(tdTot);
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    trGrand.style.cssText = 'background:#1e293b; color:#f8fafc;';
    const tdGLbl = document.createElement('td');
    tdGLbl.style.cssText = 'border:1px solid #334155; padding:7px 12px; font-weight:700; text-align:left;';
    tdGLbl.textContent = 'Grand Total';
    trGrand.appendChild(tdGLbl);
    allCats.forEach((c, i) => {
        const td = document.createElement('td');
        const baseStyle = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700;';
        td.style.cssText = baseStyle + (i < baseCount ? 'color:#86efac;' : 'color:#93c5fd; background:#1e3a5f;');
        td.textContent = grandTotals[c] > 0 ? grandTotals[c].toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
        trGrand.appendChild(td);
    });
    const tdGTotal = document.createElement('td');
    tdGTotal.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700; color:#4ade80; background:#14532d;';
    tdGTotal.textContent = grandTotal > 0 ? grandTotal.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
    trGrand.appendChild(tdGTotal);
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    tableWrap.appendChild(scrollWrap);
    wrapper.appendChild(tableWrap);
};

// ─────────────────────────────────────────────────────────────────────
// Firebase Save
// ─────────────────────────────────────────────────────────────────────
const saveIronHorseData = (silent = true) => {
    if (!window._ironHorseDb) {
        if (!silent) alert('Not connected. Please login first.');
        return;
    }
    window._ironHorseDb.ref('shared/ironhorse_data').set(JSON.stringify(window.state.ironHorse))
        .then(() => {
            if (!silent) {
                alert('Iron Horse data saved!');
                if (typeof window.logAudit === 'function') window.logAudit('save', 'ironhorse', 'Iron Horse data', '');
            }
        })
        .catch(e => { console.error('Iron Horse save error:', e); if (!silent) alert('Error: ' + e.message); });
};

// ─────────────────────────────────────────────────────────────────────
// Download Expenses Template
//   - Pre-fills asset numbers from the year's asset list
//   - Includes any extra categories the year has (e.g. PET)
//   - Total column has a SUM formula for user reference (system ignores it on import)
// ─────────────────────────────────────────────────────────────────────
async function downloadIronHorseTemplate(yearStr, monthStr) {
    try {
        if (typeof window.ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
                document.head.appendChild(s);
            });
        }

        const cats = ihGetAllCategories(yearStr);
        const baseCount = IH_CATS.length;

        // Build asset list — prefer year's asset list, fall back to defaults
        const assetsForYear = (window.state.ironHorse?.assets?.[yearStr] || []);
        const assetNos = assetsForYear.length > 0
            ? assetsForYear.map(a => a.assetNo)
            : IH_DEFAULT_ASSET_NOS;

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet(`IH ${monthStr || ''} ${yearStr}`.trim());

        // Title
        ws.mergeCells(1, 1, 1, 2 + cats.length);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `IRON HORSE — EXPENSES${monthStr ? ' (' + monthStr + ' ' + yearStr + ')' : ' (' + yearStr + ')'}`;
        titleCell.font = { bold: true, size: 12, color: { argb: 'FF1E293B' } };
        titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getRow(1).height = 22;

        // Headers (row 3)
        const headerRowIdx = 3;
        const headers = ['Asset No', ...cats.map(c => ihGetCatLabel(c)), 'Total'];
        const hdrRow = ws.getRow(headerRowIdx);
        hdrRow.values = headers;
        hdrRow.height = 20;
        hdrRow.eachCell((cell, col) => {
            cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.alignment = { horizontal: col === 1 ? 'left' : 'right', vertical: 'middle' };
            const isExtra = col > 1 + baseCount && col < headers.length;
            const isTotal = col === headers.length;
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: isTotal ? 'FF14532D' : (isExtra ? 'FF1E3A5F' : 'FF1E293B') }
            };
            cell.border = {
                top:    { style: 'thin', color: { argb: 'FF334155' } },
                bottom: { style: 'thin', color: { argb: 'FF334155' } },
                left:   { style: 'thin', color: { argb: 'FF334155' } },
                right:  { style: 'thin', color: { argb: 'FF334155' } }
            };
        });

        // Column widths
        ws.getColumn(1).width = 14;
        for (let c = 2; c < headers.length; c++) ws.getColumn(c).width = 12;
        ws.getColumn(headers.length).width = 14;

        // Data rows (one per asset)
        assetNos.forEach((assetNo, i) => {
            const r = headerRowIdx + 1 + i;
            const row = ws.getRow(r);
            row.getCell(1).value = assetNo;
            row.getCell(1).font = { bold: true, color: { argb: 'FF1D4ED8' } };
            row.getCell(1).alignment = { horizontal: 'left' };
            // Empty value cells for each category
            for (let c = 0; c < cats.length; c++) {
                const cell = row.getCell(2 + c);
                cell.value = null;
                cell.numFmt = '#,##0.00;-#,##0.00;"-"';
                cell.alignment = { horizontal: 'right' };
            }
            // Total cell (static 0 — user fills in values, Excel will show sum)
            const totalCell = row.getCell(headers.length);
            totalCell.value = 0;
            totalCell.numFmt = '#,##0.00;-#,##0.00;"-"';
            totalCell.alignment = { horizontal: 'right' };
            totalCell.font = { bold: true, color: { argb: 'FF166534' } };
            totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
            // Borders for all data cells
            for (let c = 1; c <= headers.length; c++) {
                row.getCell(c).border = {
                    top:    { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left:   { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right:  { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
            }
        });

        // Grand Total row
        const gtRowIdx = headerRowIdx + 1 + assetNos.length;
        const gtRow = ws.getRow(gtRowIdx);
        gtRow.getCell(1).value = 'Grand Total';
        gtRow.getCell(1).font = { bold: true, color: { argb: 'FFF8FAFC' } };
        gtRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        gtRow.getCell(1).alignment = { horizontal: 'left' };
        for (let c = 0; c < cats.length; c++) {
            const cell = gtRow.getCell(2 + c);
            cell.value = 0;
            cell.numFmt = '#,##0.00;-#,##0.00;"-"';
            cell.font = { bold: true, color: { argb: 'FF86EFAC' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            cell.alignment = { horizontal: 'right' };
        }
        const gtTotalCell = gtRow.getCell(headers.length);
        gtTotalCell.value = 0;
        gtTotalCell.numFmt = '#,##0.00;-#,##0.00;"-"';
        gtTotalCell.font = { bold: true, color: { argb: 'FF4ADE80' } };
        gtTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
        gtTotalCell.alignment = { horizontal: 'right' };

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Iron_Horse_Expenses${monthStr ? '_' + monthStr : ''}_${yearStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (err) {
        console.error('Iron Horse template error:', err);
        alert('Template error: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
// Import Expenses from Excel
//   - Detects header row by scanning for "Asset No" / "Row Labels"
//   - Maps each column to a known base/extra category, skips TOTAL
//   - Auto-prompts to add unknown categories (e.g. PET) as a year extra
//   - Skips Grand Total row, treats "-" / blanks as 0
// ─────────────────────────────────────────────────────────────────────
async function importIronHorseExpenses(file, yearStr, monthStr) {
    if (!file) return;
    try {
        if (typeof window.ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
                document.head.appendChild(s);
            });
        }
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) { alert('No worksheet found.'); return; }

        // Locate the header row: first row whose first cell contains ASSET/ROW/LABEL
        let headerRowIdx = 0;
        let headerVals = [];
        ws.eachRow((row, i) => {
            if (headerRowIdx !== 0) return;
            const norm = ihNormalizeHeader(row.values[1]);
            if (norm === 'ASSETNO' || norm === 'ASSET' || norm === 'ROWLABELS' || norm.startsWith('ASSET')) {
                headerRowIdx = i;
                headerVals = row.values;
            }
        });

        if (headerRowIdx === 0) { alert('Could not find header row. The first column must be "Asset No" or "Row Labels".'); return; }

        // Ensure year structure exists
        const yd = ihEnsureExpenseYear(yearStr);

        // Build column map: index → { kind, key }
        const colMap = {};         // colIdx -> category key (e.g. "DC", "PET")
        const unknownCols = [];    // [{ colIdx, name }]
        const seenKnown = new Set();
        for (let c = 2; c < headerVals.length; c++) {
            const norm = ihNormalizeHeader(headerVals[c]);
            if (!norm) continue;
            const match = ihMatchHeaderToCategory(norm, yd.extraCategories);
            if (match.kind === 'skip' || match.kind === 'asset') continue;
            if (match.kind === 'base' || match.kind === 'extra') {
                colMap[c] = match.key;
                seenKnown.add(match.key);
            } else if (match.kind === 'unknown') {
                unknownCols.push({ colIdx: c, name: norm });
            }
        }

        // Prompt user for each unknown column
        for (const u of unknownCols) {
            const add = confirm(`Found new category "${u.name}" in the file.\n\nAdd it as a category for year ${yearStr}?\n(Cancel to skip this column.)`);
            if (add) {
                if (!yd.extraCategories.includes(u.name)) yd.extraCategories.push(u.name);
                colMap[u.colIdx] = u.name;
            }
        }

        // Parse data rows
        const parseV = v => {
            if (v == null || v === '') return 0;
            // ExcelJS returns formula cells as { formula: '...', result: value }
            if (typeof v === 'object' && v !== null && 'result' in v) v = v.result;
            if (v == null || v === '') return 0;
            const s = String(v).trim();
            if (s === '-' || s === '—') return 0;
            const n = parseFloat(s.replace(/,/g, ''));
            return isNaN(n) ? 0 : n;
        };

        const monthData = {};
        ws.eachRow((row, i) => {
            if (i <= headerRowIdx) return;
            const vals = row.values;
            const assetNo = String(vals[1] || '').trim().toUpperCase();
            if (!assetNo) return;
            if (assetNo.includes('TOTAL') || assetNo.includes('BLANK') || assetNo === 'GRAND TOTAL') return;
            if (!assetNo.match(/^GT\d+/)) return;

            const entry = {};
            // Initialize all known cats to 0
            ihGetAllCategories(yearStr).forEach(c => { entry[c] = 0; });
            // Fill from columns
            Object.keys(colMap).forEach(colIdx => {
                const key = colMap[colIdx];
                entry[key] = parseV(vals[colIdx]);
            });
            monthData[assetNo] = entry;
        });

        const count = Object.keys(monthData).length;
        if (count === 0) { alert('No valid asset rows found (rows must start with GT…). Check file format.'); return; }

        yd.months[monthStr] = monthData;
        window.state.ihExpensesYear = yearStr;
        window.state.ihExpensesMonth = monthStr;
        saveIronHorseData(false);
        renderIronHorseExpenses();

        const addedExtras = unknownCols.filter(u => yd.extraCategories.includes(u.name)).map(u => u.name);
        const skippedExtras = unknownCols.filter(u => !yd.extraCategories.includes(u.name)).map(u => u.name);
        let msg = `Imported ${count} asset rows for ${monthStr} ${yearStr}.`;
        if (addedExtras.length) msg += `\nNew categories added: ${addedExtras.join(', ')}.`;
        if (skippedExtras.length) msg += `\nSkipped columns: ${skippedExtras.join(', ')}.`;
        alert(msg);
    } catch (err) {
        console.error('Iron Horse import error:', err);
        alert('Import error: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
// Iron Horse expenses mini-table injected under each gang's perf chart
// Called from script.js renderPerformanceTable() after chart is built.
// perfMonth = "Jan"/"Feb" (perf format); converted to "JAN"/"FEB" internally.
// ─────────────────────────────────────────────────────────────────────
const renderIHExpensesForGang = (gangWrapper, gangName, yearStr, perfMonth) => {
    const monthStr = perfMonth.toUpperCase();
    const monthIdx = IH_MONTHS.indexOf(monthStr);
    if (monthIdx === -1) return;

    if (!window.state.ironHorse) return;

    // Normalize: strip "- previously ..." suffix and trailing GANG word
    const normGang = s => (s || '').trim().toUpperCase()
        .replace(/\s*-\s*PREVIOUSLY\b.*/i, '')
        .replace(/\bGANG\b\s*$/i, '')
        .trim();

    // Fuzzy match: equal, prefix, or first-word typo (≤1 char diff)
    const gangMatch = (a, b) => {
        const n1 = normGang(a), n2 = normGang(b);
        if (!n1 || !n2) return false;
        if (n1 === n2) return true;
        if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
        // Single-word fuzzy match for typos (e.g. WENDELINUS vs WENDERLINUS)
        const w1 = n1.split(/\s+/)[0], w2 = n2.split(/\s+/)[0];
        if (w1.length >= 5 && w2.length >= 5 && Math.abs(w1.length - w2.length) <= 2) {
            const [lng, sht] = w1.length >= w2.length ? [w1, w2] : [w2, w1];
            let m = 0, si = 0;
            for (let li = 0; li < lng.length && si < sht.length; li++) {
                if (lng[li] === sht[si]) { m++; si++; }
            }
            if (m >= sht.length - 1 && m >= 5) return true;
        }
        return false;
    };

    const assets = (window.state.ironHorse.assets || {})[yearStr] || [];
    const assignedAssets = assets.filter(asset => {
        const active = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        return active && gangMatch(active.gang, gangName);
    });

    const yd        = ihEnsureExpenseYear(yearStr);
    const monthData = ((yd.months || {})[monthStr]) || {};
    const allCats   = ihGetAllCategories(yearStr);
    const baseCount = IH_CATS.length;

    // ── Section wrapper ───────────────────────────────────────────────
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:2rem;';

    const secTitle = document.createElement('div');
    secTitle.style.cssText = 'font-size:0.9rem; font-weight:700; color:var(--text-primary); margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:2px solid #1d4ed8; text-transform:uppercase; letter-spacing:0.03em;';
    secTitle.textContent = `🐴 Iron Horse Expenses — ${gangName} (${monthStr} ${yearStr})`;
    section.appendChild(secTitle);

    if (assignedAssets.length === 0) {
        const ph = document.createElement('div');
        ph.style.cssText = 'padding:1rem 1.25rem; background:var(--bg-card); border:1px solid var(--border-color); border-radius:6px; color:var(--text-secondary); font-size:0.85rem; text-align:center;';
        ph.textContent = `No Iron Horse machines assigned to ${gangName} for ${monthStr} ${yearStr}.`;
        section.appendChild(ph);
        gangWrapper.appendChild(section);
        return;
    }

    // ── Expense table ─────────────────────────────────────────────────
    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'overflow-x:auto; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem;';

    const hS     = 'background:#1e293b; color:#f8fafc; padding:7px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right;';
    const hXtraS = 'background:#1e3a5f; color:#dbeafe; padding:7px 12px; border:1px solid #2d4f7c; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right;';

    const headerCells = allCats.map((c, i) =>
        `<th style="${i < baseCount ? hS : hXtraS}">${ihGetCatLabel(c)}</th>`
    ).join('');

    table.innerHTML = `<thead><tr>
        <th style="${hS}text-align:left; min-width:110px;">Asset No</th>
        ${headerCells}
        <th style="${hS}background:#14532d; color:#dcfce7; min-width:100px;">Total</th>
    </tr></thead>`;

    const tbody  = document.createElement('tbody');
    const cS     = 'border:1px solid var(--border-color); padding:6px 12px; text-align:right;';
    const cXtraS = cS + 'background:#eff6ff;';

    const grandTotals = {};
    allCats.forEach(c => { grandTotals[c] = 0; });
    let grandTotal = 0;

    assignedAssets.forEach((asset, ai) => {
        const row = monthData[asset.assetNo] || {};
        const tr  = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:left;';
        tdNo.textContent = asset.assetNo;
        tr.appendChild(tdNo);

        let rowTotal = 0;
        allCats.forEach((c, i) => {
            const val = parseFloat(row[c]) || 0;
            grandTotals[c] += val;
            rowTotal += val;
            const td = document.createElement('td');
            td.style.cssText = i < baseCount ? cS : cXtraS;
            td.textContent = val > 0
                ? val.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '—';
            tr.appendChild(td);
        });
        grandTotal += rowTotal;

        const tdTot = document.createElement('td');
        tdTot.style.cssText = cS + 'background:#f0fdf4; font-weight:700; color:#166534;';
        tdTot.textContent = rowTotal > 0
            ? rowTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';
        tr.appendChild(tdTot);
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    trGrand.style.cssText = 'background:#1e293b; color:#f8fafc;';
    const tdGLbl = document.createElement('td');
    tdGLbl.style.cssText = 'border:1px solid #334155; padding:7px 12px; font-weight:700; text-align:left;';
    tdGLbl.textContent = 'Grand Total';
    trGrand.appendChild(tdGLbl);

    allCats.forEach((c, i) => {
        const td = document.createElement('td');
        td.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700;'
            + (i < baseCount ? 'color:#86efac;' : 'color:#93c5fd; background:#1e3a5f;');
        td.textContent = grandTotals[c] > 0
            ? grandTotals[c].toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';
        trGrand.appendChild(td);
    });

    const tdGTotal = document.createElement('td');
    tdGTotal.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700; color:#4ade80; background:#14532d;';
    tdGTotal.textContent = grandTotal > 0
        ? grandTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
    trGrand.appendChild(tdGTotal);
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    section.appendChild(scrollWrap);
    gangWrapper.appendChild(section);
};

// ─────────────────────────────────────────────────────────────────────
// Cost per Ha Report
// Two tables:
//   1. Cost / Ha — monthly expense per asset ÷ gang's total Ha
//   2. Issued Cost — raw RM per asset per month
// Ha per gang is derived from state.reports[year] block data.
// ─────────────────────────────────────────────────────────────────────
const renderIronHorseCostPerHa = () => {
    const wrapper = document.getElementById('ironhorse-costperha-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!window.state.ironHorse) window.state.ironHorse = {};

    const availYears = Object.keys(window.state.ironHorse.assets || {})
        .filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr = window.state.ihCostPerHaYear
        || availYears[availYears.length - 1]
        || String(new Date().getFullYear());

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase; flex:1;';
    titleEl.textContent = `Iron Horse — Expenses by Cost per Ha`;
    toolbar.appendChild(titleEl);

    if (availYears.length > 0) {
        toolbar.appendChild(ihMakeSelector(
            'Year:',
            availYears.map(y => ({ value: y, label: y })),
            yearStr,
            v => { window.state.ihCostPerHaYear = v; renderIronHorseCostPerHa(); }
        ));
    }
    wrapper.appendChild(toolbar);

    // ── Data preparation ──────────────────────────────────────────────
    const assets   = (window.state.ironHorse.assets || {})[yearStr] || [];
    const yd       = ihEnsureExpenseYear(yearStr);
    const allCats  = ihGetAllCategories(yearStr);

    // Gang Ha: sum block.ha per gang from state.reports[year]
    const reports  = (window.state.reports || {})[yearStr] || [];
    const gangHaMap = {};
    reports.forEach(b => {
        if (b.gang && typeof b.ha === 'number' && b.ha > 0) {
            gangHaMap[b.gang] = (gangHaMap[b.gang] || 0) + b.ha;
        }
    });
    const noHaData = Object.keys(gangHaMap).length === 0;

    // Resolve each asset's gang per month; group by July (mid-year) for display order
    const assetMonthGang = {};
    assets.forEach(asset => {
        assetMonthGang[asset.assetNo] = {};
        IH_MONTHS.forEach((m, i) => {
            const a = resolveGangForMonth(asset.gangAssignments || [], yearStr, i);
            assetMonthGang[asset.assetNo][m] = a ? a.gang : null;
        });
    });

    const gangOrder   = [];
    const gangToAssets = {};
    assets.forEach(asset => {
        const julyGang = assetMonthGang[asset.assetNo]['JUL'];
        const primary  = julyGang
            || IH_MONTHS.map(m => assetMonthGang[asset.assetNo][m]).find(g => g)
            || '__UNASSIGNED__';
        if (!gangToAssets[primary]) {
            gangToAssets[primary] = [];
            gangOrder.push(primary);
        }
        gangToAssets[primary].push(asset.assetNo);
    });

    // Monthly expense per asset (sum of all categories)
    const assetMonthExp = {};
    assets.forEach(asset => {
        assetMonthExp[asset.assetNo] = {};
        let yr = 0;
        IH_MONTHS.forEach(m => {
            const row = ((yd.months || {})[m] || {})[asset.assetNo] || {};
            const v   = allCats.reduce((s, c) => s + (parseFloat(row[c]) || 0), 0);
            assetMonthExp[asset.assetNo][m] = v;
            yr += v;
        });
        assetMonthExp[asset.assetNo]['YEAR'] = yr;
    });

    // Gang monthly totals
    const gangMonthExp = {};
    gangOrder.forEach(gangName => {
        gangMonthExp[gangName] = {};
        let yr = 0;
        IH_MONTHS.forEach(m => {
            const v = (gangToAssets[gangName] || []).reduce((s, a) => s + (assetMonthExp[a]?.[m] || 0), 0);
            gangMonthExp[gangName][m] = v;
            yr += v;
        });
        gangMonthExp[gangName]['YEAR'] = yr;
    });

    // Grand totals
    const grandMonthExp = {};
    let grandYearExp = 0;
    IH_MONTHS.forEach(m => {
        const v = gangOrder.reduce((s, g) => s + (gangMonthExp[g]?.[m] || 0), 0);
        grandMonthExp[m] = v;
        grandYearExp += v;
    });
    const totalHa = Object.values(gangHaMap).reduce((s, h) => s + h, 0);

    // Formatters
    const fmtRm = v => v !== 0
        ? v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
    const fmtHa = h => h > 0 ? h.toFixed(2) : '—';
    const fmtCph = (cost, ha) => {
        if (!ha || ha <= 0) return '—';
        return (cost / ha).toFixed(2);
    };

    // Shared CSS
    const hS    = 'background:#1e293b;color:#f8fafc;padding:7px 10px;border:1px solid #334155;font-weight:600;font-size:0.75rem;text-transform:uppercase;text-align:right;white-space:nowrap;';
    const hLS   = hS + 'text-align:left;min-width:155px;';
    const hTotS = hS + 'background:#14532d;color:#dcfce7;min-width:95px;';
    const gS    = 'background:#0f172a;color:#e2e8f0;padding:7px 10px;border:1px solid #1e293b;font-weight:700;font-size:0.78rem;text-align:right;';
    const gLS   = gS + 'text-align:left;padding-left:10px;';
    const gTotS = gS + 'background:#14532d;color:#dcfce7;';
    const aS    = 'border:1px solid var(--border-color);padding:6px 10px;font-size:0.78rem;text-align:right;';
    const aLS   = aS + 'text-align:left;padding-left:26px;color:var(--accent);font-weight:600;';
    const aTotS = aS + 'background:#f0fdf4;font-weight:700;color:#166534;';
    const grS   = 'border:1px solid #334155;padding:7px 10px;font-weight:700;text-align:right;';
    const grLS  = grS + 'text-align:left;';
    const grTotS = grS + 'background:#14532d;color:#4ade80;';

    // ── Generic table builder ─────────────────────────────────────────
    const buildTable = (title, gangExtraCell, assetExtraCell, grandExtraCell) => {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom:2.5rem;';

        const secTitle = document.createElement('div');
        secTitle.style.cssText = 'font-size:0.95rem;font-weight:700;color:var(--text-primary);margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:2px solid var(--accent);';
        secTitle.textContent = title;
        section.appendChild(secTitle);

        if (noHaData && title.includes('Cost / Ha')) {
            const warn = document.createElement('div');
            warn.style.cssText = 'padding:1rem;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;font-size:0.85rem;color:#92400e;margin-bottom:0.75rem;';
            warn.textContent = `⚠ No hectarage data found for ${yearStr}. Ha values will show as "—". Please ensure harvesting block data is imported for this year.`;
            section.appendChild(warn);
        }

        const scrollWrap = document.createElement('div');
        scrollWrap.style.cssText = 'overflow-x:auto;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;';

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.78rem;';

        const monthHdrs = IH_MONTHS.map(m => `<th style="${hS}">${m}</th>`).join('');
        table.innerHTML = `<thead><tr>
            <th style="${hLS}">Gang / Asset</th>
            <th style="${hS}min-width:75px;">Ha</th>
            ${monthHdrs}
            <th style="${hTotS}">Total</th>
        </tr></thead>`;

        const tbody = document.createElement('tbody');

        gangOrder.forEach(gangName => {
            const ha      = gangHaMap[gangName] || 0;
            const label   = gangName === '__UNASSIGNED__' ? '— Unassigned —' : gangName;
            const monthTds = IH_MONTHS.map(m =>
                `<td style="${gS}">${gangExtraCell.monthVal(gangMonthExp[gangName][m], ha)}</td>`
            ).join('');
            const trGang = document.createElement('tr');
            trGang.innerHTML = `
                <td style="${gLS}">${label}</td>
                <td style="${gS}">${fmtHa(ha)}</td>
                ${monthTds}
                <td style="${gTotS}">${gangExtraCell.yearVal(gangMonthExp[gangName]['YEAR'], ha)}</td>`;
            tbody.appendChild(trGang);

            (gangToAssets[gangName] || []).forEach((assetNo, ai) => {
                const monthAssetTds = IH_MONTHS.map(m =>
                    `<td style="${aS}">${assetExtraCell.monthVal(assetMonthExp[assetNo][m], ha)}</td>`
                ).join('');
                const tr = document.createElement('tr');
                tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';
                tr.innerHTML = `
                    <td style="${aLS}">↳ ${assetNo}</td>
                    <td style="${aS}">—</td>
                    ${monthAssetTds}
                    <td style="${aTotS}">${assetExtraCell.yearVal(assetMonthExp[assetNo]['YEAR'], ha)}</td>`;
                tbody.appendChild(tr);
            });
        });

        // Grand total row
        const monthGrandTds = IH_MONTHS.map(m =>
            `<td style="${grS}color:#86efac;">${grandExtraCell.monthVal(grandMonthExp[m], totalHa)}</td>`
        ).join('');
        const trGrand = document.createElement('tr');
        trGrand.style.cssText = 'background:#1e293b;color:#f8fafc;';
        trGrand.innerHTML = `
            <td style="${grLS}">Grand Total</td>
            <td style="${grS}">${fmtHa(totalHa)}</td>
            ${monthGrandTds}
            <td style="${grTotS}">${grandExtraCell.yearVal(grandYearExp, totalHa)}</td>`;
        tbody.appendChild(trGrand);

        table.appendChild(tbody);
        scrollWrap.appendChild(table);
        section.appendChild(scrollWrap);
        return section;
    };

    if (gangOrder.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:3rem;text-align:center;color:var(--text-secondary);';
        empty.innerHTML = `<div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
            <div style="font-size:1rem;font-weight:600;margin-bottom:0.5rem;">No data for ${yearStr}</div>
            <div style="font-size:0.85rem;">Add assets under <strong>Asset Numbers</strong> and record expenses under <strong>Expenses</strong> first.</div>`;
        wrapper.appendChild(empty);
        return;
    }

    // Table 1: Cost / Ha
    wrapper.appendChild(buildTable(
        `Cost / Ha (RM/Ha) — ${yearStr}`,
        { monthVal: (cost, ha) => fmtCph(cost, ha), yearVal: (cost, ha) => fmtCph(cost, ha) },
        { monthVal: (cost, ha) => fmtCph(cost, ha), yearVal: (cost, ha) => fmtCph(cost, ha) },
        { monthVal: (cost, ha) => fmtCph(cost, ha), yearVal: (cost, ha) => fmtCph(cost, ha) }
    ));

    // Table 2: Issued Cost
    wrapper.appendChild(buildTable(
        `Issued Cost (RM) — ${yearStr}`,
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) },
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) },
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) }
    ));
};
