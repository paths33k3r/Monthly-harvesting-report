// =====================================================================
// render_spraying.js — GLY + ALLY Spraying Maintenance Report
// Mirrors the "GLY + ALLY 20225 (2)" worksheet structure
// =====================================================================

const renderSprayingReport = () => {
    const wrapper = document.getElementById('spraying-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = '';

    // Ensure spraying data container exists on state
    if (!window.state.spraying) window.state.spraying = {};

    const yearStr = window.state.sprayingYear || Object.keys(window.state.spraying)[0] || String(new Date().getFullYear());

    if (!window.state.spraying[yearStr]) {
        window.state.spraying[yearStr] = getDefaultSprayingData();
    }

    const data = window.state.spraying[yearStr];

    // ── MONTHS ──────────────────────────────────────────────────────
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // ── TOP TOOLBAR ─────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    // Left: Title & Year Selector
    const titleGroup = document.createElement('div');
    titleGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Glyphosate & Ally Spraying Maintenance';
    titleGroup.appendChild(titleEl);

    // Year selector
    const yearSelectWrap = document.createElement('div');
    yearSelectWrap.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const yearLabel = document.createElement('span');
    yearLabel.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    yearLabel.textContent = 'Year:';
    const yearSelect = document.createElement('select');
    yearSelect.className = 'edit-input';
    yearSelect.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';

    const sprayingYears = Object.keys(window.state.spraying).filter(k => /^\d{4}$/.test(k)).sort();
    sprayingYears.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === yearStr) opt.selected = true;
        yearSelect.appendChild(opt);
    });
    yearSelect.onchange = () => {
        window.state.sprayingYear = yearSelect.value;
        renderSprayingReport();
    };
    yearSelectWrap.appendChild(yearLabel);
    yearSelectWrap.appendChild(yearSelect);
    titleGroup.appendChild(yearSelectWrap);

    // Add Year button
    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const newY = prompt('Enter the new Spraying Year (e.g., 2026):', String(parseInt(yearStr) + 1));
        if (!newY || newY.trim() === '') return;
        const ny = newY.trim();
        if (window.state.spraying[ny]) { alert(`Year ${ny} already exists.`); return; }
        window.state.spraying[ny] = getDefaultSprayingData();
        window.state.sprayingYear = ny;
        saveSprayingData();
        renderSprayingReport();
    };
    titleGroup.appendChild(btnAddYear);

    toolbar.appendChild(titleGroup);

    // Right: Action Buttons
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;';

    const btnAddPhase = document.createElement('button');
    btnAddPhase.className = 'btn-secondary';
    btnAddPhase.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddPhase.innerHTML = '➕ Add Phase';
    btnAddPhase.onclick = () => addNewPhase(yearStr);
    btnGroup.appendChild(btnAddPhase);

    const btnClear = document.createElement('button');
    btnClear.className = 'btn-secondary';
    btnClear.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#dc2626; border-color:#dc2626; color:#fff;';
    btnClear.innerHTML = '🗑 Clear Year';
    btnClear.onclick = () => {
        if (!confirm(`Clear ALL spraying application data for year ${yearStr}?\n\nThis will erase all Round, Litre/GM and Ha entries for every block, but keep the block structure.\n\nThis cannot be undone.`)) return;
        const yd = window.state.spraying[yearStr];
        if (!yd) return;
        const MONTHS_CLR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        yd.phases.forEach(phase => {
            phase.blocks.forEach(block => {
                MONTHS_CLR.forEach(m => {
                    block.months[m] = { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' };
                });
            });
        });
        saveSprayingData(false);
        renderSprayingReport();
    };
    btnGroup.appendChild(btnClear);

    const btnSave = document.createElement('button');
    btnSave.className = 'btn-primary';
    btnSave.style.cssText = 'background-color:#10b981; border-color:#10b981; padding:0.4rem 1rem; font-size:0.85rem;';
    btnSave.innerHTML = '💾 Save';
    btnSave.onclick = () => saveSprayingData(false);
    btnGroup.appendChild(btnSave);

    toolbar.appendChild(btnGroup);
    wrapper.appendChild(toolbar);

    // ── COMPANY HEADER ───────────────────────────────────────────────
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1rem 1.5rem; margin-bottom:1.5rem; text-align:center;';
    headerDiv.innerHTML = `
        <div style="font-weight:700; font-size:1rem; text-transform:uppercase;">POLIMA FOREST BINTULU SDN. BHD.</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">ESTATE MONTHLY REPORT — LADANG BATANG KAYAN</div>
        <div style="font-weight:600; margin-top:0.25rem; color:var(--accent);">GLYPHOSATE &amp; ALLY SPRAYING SELECT — ${yearStr}</div>
    `;
    wrapper.appendChild(headerDiv);

    // ── TABLE PER PHASE ──────────────────────────────────────────────
    data.phases.forEach((phase, phaseIdx) => {
        renderPhaseTable(wrapper, phase, phaseIdx, yearStr, MONTHS);
    });

    // ── GRAND TOTAL SUMMARY ──────────────────────────────────────────
    renderGrandTotal(wrapper, data, MONTHS, yearStr);
};

