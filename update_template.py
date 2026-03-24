import openpyxl

def update_template():
    # Load the workbook
    wb = openpyxl.load_workbook('FFB Budget Estimate 2026.xlsx')
    
    # Sheets to remove
    sheets_to_remove = ['FFB Budget 2026', 'FFB Budget 2026 - 2']
    
    for sheet_name in sheets_to_remove:
        if sheet_name in wb.sheetnames:
            del wb[sheet_name]
            
    # Save as the template
    wb.save('FFB_Budget_Template.xlsx')
    print("Template updated successfully. Only 'FFB Budget 2026 - 2 summary' remains.")

if __name__ == "__main__":
    update_template()
