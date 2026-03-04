import base64

with open('Harvesting_Template.xlsx', 'rb') as f:
    b64_str = base64.b64encode(f.read()).decode('utf-8')

js_injection = f"""    const init = async () => {{
        try {{
            const tBtn = document.getElementById('sidebar-download-template');
            if (tBtn) {{
                tBtn.onclick = (e) => {{
                    e.preventDefault();
                    const bStr = '{b64_str}';
                    const bin = atob(bStr);
                    const arr = new Uint8Array(bin.length);
                    for(let i=0; i<bin.length; i++) arr[i] = bin.charCodeAt(i);
                    const blob = new Blob([arr], {{type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Harvesting_Template.xlsx';
                    a.click();
                    window.URL.revokeObjectURL(url);
                }};
            }}
"""

with open('script.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the init start
content = content.replace("    const init = async () => {\n        try {\n", js_injection)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Injected Base64 template into script.js")