// ─────────────────────────────────────────────────────────────────────
// Render a single Phase table (e.g. OP2010)
// ─────────────────────────────────────────────────────────────────────
const renderPhaseTable = (wrapper, phase, phaseIdx, yearStr, MONTHS) => {
    const section = document.createElement('div');
    section.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; margin-bottom:1.5rem; overflow:hidden;';

    // Phase header bar
    const phaseBar = document.createElement('div');
    phaseBar.style.cssText = 'background:var(--bg-main); border-bottom:2px solid var(--border-color); padding:0.6rem 1rem; display:flex; align-items:center; justify-content:space-between;';

    const phaseNameEl = document.createElement('div');
    phaseNameEl.style.cssText = 'font-weight:700; font-size:0.95rem; color:var(--text-primary);';
    phaseNameEl.textContent = phase.phaseName || `Phase ${phaseIdx + 1}`;
    phaseBar.appendChild(phaseNameEl);

    const phaseActions = document.createElement('div');
    phaseActions.style.cssText = 'display:flex; gap:0.5rem;';

    const btnAddBlock = document.createElement('button');
    btnAddBlock.className = 'btn-secondary';
    btnAddBlock.style.cssText = 'padding:0.25rem 0.65rem; font-size:0.8rem;';
    btnAddBlock.innerHTML = '➕ Add Block';
    btnAddBlock.onclick = () => addNewBlock(yearStr, phaseIdx);
    phaseActions.appendChild(btnAddBlock);

    phaseBar.appendChild(phaseActions);
    section.appendChild(phaseBar);

    // Scrollable table
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.8rem; min-width:1600px;';

    // ── THEAD ────────────────────────────────────────────────────────
    const thead = document.createElement('thead');

    // Row 1: Phase | Block | Year | Ha Prev | Ha Present | Particular | JAN(span2) | FEB(span2) ... DEC(span2) | TOTAL(span2)
    const tr1 = document.createElement('tr');
    const headerStyle = 'background:#1e293b; color:#f8fafc; padding:6px 8px; text-align:center; border:1px solid #334155; font-weight:600; font-size:0.75rem; text-transform:uppercase; white-space:nowrap;';

    const fixedHeaders = [
        { text: 'Block No', rowspan: 3, style: 'min-width:60px;' },
        { text: 'Year', rowspan: 3, style: 'min-width:50px;' },
        { text: 'Ha Previous', rowspan: 3, style: 'min-width:70px;' },
        { text: 'Ha Present', rowspan: 3, style: 'min-width:70px;' },
        { text: 'Particular', rowspan: 3, style: 'min-width:100px; text-align:left;' },
    ];

    fixedHeaders.forEach(h => {
        const th = document.createElement('th');
        th.rowSpan = h.rowspan;
        th.style.cssText = headerStyle + h.style;
        th.textContent = h.text;
        tr1.appendChild(th);
    });

    // Month columns (each spans 2: GLY, ALY)
    MONTHS.forEach(m => {
        const th = document.createElement('th');
        th.colSpan = 2;
        th.style.cssText = headerStyle;
        th.textContent = m;
        tr1.appendChild(th);
    });

    // TOTAL column (spans 2)
    const thTotal = document.createElement('th');
    thTotal.colSpan = 2;
    thTotal.style.cssText = headerStyle + 'background:#166534; color:#dcfce7;';
    thTotal.textContent = 'TOTAL';
    tr1.appendChild(thTotal);

    thead.appendChild(tr1);

    // Row 2: GLY / ALY sub-headers for each month
    const tr2 = document.createElement('tr');
    const subHeaderStyle = 'background:#334155; color:#94a3b8; padding:4px 6px; text-align:center; border:1px solid #475569; font-size:0.7rem; font-weight:500;';

    MONTHS.forEach(() => {
        ['GLY\n(LITRE)', 'ALY\n(GM)'].forEach(sub => {
            const th = document.createElement('th');
            th.style.cssText = subHeaderStyle;
            th.style.whiteSpace = 'pre-line';
            th.textContent = sub;
            tr2.appendChild(th);
        });
    });

    // TOTAL sub-headers
    ['GLY\n(LITRE)', 'ALY\n(GM)'].forEach(sub => {
        const th = document.createElement('th');
        th.style.cssText = subHeaderStyle + 'background:#14532d; color:#bbf7d0;';
        th.style.whiteSpace = 'pre-line';
        th.textContent = sub;
        tr2.appendChild(th);
    });

    thead.appendChild(tr2);
    table.appendChild(thead);

    // ── TBODY ────────────────────────────────────────────────────────
    const tbody = document.createElement('tbody');

    const SUB_ROWS = ['Round', 'No.Litre / GM', 'Ha'];
    const cellStyle = 'border:1px solid var(--border-color); padding:2px 4px; text-align:center; vertical-align:middle;';
    const phaseLabel = phase.phaseName || '';

    phase.blocks.forEach((block, blockIdx) => {
        // Initialize month data if missing
        if (!block.months) block.months = {};
        MONTHS.forEach(m => {
            if (!block.months[m]) block.months[m] = { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' };
        });

        SUB_ROWS.forEach((subRow, subIdx) => {
            const tr = document.createElement('tr');
            tr.style.background = subIdx === 0 ? '#fff' : subIdx === 1 ? '#f8fafc' : '#f1f5f9';

            // Block No (only first sub-row)
            if (subIdx === 0) {
                const tdBlock = document.createElement('td');
                tdBlock.rowSpan = 3;
                tdBlock.style.cssText = cellStyle + 'font-weight:600; min-width:60px;';
                const blockInput = document.createElement('input');
                blockInput.type = 'text';
                blockInput.className = 'edit-input text-center';
                blockInput.style.cssText = 'width:100%; min-width:50px; text-align:center;';
                blockInput.value = block.blockNo || '';
                blockInput.onchange = e => { block.blockNo = e.target.value; };
                tdBlock.appendChild(blockInput);
                tr.appendChild(tdBlock);

                // Year
                const tdYear = document.createElement('td');
                tdYear.rowSpan = 3;
                tdYear.style.cssText = cellStyle + 'min-width:50px;';
                const yearInput = document.createElement('input');
                yearInput.type = 'text';
                yearInput.className = 'edit-input text-center';
                yearInput.style.cssText = 'width:100%; min-width:40px; text-align:center;';
                yearInput.value = block.plantYear || '';
                yearInput.onchange = e => { block.plantYear = e.target.value; };
                tdYear.appendChild(yearInput);
                tr.appendChild(tdYear);

                // Ha Previous
                const tdHaPrev = document.createElement('td');
                tdHaPrev.rowSpan = 3;
                tdHaPrev.style.cssText = cellStyle + 'min-width:70px;';
                const haPrevInput = document.createElement('input');
                haPrevInput.type = 'number';
                haPrevInput.className = 'edit-input text-right';
                haPrevInput.style.cssText = 'width:100%; min-width:55px; text-align:right;';
                haPrevInput.value = block.haPrevious != null ? block.haPrevious : '';
                haPrevInput.onchange = e => { block.haPrevious = parseFloat(e.target.value) || 0; };
                tdHaPrev.appendChild(haPrevInput);
                tr.appendChild(tdHaPrev);

                // Ha Present
                const tdHaPres = document.createElement('td');
                tdHaPres.rowSpan = 3;
                tdHaPres.style.cssText = cellStyle + 'min-width:70px;';
                const haPresInput = document.createElement('input');
                haPresInput.type = 'number';
                haPresInput.className = 'edit-input text-right';
                haPresInput.style.cssText = 'width:100%; min-width:55px; text-align:right;';
                haPresInput.value = block.haPresent != null ? block.haPresent : '';
                haPresInput.onchange = e => { block.haPresent = parseFloat(e.target.value) || 0; };
                tdHaPres.appendChild(haPresInput);
                tr.appendChild(tdHaPres);
            }

            // Particular label
            const tdPart = document.createElement('td');
            tdPart.style.cssText = cellStyle + 'text-align:left; font-size:0.78rem; color:var(--text-secondary); padding-left:8px; white-space:nowrap;';
            tdPart.textContent = subRow;
            tr.appendChild(tdPart);

            // Month data cells
            let totalGly = 0;
            let totalAly = 0;

            MONTHS.forEach(m => {
                const mData = block.months[m];

                if (subRow === 'Round') {
                    // GLY Round
                    const tdGly = document.createElement('td');
                    tdGly.style.cssText = cellStyle;
                    const inGly = createSprayInput('number', mData.roundGly, val => { mData.roundGly = val; });
                    tdGly.appendChild(inGly);
                    tr.appendChild(tdGly);

                    // ALY Round
                    const tdAly = document.createElement('td');
                    tdAly.style.cssText = cellStyle;
                    const inAly = createSprayInput('number', mData.roundAly, val => { mData.roundAly = val; });
                    tdAly.appendChild(inAly);
                    tr.appendChild(tdAly);

                } else if (subRow === 'No.Litre / GM') {
                    // GLY Litres
                    const tdGly = document.createElement('td');
                    tdGly.style.cssText = cellStyle + 'background:#fefce8;';
                    const inGly = createSprayInput('number', mData.litresGly, val => { mData.litresGly = val; }, true);
                    tdGly.appendChild(inGly);
                    tr.appendChild(tdGly);
                    totalGly += parseFloat(mData.litresGly) || 0;

                    // ALY GM
                    const tdAly = document.createElement('td');
                    tdAly.style.cssText = cellStyle + 'background:#fef9c3;';
                    const inAly = createSprayInput('number', mData.gmAly, val => { mData.gmAly = val; }, true);
                    tdAly.appendChild(inAly);
                    tr.appendChild(tdAly);
                    totalAly += parseFloat(mData.gmAly) || 0;

                } else { // Ha
                    // GLY Ha
                    const tdGly = document.createElement('td');
                    tdGly.style.cssText = cellStyle + 'background:#f0fdf4;';
                    const inGly = createSprayInput('number', mData.haGly, val => { mData.haGly = val; });
                    tdGly.appendChild(inGly);
                    tr.appendChild(tdGly);

                    // ALY Ha
                    const tdAly = document.createElement('td');
                    tdAly.style.cssText = cellStyle + 'background:#dcfce7;';
                    const inAly = createSprayInput('number', mData.haAly, val => { mData.haAly = val; });
                    tdAly.appendChild(inAly);
                    tr.appendChild(tdAly);
                }
            });

            // TOTAL columns
            if (subRow === 'No.Litre / GM') {
                const tdTGly = document.createElement('td');
                tdTGly.style.cssText = cellStyle + 'background:#dcfce7; font-weight:700; color:#166534;';
                tdTGly.textContent = totalGly > 0 ? totalGly.toLocaleString() : '';

                const tdTAly = document.createElement('td');
                tdTAly.style.cssText = cellStyle + 'background:#bbf7d0; font-weight:700; color:#14532d;';
                tdTAly.textContent = totalAly > 0 ? totalAly.toLocaleString() : '';

                tr.appendChild(tdTGly);
                tr.appendChild(tdTAly);
            } else {
                // Empty total cells for Round and Ha rows
                const tdT1 = document.createElement('td');
                tdT1.style.cssText = cellStyle + 'background:#f0fdf4;';
                const tdT2 = document.createElement('td');
                tdT2.style.cssText = cellStyle + 'background:#dcfce7;';
                tr.appendChild(tdT1);
                tr.appendChild(tdT2);
            }

            // Delete block button (only on Round row)
            if (subIdx === 0) {
                const tdDel = document.createElement('td');
                tdDel.rowSpan = 3;
                tdDel.style.cssText = cellStyle + 'width:32px; padding:2px;';
                const btnDel = document.createElement('button');
                btnDel.className = 'btn-icon delete';
                btnDel.title = 'Delete Block';
                btnDel.innerHTML = '🗑';
                btnDel.onclick = () => {
                    if (confirm(`Delete Block ${block.blockNo || blockIdx + 1}?`)) {
                        const yd = window.state.spraying[yearStr];
                        yd.phases[phaseIdx].blocks.splice(blockIdx, 1);
                        renderSprayingReport();
                    }
                };
                tdDel.appendChild(btnDel);
                tr.appendChild(tdDel);
            }

            tbody.appendChild(tr);
        });

        // Spacer row between blocks
        if (blockIdx < phase.blocks.length - 1) {
            const spacer = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6 + MONTHS.length * 2 + 2 + 1;
            td.style.cssText = 'height:4px; background:var(--bg-main); border:none;';
            spacer.appendChild(td);
            tbody.appendChild(spacer);
        }
    });

    // ── PHASE TOTALS ROW ─────────────────────────────────────────────
    const trTotalLabel = document.createElement('tr');
    trTotalLabel.style.cssText = 'background:#1e293b; color:#f8fafc;';

    const tdTotalFixed = document.createElement('td');
    tdTotalFixed.colSpan = 6;
    tdTotalFixed.style.cssText = 'border:1px solid #334155; padding:6px 10px; font-weight:700; text-align:right; font-size:0.8rem; letter-spacing:0.05em;';
    tdTotalFixed.textContent = `SUBTOTAL — ${phase.phaseName}`;
    trTotalLabel.appendChild(tdTotalFixed);

    // Compute phase totals per month
    let grandGly = 0;
    let grandAly = 0;

    MONTHS.forEach(m => {
        let mGly = 0;
        let mAly = 0;
        phase.blocks.forEach(b => {
            mGly += parseFloat(b.months?.[m]?.litresGly) || 0;
            mAly += parseFloat(b.months?.[m]?.gmAly) || 0;
        });
        grandGly += mGly;
        grandAly += mAly;

        const tdGly = document.createElement('td');
        tdGly.style.cssText = 'border:1px solid #334155; padding:5px 6px; text-align:center; font-weight:600; font-size:0.78rem; color:#86efac;';
        tdGly.textContent = mGly > 0 ? mGly.toLocaleString() : '—';
        trTotalLabel.appendChild(tdGly);

        const tdAly = document.createElement('td');
        tdAly.style.cssText = 'border:1px solid #334155; padding:5px 6px; text-align:center; font-weight:600; font-size:0.78rem; color:#6ee7b7;';
        tdAly.textContent = mAly > 0 ? mAly.toLocaleString() : '—';
        trTotalLabel.appendChild(tdAly);
    });

    // Grand totals
    const tdGGly = document.createElement('td');
    tdGGly.style.cssText = 'border:1px solid #334155; padding:5px 8px; text-align:center; font-weight:700; font-size:0.8rem; color:#4ade80; background:#14532d;';
    tdGGly.textContent = grandGly > 0 ? grandGly.toLocaleString() : '—';
    trTotalLabel.appendChild(tdGGly);

    const tdGAly = document.createElement('td');
    tdGAly.style.cssText = 'border:1px solid #334155; padding:5px 8px; text-align:center; font-weight:700; font-size:0.8rem; color:#34d399; background:#064e3b;';
    tdGAly.textContent = grandAly > 0 ? grandAly.toLocaleString() : '—';
    trTotalLabel.appendChild(tdGAly);

    // Delete col placeholder
    const tdDelPlaceholder = document.createElement('td');
    tdDelPlaceholder.style.cssText = 'border:1px solid #334155;';
    trTotalLabel.appendChild(tdDelPlaceholder);

    tbody.appendChild(trTotalLabel);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    wrapper.appendChild(section);
};

// ─────────────────────────────────────────────────────────────────────
// Grand Total Summary across all phases
// ─────────────────────────────────────────────────────────────────────
const renderGrandTotal = (wrapper, data, MONTHS, yearStr) => {
    if (!data.phases || data.phases.length === 0) return;

    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden; margin-bottom:1.5rem;';

    const bar = document.createElement('div');
    bar.style.cssText = 'background:#1e293b; color:#f8fafc; padding:0.6rem 1rem; font-weight:700; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.05em;';
    bar.textContent = `GRAND TOTAL — ${yearStr}`;
    div.appendChild(bar);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem; min-width:1200px;';

    // Header
    let headerHtml = `<thead><tr><th style="background:#334155;color:#94a3b8;padding:6px 10px;border:1px solid #475569;text-align:left;min-width:150px;">Phase</th>`;
    MONTHS.forEach(m => {
        headerHtml += `<th colspan="2" style="background:#334155;color:#94a3b8;padding:6px;border:1px solid #475569;text-align:center;">${m}</th>`;
    });
    headerHtml += `<th colspan="2" style="background:#14532d;color:#bbf7d0;padding:6px;border:1px solid #1a6b3c;text-align:center;">TOTAL</th></tr>`;
    headerHtml += `<tr><th style="background:#1e293b;color:#64748b;padding:4px 10px;border:1px solid #334155;font-size:0.7rem;"></th>`;
    MONTHS.forEach(() => {
        headerHtml += `<th style="background:#1e293b;color:#64748b;padding:4px;border:1px solid #334155;font-size:0.7rem;text-align:center;">GLY</th>`;
        headerHtml += `<th style="background:#1e293b;color:#64748b;padding:4px;border:1px solid #334155;font-size:0.7rem;text-align:center;">ALY</th>`;
    });
    headerHtml += `<th style="background:#0f3820;color:#6ee7b7;padding:4px;border:1px solid #14532d;font-size:0.7rem;text-align:center;">GLY</th>`;
    headerHtml += `<th style="background:#0f3820;color:#34d399;padding:4px;border:1px solid #14532d;font-size:0.7rem;text-align:center;">ALY</th>`;
    headerHtml += `</tr></thead>`;

    table.innerHTML = headerHtml;

    const tbody = document.createElement('tbody');

    let grandTotalGly = 0;
    let grandTotalAly = 0;
    const grandByMonth = {};
    MONTHS.forEach(m => { grandByMonth[m] = { gly: 0, aly: 0 }; });

    data.phases.forEach(phase => {
        const tr = document.createElement('tr');
        let phaseGly = 0;
        let phaseAly = 0;

        let rowHtml = `<td style="border:1px solid var(--border-color);padding:5px 10px;font-weight:600;color:var(--accent);">${phase.phaseName}</td>`;

        MONTHS.forEach(m => {
            let mGly = 0;
            let mAly = 0;
            phase.blocks.forEach(b => {
                mGly += parseFloat(b.months?.[m]?.litresGly) || 0;
                mAly += parseFloat(b.months?.[m]?.gmAly) || 0;
            });
            phaseGly += mGly;
            phaseAly += mAly;
            grandByMonth[m].gly += mGly;
            grandByMonth[m].aly += mAly;

            rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 6px;text-align:center;background:#fefce8;color:#854d0e;">${mGly > 0 ? mGly.toLocaleString() : '—'}</td>`;
            rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 6px;text-align:center;background:#fef9c3;color:#713f12;">${mAly > 0 ? mAly.toLocaleString() : '—'}</td>`;
        });

        grandTotalGly += phaseGly;
        grandTotalAly += phaseAly;

        rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 8px;text-align:center;background:#dcfce7;font-weight:700;color:#166534;">${phaseGly > 0 ? phaseGly.toLocaleString() : '—'}</td>`;
        rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 8px;text-align:center;background:#bbf7d0;font-weight:700;color:#14532d;">${phaseAly > 0 ? phaseAly.toLocaleString() : '—'}</td>`;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    trGrand.style.fontWeight = '700';
    let grandRowHtml = `<td style="border:1px solid #334155;padding:7px 10px;background:#1e293b;color:#f8fafc;font-weight:700;">GRAND TOTAL</td>`;
    MONTHS.forEach(m => {
        grandRowHtml += `<td style="border:1px solid #334155;padding:6px;text-align:center;background:#292524;color:#fde68a;font-weight:700;">${grandByMonth[m].gly > 0 ? grandByMonth[m].gly.toLocaleString() : '—'}</td>`;
        grandRowHtml += `<td style="border:1px solid #334155;padding:6px;text-align:center;background:#1c1917;color:#fcd34d;font-weight:700;">${grandByMonth[m].aly > 0 ? grandByMonth[m].aly.toLocaleString() : '—'}</td>`;
    });
    grandRowHtml += `<td style="border:1px solid #0f3820;padding:6px 10px;text-align:center;background:#0f3820;color:#4ade80;font-weight:700;font-size:0.9rem;">${grandTotalGly > 0 ? grandTotalGly.toLocaleString() : '—'}</td>`;
    grandRowHtml += `<td style="border:1px solid #0f3820;padding:6px 10px;text-align:center;background:#052e16;color:#34d399;font-weight:700;font-size:0.9rem;">${grandTotalAly > 0 ? grandTotalAly.toLocaleString() : '—'}</td>`;
    trGrand.innerHTML = grandRowHtml;
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    div.appendChild(tableWrap);
    wrapper.appendChild(div);
};

// ─────────────────────────────────────────────────────────────────────
// Helper: Create a small editable input cell
// ─────────────────────────────────────────────────────────────────────
const createSprayInput = (type, value, onChange, highlight = false) => {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'edit-input text-center';
    inp.style.cssText = `width:100%; min-width:40px; text-align:center; font-size:0.78rem; padding:2px 3px; ${highlight ? 'font-weight:600;' : ''}`;
    inp.value = value != null && value !== '' ? value : '';
    inp.placeholder = '';
    inp.onchange = e => onChange(type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value) || 0) : e.target.value);
    return inp;
};

// ─────────────────────────────────────────────────────────────────────
// Default data structure — matches the Excel blocks
// ─────────────────────────────────────────────────────────────────────
const getDefaultSprayingData = () => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const emptyMonth = () => ({ roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' });

    // md: helper to create a month data entry (GLY and ALLY share the same round and Ha)
    const md = (round, litresGly, gmAly, ha) => ({
        roundGly: round, roundAly: round,
        litresGly, gmAly, haGly: ha, haAly: ha
    });

    const makeBlock = (blockNo, plantYear, haPrevious, haPresent, monthData = {}) => ({
        blockNo: String(blockNo),
        plantYear: String(plantYear),
        haPrevious,
        haPresent,
        months: Object.fromEntries(MONTHS.map(m => [m, monthData[m] ? { ...emptyMonth(), ...monthData[m] } : emptyMonth()]))
    });

    return {
        phases: [
            {
                phaseName: 'OP2010',
                blocks: [
                    makeBlock(1,  2010, 53.2,  53.09, { FEB: md(1,40,2000,53.2),  MAY: md(2,40,2000,53.2),  AUG: md(3,40,2000,53.2)  }),
                    makeBlock(2,  2010, 60.4,  60.27, { APR: md(1,80,4000,60.4),  JUL: md(2,80,4000,60.4),  OCT: md(3,80,4000,60.27) }),
                    makeBlock(3,  2010, 69.2,  69.04, { MAR: md(1,60,3000,69.2),  JUN: md(2,60,3000,69.2),  SEP: md(3,60,3000,69.2)  }),
                    makeBlock(4,  2010, 70.6,  70.51, { MAR: md(1,60,3000,70.6),  JUN: md(2,60,3000,70.6),  SEP: md(3,60,3000,70.6)  }),
                    makeBlock(5,  2010, 50.4,  50.4,  { FEB: md(1,40,2000,50.4),  JUN: md(2,40,2000,50.4),  AUG: md(3,40,2000,50.4)  }),
                    makeBlock(6,  2010, 58.6,  58.6,  { MAY: md(1,40,2000,58.6),  JUL: md(2,60,3000,58.6),  OCT: md(3,40,2000,58.6)  }),
                    makeBlock(7,  2010, 23.6,  23.6,  { FEB: md(1,20,1000,23.6),  MAY: md(2,20,1000,23.6),  AUG: md(3,20,1000,23.6)  }),
                    makeBlock(8,  2010, 61.6,  61.6,  { APR: md(1,40,2000,61.6),  JUL: md(2,40,2000,61.6),  OCT: md(3,40,2000,61.6)  }),
                    makeBlock(9,  2010, 38.3,  38.3,  { APR: md(1,40,2000,38.3),  JUL: md(2,40,2000,38.3),  OCT: md(3,40,2000,38.3)  }),
                    makeBlock(11, 2010, 44.5,  44.5,  { APR: md(1,40,2000,44.5),  JUL: md(2,40,2000,44.5),  OCT: md(3,40,2000,44.5)  }),
                    makeBlock(12, 2010, 71.0,  71.0,  { FEB: md(1,60,3000,71),    JUN: md(2,60,3000,71),    AUG: md(3,60,3000,71)    }),
                    makeBlock(23, 2010, 14.6,  14.6,  { FEB: md(1,20,1000,14.6),  JUN: md(2,20,1000,14.6),  AUG: md(3,20,1000,14.6)  }),
                ]
            },
            {
                phaseName: 'OP2011',
                blocks: [
                    makeBlock(10, 2011, 19.1,  19.1,  { MAY: md(1,20,1000,19.1),  JUL: md(2,20,1000,19.1),  OCT: md(3,20,1000,19.1)  }),
                    makeBlock(13, 2011, 60.8,  60.8,  { FEB: md(1,40,2000,60.8),  MAY: md(2,40,2000,60.8),  AUG: md(3,40,2000,60.8)  }),
                    makeBlock(14, 2011, 41.6,  41.6,  { APR: md(1,40,2000,41.6),  JUL: md(2,40,2000,41.6),  OCT: md(3,40,2000,41.6)  }),
                    makeBlock(15, 2011, 49.3,  49.17, { APR: md(1,60,3000,49.3),  JUL: md(2,80,4000,49.3),  OCT: md(3,60,3000,49.17) }),
                    makeBlock(16, 2011, 53.2,  52.61, { MAR: md(1,40,2000,53.2),  JUN: md(2,40,2000,53.2),  SEP: md(3,40,2000,53.2)  }),
                    makeBlock(17, 2011, 45.7,  45.58, { FEB: md(1,40,2000,45.7),  MAY: md(2,40,2000,45.7),  AUG: md(3,40,2000,45.7)  }),
                    makeBlock(18, 2011, 40.8,  40.8,  { MAR: md(1,40,2000,40.8),  JUN: md(2,40,2000,40.8),  SEP: md(3,40,2000,40.8)  }),
                ]
            },
            {
                phaseName: 'OP2012',
                blocks: [
                    makeBlock(19, 2012, 50.6,  50.6,  { FEB: md(1,60,3000,50.6),  JUN: md(2,60,3000,50.6),  AUG: md(3,60,3000,50.6)  }),
                    makeBlock(20, 2012, 62.1,  61.98, { FEB: md(1,40,2000,62.1),  MAY: md(2,40,2000,62.1),  AUG: md(3,40,2000,62.1)  }),
                    makeBlock(21, 2012, 72.2,  71.59, { MAR: md(1,80,4000,72.2),  JUN: md(2,80,4000,72.2),  SEP: md(3,80,4000,72.2)  }),
                    makeBlock(22, 2012, 52.3,  52.08, { MAR: md(1,40,2000,52.3),  JUN: md(2,40,2000,52.3),  SEP: md(3,40,2000,52.3)  }),
                    makeBlock(24, 2012, 44.7,  44.67, { MAY: md(1,40,2000,44.7),  JUL: md(2,40,2000,44.7),  OCT: md(3,40,2000,44.67) }),
                ]
            },
            {
                phaseName: 'OP2015',
                blocks: [
                    makeBlock(25,    2015, 38.22, 38.23, { MAR: md(1,40,2000,38.22), AUG: md(2,40,2000,38.22) }),
                    makeBlock('26A', 2015, 22.72, 22.72, { MAR: md(1,20,1000,22.72), JUN: md(2,20,1000,22.72), SEP: md(3,20,1000,22.72) }),
                    makeBlock('26B', 2015, 0,     0),
                    makeBlock(27,    2015, 18.64, 14.3,  { FEB: md(1,20,1000,18.64), MAY: md(2,20,1000,18.64), AUG: md(3,40,2000,18.64) }),
                    makeBlock(28,    2015, 25.5,  21.94, { APR: md(1,20,1000,25.5),  JUN: md(2,20,1000,25.5),  SEP: md(3,20,1000,25.5)  }),
                    makeBlock(29,    2015, 11.38, 19.26, { MAY: md(1,20,1000,11.38), JUL: md(2,20,1000,11.38), OCT: md(3,20,1000,19.26) }),
                    makeBlock(30,    2015, 24.35, 24.3,  { MAY: md(1,40,2000,24.35), JUL: md(2,40,2000,24.35), OCT: md(3,20,1000,24.3)  }),
                    makeBlock(31,    2015, 34.08, 34.02, { APR: md(1,40,2000,34.08), JUL: md(2,40,2000,34.08), OCT: md(3,40,2000,34.02) }),
                    makeBlock(32,    2015, 0,     0),
                ]
            },
            {
                phaseName: 'OP2016',
                blocks: [
                    makeBlock(33, 2016, 28.72, 28.42, { APR: md(1,20,1000,28.72), JUN: md(2,20,1000,28.72), SEP: md(3,20,1000,28.72) }),
                    makeBlock(39, 2016, 4.5,   4.5,   { APR: md(1,7,333,4.5),     JUN: md(2,7,333,4.5),     SEP: md(3,6,334,4.5)    }),
                ]
            }
        ]
    };
};

// ─────────────────────────────────────────────────────────────────────
// Save / Load spraying data to Firebase (under shared db path)
// ─────────────────────────────────────────────────────────────────────
const saveSprayingData = (silent = true) => {
    if (!window._sprayingDb || !window._sprayingUid) {
        if (!silent) alert('Not connected to database. Please login first.');
        return;
    }
    const payload = JSON.stringify(window.state.spraying);
    window._sprayingDb.ref('shared/spraying_data').set(payload)
        .then(() => { if (!silent) alert('Spraying data saved successfully!'); })
        .catch(e => { console.error('Spraying save error:', e); if (!silent) alert('Error saving: ' + e.message); });
};

// ─────────────────────────────────────────────────────────────────────
// Add a new Phase to the year
// ─────────────────────────────────────────────────────────────────────
const addNewPhase = (yearStr) => {
    const name = prompt('Enter Phase name (e.g., OP2016):');
    if (!name || name.trim() === '') return;
    const yd = window.state.spraying[yearStr];
    if (!yd) return;
    yd.phases.push({ phaseName: name.trim(), blocks: [] });
    renderSprayingReport();
};

// ─────────────────────────────────────────────────────────────────────
// Add block to a phase
// ─────────────────────────────────────────────────────────────────────
const addNewBlock = (yearStr, phaseIdx) => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const yd = window.state.spraying[yearStr];
    if (!yd || !yd.phases[phaseIdx]) return;

    const blockNo = prompt('Enter Block No:');
    if (!blockNo || blockNo.trim() === '') return;

    yd.phases[phaseIdx].blocks.push({
        blockNo: blockNo.trim(),
        plantYear: '',
        haPrevious: 0,
        haPresent: 0,
        months: Object.fromEntries(MONTHS.map(m => [m, { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' }]))
    });

    renderSprayingReport();
};
