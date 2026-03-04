import openpyxl

wb = openpyxl.load_workbook('HARVESTING INTERVAL-MARCH 2026 sample.xlsx', data_only=True)
ws = wb.active

print(f"Sheet name: {ws.title}")
for row in range(1, 15):
    row_data = []
    for col in range(1, 46):
        cell = ws.cell(row=row, column=col)
        val = cell.value
        if val is not None:
            row_data.append(f"{cell.coordinate}:{val}")
    print(f"Row {row}: {', '.join(row_data)}")
