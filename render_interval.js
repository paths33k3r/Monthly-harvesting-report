const renderIntervalTable = () => {
    const year = state.selectedReportYear;
    const month = state.activePerfMonth;

    intervalWrapper.innerHTML = ''; // Start clean

    // Ensure state tree
    state.performance[year] = state.performance[year] || {};
    state.performance[year][month] = state.performance[year][month] || {};

    const blocks = state.reports[year] || [];

    // 1. Initialize Month-Specific Gang Assignments
    if (!state.performance[year][month].gangAssignments) {
        const sortedMonths = [...months];
        const currentMonthIdx = sortedMonths.indexOf(month);
        let inheritedMap = null;

        if (currentMonthIdx > 0) {
            for (let i = currentMonthIdx - 1; i >= 0; i--) {
                const prevMonth = sortedMonths[i];
                if (state.performance[year][prevMonth] && state.performance[year][prevMonth].gangAssignments) {
                    inheritedMap = JSON.parse(JSON.stringify(state.performance[year][prevMonth].gangAssignments));
                    break;
                }
            }
        }

        if (inheritedMap) {
            state.performance[year][month].gangAssignments = inheritedMap;
        } else {
            const newMap = {};
            blocks.forEach(b => { newMap[b.block_id] = b.gang || "Unassigned"; });
            state.performance[year][month].gangAssignments = newMap;
        }
    }

    const monthAssignments = state.performance[year][month].gangAssignments;
    const allGangsInMonth = new Set(Object.values(monthAssignments));
    blocks.forEach(b => {
        if (!monthAssignments[b.block_id]) {
            monthAssignments[b.block_id] = b.gang || "Unassigned";
            allGangsInMonth.add(b.gang || "Unassigned");
        }
    });

    const gangs = [...allGangsInMonth].filter(b => b && b !== "Unassigned").sort();

    if (gangs.length === 0) {
        intervalWrapper.innerHTML = '<p style="padding: 2rem;">No harvesting gangs found for this year. Please assign blocks to gangs first.</p>';
        return;
    }

    gangs.forEach((gangName) => {
        const perfData = state.performance[year][month][gangName] || { manpower: 0, leave: 0, blocks: {} };
        state.performance[year][month][gangName] = perfData;

        const gBlocks = blocks.filter(b => monthAssignments[b.block_id] === gangName);
        if (gBlocks.length === 0) return;

        const gangWrapper = document.createElement('div');
        gangWrapper.style.marginBottom = '3rem';
        gangWrapper.style.padding = '0';

        const safeGangId = gangName.replace(/[^a-zA-Z0-9]/g, '_');

        gangWrapper.innerHTML = `
                <div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <h2>HARVESTING INTERVAL FOR THE MONTH OF ${month.toUpperCase()} ${year}</h2>
                        <div class="perf-stats">
                            <div class="stat-row">
                                <label>HARVESTER TEAM:</label>
                                <span class="font-bold">${gangName.toUpperCase()}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="table-container" style="overflow-x: auto; padding-bottom: 2rem;">
                    <table class="grouped-table" style="min-width: 1500px;" id="interval-table-\${safeGangId}">
                        <thead>
                            <tr>
                                <th style="min-width: 60px; position: sticky; left: 0; background: var(--bg-primary); z-index: 1; border-right: 2px solid var(--border-color);">BLOCK</th>
                                <th style="min-width: 80px; border-right: 2px solid var(--border-color);">HA</th>
                                ${Array.from({length: 31}, (_, i) => `<th style="min-width: 40px; text-align: center; font-size: 0.8em; padding: 0.2rem;">${i+1}</th>`).join('')}
                                <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">TOTAL MANDAY</th>
                                <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">FFB BUDGET</th>
                                <th style="min-width: 80px; text-align: center;">1ST RD</th>
                                <th style="min-width: 80px; text-align: center;">2ND RD</th>
                                <th style="min-width: 80px; text-align: center;">3RD RD</th>
                                <th style="min-width: 80px; text-align: center;">4TH RD</th>
                            </tr>
                        </thead>
                        <tbody id="interval-table-body-${safeGangId}">
                        </tbody>
                    </table>
                </div>
            `;

            intervalWrapper.appendChild(gangWrapper);
            
            const tbody = document.getElementById(`interval-table-body-${safeGangId}`);

            gBlocks.forEach(block => {
                const bId = block.block_id;
                if (!perfData.blocks[bId]) {
                    perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, r4: 0, manday: 0, days: new Array(31).fill("") };
                }
                const bData = perfData.blocks[bId];
                if (!bData.days) bData.days = new Array(31).fill("");
                if (typeof bData.r4 === "undefined") bData.r4 = 0;

                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="position: sticky; left: 0; background: var(--bg-primary); font-weight: 500; border-right: 2px solid var(--border-color);" class="text-center cell-block">${bId}</td>
                                <td class="text-right" style="border-right: 2px solid var(--border-color);">${formatHA(block.ha)}</td>`;
                
                // Dynamically sync FFB Budget for current month
                const monthIndex = months.indexOf(month);
                if (state.ffbBudget && state.ffbBudget[year]) {
                    const ffbRow = state.ffbBudget[year].find(r => String(r.block_id).trim() === String(bId).trim());
                    if (ffbRow && ffbRow.months && ffbRow.months.length > monthIndex) {
                        bData.budget = ffbRow.months[monthIndex] || 0;
                    }
                }
                
                bData.days.forEach((dayVal, i) => {
                    const td = document.createElement('td');
                    td.style.padding = '0';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'edit-input text-center';
                    input.style.width = '100%';
                    input.style.height = '100%';
                    input.style.padding = '0.5rem 0.2rem';
                    input.style.border = 'none';
                    input.style.background = 'transparent';
                    input.value = dayVal || "";
                    input.onchange = (e) => {
                        bData.days[i] = e.target.value;
                    };
                    td.appendChild(input);
                    tr.appendChild(td);
                });

                const createPerfInput = (field, onChange, extraStyle="") => {
                    const td = document.createElement('td');
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'edit-input text-right';
                    input.step = '0.01';
                    input.value = (bData[field] || 0).toFixed(2);
                    input.oninput = (e) => {
                        const parsed = parseFloat(e.target.value) || 0;
                        onChange(parsed);
                    };
                    input.onblur = (e) => { e.target.value = (parseFloat(e.target.value) || 0).toFixed(2); };
                    if(extraStyle) td.style.cssText = extraStyle;
                    td.appendChild(input);
                    return td;
                };

                tr.appendChild(createPerfInput('manday', (v) => bData.manday = v, "border-left: 2px solid var(--border-color);"));
                tr.appendChild(createPerfInput('budget', (v) => bData.budget = v, "border-left: 2px solid var(--border-color);"));
                tr.appendChild(createPerfInput('r1', (v) => bData.r1 = v));
                tr.appendChild(createPerfInput('r2', (v) => bData.r2 = v));
                tr.appendChild(createPerfInput('r3', (v) => bData.r3 = v));
                tr.appendChild(createPerfInput('r4', (v) => bData.r4 = v));
                
                tbody.appendChild(tr);
            });
        });
    };
