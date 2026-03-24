import pandas as pd
import json

file_path = 'FFB Auto Template.xlsx'

# Read the file
df = pd.read_excel(file_path, header=None)

blocks = []
current_phase = ""

# Look closely at how template_preview.txt shows columns
# Col 1: PHASE
# Col 2: BLK
# Col 3: Age (mth)
# Col 4: Harvest Yr.
# Col 5: Age (yr/mth)
# Col 6: Harvest (yr/mth)
# Col 7: Mt/ha/yr
# Col 8: Mt/ha/mth
# Col 9: HA
# Col 10 to 21: Jan - Dec months

for i in range(len(df)):
    row = df.iloc[i]
    phase_val = str(row[1]).strip()
    
    # Check if this row is a phase header (e.g. OP2010, OP2011)
    if phase_val.startswith("OP") and len(phase_val) == 6:
        current_phase = phase_val
    
    # Process if we have a current_phase and Col 2 is a block ID (not empty, not NaN, not "BLK", not "SUBTOTAL")
    block_val = str(row[2]).strip()
    if current_phase and block_val and block_val.lower() not in ["", "nan", "blk", "subtotal", "total"]:
        # Safety check: if Col 9 (HA) is a number, this is a data row
        try:
            ha = float(row[9])
            if pd.isna(ha):
                continue
        except (ValueError, TypeError):
            continue
            
        months = []
        for c in range(10, 22):
            try:
                m_val = float(row[c])
                months.append(m_val if not pd.isna(m_val) else 0.0)
            except (ValueError, TypeError):
                months.append(0.0)
                
        # Handle string columns with fallbacks
        age_mth = str(row[3]).strip() if pd.notna(row[3]) else ""
        harvest_yr = str(row[4]).strip() if pd.notna(row[4]) else ""
        age_yrmth = str(row[5]).strip() if pd.notna(row[5]) else ""
        harvest_yrmth = str(row[6]).strip() if pd.notna(row[6]) else ""
        
        try:
            mtha_yr = float(row[7]) if pd.notna(row[7]) else 0.0
        except:
            mtha_yr = 0.0
            
        try:
            mtha_mth = float(row[8]) if pd.notna(row[8]) else 0.0
        except:
            mtha_mth = 0.0

        blocks.append({
            "phase": current_phase,
            "block_id": block_val,
            "ageMth": age_mth,
            "harvestYr": harvest_yr,
            "ageYrMth": age_yrmth,
            "harvestYrMth": harvest_yrmth,
            "mtHaYr": mtha_yr,
            "mtHaMth": mtha_mth,
            "ha": ha,
            "months": months
        })

js_content = f"const INITIAL_FFB_BUDGET = {json.dumps(blocks, indent=4)};\n"

with open('ffbData.js', 'w') as f:
    f.write(js_content)

print(f"Extracted {len(blocks)} blocks into ffbData.js")
