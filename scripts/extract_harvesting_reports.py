import argparse
import datetime
import json
import pathlib
import re
import zipfile
import xml.etree.ElementTree as ET

def parse_shared_strings(z):
    try:
        with z.open('xl/sharedStrings.xml') as f:
            tree = ET.fromstring(f.read())
    except KeyError:
        return []
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    strings = []
    for si in tree.findall(ns + 'si'):
        text_el = si.find(ns + 't')
        if text_el is not None:
            strings.append(text_el.text)
        else:
            strings.append('')
    return strings

def col_to_index(col):
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx - 1

def build_sheet_paths(z):
    workbook = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rel_map = {rel.get('Id'): rel.get('Target') for rel in rels.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship')}
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    sheet_map = {}
    for sheet in workbook.findall('.//ns:sheet', {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}):
        name = sheet.get('name')
        rid = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        if not rid:
            continue
        target = rel_map.get(rid)
        if target:
            sheet_map[name] = pathlib.PurePosixPath('xl') / target
    return sheet_map

def read_sheet(z, path, shared_strings):
    tree = ET.fromstring(z.read(str(path)))
    rows = []
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for row in tree.findall('ns:sheetData/ns:row', ns):
        row_values = {}
        for cell in row.findall('ns:c', ns):
            r = cell.get('r')
            if not r:
                continue
            col_ref = re.sub(r'\d', '', r)
            idx = col_to_index(col_ref)
            v_el = cell.find('ns:v', ns)
            if v_el is None:
                continue
            val = v_el.text or ''
            if cell.get('t') == 's':
                try:
                    val = shared_strings[int(val)]
                except (ValueError, IndexError):
                    val = ''
            row_values[idx] = val
        if row_values:
            max_idx = max(row_values.keys())
            row_array = [row_values.get(i, '') for i in range(max_idx + 1)]
            rows.append(row_array)
    return rows

def sanitize_rows(rows):
    return [row for row in rows if any(str(cell).strip() for cell in row)]

def extract_report(rows, title=None):
    return {
        'title': title or rows[0][0] if rows and rows[0] else '',
        'rowCount': len(rows),
        'rows': rows,
    }

def main():
    parser = argparse.ArgumentParser(description='Extract harvesting performance reports from Excel')
    parser.add_argument('--source', '-s', type=pathlib.Path, required=True, help='Path to Excel workbook')
    parser.add_argument('--output', '-o', type=pathlib.Path, default=pathlib.Path('harvesting_performance_reports.json'), help='Output JSON file')
    parser.add_argument('--ytd-sheet', default='OVERALL BY GANG COMPARISON YTD2', help='Sheet name for YTD report')
    parser.add_argument('--comparison-sheet', default='OVERALL BY GANG COMPARISON V3', help='Sheet name for month comparison report')
    args = parser.parse_args()

    with zipfile.ZipFile(args.source) as z:
        sheet_paths = build_sheet_paths(z)
        shared_strings = parse_shared_strings(z)
        reports = {}
        for key, sheet_name in (('harvestingYtdByGang', args.ytd_sheet), ('harvestersMonthComparison', args.comparison_sheet)):
            path = sheet_paths.get(sheet_name)
            if not path:
                raise SystemExit(f'Sheet {sheet_name} not found in workbook')
            rows = read_sheet(z, path, shared_strings)
            sanitized = sanitize_rows(rows)
            reports[key] = extract_report(sanitized, title=sheet_name)

    payload = {
        'sourceWorkbook': str(args.source),
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'reports': reports,
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
