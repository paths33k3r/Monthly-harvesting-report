const XLSX = require('xlsx');
const fs = require('fs');

const aoa = [
    ["BLK", "AGE (MTH)", "HARVEST YR.", "MT/HA/YR", "MT/HA/MTH", "HA", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
    ["SUBTOTAL OP2010"],
    ["1", "168-180", 11.00, 20.00, 1.67, 53.09, 62, 72, 70, 90, 80, 70, 71, 81, 91, 100, 100, 100],
    ["2", "168-180", 11.00, 20.00, 1.67, 60.27, 68, 81, 81, 104, 92, 81, 81, 92, 104, 110, 110, 110],
    ["SUBTOTAL OP2011"],
    ["3A", "156-168", 12.00, 21.00, 1.75, 45.00, 80, 85, 90, 95, 90, 85, 80, 85, 90, 95, 90, 85]
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(aoa);

XLSX.utils.book_append_sheet(wb, ws, "FFB_Budget");
const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

let templatesCode = fs.readFileSync('templates.js', 'utf8');

// Replace the ffbBudget part
templatesCode = templatesCode.replace(/ffbBudget:\s*"(.*?)"/, `ffbBudget: "${b64}"`);

fs.writeFileSync('templates.js', templatesCode);
console.log("Updated templates.js with new FFB budget layout, preserved others.");
