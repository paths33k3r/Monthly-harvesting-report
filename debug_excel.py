import pandas as pd
import json

file_path = "HARVESTING INTERVAL-MARCH 2026 sample.xlsx"
df = pd.read_excel(file_path, sheet_name=0, header=None)
df = df.fillna("")

print("Shape:", df.shape)
print("First 15 rows (structure & headers):")
rows = df.head(15).values.tolist()
for i, row in enumerate(rows):
    print(f"Row {i}: {row}")
