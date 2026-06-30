# Invoice → batch mapping (provenance)

How the Tree Logs **invoice column** links were built. The customer's invoices
(`Desktop/New folder/Invoice/<year>/PFB*.pdf`) are **scanned image PDFs with no
text layer**, so they can't be parsed in the browser. The mapping was built
offline once and embedded in `render_tree_logs.js` as `TL_INVOICE_MAP`.

## Files
- `invoices_ocr.json` / `invoices_old.json` — every invoice transcribed by hand
  (invoice no, date, total, and either embedded batch `codes` or the
  category/grade/qty/volume `lines`). `mode`: `code` (codes printed on invoice),
  `cat` (category-based lines), `sp` (older species-based lines), `archive`
  (orphan, no batch in system).
- `parse_batches.py` — reads `1. Logs Species Summary.xlsx` and computes each
  batch's per-(category,grade) and per-(species,grade) sub-totals → `batches.json`.
- `build_mapping.py` — matches each invoice to its batch(es): exact codes first,
  then content sub-total match (single batch or subset-sum for aggregated
  invoices) → `invoice_batch_map.json`.

## Result
**105 / 105 batches linked, zero mismatches.** 25 invoices link to batches; 5 are
orphan-archive (pre-Aug-2023 deliveries not in the system). The 10 × 2022
invoices have no batch in the system and are auto-archived from their filename at
import time (no OCR needed).

## Regenerate
```bash
cd tools/invoice_mapping
python parse_batches.py     # needs openpyxl + the source workbook path inside the script
python build_mapping.py     # writes invoice_batch_map.json
```
Then copy the compact map into `TL_INVOICE_MAP` in `render_tree_logs.js`.
