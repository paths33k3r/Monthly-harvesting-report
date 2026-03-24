import base64
import os

def process():
    if not os.path.exists("FFB_Budget_Template.xlsx"):
        print("FFB_Budget_Template.xlsx not found")
        return
    if not os.path.exists("Harvesting_Template.xlsx"):
        print("Harvesting_Template.xlsx not found")
        return

    with open("FFB_Budget_Template.xlsx", "rb") as f:
        ffb_b64 = base64.b64encode(f.read()).decode('utf-8')

    with open("Harvesting_Template.xlsx", "rb") as f:
        harv_b64 = base64.b64encode(f.read()).decode('utf-8')

    js_content = f"""// Auto-generated templates for downloading directly without a server
window.AppTemplates = {{
    ffbBudget: "{ffb_b64}",
    harvestingInterval: "{harv_b64}"
}};
"""
    with open("templates.js", "w", encoding='utf-8') as f:
        f.write(js_content)
    print("templates.js created successfully")

if __name__ == "__main__":
    process()
