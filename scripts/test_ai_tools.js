/* Harness for the AI Assist tool layer.
 * Loads render_ai_assist.js in a fake browser global, feeds it a state object in
 * the exact shape render_ytd_report.js reads, and checks the pivot's numbers
 * against an INDEPENDENT re-implementation of the YTD traversal.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- minimal browser globals -------------------------------------------------
global.window = {};
global.document = { createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.location = { hostname: 'localhost' };

require(path.join(ROOT, 'render_report_builder.js'));   // provides window.rbPivot
require(path.join(ROOT, 'render_ai_assist.js'));
const { runTool } = global.window._aiTools;

// --- fixture in the documented shape ----------------------------------------
// state.performance[year][Mon][gang].blocks[blockId] = {r1..r4}
// Edge cases baked in on purpose:
//   * 'gangAssignments' sibling key that must never be treated as a gang
//   * a block (39) worked by TWO gangs in the same month
//   * numeric strings and blanks, as the grid produces
//   * a month with no data at all (MAR)
const state = {
  performance: {
    '2026': {
      Jan: {
        gangAssignments: { '1': 'Wenderlinus Gang', '39': 'Darso Gang' },
        'Wenderlinus Gang': { blocks: {
          '1':  { r1: 10, r2: 5,   r3: 0, r4: 0 },
          '2':  { r1: '7.5', r2: '', r3: 0, r4: 0 },
        } },
        'Darso Gang': { blocks: {
          '39': { r1: 20, r2: 0, r3: 0, r4: 0 },
        } },
      },
      Feb: {
        gangAssignments: { '1': 'Wenderlinus Gang' },
        'Wenderlinus Gang': { blocks: {
          '1':  { r1: 12, r2: 6, r3: 1, r4: 0 },
        } },
        'Darso Gang': { blocks: {
          '39': { r1: 8,  r2: 2, r3: 0, r4: 0 },
          '40': { r1: 3,  r2: 0, r3: 0, r4: 0.5 },
        } },
        // same block under a second gang — must be counted once per (gang, block)
        'Relief Gang': { blocks: {
          '39': { r1: 4, r2: 0, r3: 0, r4: 0 },
        } },
      },
      Mar: { gangAssignments: {} },
    },
  },
  wages: {}, wagesLedger: {}, wagesEmployees: { list: [] }, reports: {},
};
global.window.state = state;

// --- independent reference sum (mirrors render_ytd_report.js's traversal) ----
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const key = (m) => m.charAt(0) + m.slice(1).toLowerCase();
function referenceTotal(year, months) {
  let sum = 0;
  (months || MONTHS).forEach((mon) => {
    const md = state.performance[year][key(mon)];
    if (!md) return;
    Object.keys(md).forEach((g) => {
      if (g === 'gangAssignments') return;
      const blocks = (md[g] && md[g].blocks) || {};
      Object.keys(blocks).forEach((b) => {
        const c = blocks[b];
        sum += (parseFloat(c.r1)||0)+(parseFloat(c.r2)||0)+(parseFloat(c.r3)||0)+(parseFloat(c.r4)||0);
      });
    });
  });
  return Math.round(sum * 100) / 100;
}

// --- assertions --------------------------------------------------------------
let pass = 0, fail = 0;
// Read a cell by column NAME so the test can't drift from the row layout.
const mtOf = (res, rowIdx) => res.rows[rowIdx][res.columns.indexOf('FFB (MT)')];
const sumMt = (res) => Math.round(res.rows.reduce((s, r) => s + r[res.columns.indexOf('FFB (MT)')], 0) * 100) / 100;

const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

(async () => {
  console.log('\n── query_ffb_production ───────────────────────────────────');

  const byMonth = await runTool('query_ffb_production', { year: '2026', group_by: 'month' });
  console.log('  rows:', JSON.stringify(byMonth.rows));
  eq('month rows are in calendar order', byMonth.rows.map(r => r[0]), ['JAN', 'FEB']);
  eq('JAN total = (10+5)+7.5+20', mtOf(byMonth, 0), 42.5);
  eq('FEB total = 19+(10+3.5)+4', mtOf(byMonth, 1), 36.5);
  eq('year total matches independent YTD traversal', byMonth.total_mt, referenceTotal('2026'));
  eq('empty month (MAR) omitted, not zero-filled', byMonth.rows.length, 2);

  const byGang = await runTool('query_ffb_production', { year: '2026', group_by: 'gang' });
  console.log('  rows:', JSON.stringify(byGang.rows));
  eq('gangAssignments never becomes a gang', byGang.rows.some(r => r[0] === 'gangAssignments'), false);
  eq('gang split sums to the same year total', sumMt(byGang), byMonth.total_mt);
  eq('gang grouping sorted by size desc', byGang.rows.map(r => r[1]), [...byGang.rows.map(r => r[1])].sort((a,b)=>b-a));

  const byBlock = await runTool('query_ffb_production', { year: '2026', group_by: 'block' });
  console.log('  rows:', JSON.stringify(byBlock.rows));
  const blk39 = byBlock.rows.find(r => r[0] === '39');
  eq('block 39 across two gangs = 20+10+4', blk39[byBlock.columns.indexOf('FFB (MT)')], 34);
  eq('block split sums to the same year total', sumMt(byBlock), byMonth.total_mt);

  const r1only = await runTool('query_ffb_production', { year: '2026', group_by: 'month', rounds: [1] });
  eq('rounds filter: JAN r1 only = 10+7.5+20', mtOf(r1only, 0), 37.5);

  const oneGang = await runTool('query_ffb_production', { year: '2026', group_by: 'month', gangs: ['Darso Gang'] });
  eq('gang filter: Darso FEB = 8+2+3+0.5', mtOf(oneGang, 1), 13.5);

  const q2 = await runTool('query_ffb_production', { year: '2026', group_by: 'month', months: ['FEB'] });
  eq('month filter total matches reference', q2.total_mt, referenceTotal('2026', ['FEB']));

  const monthBlock = await runTool('query_ffb_production', { year: '2026', group_by: 'month_block' });
  eq('month_block sums to year total', sumMt(monthBlock), byMonth.total_mt);

  console.log('\n── error paths ───────────────────────────────────────────');
  const badYear = await runTool('query_ffb_production', { year: '1999', group_by: 'month' });
  eq('unknown year returns an error, not a crash', !!badYear.error, true);
  const badFilter = await runTool('query_ffb_production', { year: '2026', group_by: 'month', blocks: ['999'] });
  eq('no-match filter returns an error, not empty rows', !!badFilter.error, true);
  const noEmp = await runTool('query_employees', { group_by: 'agent' });
  eq('empty employee master returns a clear error', !!noEmp.error, true);

  console.log('\n── result cache (what Excel is built from) ───────────────');
  eq('query returns a result_id', typeof byMonth.result_id, 'string');
  const cached = global.window._aiTools.results()[byMonth.result_id];
  eq('cached rows are identical to returned rows', cached.rows, byMonth.rows);

  console.log('\n── get_data_scope ────────────────────────────────────────');
  const scope = await runTool('get_data_scope', {});
  console.log('  ', JSON.stringify(scope.ffb_production));
  eq('scope reports only months with production', scope.ffb_production.detail['2026'].months_with_production, ['JAN','FEB']);
  eq('scope lists gangs', scope.ffb_production.detail['2026'].gangs, ['Darso Gang','Relief Gang','Wenderlinus Gang']);

  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
