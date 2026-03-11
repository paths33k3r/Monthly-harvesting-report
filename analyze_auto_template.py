import pandas as pd
import json

def analyze():
    try:
        df = pd.read_excel('FFB Auto Template.xlsx', header=None)
        
        # Find the header row by looking for 'PHASE' or 'ESTATE' or similar common keywords
        # Or just print the first 20 rows, converting them to lists
        
        preview = []
        for i in range(min(20, len(df))):
            row = [str(x) if pd.notna(x) else "" for x in df.iloc[i].tolist()]
            # Only keep non-empty columns to reduce noise
            row_clean = [f"Col {j}: {val}" for j, val in enumerate(row) if val.strip() != ""]
            if row_clean:
                preview.append(f"Row {i}: " + " | ".join(row_clean))
                
        with open('template_preview.txt', 'w', encoding='utf-8') as f:
            f.write("\n".join(preview))
        print("Analysis saved to template_preview.txt")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    analyze()
