import re

with open('script.js', 'r', encoding='utf-8') as f:
    c = f.read()

replacement = """        let gR1=0, gR2=0, gR3=0, gR4=0, gTot=0;
        blocks.forEach(b => {
            const d = state.performance[year][month][b.block_id];
            if(d) {
                gR1 += parseFloat(d.r1) || 0;
                gR2 += parseFloat(d.r2) || 0;
                gR3 += parseFloat(d.r3) || 0;
                gR4 += parseFloat(d.r4) || 0;
                gTot += (parseFloat(d.r1) || 0) + (parseFloat(d.r2) || 0) + (parseFloat(d.r3) || 0) + (parseFloat(d.r4) || 0);
            }
        });

        wrapper.innerHTML = `
            <div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h2>HARVESTING INTERVAL FOR THE MONTH OF ${month.toUpperCase()} ${year}</h2>
                    <div class="perf-stats">
                        <div class="stat-row">
                            <label>VIEW:</label>
                            <span class="font-bold">ALL BLOCKS</span>
                        </div>
                    </div>
                </div>
                <div>
                     <table style="border-collapse: collapse; text-align: center; font-size: 13px; margin-bottom: 0.5rem; width: 400px;">
                        <thead>
                            <tr style="background: var(--bg-color);">
                                <th style="border: 1px solid var(--border-color); padding: 8px;">1ST RD</th>
                                <th style="border: 1px solid var(--border-color); padding: 8px;">2ND RD</th>
                                <th style="border: 1px solid var(--border-color); padding: 8px;">3RD RD</th>
                                <th style="border: 1px solid var(--border-color); padding: 8px;">4TH RD</th>
                                <th style="border: 1px solid var(--border-color); padding: 8px;">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="border: 1px solid var(--border-color); padding: 8px;">${gR1.toFixed(2)}</td>
                                <td style="border: 1px solid var(--border-color); padding: 8px;">${gR2.toFixed(2)}</td>
                                <td style="border: 1px solid var(--border-color); padding: 8px;">${gR3.toFixed(2)}</td>
                                <td style="border: 1px solid var(--border-color); padding: 8px;">${gR4.toFixed(2)}</td>
                                <td style="border: 1px solid var(--border-color); padding: 8px; font-weight: bold; color: var(--primary-color);">${gTot.toFixed(2)}</td>
                            </tr>
                        </tbody>
                     </table>
                </div>
            </div>`;"""

pattern = r'        wrapper\.innerHTML = `\s*<div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">\s*<div>\s*<h2>HARVESTING INTERVAL FOR THE MONTH OF \$\{month\.toUpperCase\(\)\} \$\{year\}<\/h2>\s*<div class="perf-stats">\s*<div class="stat-row">\s*<label>VIEW:<\/label>\s*<span class="font-bold">ALL BLOCKS<\/span>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>`;'

c = re.sub(pattern, replacement, c, flags=re.MULTILINE)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(c)

print("Injected UI element successfully.")
