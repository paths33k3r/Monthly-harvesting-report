document.addEventListener('DOMContentLoaded', () => {
    // App State
    const state = {
        reports: {}, // { "2025": [ { block_id, ha, op_year, gang }, ... ] }
        performance: {}, // { "2025": { "Jan": { "DARSO GANG": { manpower: 17, leave: 0, blocks: { "15": { budget: 56.34, r1: 33.38, r2: 10.51, r3: 20.07, manday: 56 } } } } } } }
        selectedReportYear: null,

        // Could be 'report_year' (shows all for the year, grouped by op_year)
        // or 'gang' (shows specific gang for the year, grouped by op_year)
        // or 'perf_month' (shows performance charts for all gangs in a specific year/month)
        activeViewType: 'report_year',
        activeViewValue: null,
        activePerfMonth: null // Used when activeViewType === 'perf_month'
    };

    // Predefined Gang Assignments
    const predefinedGangs = {
        "YUVENTUS UN GANG": ["1", "3", "14"],
        "DARSO GANG": ["15", "16", "17", "19", "20", "21", "22"],
        "YUDI GANG -previously ERDI GANG": ["2", "11", "29"],
        "SOFIO MODENTUS MISSA GANG - previously SERAN": ["4", "5", "6", "7", "23", "24"],
        "NU AZANI GANG": ["8", "9", "12", "10", "13", "18"],
        "WENDERLINUS GANG": ["25", "26A", "27", "28", "30", "31", "33", "39"]
    };

    const getGangForBlock = (blockId) => {
        for (const [gangName, blocks] of Object.entries(predefinedGangs)) {
            if (blocks.includes(blockId)) return gangName;
        }
        return "Unassigned";
    };

    // DOM Elements
    const tableBody = document.getElementById('table-body');
    const tableGrandTotal = document.getElementById('table-grand-total');
    const headerGrandTotal = document.getElementById('header-grand-total');
    const loadingEl = document.getElementById('loading');
    const tableContainer = document.getElementById('table-container');

    const sidebarYearList = document.getElementById('sidebar-year-list');
    const sidebarGangList = document.getElementById('sidebar-gang-list');
    const tableTitle = document.getElementById('table-title');
    const colHeaderGrouping = document.getElementById('col-header-grouping');

    // Performance DOM Elements
    const perfWrapper = document.getElementById('performance-wrapper');

    // Chart instances keyed by gang name
    const performanceChartInstances = {};

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const formatHA = (num) => Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const getActiveBlocks = () => {
        const blocks = state.reports[state.selectedReportYear] || [];
        if (state.activeViewType === 'gang') {
            return blocks.filter(b => b.gang === state.activeViewValue);
        }
        return blocks;
    };

    const getGroupedBlocks = (blocks) => {
        const groups = {};
        // Even in Gang view, the user typically wants to see the blocks grouped by O/P year
        const groupProp = 'op_year';
        blocks.forEach(block => {
            const key = block[groupProp] || "Unassigned";
            if (!groups[key]) groups[key] = [];
            groups[key].push(block);
        });
        return groups;
    };

    // Recalculates totals and updates DOM
    const recalculateTotals = () => {
        const blocks = getActiveBlocks();
        const total = blocks.reduce((sum, b) => sum + b.ha, 0);

        const formattedTotal = formatHA(total);
        if (tableGrandTotal) tableGrandTotal.textContent = formattedTotal;
        if (headerGrandTotal) headerGrandTotal.textContent = formattedTotal + ' HA';

        // Update group subtotals in the DOM 
        const groups = getGroupedBlocks(blocks);
        // We have to iterate the actual DOM array to map to `subtotal-${groupIdx}`
        const groupKeys = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));
        groupKeys.forEach((groupKey, idx) => {
            const subtotalEl = document.getElementById(`subtotal-${idx}`);
            if (subtotalEl) {
                const subTotal = groups[groupKey].reduce((sum, b) => sum + b.ha, 0);
                subtotalEl.textContent = formatHA(subTotal);
            }
        });
    };


    const handleGlobalAddBlock = () => {
        if (!state.selectedReportYear) {
            alert("No report year available");
            return;
        }

        if (state.activeViewType === 'gang') {
            const targetBlockId = prompt(`Enter the Block Number to assign to Gang '${state.activeViewValue}':`);
            if (!targetBlockId) return;

            const blockToAssign = state.reports[state.selectedReportYear].find(b => b.block_id === targetBlockId.trim());

            if (!blockToAssign) {
                alert(`Block '${targetBlockId.trim()}' not found in Report Year ${state.selectedReportYear}. Please add it to the Planting Phase Record first.`);
                return;
            }

            blockToAssign.gang = state.activeViewValue;

        } else {
            const targetOpYear = prompt("Enter the Planting Phase Year (O/P) for this new block:");
            if (!targetOpYear) return;

            const newBlock = {
                block_id: "New Block " + Math.floor(Math.random() * 1000),
                ha: 0,
                op_year: targetOpYear.trim(),
                gang: "Unassigned"
            };
            state.reports[state.selectedReportYear].push(newBlock);
        }

        renderTable();
        recalculateTotals();
    };

    const handleDeleteYear = () => {
        if (!state.selectedReportYear) return;

        const isAdmin = confirm("Admin Check: Are you sure you are authorized to bulk delete?");
        if (!isAdmin) return;

        const confirmDelete = confirm(`WARNING: Are you sure you want to permanently delete ALL data for Report Year ${state.selectedReportYear}?`);
        if (!confirmDelete) return;

        delete state.reports[state.selectedReportYear];

        const remainingYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));
        if (remainingYears.length > 0) {
            state.selectedReportYear = remainingYears[remainingYears.length - 1];
            state.activeViewType = 'report_year';
            state.activeViewValue = state.selectedReportYear;
        } else {
            state.selectedReportYear = null;
            state.activeViewType = 'report_year';
            state.activeViewValue = null;
        }

        renderSidebar();
        renderTable();
        recalculateTotals();
    };

    const handleAddReportYear = (e) => {
        if (e) e.stopPropagation();

        const newYearStr = prompt("Enter the new Report Year (e.g., 2026):");
        if (!newYearStr || newYearStr.trim() === "") return;
        const newYear = newYearStr.trim();

        if (state.reports[newYear]) {
            alert(`Report Year ${newYear} already exists!`);
            return;
        }

        // Clone current year data if exists, otherwise empty
        const sourceData = state.reports[state.selectedReportYear] || [];
        state.reports[newYear] = JSON.parse(JSON.stringify(sourceData));

        state.selectedReportYear = newYear;
        state.activeViewType = 'report_year';
        state.activeViewValue = newYear;

        renderSidebar();
        renderTable();
        recalculateTotals();
    };

    const renderSidebar = () => {
        // Handle Sidebar Header styling
        const navHeaderYear = document.getElementById('nav-header-year');
        const navHeaderGangYear = document.getElementById('nav-header-gang-year');
        const navHeaderPerfYear = document.getElementById('nav-header-perf-year');

        if (navHeaderYear && navHeaderGangYear && navHeaderPerfYear) {
            navHeaderYear.style.color = state.activeViewType === 'report_year' ? 'var(--text-primary)' : '';
            navHeaderGangYear.style.color = state.activeViewType === 'gang' ? 'var(--text-primary)' : '';
            navHeaderPerfYear.style.color = state.activeViewType === 'perf_month' ? 'var(--text-primary)' : '';
        }

        // Render Report Years
        if (sidebarYearList) {
            sidebarYearList.innerHTML = '';
            const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

            reportYears.forEach(year => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                if (state.activeViewType === 'report_year' && state.activeViewValue === year) {
                    li.classList.add('active');
                }

                const a = document.createElement('a');
                a.href = '#';
                a.className = 'nav-link';
                a.textContent = year;
                a.onclick = (e) => {
                    e.preventDefault();
                    state.selectedReportYear = year;
                    state.activeViewType = 'report_year';
                    state.activeViewValue = year;
                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                };
                li.appendChild(a);
                sidebarYearList.appendChild(li);
            });

            const liAdd = document.createElement('li');
            liAdd.className = 'nav-item';
            const aAdd = document.createElement('a');
            aAdd.href = '#';
            aAdd.className = 'nav-link add-year-link';
            aAdd.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
            aAdd.onclick = handleAddReportYear;
            liAdd.appendChild(aAdd);
            sidebarYearList.appendChild(liAdd);
        }

        // Render Gangs (Grouped by Year)
        const sidebarGangYearList = document.getElementById('sidebar-gang-year-list');
        if (sidebarGangYearList) {
            sidebarGangYearList.innerHTML = '';

            const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

            reportYears.forEach(year => {
                const liYear = document.createElement('li');
                liYear.className = 'nav-item';

                // Keep the year open if we are currently viewing something inside it
                const isOpen = state.selectedReportYear === year ? 'open' : '';

                const divYearHeader = document.createElement('div');
                divYearHeader.className = `nav-item-header has-children ${isOpen}`;
                divYearHeader.innerHTML = `<span class="nav-label">${year}</span><span class="nav-chevron">▼</span>`;

                const ulGangs = document.createElement('ul');
                ulGangs.className = 'nav-submenu';
                ulGangs.style.display = isOpen ? 'block' : 'none';

                const blocks = state.reports[year] || [];
                const gangs = [...new Set(blocks.map(b => b.gang))].filter(Boolean).sort();

                // Helper for rendering edit/delete icons in Gang list
                const createActionIcon = (text, onClick) => {
                    const span = document.createElement('span');
                    span.innerHTML = text;
                    span.style.cursor = 'pointer';
                    span.style.fontSize = '0.8em';
                    span.onclick = (e) => {
                        e.stopPropagation();
                        onClick();
                    };
                    return span;
                };

                gangs.forEach(gang => {
                    const liGang = document.createElement('li');
                    liGang.className = 'nav-item';
                    if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                        liGang.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';

                    a.style.display = 'flex';
                    a.style.justifyContent = 'space-between';
                    a.style.alignItems = 'center';

                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = gang;
                    a.appendChild(labelSpan);

                    const actionDiv = document.createElement('div');
                    actionDiv.style.display = 'flex';
                    actionDiv.style.gap = '0.5rem';

                    actionDiv.appendChild(createActionIcon('✏️', () => {
                        const newName = prompt(`Rename gang '${gang}' in Year ${year}:`);
                        if (newName && newName.trim() !== "") {
                            blocks.forEach(b => {
                                if (b.gang === gang) b.gang = newName.trim();
                            });
                            if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                                state.activeViewValue = newName.trim();
                            }
                            renderSidebar();
                            renderTable();
                        }
                    }));

                    actionDiv.appendChild(createActionIcon('🗑️', () => {
                        if (confirm(`WARNING: Remove Gang '${gang}' from Year ${year}? ALL blocks assigned to this gang will also be completely deleted from this Year.`)) {
                            // Filter out blocks that belong to the deleted gang
                            state.reports[year] = state.reports[year].filter(b => b.gang !== gang);

                            if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                                state.activeViewType = 'report_year';
                                state.activeViewValue = year;
                            }
                            renderSidebar();
                            renderTable();
                            recalculateTotals();
                        }
                    }));

                    a.appendChild(actionDiv);

                    a.onclick = (e) => {
                        if (e.target !== a && e.target !== labelSpan) return;
                        e.preventDefault();
                        state.selectedReportYear = year; // switching year contextualizes the gang
                        state.activeViewType = 'gang';
                        state.activeViewValue = gang;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    liGang.appendChild(a);
                    ulGangs.appendChild(liGang);
                });

                // Add Gang button tailored for THIS specific year
                const liAddGang = document.createElement('li');
                liAddGang.className = 'nav-item';
                const aAddGang = document.createElement('a');
                aAddGang.href = '#';
                aAddGang.className = 'nav-link add-year-link';
                aAddGang.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Gang`;
                aAddGang.onclick = (e) => {
                    e.stopPropagation();
                    const newGang = prompt(`Enter new Gang name for Year ${year}:`);
                    if (newGang && newGang.trim()) {
                        state.selectedReportYear = year;
                        state.activeViewType = 'gang';
                        state.activeViewValue = newGang.trim();
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    }
                };
                liAddGang.appendChild(aAddGang);
                ulGangs.appendChild(liAddGang);

                // Add nested toggle logic specifically for this dynamic header
                divYearHeader.onclick = (e) => {
                    e.stopPropagation();
                    const isClosing = divYearHeader.classList.contains('open');

                    if (isClosing) {
                        divYearHeader.classList.remove('open');
                        ulGangs.style.display = 'none';
                    } else {
                        divYearHeader.classList.add('open');
                        ulGangs.style.display = 'block';
                    }
                };

                liYear.appendChild(divYearHeader);
                liYear.appendChild(ulGangs);

                sidebarGangYearList.appendChild(liYear);
            });
        }

        // Render Performance Navigation
        const sidebarPerfYearList = document.getElementById('sidebar-perf-year-list');
        if (sidebarPerfYearList) {
            sidebarPerfYearList.innerHTML = '';
            const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

            reportYears.forEach(year => {
                const liYear = document.createElement('li');
                liYear.className = 'nav-item';

                const isYearOpen = (state.activeViewType === 'perf_gang' && state.selectedReportYear === year) ? 'open' : '';

                const divYearHeader = document.createElement('div');
                divYearHeader.className = `nav-item-header has-children ${isYearOpen}`;
                divYearHeader.innerHTML = `<span class="nav-label">${year}</span><span class="nav-chevron">▼</span>`;

                const ulMonths = document.createElement('ul');
                ulMonths.className = 'nav-submenu';
                ulMonths.style.display = isYearOpen ? 'block' : 'none';

                divYearHeader.onclick = (e) => {
                    e.stopPropagation();
                    const isClosing = divYearHeader.classList.contains('open');
                    if (isClosing) {
                        divYearHeader.classList.remove('open');
                        ulMonths.style.display = 'none';
                    } else {
                        divYearHeader.classList.add('open');
                        ulMonths.style.display = 'block';
                    }
                };

                months.forEach(month => {
                    const liMonth = document.createElement('li');
                    liMonth.className = 'nav-item';

                    const isMonthOpen = (state.activeViewType === 'perf_gang' && state.selectedReportYear === year && state.activePerfMonth === month) ? 'open' : '';

                    const divMonthHeader = document.createElement('div');
                    divMonthHeader.className = `nav-item-header has-children ${isMonthOpen}`;
                    divMonthHeader.innerHTML = `<span class="nav-label">${month}</span><span class="nav-chevron">▼</span>`;

                    const ulGangs = document.createElement('ul');
                    ulGangs.className = 'nav-submenu';
                    ulGangs.style.display = isMonthOpen ? 'block' : 'none';

                    divMonthHeader.onclick = (e) => {
                        e.stopPropagation();
                        const isClosing = divMonthHeader.classList.contains('open');
                        if (isClosing) {
                            divMonthHeader.classList.remove('open');
                            ulGangs.style.display = 'none';
                        } else {
                            divMonthHeader.classList.add('open');
                            ulGangs.style.display = 'block';
                        }
                    };

                    const blocks = state.reports[year] || [];
                    const gangs = [...new Set(blocks.map(b => b.gang))].filter(Boolean).sort();

                    gangs.forEach(gang => {
                        const liGang = document.createElement('li');
                        liGang.className = 'nav-item';
                        if (state.activeViewType === 'perf_gang' && state.activeViewValue === gang && state.selectedReportYear === year && state.activePerfMonth === month) {
                            liGang.classList.add('active');
                        }

                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'nav-link';
                        a.textContent = gang;

                        a.onclick = (e) => {
                            e.preventDefault();
                            state.selectedReportYear = year;
                            state.activeViewType = 'perf_gang';
                            state.activeViewValue = gang;
                            state.activePerfMonth = month;

                            // Initialize state tree if not exists
                            state.performance[year] = state.performance[year] || {};
                            state.performance[year][month] = state.performance[year][month] || {};
                            state.performance[year][month][gang] = state.performance[year][month][gang] || { manpower: 0, leave: 0, blocks: {} };

                            renderSidebar();
                            renderTable();
                        };

                        liGang.appendChild(a);
                        ulGangs.appendChild(liGang);
                    });

                    liMonth.appendChild(divMonthHeader);
                    liMonth.appendChild(ulGangs);
                    ulMonths.appendChild(liMonth);
                });

                liYear.appendChild(divYearHeader);
                liYear.appendChild(ulMonths);
                sidebarPerfYearList.appendChild(liYear);
            });
        }
    };

    const renderTable = () => {
        tableBody.innerHTML = '';
        perfWrapper.innerHTML = ''; // Clear dynamically appended performance widgets

        if (!state.selectedReportYear) {
            if (tableTitle) tableTitle.textContent = "No Report Year Selected";
            perfWrapper.classList.add('hidden');
            tableContainer.classList.add('hidden');
            return;
        }

        const isPerfView = state.activeViewType === 'perf_month';

        if (isPerfView) {
            tableContainer.classList.add('hidden');
            perfWrapper.classList.remove('hidden');
            renderPerformanceTable();
        } else {
            perfWrapper.classList.add('hidden');
            tableContainer.classList.remove('hidden');

            const isYearView = state.activeViewType === 'report_year';
            if (tableTitle) {
                tableTitle.textContent = isYearView
                    ? `Planting Phase (O/P) Breakdown year ${state.activeViewValue}`
                    : `Harvesting Gang: ${state.activeViewValue} (Year ${state.selectedReportYear})`;
            }

            if (colHeaderGrouping) {
                colHeaderGrouping.textContent = 'O/P'; // Always O/P
            }

            const activeBlocks = getActiveBlocks();
            const groupedBlocks = getGroupedBlocks(activeBlocks);

            const groupKeys = Object.keys(groupedBlocks).sort((a, b) => parseInt(a) - parseInt(b));

            groupKeys.forEach((groupKey, groupIdx) => {
                const groupBlocks = groupedBlocks[groupKey];

                // 1. Render Group Header
                const trHeader = document.createElement('tr');
                trHeader.className = 'row-group-header';

                const tdEmpty = document.createElement('td');
                trHeader.appendChild(tdEmpty);

                const tdOpLabel = document.createElement('td');
                tdOpLabel.className = 'cell-op-label';
                tdOpLabel.textContent = groupKey;
                trHeader.appendChild(tdOpLabel);

                const tdSubtotal = document.createElement('td');
                tdSubtotal.className = 'cell-subtotal';
                tdSubtotal.id = `subtotal-${groupIdx}`;
                tdSubtotal.textContent = formatHA(groupBlocks.reduce((s, b) => s + b.ha, 0));
                trHeader.appendChild(tdSubtotal);

                const tdEmptyActions = document.createElement('td');
                trHeader.appendChild(tdEmptyActions);

                tableBody.appendChild(trHeader);

                // 2. Render Nested Block Rows
                groupBlocks.forEach((block) => {
                    const trBlock = document.createElement('tr');
                    trBlock.className = 'row-block';

                    // Block ID
                    const tdBlockId = document.createElement('td');
                    tdBlockId.className = 'cell-block';
                    const inputBlock = document.createElement('input');
                    inputBlock.className = 'edit-input text-center';
                    inputBlock.value = block.block_id;
                    inputBlock.onchange = (e) => block.block_id = e.target.value;
                    tdBlockId.appendChild(inputBlock);
                    trBlock.appendChild(tdBlockId);

                    // O/P Year Property
                    const tdOpValue = document.createElement('td');
                    tdOpValue.className = 'cell-op';
                    const inputOp = document.createElement('input');
                    inputOp.className = 'edit-input text-center';
                    inputOp.value = block.op_year;
                    inputOp.title = `Edit to re-assign to another O/P Year`;
                    inputOp.onchange = (e) => {
                        const newVal = e.target.value.trim();
                        if (!newVal) return;
                        block.op_year = newVal;
                        renderTable();
                        recalculateTotals();
                    };
                    tdOpValue.appendChild(inputOp);
                    trBlock.appendChild(tdOpValue);

                    // HA Value
                    const tdHaValue = document.createElement('td');
                    const inputHa = document.createElement('input');
                    inputHa.type = 'number';
                    inputHa.className = 'edit-input text-right';
                    inputHa.step = '0.01';
                    inputHa.value = block.ha.toFixed(2);
                    inputHa.oninput = (e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                            block.ha = val;
                            recalculateTotals();
                        }
                    };
                    inputHa.onblur = (e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) e.target.value = val.toFixed(2);
                        else { e.target.value = '0.00'; block.ha = 0; recalculateTotals(); }
                    };
                    tdHaValue.appendChild(inputHa);
                    trBlock.appendChild(tdHaValue);

                    // Actions
                    const tdActions = document.createElement('td');
                    tdActions.className = 'cell-actions';
                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn-icon delete';
                    btnDelete.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                    btnDelete.onclick = () => {
                        const confirmRemove = confirm(`Are you sure you want to remove block ${block.block_id}?`);
                        if (!confirmRemove) return;

                        if (state.activeViewType === 'gang') {
                            // Just unassign from gang
                            block.gang = "Unassigned";
                        } else {
                            // Completely delete from Report Year
                            const idx = state.reports[state.selectedReportYear].indexOf(block);
                            if (idx > -1) {
                                state.reports[state.selectedReportYear].splice(idx, 1);
                            }
                        }
                        renderTable();
                        recalculateTotals();
                        renderSidebar();
                    };
                    tdActions.appendChild(btnDelete);
                    trBlock.appendChild(tdActions);

                    tableBody.appendChild(trBlock);
                });

                // 3. Render Spacer relative to group, except for last one
                if (groupIdx < groupKeys.length - 1) {
                    const trSpacer = document.createElement('tr');
                    trSpacer.className = 'row-spacer';
                    trSpacer.innerHTML = '<td colspan="4"></td>';
                    tableBody.appendChild(trSpacer);
                }
            });
        }
    };

    const renderPerformanceTable = () => {
        const year = state.selectedReportYear;
        const month = state.activePerfMonth;
        const gangName = state.activeViewValue;

        if (perfTitle) perfTitle.textContent = `HARVESTER PERFORMANCE CHART FOR THE MONTH OF ${month.toUpperCase()} ${year}`;
        if (perfTeamName) perfTeamName.textContent = gangName.toUpperCase();
        if (perfBudgetYear) perfBudgetYear.textContent = year;

        const perfData = state.performance[year][month][gangName];

        // Bind global headers
        perfManpower.value = perfData.manpower || 0;
        perfLeave.value = perfData.leave || 0;

        perfManpower.oninput = (e) => { perfData.manpower = parseFloat(e.target.value) || 0; calculatePerformanceTotals(perfData, gBlocks); };
        perfLeave.oninput = (e) => { perfData.leave = parseFloat(e.target.value) || 0; calculatePerformanceTotals(perfData, gBlocks); };

        // Pull active blocks for this gang from the main dataset to ensure syncing of HA
        const gBlocks = state.reports[year].filter(b => b.gang === gangName);

        const createPerfInput = (type, val, onChange) => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'edit-input text-right';
            input.step = '0.01';
            input.value = (val || 0).toFixed(2);
            input.oninput = (e) => {
                const parsed = parseFloat(e.target.value) || 0;
                onChange(parsed);
                calculatePerformanceTotals(perfData, gBlocks);
            };
            input.onblur = (e) => { e.target.value = (parseFloat(e.target.value) || 0).toFixed(2); };
            td.appendChild(input);
            return td;
        };

        gBlocks.forEach(block => {
            const bId = block.block_id;
            // Init block data if missing
            if (!perfData.blocks[bId]) {
                perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, manday: 0 };
            }
            const bData = perfData.blocks[bId];

            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="text-center cell-block">${bId}</td><td class="text-right">${formatHA(block.ha)}</td>`;

            tr.appendChild(createPerfInput('budget', bData.budget, (v) => bData.budget = v));
            tr.appendChild(createPerfInput('r1', bData.r1, (v) => bData.r1 = v));
            tr.appendChild(createPerfInput('r2', bData.r2, (v) => bData.r2 = v));
            tr.appendChild(createPerfInput('r3', bData.r3, (v) => bData.r3 = v));

            const tdTotal = document.createElement('td');
            tdTotal.className = 'text-right font-bold col-total';
            tdTotal.id = `perf-row-total-${bId}`;
            tdTotal.textContent = formatHA(bData.r1 + bData.r2 + bData.r3);
            tr.appendChild(tdTotal);

            tr.appendChild(createPerfInput('manday', bData.manday, (v) => bData.manday = v));

            const tdMtManday = document.createElement('td');
            tdMtManday.className = 'text-right font-bold';
            tdMtManday.id = `perf-row-mt-${bId}`;
            const totalRound = bData.r1 + bData.r2 + bData.r3;
            tdMtManday.textContent = bData.manday > 0 ? (totalRound / bData.manday).toFixed(2) : "0.00";
            tr.appendChild(tdMtManday);

            perfTableBody.appendChild(tr);
        });

        calculatePerformanceTotals(perfData, gBlocks);
    };

    const calculatePerformanceTotals = (perfData, blocks) => {
        let tHa = 0, tBudget = 0, tR1 = 0, tR2 = 0, tR3 = 0, tTotal = 0, tManday = 0;

        blocks.forEach(block => {
            const bId = block.block_id;
            const bData = perfData.blocks[bId];
            if (bData) {
                tHa += block.ha;
                tBudget += bData.budget;
                tR1 += bData.r1;
                tR2 += bData.r2;
                tR3 += bData.r3;

                const rowTotal = bData.r1 + bData.r2 + bData.r3;
                tTotal += rowTotal;
                tManday += bData.manday;

                const rowTotalEl = document.getElementById(`perf-row-total-${bId}`);
                const rowMtEl = document.getElementById(`perf-row-mt-${bId}`);

                if (rowTotalEl) rowTotalEl.textContent = formatHA(rowTotal);
                if (rowMtEl) rowMtEl.textContent = bData.manday > 0 ? (rowTotal / bData.manday).toFixed(2) : "0.00";
            }
        });

        if (pTotalHa) pTotalHa.textContent = formatHA(tHa);
        if (pTotalBudget) pTotalBudget.textContent = formatHA(tBudget);
        if (pTotalR1) pTotalR1.textContent = formatHA(tR1);
        if (pTotalR2) pTotalR2.textContent = formatHA(tR2);
        if (pTotalR3) pTotalR3.textContent = formatHA(tR3);
        if (pTotalAll) pTotalAll.textContent = formatHA(tTotal);
        if (pTotalManday) pTotalManday.textContent = formatHA(tManday);
        if (pTotalMtManday) pTotalMtManday.textContent = tManday > 0 ? (tTotal / tManday).toFixed(2) : "0.00";

        // Side Stats
        const netManpower = perfData.manpower - perfData.leave;
        const mtPerson = netManpower > 0 ? (tTotal / netManpower).toFixed(2) : "0.00";
        const haPerson = netManpower > 0 ? (tHa / netManpower).toFixed(2) : "0.00";

        if (statMtPerson) statMtPerson.textContent = mtPerson;
        if (statHaPerson) statHaPerson.textContent = haPerson;

        if (statRatio && mtPerson !== "0.00" && haPerson !== "0.00") {
            const ratio = (parseFloat(mtPerson) / parseFloat(haPerson)).toFixed(2);
            statRatio.textContent = `1:${ratio}`;
        } else {
            if (statRatio) statRatio.textContent = "0:0";
        }

        updatePerformanceChart(blocks, perfData);
    };

    const updatePerformanceChart = (blocks, perfData) => {
        const ctx = document.getElementById('performanceChart');
        if (!ctx) return;

        const labels = [];
        const dR1 = [], dR2 = [], dR3 = [], dBudget = [], dTotal = [];

        blocks.forEach(block => {
            labels.push(block.block_id);
            const bData = perfData.blocks[block.block_id];
            dR1.push(bData.r1);
            dR2.push(bData.r2);
            dR3.push(bData.r3);
            dBudget.push(bData.budget);
            dTotal.push(bData.r1 + bData.r2 + bData.r3);
        });

        if (performanceChartInstance) {
            performanceChartInstance.destroy();
        }

        performanceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '1st Round',
                        data: dR1,
                        backgroundColor: '#60a5fa' // blue
                    },
                    {
                        label: '2nd Round',
                        data: dR2,
                        backgroundColor: '#ef4444' // red
                    },
                    {
                        label: '3rd Round',
                        data: dR3,
                        backgroundColor: '#a3e635' // green
                    },
                    {
                        type: 'line',
                        label: `Budget ${state.selectedReportYear}`,
                        data: dBudget,
                        borderColor: '#8b5cf6', // purple
                        backgroundColor: '#8b5cf6',
                        borderWidth: 0,
                        pointStyle: 'rect',
                        pointRadius: 6,
                        showLine: false
                    },
                    {
                        type: 'line',
                        label: `Total`,
                        data: dTotal,
                        borderColor: '#0ea5e9', // cyan
                        backgroundColor: '#0ea5e9',
                        borderWidth: 0,
                        pointStyle: 'cross',
                        pointRadius: 10,
                        pointBorderWidth: 2,
                        showLine: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: false,
                        title: { display: true, text: 'Block Harvested' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Harvest Amount' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'right',
                    }
                }
            }
        });
    };

    const init = async () => {
        try {
            const addBlockBtn = document.getElementById('add-block-btn');
            if (addBlockBtn) addBlockBtn.onclick = handleGlobalAddBlock;

            const deleteYearBtn = document.getElementById('delete-year-btn');
            if (deleteYearBtn) deleteYearBtn.onclick = handleDeleteYear;

            const res = await fetch('grouped_data.json');
            if (!res.ok) throw new Error("Failed to load block data.");
            const data = await res.json();

            // Load all initial blocks into report year "2025" by default
            state.reports = {};
            state.reports["2025"] = [];

            if (data.groups) {
                data.groups.forEach(group => {
                    const opYear = group.op_year;
                    if (group.blocks) {
                        group.blocks.forEach(b => {
                            state.reports["2025"].push({
                                block_id: b.block_id,
                                ha: b.ha,
                                op_year: opYear,
                                gang: getGangForBlock(b.block_id)
                            });
                        });
                    }
                });
            }

            state.selectedReportYear = "2025";
            state.activeViewType = 'report_year';
            state.activeViewValue = "2025";

            renderSidebar();
            renderTable();
            recalculateTotals();

            loadingEl.classList.add('hidden');
            tableContainer.classList.remove('hidden');

        } catch (error) {
            console.error(error);
            loadingEl.innerHTML = `<p style="color:var(--danger)">Error initializing dashboard: ${error.message}</p>`;
        }
    };

    init();
});
