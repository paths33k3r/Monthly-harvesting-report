import json
import base64

def patch_script():
    with open('script.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # We will inject some fake FFB Budget data right after state.reports["2025"] = []
    injection_point = 'state.reports["2025"] = [];'
    
    fake_data = """
            state.ffbBudget = state.ffbBudget || {};
            state.ffbBudget["2026"] = [
                {
                    phase: "OP2010",
                    block_id: "BLK-A",
                    ha: 15.5,
                    ageMth: "180",
                    harvestYr: "2026",
                    ageYrMth: "15/0",
                    harvestYrMth: "15/0",
                    mtHaYr: 25.5,
                    mtHaMth: 2.1,
                    months: [100, 110, 120, 100, 110, 120, 100, 110, 120, 100, 110, 120]
                },
                {
                    phase: "OP2010",
                    block_id: "BLK-B",
                    ha: 20.0,
                    ageMth: "180",
                    harvestYr: "2026",
                    ageYrMth: "15/0",
                    harvestYrMth: "15/0",
                    mtHaYr: 26.0,
                    mtHaMth: 2.2,
                    months: [150, 160, 170, 150, 160, 170, 150, 160, 170, 150, 160, 170]
                },
                {
                    phase: "OP2015",
                    block_id: "BLK-C",
                    ha: 10.0,
                    ageMth: "120",
                    harvestYr: "2026",
                    ageYrMth: "10/0",
                    harvestYrMth: "10/0",
                    mtHaYr: 28.0,
                    mtHaMth: 2.3,
                    months: [80, 85, 90, 80, 85, 90, 80, 85, 90, 80, 85, 90]
                }
            ];
    """
    
    if "state.ffbBudget['2026'] =" not in content and "state.ffbBudget[\"2026\"] =" not in content:
        content = content.replace(injection_point, injection_point + '\n' + fake_data)
        
        with open('script.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Test data injected.")
    else:
        print("Data already injected.")

if __name__ == '__main__':
    patch_script()
