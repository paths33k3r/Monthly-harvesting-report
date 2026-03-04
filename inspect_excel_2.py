import openpyxl

wb = openpyxl.load_workbook('HARVESTING INTERVAL-MARCH 2026 sample.xlsx', data_only=True)
ws = wb.active

for row in range(5, 7):
    row_data = []
    for col in range(5, 20):  # Col E to Col T (Days 1 to 16)
        cell = ws.cell(row=row, column=col)
        row_data.append(f"D{col-4}:{cell.value}")
    print(f"Row {row}: {', '.join(row_data)}")
