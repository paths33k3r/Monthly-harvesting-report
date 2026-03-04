import re

with open('script.js', 'r', encoding='utf-8') as f:
    c = f.read()

# 1) Fix renderIntervalTable blocks logic
old_blocks_logic = r"""        let blocks = \[\.\.\.\(state\.reports\[year\] \|\| \[\]\)\].*?        \}"""

new_blocks_logic = """        let blocks = [...(state.reports[year] || [])];
        if (state.performance[year] && state.performance[year][month]) {
            Object.keys(state.performance[year][month]).forEach(gangKey => {
                if (gangKey !== 'gangAssignments') {
                    const gangData = state.performance[year][month][gangKey];
                    if (gangData && gangData.blocks) {
                        Object.keys(gangData.blocks).forEach(bId => {
                            if (!blocks.find(b => String(b.block_id) === String(bId))) {
                                blocks.push({ block_id: bId, ha: gangData.blocks[bId].ha || 0, gang: gangKey });
                            }
                        });
                    }
                }
            });
        }
        blocks.sort((a,b) => parseFloat(a.block_id) - parseFloat(b.block_id));"""

c = re.sub(old_blocks_logic, new_blocks_logic, c, flags=re.DOTALL)

# 2) Fix global sum logic in renderIntervalTable
old_sum_logic = r"""        let gR1=0, gR2=0, gR3=0, gR4=0, gTot=0;
        blocks\.forEach\(b => \{
            const d = state\.performance\[year\]\[month\]\[b\.block_id\];
            if\(d\) \{
                gR1 \+= parseFloat\(d\.r1\) \|\| 0;
                gR2 \+= parseFloat\(d\.r2\) \|\| 0;
                gR3 \+= parseFloat\(d\.r3\) \|\| 0;
                gR4 \+= parseFloat\(d\.r4\) \|\| 0;
                gTot \+= \(parseFloat\(d\.r1\)\|\|0\) \+ \(parseFloat\(d\.r2\)\|\|0\) \+ \(parseFloat\(d\.r3\)\|\|0\) \+ \(parseFloat\(d\.r4\)\|\|0\);
            \}
        \}\);"""

new_sum_logic = """        let gR1=0, gR2=0, gR3=0, gR4=0, gTot=0;
        blocks.forEach(b => {
            const gangName = monthAssignments[b.block_id] || b.gang || "Unassigned";
            const gangData = state.performance[year][month][gangName];
            if(gangData && gangData.blocks) {
                const d = gangData.blocks[b.block_id];
                if(d) {
                    gR1 += parseFloat(d.r1) || 0;
                    gR2 += parseFloat(d.r2) || 0;
                    gR3 += parseFloat(d.r3) || 0;
                    gR4 += parseFloat(d.r4) || 0;
                    gTot += (parseFloat(d.r1)||0) + (parseFloat(d.r2)||0) + (parseFloat(d.r3)||0) + (parseFloat(d.r4)||0);
                }
            }
        });"""

c = re.sub(old_sum_logic, new_sum_logic, c, flags=re.DOTALL)


# 3) Fix handleImportExcel to save `ha` correctly
old_import_logic = r"""                pBlocks\[importedBlock\.block_id\] = \{
                    budget: pBlocks\[importedBlock\.block_id\]\?\.budget \|\| 0, // preserve budget if it exists"""

new_import_logic = """                pBlocks[importedBlock.block_id] = {
                    ha: importedBlock.ha,
                    budget: pBlocks[importedBlock.block_id]?.budget || 0, // preserve budget if it exists"""

c = re.sub(old_import_logic, new_import_logic, c, flags=re.DOTALL)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(c)

print("Fixed performance structures.")
