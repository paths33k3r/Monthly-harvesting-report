// Generates a Tree Logs importable workbook for the 10 × 2022 invoices.
// Data was transcribed by reading each scanned invoice PDF (tools/invoice_mapping/2022/).
// Each invoice = one DETAILED delivery batch. These legacy invoices are organised by
// SPECIES (no category column), so we set category = species per line — this reproduces
// the invoice's natural per-species grouping in the Tree Logs detail drilldown.
//
// Sheet layout mirrors the module's own export (tlBuildBatchSheet) so the importer
// (tlParseKuSheet) round-trips it exactly:
//   A1 company · A5 "BATCH: <no>" · E5 delivery date (ISO) · row 7 header · rows 8+ data
//   header: SPECIES CATEGORY | SPECIES | GRADE | QUANTITY (PCS) | VOLUME (MT)
//
// Run: node tools/invoice_mapping/gen_2022_import.js

const ExcelJS = require('exceljs');
const path = require('path');

const COMPANY = 'POLIMA FOREST BINTULU SDN BHD';

// invNo, ISO delivery date, printed Total Payable (RM), and lines [species, grade, qtyPcs, volumeMT]
const INVOICES = [
  { no: 'PFB202205001', date: '2022-05-15', total: 84740.25, lines: [
    ['ACMG','SSG',9,4.518],['ACMG','BSG',14,3.047],['MLH','SSG',35,14.257],['MLH','BSG',231,50.967],
    ['MRTX','SSG',2,0.965],['MRTX','BSG',42,10.239],['RESAK','SSG',2,0.850],['RESAK','BSG',2,0.597],
    ['UBAH','SG',1,0.483],['UBAH','SSG',8,3.808],['UBAH','BSG',56,11.082],
  ]},
  { no: 'PFB202208001', date: '2022-08-15', total: 84363.63, lines: [
    ['ACMG','SSG',1,0.442],['ACMG','BSG',23,4.846],['EMPN','SSG',5,2.900],['EMPN','BSG',14,3.353],
    ['MEDANG','SG',1,0.392],['MEDANG','SSG',2,1.140],['MEDANG','BSG',68,15.563],['MLH','SSG',7,4.076],
    ['MLH','BSG',55,14.166],['MRTX','SSG',5,2.233],['MRTX','BSG',59,14.479],['NYTO','SSG',3,1.878],
    ['NYTO','BSG',12,2.881],['REHU','BSG',1,0.293],['RESAK','SSG',2,0.856],['RESAK','BSG',13,3.105],
    ['UBAH','SSG',14,8.002],['UBAH','BSG',79,18.910],
  ]},
  { no: 'PFB202209001', date: '2022-09-01', total: 51075.67, lines: [
    ['ACMG','SSG',3,1.834],['ACMG','BSG',92,18.067],['EMPN','SSG',2,1.152],['EMPN','BSG',3,0.700],
    ['MEDANG','BSG',16,3.838],['MLH','SSG',1,0.793],['MLH','BSG',24,6.007],['MRTX','SSG',2,1.389],
    ['MRTX','BSG',30,7.048],['NYTO','BSG',4,1.072],['RESAK','BSG',3,0.574],['UBAH','SSG',4,2.563],
    ['UBAH','BSG',58,16.181],
  ]},
  { no: 'PFB202209002', date: '2022-09-06', total: 30391.03, lines: [
    ['ACMG','BSG',23,3.898],['MEDANG','BSG',9,1.642],['MLH','BSG',16,3.811],['MRTX','SSG',1,0.651],
    ['MRTX','BSG',33,7.929],['NYTO','BSG',7,1.809],['RESAK','BSG',18,3.839],['UBAH','BSG',50,12.588],
  ]},
  { no: 'PFB202209003', date: '2022-09-08', total: 85136.80, lines: [
    ['ACMG','SSG',1,0.468],['ACMG','BSG',36,8.056],['EMPN','BSG',4,1.104],['MEDANG','BSG',37,6.931],
    ['MLH','SSG',2,1.161],['MLH','BSG',39,8.177],['MRTX','SG',1,0.838],['MRTX','SSG',8,4.057],
    ['MRTX','BSG',104,26.304],['NYTO','BSG',3,0.689],['REHU','REG',1,1.465],['REHU','BSG',2,0.622],
    ['RESAK','SSG',2,1.049],['RESAK','BSG',33,8.584],['UBAH','SSG',7,3.776],['UBAH','BSG',101,24.926],
  ]},
  { no: 'PFB202209006', date: '2022-09-23', total: 90471.52, lines: [
    ['ACMG','BSG',1,0.225],['EMPN','SSG',1,0.614],['EMPN','BSG',9,1.576],['MEDANG','BSG',63,11.282],
    ['MLH','SSG',1,0.505],['MLH','BSG',36,7.856],['MRTX','SSG',9,4.827],['MRTX','BSG',148,35.468],
    ['NYTO','BSG',6,1.536],['REHU','BSG',2,0.964],['RESAK','BSG',44,8.632],['UBAH','SSG',5,2.730],
    ['UBAH','BSG',119,27.598],
  ]},
  { no: 'PFB202210001', date: '2022-10-06', total: 94313.67, lines: [
    ['ACMG','BSG',17,4.048],['EMPN','SSG',1,0.544],['EMPN','BSG',11,2.585],['MEDANG','BSG',68,12.445],
    ['MLH','SSG',10,5.758],['MLH','BSG',79,19.005],['MRTX','SG',1,1.106],['MRTX','SSG',14,7.367],
    ['MRTX','BSG',77,19.227],['NYTO','SSG',1,0.478],['NYTO','BSG',16,3.235],['REHU','SSG',2,1.234],
    ['REHU','BSG',1,0.529],['RESAK','SSG',2,1.257],['RESAK','BSG',19,4.592],['UBAH','SSG',11,6.871],
    ['UBAH','BSG',75,18.740],
  ]},
  { no: 'PFB202211005', date: '2022-11-30', total: 98989.58, lines: [
    ['ACMG','BSG',10,1.702],['EMPN','BSG',12,2.760],['KERANJI','BSG',4,0.712],['MEDANG','SSG',1,0.310],
    ['MEDANG','BSG',71,11.394],['MLH','SSG',3,2.088],['MLH','BSG',57,10.999],['MRTX','SSG',3,0.960],
    ['MRTX','BSG',159,36.505],['NYTO','BSG',17,3.633],['REHU','BSG',3,1.125],['RESAK','BSG',77,16.045],
    ['SLGB','BSG',7,2.044],['UBAH','SG',1,0.879],['UBAH','SSG',3,1.061],['UBAH','BSG',109,23.339],
  ]},
  { no: 'PFB202212001', date: '2022-12-15', total: 107520.21, lines: [
    ['ACMG','BSG',2,0.216],['EMPN','SSG',2,0.939],['EMPN','BSG',18,4.164],['KERANJI','SSG',1,0.368],
    ['KERANJI','BSG',5,1.000],['MEDANG','BSG',77,12.947],['MLH','SSG',1,0.579],['MLH','BSG',82,15.297],
    ['MRTX','REG',1,0.843],['MRTX','SSG',9,5.394],['MRTX','BSG',166,33.663],['NGILAS','BSG',1,0.326],
    ['NYTO','BSG',25,4.637],['REHU','SSG',1,0.740],['REHU','BSG',9,1.917],['RESAK','BSG',44,8.805],
    ['SLGB','BSG',39,8.106],['UBAH','SG',2,1.781],['UBAH','SSG',6,3.797],['UBAH','BSG',94,18.665],
  ]},
  { no: 'PFB202212004', date: '2022-12-21', total: 54840.37, lines: [
    ['EMPN','BSG',8,1.596],['KERANJI','BSG',6,1.203],['MEDANG','SSG',1,0.739],['MEDANG','BSG',31,4.782],
    ['MLH','BSG',49,9.177],['MRTX','SSG',2,1.366],['MRTX','BSG',91,17.273],['NGILAS','BSG',8,2.002],
    ['NYTO','SSG',1,0.695],['NYTO','BSG',12,2.881],['REHU','SSG',1,0.581],['REHU','BSG',6,1.024],
    ['RESAK','BSG',37,6.436],['SLGB','BSG',14,3.406],['UBAH','BSG',55,9.823],
  ]},
];

const HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
const BORDER = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
const round3 = (n) => Math.round(n * 1000) / 1000;

async function main() {
  const wb = new ExcelJS.Workbook();

  // Divider sheet — forces year 2022 regardless of date parsing (belt & suspenders).
  const yws = wb.addWorksheet('YEAR 2022');
  yws.getCell('A1').value = 'YEAR 2022';

  let grandQty = 0, grandVol = 0;
  console.log('Invoice         Date         Lines  Qty(pcs)  Volume(MT)   Total(RM)');
  console.log('-----------------------------------------------------------------------');

  for (const inv of INVOICES) {
    const ws = wb.addWorksheet(inv.no);
    ws.columns = [{width:18},{width:14},{width:10},{width:16},{width:14}];
    ws.mergeCells('A1:E1'); ws.getCell('A1').value = COMPANY; ws.getCell('A1').font = {bold:true}; ws.getCell('A1').alignment = {horizontal:'center'};
    ws.mergeCells('A3:E3'); ws.getCell('A3').value = 'SUMMARIZED LOGS SPECIES'; ws.getCell('A3').font = {bold:true}; ws.getCell('A3').alignment = {horizontal:'center'};
    ws.getCell('A5').value = 'BATCH: ' + inv.no; ws.getCell('A5').font = {bold:true};
    ws.getCell('D5').value = 'DELIVERY COMPLETED DATE:'; ws.getCell('D5').font = {bold:true};
    ws.getCell('E5').value = inv.date;   // ISO string — tlToISO parses it, timezone-proof

    const hr = 7;
    ['SPECIES CATEGORY','SPECIES','GRADE','QUANTITY (PCS)','VOLUME (MT)'].forEach((h,i) => {
      const c = ws.getCell(hr, i+1);
      c.value = h; c.font = {bold:true, color:{argb:'FFF8FAFC'}}; c.fill = HDR_FILL;
      c.alignment = {horizontal:'center', wrapText:true}; c.border = BORDER;
    });

    let r = hr + 1, qSum = 0, vSum = 0;
    for (const [species, grade, qty, vol] of inv.lines) {
      ws.getCell(r,1).value = species;   // category = species (legacy species-based invoice)
      ws.getCell(r,2).value = species;
      ws.getCell(r,3).value = grade;
      ws.getCell(r,4).value = qty;
      ws.getCell(r,5).value = vol; ws.getCell(r,5).numFmt = '#,##0.000';
      for (let c = 1; c <= 5; c++) ws.getCell(r,c).border = BORDER;
      qSum += qty; vSum += vol; r++;
    }
    // Grand total row (importer skips it — col C contains "GRAND TOTAL")
    ws.getCell(r,3).value = 'GRAND TOTAL:'; ws.getCell(r,3).font = {bold:true};
    ws.getCell(r,4).value = qSum; ws.getCell(r,4).font = {bold:true};
    ws.getCell(r,5).value = round3(vSum); ws.getCell(r,5).numFmt = '#,##0.000'; ws.getCell(r,5).font = {bold:true};

    grandQty += qSum; grandVol += vSum;
    console.log(
      inv.no.padEnd(15) + inv.date.padEnd(13) +
      String(inv.lines.length).padStart(4) + '  ' +
      String(qSum).padStart(8) + '  ' +
      round3(vSum).toFixed(3).padStart(10) + '  ' +
      inv.total.toFixed(2).padStart(11)
    );
  }

  console.log('-----------------------------------------------------------------------');
  console.log('TOTAL'.padEnd(28) + String(INVOICES.length).padStart(4) + ' batches  ' +
    String(grandQty).padStart(6) + '  ' + round3(grandVol).toFixed(3).padStart(10));

  const out = path.join(__dirname, '..', '..', 'Tree_Logs_2022_import.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('\nWrote:', path.resolve(out));
}

main().catch(e => { console.error(e); process.exit(1); });
