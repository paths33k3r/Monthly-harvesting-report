(function () {
  'use strict';

  const MONTH_SLOTS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Aug2','Sep','Oct','Nov','Dec'];
  const MONTH_LABELS = {
    Jan:'JAN', Feb:'FEB', Mar:'MAR', Apr:'APR', May:'MAY', Jun:'JUN',
    Jul:'JUL', Aug:'AUG', Aug2:'AUG*', Sep:'SEP', Oct:'OCT', Nov:'NOV', Dec:'DEC'
  };

  const FERT_COLORS = {
    MOP:  { bg: '#00B050', text: '#fff' },
    SATO: { bg: '#0070C0', text: '#fff' },
    COM:  { bg: '#FF6600', text: '#fff' },
    SPEC: { bg: '#FFFF00', text: '#000' },
    ERP:  { bg: '#9B59B6', text: '#fff' },
    MIX:  { bg: '#E67E22', text: '#fff' },
  };

  const PHASE_NAMES = ['PHASE 2010','PHASE 2011','PHASE 2012','PHASE 2015','PHASE 2016'];

  const DEFAULT_2025 = {
    'PHASE 2010': { blocks: [
      { bk:1,  ha:53.09,  npalm:6045,  apps:{ Apr:{round:1,bags:121,mt:6.05,fert:'MOP'}, Jul:{round:1,bags:121,mt:6.05,fert:'SATO'}, Aug:{round:1,bags:82,mt:4.1,fert:'SATO'}, Aug2:{round:1,bags:39,mt:1.95,fert:'COM'}, Sep:{round:1,bags:121,mt:6.05,fert:'COM'}, Nov:{round:1.5,bags:183,mt:9.15,fert:'SATO'} } },
      { bk:2,  ha:60.27,  npalm:6841,  apps:{ Apr:{round:1,bags:137,mt:6.85,fert:'MOP'}, Jul:{round:1,bags:137,mt:6.85,fert:'SATO'}, Aug:{round:1,bags:137,mt:6.85,fert:'COM'}, Sep:{round:1,bags:137,mt:6.85,fert:'COM'}, Nov:{round:1.5,bags:207,mt:10.35,fert:'SATO'} } },
      { bk:3,  ha:69.04,  npalm:8211,  apps:{ Apr:{round:1,bags:164,mt:8.2,fert:'MOP'}, Jul:{round:1,bags:164,mt:8.2,fert:'SATO'}, Aug:{round:1,bags:164,mt:8.2,fert:'COM'}, Oct:{round:1,bags:164,mt:8.2,fert:'COM'}, Nov:{round:1.5,bags:248,mt:12.4,fert:'SATO'} } },
      { bk:4,  ha:70.51,  npalm:8849,  apps:{ Apr:{round:1,bags:177,mt:8.85,fert:'MOP'}, Jul:{round:1,bags:177,mt:8.85,fert:'SATO'}, Aug:{round:1,bags:177,mt:8.85,fert:'COM'}, Sep:{round:1,bags:177,mt:8.85,fert:'COM'}, Nov:{round:1.5,bags:268,mt:13.4,fert:'SATO'} } },
      { bk:5,  ha:50.4,   npalm:6830,  apps:{ Apr:{round:1,bags:136,mt:6.8,fert:'MOP'}, Jul:{round:1,bags:136,mt:6.8,fert:'SATO'}, Aug:{round:1,bags:137,mt:6.85,fert:'COM'}, Oct:{round:1,bags:137,mt:6.85,fert:'COM'}, Nov:{round:1.5,bags:206,mt:10.3,fert:'SATO'} } },
      { bk:6,  ha:58.6,   npalm:7060,  apps:{ Apr:{round:1,bags:141,mt:7.05,fert:'MOP'}, Jul:{round:1,bags:141,mt:7.05,fert:'SATO'}, Aug:{round:1,bags:142,mt:7.1,fert:'COM'}, Oct:{round:1,bags:142,mt:7.1,fert:'COM'}, Nov:{round:1.5,bags:213,mt:10.65,fert:'SATO'} } },
      { bk:7,  ha:23.6,   npalm:2258,  apps:{ Apr:{round:1,bags:45,mt:2.25,fert:'MOP'}, Jul:{round:1,bags:45,mt:2.25,fert:'SATO'}, Aug:{round:1,bags:46,mt:2.3,fert:'COM'}, Oct:{round:1,bags:46,mt:2.3,fert:'COM'}, Nov:{round:1.5,bags:68,mt:3.4,fert:'SATO'} } },
      { bk:8,  ha:61.6,   npalm:7486,  apps:{ May:{round:1,bags:149,mt:7.45,fert:'MOP'}, Jul:{round:1,bags:149,mt:7.45,fert:'SATO'}, Aug:{round:1,bags:150,mt:7.5,fert:'COM'}, Oct:{round:1,bags:150,mt:7.5,fert:'COM'} } },
      { bk:9,  ha:38.3,   npalm:4990,  apps:{ Feb:{round:1,bags:99,mt:4.95,fert:'MOP'}, May:{round:1,bags:99,mt:4.95,fert:'MOP'}, Jul:{round:1,bags:99,mt:4.95,fert:'SATO'}, Aug:{round:1,bags:100,mt:5.0,fert:'COM'}, Oct:{round:1,bags:100,mt:5.0,fert:'COM'} } },
      { bk:11, ha:44.5,   npalm:5701,  apps:{ Feb:{round:1,bags:114,mt:5.7,fert:'MOP'}, May:{round:1,bags:114,mt:5.7,fert:'MOP'}, Jul:{round:1,bags:114,mt:5.7,fert:'SATO'}, Aug:{round:1,bags:114,mt:5.7,fert:'COM'}, Oct:{round:1,bags:114,mt:5.7,fert:'COM'} } },
      { bk:12, ha:71.0,   npalm:9301,  apps:{ Feb:{round:1,bags:186,mt:9.3,fert:'MOP'}, May:{round:1,bags:186,mt:9.3,fert:'MOP'}, Jul:{round:1,bags:186,mt:9.3,fert:'SATO'}, Aug:{round:1,bags:186,mt:9.3,fert:'COM'}, Oct:{round:1,bags:186,mt:9.3,fert:'COM'} } },
      { bk:23, ha:14.6,   npalm:1923,  apps:{ Apr:{round:1,bags:38,mt:1.9,fert:'MOP'}, Jul:{round:1,bags:38,mt:1.9,fert:'SATO'}, Aug:{round:1,bags:39,mt:1.95,fert:'COM'}, Oct:{round:1,bags:39,mt:1.95,fert:'COM'}, Nov:{round:1.5,bags:58,mt:2.9,fert:'SATO'} } },
    ]},
    'PHASE 2011': { blocks: [
      { bk:10, ha:19.1,  npalm:2673,  apps:{ Feb:{round:1,bags:53,mt:2.65,fert:'MOP'}, May:{round:1,bags:53,mt:2.65,fert:'MOP'}, Jul:{round:1,bags:53,mt:2.65,fert:'SATO'}, Aug:{round:1,bags:54,mt:2.7,fert:'COM'}, Sep:{round:1,bags:54,mt:2.7,fert:'COM'} } },
      { bk:13, ha:60.8,  npalm:7524,  apps:{ Mar:{round:1,bags:150,mt:7.5,fert:'MOP'}, Jun:{round:1,bags:150,mt:7.5,fert:'SATO'}, Aug:{round:1,bags:151,mt:7.55,fert:'COM'}, Sep:{round:1,bags:151,mt:7.55,fert:'COM'} } },
      { bk:14, ha:41.6,  npalm:4886,  apps:{ May:{round:1,bags:97,mt:4.85,fert:'MOP'}, Jul:{round:1,bags:97,mt:4.85,fert:'SATO'}, Aug:{round:1,bags:98,mt:4.9,fert:'COM'}, Sep:{round:1,bags:98,mt:4.9,fert:'COM'} } },
      { bk:15, ha:49.17, npalm:5678,  apps:{ May:{round:1,bags:113,mt:5.65,fert:'MOP'}, Jul:{round:1,bags:113,mt:5.65,fert:'SATO'}, Aug:{round:1,bags:114,mt:5.7,fert:'COM'}, Sep:{round:1,bags:114,mt:5.7,fert:'COM'} } },
      { bk:16, ha:53.2,  npalm:5867,  apps:{ Mar:{round:1,bags:118,mt:5.9,fert:'MOP'}, Jun:{round:1,bags:118,mt:5.9,fert:'SATO'}, Aug:{round:1,bags:118,mt:5.9,fert:'COM'}, Sep:{round:1,bags:118,mt:5.9,fert:'COM'} } },
      { bk:17, ha:45.58, npalm:5213,  apps:{ Mar:{round:1,bags:104,mt:5.2,fert:'MOP'}, Jun:{round:1,bags:104,mt:5.2,fert:'SATO'}, Aug:{round:1,bags:105,mt:5.25,fert:'COM'}, Sep:{round:1,bags:105,mt:5.25,fert:'COM'} } },
      { bk:18, ha:40.8,  npalm:4974,  apps:{ Mar:{round:1,bags:99,mt:4.95,fert:'MOP'}, Jun:{round:1,bags:99,mt:4.95,fert:'SATO'}, Aug:{round:1,bags:100,mt:5.0,fert:'COM'}, Sep:{round:1,bags:100,mt:5.0,fert:'COM'} } },
    ]},
    'PHASE 2012': { blocks: [
      { bk:19, ha:50.6,  npalm:6527,  apps:{ Mar:{round:1,bags:130,mt:6.5,fert:'MOP'}, Jul:{round:1,bags:130,mt:6.5,fert:'SATO'}, Aug:{round:1,bags:131,mt:6.55,fert:'COM'}, Sep:{round:1,bags:131,mt:6.55,fert:'COM'} } },
      { bk:20, ha:61.98, npalm:7871,  apps:{ Mar:{round:1,bags:157,mt:7.85,fert:'MOP'}, Jul:{round:1,bags:157,mt:7.85,fert:'SATO'}, Aug:{round:1,bags:158,mt:7.9,fert:'COM'}, Sep:{round:1,bags:158,mt:7.9,fert:'COM'} } },
      { bk:21, ha:71.59, npalm:9020,  apps:{ Mar:{round:1,bags:181,mt:9.05,fert:'MOP'}, Jul:{round:1,bags:181,mt:9.05,fert:'SATO'}, Aug:{round:1,bags:181,mt:9.05,fert:'COM'}, Sep:{round:1,bags:168,mt:8.4,fert:'COM'}, Oct:{round:1,bags:13,mt:0.65,fert:'SATO'} } },
      { bk:22, ha:52.08, npalm:6666,  apps:{ Apr:{round:1,bags:134,mt:6.7,fert:'MOP'}, Jul:{round:1,bags:134,mt:6.7,fert:'SATO'}, Aug:{round:1,bags:134,mt:6.7,fert:'COM'}, Sep:{round:1.5,bags:202,mt:10.1,fert:'SATO'} } },
      { bk:24, ha:44.67, npalm:5586,  apps:{ Nov:{round:1.5,bags:169,mt:8.45,fert:'SATO'} } },
    ]},
    'PHASE 2015': { blocks: [
      { bk:25, ha:38.23, npalm:0, apps:{} },
      { bk:27, ha:14.3,  npalm:0, apps:{} },
      { bk:28, ha:21.94, npalm:0, apps:{} },
      { bk:29, ha:19.26, npalm:0, apps:{} },
      { bk:30, ha:24.3,  npalm:0, apps:{} },
      { bk:31, ha:34.02, npalm:0, apps:{} },
    ]},
    'PHASE 2016': { blocks: [
      { bk:33, ha:28.42, npalm:3553, apps:{ Apr:{round:1,bags:71,mt:3.55,fert:'MOP'}, Jul:{round:1,bags:71,mt:3.55,fert:'SATO'}, Aug2:{round:1,bags:71,mt:3.55,fert:'COM'}, Sep:{round:1.5,bags:107,mt:5.35,fert:'SATO'} } },
      { bk:39, ha:4.5,   npalm:563,  apps:{ Aug2:{round:1,bags:12,mt:0.6,fert:'COM'} } },
    ]},
  };

  function getManuringData() {
    return (window.state && window.state.manuring) ? window.state.manuring : {};
  }

  function getCurrentYear() {
    return (window.state && window.state.manuringYear) || '2025';
  }

  function createBlankYear() {
    const result = {};
    for (const phase of PHASE_NAMES) {
      const src = DEFAULT_2025[phase] || { blocks: [] };
      result[phase] = {
        blocks: src.blocks.map(b => ({ bk: b.bk, ha: b.ha, npalm: b.npalm, apps: {} }))
      };
    }
    return result;
  }

  async function saveManuringToFirebase() {
    const db = window._manuringDb || (window.firebase && window.firebase.database ? window.firebase.database() : null);
    if (!db || !window.state || !window.state.manuring) return;
    try {
      await db.ref('shared/manuring_data').set(JSON.stringify(window.state.manuring));
    } catch (e) {
      console.warn('Failed to save manuring data:', e.message);
    }
  }

  function computeTotals(apps) {
    let bags = 0, mt = 0;
    for (const v of Object.values(apps || {})) {
      bags += (v.bags || 0);
      mt   += (v.mt   || 0);
    }
    return { bags, mt: Math.round(mt * 1000) / 1000 };
  }

  function phaseTotal(blocks) {
    let bags = 0, mt = 0, ha = 0;
    for (const b of blocks) {
      const t = computeTotals(b.apps);
      bags += t.bags; mt += t.mt; ha += (b.ha || 0);
    }
    return { bags, mt: Math.round(mt * 1000) / 1000, ha: Math.round(ha * 100) / 100 };
  }

  function slotStyle(app) {
    if (!app || !app.bags) return 'background:#f8f8f8; color:#bbb; text-align:center; padding:3px 2px; border:1px solid #eee;';
    const c = FERT_COLORS[app.fert] || { bg:'#888', text:'#fff' };
    return `background:${c.bg}; color:${c.text}; text-align:center; padding:3px 4px; border:1px solid rgba(0,0,0,0.15); cursor:pointer;`;
  }

  function slotContent(app) {
    if (!app || !app.bags) return '<span style="font-size:0.8em">—</span>';
    return `<div style="font-weight:700; font-size:0.82rem; line-height:1.2">${app.bags}</div>
            <div style="font-size:0.72rem; opacity:0.92">${app.mt}mt</div>
            <div style="font-size:0.7rem; font-weight:600; letter-spacing:0.02em">${app.fert}×${app.round}</div>`;
  }

  function renderLegend() {
    return `<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center; margin-bottom:1rem;">
      <span style="font-size:0.8rem; color:#666; font-weight:600">Fertilizer:</span>
      ${Object.entries(FERT_COLORS).map(([k,c]) =>
        `<span style="background:${c.bg}; color:${c.text}; padding:2px 8px; border-radius:3px; font-size:0.78rem; font-weight:600">${k}</span>`
      ).join('')}
      <span style="font-size:0.76rem; color:#999; margin-left:0.5rem">Aug* = late Aug/early Sep application slot</span>
    </div>`;
  }

  function renderPhaseSection(phaseName, phaseData, year) {
    const blocks = (phaseData && phaseData.blocks) ? phaseData.blocks : [];

    // Determine which month slots to show (all slots that have any data in this phase, or all 13 if no data)
    const usedSlots = MONTH_SLOTS.filter(m => blocks.some(b => b.apps && b.apps[m] && b.apps[m].bags > 0));
    const slotsToShow = usedSlots.length > 0 ? usedSlots : MONTH_SLOTS;

    const tot = phaseTotal(blocks);

    const headerCols = slotsToShow.map(m =>
      `<th style="background:#2c5f2e; color:#fff; text-align:center; padding:5px 3px; min-width:62px; font-size:0.78rem; white-space:nowrap">${MONTH_LABELS[m]}</th>`
    ).join('');

    const dataRows = blocks.map(b => {
      const apps = b.apps || {};
      const t = computeTotals(apps);
      const dataCells = slotsToShow.map(m => {
        const app = apps[m];
        const editAttr = `onclick="window._manuringEditCell('${year}','${phaseName}',${b.bk},'${m}')"`;
        return `<td style="${slotStyle(app)}" title="${m}: ${app ? (app.bags + ' bags ' + (app.fert||'')) : 'no application'}" ${editAttr}>${slotContent(app)}</td>`;
      }).join('');

      return `<tr>
        <td style="padding:4px 6px; font-weight:700; background:#f5f5f5; border:1px solid #ddd; text-align:center">${b.bk}</td>
        <td style="padding:4px 6px; border:1px solid #ddd; text-align:right">${b.ha}</td>
        <td style="padding:4px 6px; border:1px solid #ddd; text-align:right">${b.npalm ? b.npalm.toLocaleString() : '—'}</td>
        ${dataCells}
        <td style="padding:4px 8px; border:1px solid #ddd; text-align:right; font-weight:700; background:#fffbe6">${t.bags || '—'}</td>
        <td style="padding:4px 8px; border:1px solid #ddd; text-align:right; color:#555; background:#fffbe6">${t.mt || '—'}</td>
      </tr>`;
    }).join('');

    const totalRow = blocks.length > 0 ? `<tr style="background:#e8f4e8; font-weight:700">
      <td colspan="3" style="padding:5px 6px; border:1px solid #ddd; text-align:right; font-size:0.82rem">PHASE TOTAL</td>
      ${slotsToShow.map(() => '<td style="border:1px solid #ddd"></td>').join('')}
      <td style="padding:5px 8px; border:1px solid #ddd; text-align:right">${tot.bags}</td>
      <td style="padding:5px 8px; border:1px solid #ddd; text-align:right">${tot.mt}</td>
    </tr>` : '';

    const emptyMsg = blocks.length === 0
      ? `<tr><td colspan="${slotsToShow.length + 5}" style="text-align:center; color:#aaa; padding:1.5rem; font-style:italic">No data recorded for this phase</td></tr>`
      : '';

    return `<div style="margin-bottom:2rem;">
      <h3 style="margin:0 0 0.5rem; color:#2c5f2e; font-size:1rem; font-weight:700; display:flex; align-items:center; gap:0.5rem;">
        🌴 ${phaseName}
        <span style="font-size:0.78rem; font-weight:400; color:#666">(${blocks.length} blocks · ${tot.ha} ha)</span>
      </h3>
      <div style="overflow-x:auto; border-radius:4px; box-shadow:0 1px 4px rgba(0,0,0,0.1)">
        <table style="border-collapse:collapse; min-width:100%; font-size:0.82rem">
          <thead>
            <tr>
              <th style="background:#1a3d1e; color:#fff; padding:6px 8px; text-align:center; border:1px solid #333; min-width:36px">BK</th>
              <th style="background:#1a3d1e; color:#fff; padding:6px 8px; text-align:right; border:1px solid #333; min-width:52px">Ha</th>
              <th style="background:#1a3d1e; color:#fff; padding:6px 8px; text-align:right; border:1px solid #333; min-width:64px">No.Palm</th>
              ${headerCols}
              <th style="background:#b8860b; color:#fff; padding:6px 8px; text-align:right; border:1px solid #333; min-width:60px">Tot.Bags</th>
              <th style="background:#b8860b; color:#fff; padding:6px 8px; text-align:right; border:1px solid #333; min-width:56px">Tot.Mt</th>
            </tr>
          </thead>
          <tbody>${dataRows}${totalRow}${emptyMsg}</tbody>
        </table>
      </div>
    </div>`;
  }

  function renderManuring() {
    const wrapper = document.getElementById('manuring-wrapper');
    if (!wrapper) return;

    const data = getManuringData();
    const currentYear = getCurrentYear();

    // Ensure 2025 default is always present
    if (!data['2025']) {
      data['2025'] = JSON.parse(JSON.stringify(DEFAULT_2025));
      if (window.state) window.state.manuring = data;
    }

    const years = Object.keys(data).filter(k => /^\d{4}$/.test(k)).sort();
    const yearData = data[currentYear] || {};

    const yearBtns = years.map(y =>
      `<button onclick="window._manuringSetYear('${y}')" style="
        padding:5px 14px; border:2px solid ${y === currentYear ? '#2c5f2e' : '#ccc'};
        background:${y === currentYear ? '#2c5f2e' : '#fff'}; color:${y === currentYear ? '#fff' : '#333'};
        border-radius:4px; cursor:pointer; font-weight:600; font-size:0.88rem">${y}</button>`
    ).join('');

    const phaseSections = PHASE_NAMES.map(p =>
      renderPhaseSection(p, yearData[p], currentYear)
    ).join('');

    wrapper.innerHTML = `
      <div style="padding:1rem 1rem 0.5rem; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; gap:1rem; flex-wrap:wrap; background:#fff; border-radius:8px 8px 0 0; box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <div>
          <h2 style="margin:0; font-size:1.15rem; color:#1a3d1e; font-weight:700">🌿 Manuring Report</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:#888">Click any cell to edit an application. Color indicates fertilizer type.</p>
        </div>
        <div style="margin-left:auto; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <span style="font-size:0.82rem; color:#666; font-weight:600">Year:</span>
          ${yearBtns}
          <button onclick="window._manuringAddYear()" style="
            padding:5px 14px; border:2px dashed #aaa; background:#f9f9f9; color:#555;
            border-radius:4px; cursor:pointer; font-weight:600; font-size:0.88rem">+ Add Year</button>
          <button id="manuring-dl-btn" onclick="window._downloadManuringExcel()" style="
            padding:5px 14px; border:none; background:#1a6b1e; color:#fff;
            border-radius:4px; cursor:pointer; font-weight:700; font-size:0.88rem; margin-left:0.5rem">
            ⬇ Download Excel</button>
        </div>
      </div>

      <div style="padding:1rem; background:#fafafa; min-height:400px;">
        ${renderLegend()}
        ${phaseSections}
      </div>

      <div id="manuring-edit-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.45); z-index:9999; align-items:center; justify-content:center;">
        <div style="background:#fff; border-radius:8px; padding:1.5rem; min-width:320px; max-width:420px; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
          <h3 id="manuring-edit-title" style="margin:0 0 1rem; color:#1a3d1e; font-size:1rem"></h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-bottom:1rem;">
            <label style="font-size:0.85rem; color:#555; display:flex; flex-direction:column; gap:3px">
              Round (Kg/pokok)
              <input id="me-round" type="number" step="0.5" min="0" style="padding:5px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9rem">
            </label>
            <label style="font-size:0.85rem; color:#555; display:flex; flex-direction:column; gap:3px">
              No. Bags
              <input id="me-bags" type="number" step="1" min="0" style="padding:5px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9rem">
            </label>
            <label style="font-size:0.85rem; color:#555; display:flex; flex-direction:column; gap:3px">
              Mt (metric tons)
              <input id="me-mt" type="number" step="0.01" min="0" style="padding:5px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9rem">
            </label>
            <label style="font-size:0.85rem; color:#555; display:flex; flex-direction:column; gap:3px">
              Fertilizer Type
              <select id="me-fert" style="padding:5px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9rem">
                <option value="">— Select —</option>
                ${Object.keys(FERT_COLORS).map(f => `<option value="${f}">${f}</option>`).join('')}
                <option value="OTHER">Other...</option>
              </select>
            </label>
          </div>
          <div id="me-other-wrap" style="display:none; margin-bottom:0.75rem;">
            <label style="font-size:0.85rem; color:#555; display:flex; flex-direction:column; gap:3px">
              Custom Type
              <input id="me-fert-other" type="text" placeholder="e.g. NPK" style="padding:5px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9rem">
            </label>
          </div>
          <div style="display:flex; gap:0.5rem; justify-content:flex-end; flex-wrap:wrap;">
            <button id="me-clear" onclick="window._manuringClearSlot()" style="padding:6px 14px; background:#fce8e8; color:#c00; border:1px solid #f5c6c6; border-radius:4px; cursor:pointer; font-size:0.85rem">Clear</button>
            <button onclick="window._manuringCloseEdit()" style="padding:6px 14px; background:#f0f0f0; border:1px solid #ccc; border-radius:4px; cursor:pointer; font-size:0.85rem">Cancel</button>
            <button onclick="window._manuringConfirmEdit()" style="padding:6px 16px; background:#2c5f2e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:700; font-size:0.85rem">Save</button>
          </div>
        </div>
      </div>`;

    // Wire up fert-type "Other" toggle
    const fertSel = document.getElementById('me-fert');
    if (fertSel) {
      fertSel.onchange = () => {
        const ow = document.getElementById('me-other-wrap');
        if (ow) ow.style.display = fertSel.value === 'OTHER' ? 'block' : 'none';
      };
    }
  }

  // Edit state
  let _editCtx = null;

  window._manuringEditCell = function(year, phase, bk, month) {
    _editCtx = { year, phase, bk, month };
    const data = getManuringData();
    const phaseBlocks = (data[year] && data[year][phase] && data[year][phase].blocks) || [];
    const block = phaseBlocks.find(b => b.bk === bk);
    const existing = block && block.apps && block.apps[month] ? block.apps[month] : {};

    document.getElementById('manuring-edit-title').textContent =
      `${phase} — BK ${bk} — ${MONTH_LABELS[month] || month}`;
    document.getElementById('me-round').value  = existing.round || '';
    document.getElementById('me-bags').value   = existing.bags  || '';
    document.getElementById('me-mt').value     = existing.mt    || '';

    const fertSel = document.getElementById('me-fert');
    const knownFerts = Object.keys(FERT_COLORS);
    if (existing.fert && knownFerts.includes(existing.fert)) {
      fertSel.value = existing.fert;
      document.getElementById('me-other-wrap').style.display = 'none';
    } else if (existing.fert) {
      fertSel.value = 'OTHER';
      document.getElementById('me-fert-other').value = existing.fert;
      document.getElementById('me-other-wrap').style.display = 'block';
    } else {
      fertSel.value = '';
      document.getElementById('me-other-wrap').style.display = 'none';
    }

    const modal = document.getElementById('manuring-edit-modal');
    modal.style.display = 'flex';
    document.getElementById('me-bags').focus();
  };

  window._manuringCloseEdit = function() {
    const modal = document.getElementById('manuring-edit-modal');
    if (modal) modal.style.display = 'none';
    _editCtx = null;
  };

  window._manuringConfirmEdit = function() {
    if (!_editCtx) return;
    const { year, phase, bk, month } = _editCtx;

    const round = parseFloat(document.getElementById('me-round').value) || 0;
    const bags  = parseInt(document.getElementById('me-bags').value)   || 0;
    const mt    = parseFloat(document.getElementById('me-mt').value)   || 0;
    const fertSel = document.getElementById('me-fert');
    let fert = fertSel.value === 'OTHER'
      ? (document.getElementById('me-fert-other').value || '').trim()
      : fertSel.value;

    if (!window.state) return;
    if (!window.state.manuring) window.state.manuring = {};
    if (!window.state.manuring[year]) window.state.manuring[year] = JSON.parse(JSON.stringify(DEFAULT_2025));
    const phaseData = window.state.manuring[year][phase];
    if (!phaseData || !phaseData.blocks) return;
    const block = phaseData.blocks.find(b => b.bk === bk);
    if (!block) return;
    if (!block.apps) block.apps = {};

    if (bags === 0 && round === 0 && mt === 0) {
      delete block.apps[month];
    } else {
      block.apps[month] = { round, bags, mt, fert };
    }

    window._manuringCloseEdit();
    saveManuringToFirebase();
    renderManuring();
  };

  window._manuringClearSlot = function() {
    if (!_editCtx) return;
    const { year, phase, bk, month } = _editCtx;
    if (!window.state || !window.state.manuring || !window.state.manuring[year]) return;
    const phaseData = window.state.manuring[year][phase];
    if (!phaseData || !phaseData.blocks) return;
    const block = phaseData.blocks.find(b => b.bk === bk);
    if (block && block.apps) delete block.apps[month];
    window._manuringCloseEdit();
    saveManuringToFirebase();
    renderManuring();
  };

  window._manuringSetYear = function(year) {
    if (!window.state) return;
    window.state.manuringYear = year;
    // Ensure year data exists
    if (!window.state.manuring) window.state.manuring = {};
    if (!window.state.manuring[year]) {
      window.state.manuring[year] = year === '2025'
        ? JSON.parse(JSON.stringify(DEFAULT_2025))
        : createBlankYear();
    }
    renderManuring();
  };

  window._manuringAddYear = function() {
    const year = prompt('Enter new year (e.g. 2026):');
    if (!year || !/^\d{4}$/.test(year.trim())) return;
    const y = year.trim();
    if (!window.state) return;
    if (!window.state.manuring) window.state.manuring = {};
    if (window.state.manuring[y]) {
      alert(`Year ${y} already exists.`);
      return;
    }
    window.state.manuring[y] = createBlankYear();
    window.state.manuringYear = y;
    saveManuringToFirebase();
    renderManuring();
  };

  // ── ExcelJS lazy loader ──────────────────────────────────────────────────
  async function ensureExcelJS() {
    if (typeof window.ExcelJS !== 'undefined') return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('Failed to load ExcelJS'));
      document.head.appendChild(s);
    });
  }

  // ── Column layout ─────────────────────────────────────────────────────────
  // A=BK B=Ha C=NPalm D=ACTUAL E=label F=Jan G=Feb H=Mar I=Apr J=May K=Jun
  // L=Jul M=Aug N=Aug* O=Sep P=Oct Q=Nov R=Dec S=TotBags T=TotMt U=Remark
  const XL_MONTH_COL = {
    Jan:6, Feb:7, Mar:8, Apr:9, May:10, Jun:11,
    Jul:12, Aug:13, Aug2:14, Sep:15, Oct:16, Nov:17, Dec:18
  };
  const HEADER_DARK  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A3D1E' } };
  const HEADER_GREEN = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2C5F2E' } };
  const HEADER_GOLD  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFB8860B' } };
  const WHITE_FONT   = { color:{ argb:'FFFFFFFF' }, bold:true, size:9 };
  const THIN  = { style:'thin',   color:{ argb:'FF888888' } };
  const MED   = { style:'medium', color:{ argb:'FF444444' } };

  function xlBorder(top, bottom) {
    return { top: top?MED:THIN, bottom: bottom?MED:THIN, left:THIN, right:THIN };
  }

  function xlFertFill(fert) {
    const map = { MOP:'FF00B050', SATO:'FF0070C0', COM:'FFFF6600', SPEC:'FFFFFF00', ERP:'FF9B59B6', MIX:'FFE67E22' };
    const argb = map[fert];
    return argb ? { type:'pattern', pattern:'solid', fgColor:{ argb } } : null;
  }
  function xlFertFont(fert) {
    const light = fert === 'SPEC';
    return { color:{ argb: light ? 'FF000000' : 'FFFFFFFF' }, bold:true, size:8 };
  }

  function applyHeaderCell(cell, fill, value, align='center') {
    cell.value = value;
    cell.fill = fill;
    cell.font = WHITE_FONT;
    cell.alignment = { horizontal:align, vertical:'middle', wrapText:false };
  }

  function buildPhaseSheet(ws, phaseName, phaseData, year) {
    const blocks = (phaseData && phaseData.blocks) ? phaseData.blocks : [];
    const phaseYear = phaseName.replace('PHASE ','');

    // Column widths
    ws.getColumn(1).width  = 4.5;   // A BK
    ws.getColumn(2).width  = 6;     // B Ha
    ws.getColumn(3).width  = 8;     // C NPalm
    ws.getColumn(4).width  = 7;     // D ACTUAL
    ws.getColumn(5).width  = 10;    // E label
    for (let c = 6; c <= 18; c++) ws.getColumn(c).width = 8.5;  // F-R months
    ws.getColumn(19).width = 10;    // S TotBags
    ws.getColumn(20).width = 9;     // T TotMt
    ws.getColumn(21).width = 12;    // U Remark

    // ── Header rows ──────────────────────────────────────────────────────────
    ws.getRow(1).height = 6;
    ws.getRow(2).height = 6;

    // Row 3: company
    ws.mergeCells('A3:U3');
    ws.getRow(3).height = 18;
    const r3c = ws.getCell('A3');
    r3c.value = 'GLOBAL TAAT SDN BHD';
    r3c.font = { bold:true, size:12 };
    r3c.alignment = { horizontal:'center', vertical:'middle' };

    // Row 4: title
    ws.mergeCells('A4:U4');
    ws.getRow(4).height = 16;
    ws.getCell('A4').value = 'ACTUAL FERTILIZER APPLICATION';
    ws.getCell('A4').font = { bold:true, size:11 };
    ws.getCell('A4').alignment = { horizontal:'center', vertical:'middle' };

    // Row 5: phase + year
    ws.mergeCells('A5:U5');
    ws.getRow(5).height = 16;
    ws.getCell('A5').value = `${phaseName}  —  ${year}`;
    ws.getCell('A5').font = { bold:true, size:11 };
    ws.getCell('A5').alignment = { horizontal:'center', vertical:'middle' };

    ws.getRow(6).height = 6;
    ws.getRow(7).height = 6;

    // Row 8: phase identifier
    ws.mergeCells('A8:U8');
    ws.getRow(8).height = 16;
    ws.getCell('A8').value = `PHASE : ${phaseYear}`;
    ws.getCell('A8').font = { bold:true, size:10 };

    // Row 9: main column headers
    ws.getRow(9).height = 22;
    const hdr9cells = [
      [1,'BK'],[2,'HA'],[3,'NO. PALM'],[4,'PARTICULAR'],[5,'']
    ];
    for (const [c,v] of hdr9cells) applyHeaderCell(ws.getRow(9).getCell(c), HEADER_DARK, v);
    ws.mergeCells('F9:R9');
    applyHeaderCell(ws.getCell('F9'), HEADER_DARK, 'MONTH');
    applyHeaderCell(ws.getRow(9).getCell(19), HEADER_DARK, 'TOTAL');
    applyHeaderCell(ws.getRow(9).getCell(20), HEADER_DARK, 'MT.');
    applyHeaderCell(ws.getRow(9).getCell(21), HEADER_DARK, 'REMARK');

    // Row 10: spacer
    ws.getRow(10).height = 6;

    // Row 11: month names
    ws.getRow(11).height = 18;
    const monthHdrs = [
      [6,'JAN'],[7,'FEB'],[8,'MAR'],[9,'APR'],[10,'MAY'],[11,'JUN'],
      [12,'JUL'],[15,'SEP'],[16,'OCT'],[17,'NOV'],[18,'DEC']
    ];
    ws.mergeCells('M11:N11');
    applyHeaderCell(ws.getCell('M11'), HEADER_GREEN, 'AUG');
    for (const [c,v] of monthHdrs) applyHeaderCell(ws.getRow(11).getCell(c), HEADER_GREEN, v);
    applyHeaderCell(ws.getRow(11).getCell(19), HEADER_GOLD, 'TOTAL');
    applyHeaderCell(ws.getRow(11).getCell(20), HEADER_GOLD, 'MT.');

    // ── Block data rows ───────────────────────────────────────────────────────
    let rowIdx = 12;

    for (const block of blocks) {
      const apps = block.apps || {};
      const r0 = rowIdx;

      let totBags = 0, totMt = 0, totRounds = 0;
      for (const v of Object.values(apps)) {
        totBags   += v.bags  || 0;
        totMt     += v.mt    || 0;
        totRounds += v.round || 0;
      }
      totMt = Math.round(totMt * 1000) / 1000;

      // Set row heights
      for (let r = r0; r <= r0+3; r++) ws.getRow(r).height = 18;

      // Merge static columns across 4 rows
      ws.mergeCells(r0,1, r0+3,1);   // A: BK
      ws.mergeCells(r0,2, r0+3,2);   // B: Ha
      ws.mergeCells(r0,3, r0+3,3);   // C: NPalm
      ws.mergeCells(r0,4, r0+3,4);   // D: ACTUAL

      // BK, Ha, NPalm, ACTUAL (set on first merged cell)
      const cBK   = ws.getCell(r0, 1);
      const cHa   = ws.getCell(r0, 2);
      const cNP   = ws.getCell(r0, 3);
      const cAct  = ws.getCell(r0, 4);

      cBK.value = block.bk;
      cBK.font = { bold:true, size:9 };
      cBK.alignment = { horizontal:'center', vertical:'middle' };
      cBK.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF5F5F5' } };

      cHa.value = block.ha;
      cHa.alignment = { horizontal:'right', vertical:'middle' };
      cHa.numFmt = '0.00';

      cNP.value = block.npalm || 0;
      cNP.alignment = { horizontal:'right', vertical:'middle' };
      cNP.numFmt = '#,##0';

      cAct.value = 'ACTUAL';
      cAct.alignment = { horizontal:'center', vertical:'middle' };
      cAct.font = { size:8 };

      // Row labels in col E
      const rowLabels = ['Kg/pokok','No. Beg','Mt','Fert.Type'];
      for (let i = 0; i < 4; i++) {
        const c = ws.getCell(r0+i, 5);
        c.value = rowLabels[i];
        c.font = { size:8, italic: i === 3 };
        c.alignment = { horizontal:'left', vertical:'middle' };
      }

      // Totals in col S (bags), T (mt)
      if (totRounds > 0) { const c = ws.getCell(r0, 19); c.value = totRounds; c.numFmt = '0.0#'; c.alignment={horizontal:'center',vertical:'middle'}; c.fill=HEADER_GOLD; c.font={bold:true,size:9,color:{argb:'FFFFFFFF'}}; }
      if (totBags   > 0) { const c = ws.getCell(r0+1,19); c.value = totBags;  c.numFmt = '#,##0'; c.alignment={horizontal:'center',vertical:'middle'}; c.fill=HEADER_GOLD; c.font={bold:true,size:9,color:{argb:'FFFFFFFF'}}; }
      if (totMt     > 0) { const c = ws.getCell(r0+2,20); c.value = totMt;    c.numFmt = '0.000'; c.alignment={horizontal:'center',vertical:'middle'}; c.fill=HEADER_GOLD; c.font={bold:true,size:9,color:{argb:'FFFFFFFF'}}; }

      // Month data
      const hasAug  = apps['Aug']  && apps['Aug'].bags  > 0;
      const hasAug2 = apps['Aug2'] && apps['Aug2'].bags > 0;

      // Merge Aug+Aug2 cols when only one is used
      if (!hasAug && !hasAug2) {
        for (let i = 0; i < 4; i++) ws.mergeCells(r0+i, 13, r0+i, 14);
      } else if (hasAug && !hasAug2) {
        for (let i = 0; i < 4; i++) ws.mergeCells(r0+i, 13, r0+i, 14);
      }

      for (const [month, colNum] of Object.entries(XL_MONTH_COL)) {
        const app = apps[month];
        if (!app || !app.bags) continue;

        if (app.round) {
          const c = ws.getCell(r0, colNum);
          c.value = app.round; c.numFmt = '0.0#';
          c.alignment = { horizontal:'center', vertical:'middle' }; c.font = { size:9 };
        }
        if (app.bags) {
          const c = ws.getCell(r0+1, colNum);
          c.value = app.bags; c.numFmt = '#,##0';
          c.alignment = { horizontal:'center', vertical:'middle' }; c.font = { size:9 };
        }
        if (app.mt) {
          const c = ws.getCell(r0+2, colNum);
          c.value = app.mt; c.numFmt = '0.000';
          c.alignment = { horizontal:'center', vertical:'middle' }; c.font = { size:9 };
        }
        // Fert type cell with color
        const fc = ws.getCell(r0+3, colNum);
        fc.value = app.fert || '';
        fc.alignment = { horizontal:'center', vertical:'middle' };
        const fill = xlFertFill(app.fert);
        if (fill) { fc.fill = fill; fc.font = xlFertFont(app.fert); }
        else fc.font = { size:8 };
      }

      // Borders for all 4 rows, all 21 cols
      for (let r = r0; r <= r0+3; r++) {
        for (let c = 1; c <= 21; c++) {
          const cell = ws.getCell(r, c);
          cell.border = xlBorder(r === r0, r === r0+3);
        }
      }

      rowIdx += 4;
    }

    // "Application Round" summary row at end
    if (blocks.length > 0) {
      ws.mergeCells(`A${rowIdx}:R${rowIdx}`);
      ws.getCell(rowIdx, 1).value = 'Application Round';
      ws.getCell(rowIdx, 1).alignment = { horizontal:'right' };
      ws.getCell(rowIdx, 1).font = { italic:true, size:9, color:{ argb:'FF666666' } };
      ws.getRow(rowIdx).height = 16;
    }
  }

  function buildSummarySheet(ws, allYearData, year) {
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 30;
    for (let c = 3; c <= 7; c++) ws.getColumn(c).width = 14;

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = `MANURING SUMMARY — ${year}`;
    ws.getCell('A1').font = { bold:true, size:13 };
    ws.getCell('A1').alignment = { horizontal:'center' };
    ws.getRow(1).height = 24;

    ws.getRow(3).height = 18;
    const hdrs = ['Phase','','Blocks','Total Ha','Total Bags','Total Mt'];
    for (let i = 0; i < hdrs.length; i++) {
      const c = ws.getCell(3, i+1);
      c.value = hdrs[i];
      c.fill = HEADER_DARK; c.font = WHITE_FONT;
      c.alignment = { horizontal:'center', vertical:'middle' };
    }

    let row = 4;
    let grandBags = 0, grandMt = 0, grandHa = 0;

    for (const phaseName of PHASE_NAMES) {
      const pd = allYearData[phaseName] || { blocks:[] };
      const blocks = pd.blocks || [];
      let phBags = 0, phMt = 0, phHa = 0;
      for (const b of blocks) {
        phHa += b.ha || 0;
        for (const v of Object.values(b.apps || {})) { phBags += v.bags||0; phMt += v.mt||0; }
      }
      phMt = Math.round(phMt*1000)/1000;
      phHa = Math.round(phHa*100)/100;

      ws.getRow(row).height = 18;
      ws.getCell(row,1).value = phaseName;
      ws.getCell(row,1).font = { bold:true, size:9 };
      ws.getCell(row,3).value = blocks.length;
      ws.getCell(row,4).value = phHa;     ws.getCell(row,4).numFmt = '0.00';
      ws.getCell(row,5).value = phBags;   ws.getCell(row,5).numFmt = '#,##0';
      ws.getCell(row,6).value = phMt;     ws.getCell(row,6).numFmt = '0.000';
      for (let c=1;c<=6;c++) {
        ws.getCell(row,c).border = { top:THIN, bottom:THIN, left:THIN, right:THIN };
        ws.getCell(row,c).alignment = { horizontal:'center', vertical:'middle' };
      }
      ws.getCell(row,1).alignment.horizontal = 'left';

      grandBags += phBags; grandMt += phMt; grandHa += phHa;
      row++;
    }

    // Grand total
    ws.getRow(row).height = 20;
    ws.getCell(row,1).value = 'GRAND TOTAL';
    ws.getCell(row,1).font = { bold:true, size:9 };
    ws.getCell(row,4).value = Math.round(grandHa*100)/100; ws.getCell(row,4).numFmt='0.00';
    ws.getCell(row,5).value = grandBags; ws.getCell(row,5).numFmt='#,##0';
    ws.getCell(row,6).value = Math.round(grandMt*1000)/1000; ws.getCell(row,6).numFmt='0.000';
    for (let c=1;c<=6;c++) {
      ws.getCell(row,c).fill = HEADER_GOLD;
      ws.getCell(row,c).font = { bold:true, size:9, color:{ argb:'FFFFFFFF' } };
      ws.getCell(row,c).border = { top:MED, bottom:MED, left:THIN, right:THIN };
      ws.getCell(row,c).alignment = { horizontal:'center', vertical:'middle' };
    }
    ws.getCell(row,1).alignment.horizontal = 'left';
  }

  window._downloadManuringExcel = async function(overrideYear) {
    const btn = document.getElementById('manuring-dl-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...'; }
    try {
      await ensureExcelJS();
      const WB = new window.ExcelJS.Workbook();
      WB.creator = 'Monthly Harvesting Report';
      WB.created = new Date();

      const year = overrideYear || getCurrentYear();
      const data = getManuringData();
      if (!data['2025'] && typeof window._manuringDefault2025 !== 'undefined') {
        data['2025'] = JSON.parse(JSON.stringify(window._manuringDefault2025));
      }
      const yearData = data[year] || {};

      // Summary sheet first
      const summaryWs = WB.addWorksheet('Summary');
      buildSummarySheet(summaryWs, yearData, year);

      // Phase sheets
      for (const phaseName of PHASE_NAMES) {
        const ws = WB.addWorksheet(phaseName);
        buildPhaseSheet(ws, phaseName, yearData[phaseName] || { blocks:[] }, year);
      }

      const buf = await WB.xlsx.writeBuffer();
      const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Manuring Report ${year}.xlsx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) {
      alert('Failed to generate Excel: ' + e.message);
      console.error(e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Excel'; }
    }
  };

  window.renderManuringReport = renderManuring;
  window._manuringDefault2025 = DEFAULT_2025;

})();
