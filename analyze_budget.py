import pandas as pd
import json

file_path = "FFB Budget Estimate 2026.xlsx"
try:
    xl = pd.ExcelFile(file_path)
    sheets_info = {}
    for sheet_name in xl.sheet_names:
        df = xl.parse(sheet_name, nrows=10) # Read first 10 rows to get headers and some sample data
        sheets_info[sheet_name] = {
            "columns": df.columns.tolist(),
            "first_few_rows": df.head(5).to_dict(orient="records")
        }
    
    with open("budget_analysis.json", "w") as f:
        json.dump(sheets_info, f, indent=2, default=str)
    print("Analysis saved to budget_analysis.json")
except Exception as e:
    print(f"Error: {e}")
