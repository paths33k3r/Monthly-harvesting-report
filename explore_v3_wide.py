import openpyxl

excel_file = "Havesting Performance Jan 2026.xlsx"
wb = openpyxl.load_workbook(excel_file, data_only=True)
ws2 = wb["OVERALL BY GANG COMPARISON V3"]

print("V3 wide columns (Rows 1-10, Cols 13-30):")
for r in range(1, 10):
    row_vals = []
    for c in range(13, 30):
        val = ws2.cell(row=r, column=c).value
        # Replace empty strings and newlines to keep it neat
        clean_val = str(val).replace('\n', ' ') if val is not None else ""
        row_vals.append(f"C{c}:{clean_val}")
    print(f"Row {r:02d}:", " | ".join(row_vals))

