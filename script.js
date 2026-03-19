window.state = window.state || {};
const state = window.state;

document.addEventListener('DOMContentLoaded', () => {
    Object.assign(state, {
        reports: {}, // { "2025": [ { block_id, ha, op_year, gang }, ... ] }
        performance: {}, // { "2025": { "Jan": { "DARSO GANG": { manpower: 17, leave: 0, blocks: { "15": { budget: 56.34, r1: 33.38, r2: 10.51, r3: 20.07, manday: 56 } } } } } } }
        ffbBudget: null,
        rainfall: null,
        harvestingReports: null,
        harvestingReportsMeta: null,
        selectedReportYear: null,
        activeViewType: 'report_year',
        activeViewValue: null,
        activePerfMonth: null
    });

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
    const mainReportWrapper = document.getElementById('main-report-wrapper');

    // Performance and Interval DOM Elements
    const perfWrapper = document.getElementById('performance-wrapper');
    const intervalWrapper = document.getElementById('interval-wrapper');
    const harvestingYtdWrapper = document.getElementById('harvesting-ytd-wrapper');
    const harvesterComparisonWrapper = document.getElementById('harvester-comparison-wrapper');
    const rainfallWrapper = document.getElementById('rainfall-wrapper');

    // Chart instances keyed by gang name
    const performanceChartInstances = {};

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const rainfallMonths = window.RAINFALL_MONTHS || ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    const formatHA = (num) => Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const persistRainfall = () => {
        try {
            localStorage.setItem('monthly-harvesting-rainfall', JSON.stringify(state.rainfall || {}));
        } catch (error) {
            console.warn('Failed to persist rainfall data:', error);
        }
    };

    const initializeRainfallState = () => {
        const fallback = window.INITIAL_RAINFALL_DATA ? JSON.parse(JSON.stringify(window.INITIAL_RAINFALL_DATA)) : {};
        try {
            const stored = localStorage.getItem('monthly-harvesting-rainfall');
            if (stored) {
                const parsed = JSON.parse(stored);
                // Only use stored data if it actually has keys, otherwise use fallback
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    state.rainfall = parsed;
                } else {
                    state.rainfall = fallback;
                    // Fix the bad storage
                    persistRainfall();
                }
            } else {
                state.rainfall = fallback;
            }
        } catch (error) {
            console.warn('Falling back to bundled rainfall data:', error);
            state.rainfall = fallback;
        }

        Object.keys(state.rainfall || {}).forEach((year) => {
            rainfallMonths.forEach((month) => {
                if (!state.rainfall[year][month]) {
                    state.rainfall[year][month] = { days: 0, mm: 0 };
                }
            });
        });
    };

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

    const handleImportExcel = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convert to array of arrays, preserving blank rows directly so we can grab the adjacent 2nd rows
            const excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true });

            if (excelData.length < 4) {
                alert("Excel file does not contain enough data rows.");
                return;
            }

            // Ask user for target month and year when importing this interval data
            const importTargetStr = prompt("Which month and year are you importing this data for? (e.g., Mar 2026)", "Mar 2026");
            if (!importTargetStr) {
                alert("Import cancelled. Month and Year is required to assign interval performance data.");
                return;
            }

            const [monthStr, yearStr] = importTargetStr.trim().split(" ");
            if (!monthStr || !yearStr) {
                alert("Import cancelled. Please enter a valid Month and Year format (e.g., Mar 2026).");
                return;
            }

            const targetMonth = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).toLowerCase();
            const targetYear = yearStr;

            // Ensure we have a report year to add to
            if (!state.reports[targetYear]) {
                handleAddReportYearManual(targetYear);
            }

            // Initialize performance state
            state.performance[targetYear] = state.performance[targetYear] || {};
            state.performance[targetYear][targetMonth] = state.performance[targetYear][targetMonth] || { gangAssignments: {} };

            // In the provided sample, row 3 (index 2) has headers: 'GANG', 'YEAR', 'BLOCK', 'HA', 1, 2...
            // Data actually starts from row 5 (index 4)
            let currentGang = "Unassigned";
            const newBlocks = [];

            for (let i = 4; i < excelData.length; i++) {
                const row = excelData[i];
                if (!row || row.length === 0) continue;

                // If column 0 has text, it's a new gang
                const gangCol = row[0];
                if (gangCol && typeof gangCol === 'string' && gangCol.trim() !== '') {
                    currentGang = gangCol.trim();
                }

                // Year is column 1
                const yearCol = row[1];
                // Block is column 2
                const blockCol = row[2];
                // HA is column 3
                const haCol = row[3];

                if (yearCol && blockCol) {
                    const parsedYear = String(yearCol).trim();
                    if (parsedYear) {
                        // We found a block row
                        const blockId = String(blockCol).trim();
                        const haValue = parseFloat(haCol) || 0;

                        // Days 1..31 start at index 4 (Column E)
                        // Get the current row for rounds, and the next row for manpower
                        const manpowerRow = (i + 1 < excelData.length) ? excelData[i + 1] : [];
                        const daysData = [];
                        for (let d = 0; d < 31; d++) {
                            const roundVal = row[4 + d];
                            const hpVal = manpowerRow[4 + d];

                            daysData.push({
                                roundVal: roundVal != null ? String(roundVal).trim() : "",
                                hpVal: hpVal != null ? String(hpVal).trim() : ""
                            });
                        }

                        // Index 35 is TOTAL MANDAY (Column AJ)
                        const totalManday = parseFloat(row[35]) || 0;
                        // Index 36 is 1ST RD (Column AK)
                        const r1 = parseFloat(row[36]) || 0;
                        // Index 38 is 2ND RD (Column AM, assuming merge cell skip)
                        const r2 = parseFloat(row[38]) || 0;
                        // Index 40 is 3RD RD (Column AO)
                        const r3 = parseFloat(row[40]) || 0;
                        // Index 42 is 4TH RD (Column AQ)
                        const r4 = parseFloat(row[42]) || 0;

                        newBlocks.push({
                            block_id: blockId,
                            ha: haValue,
                            op_year: parsedYear,
                            gang: currentGang,
                            days: daysData,
                            manday: totalManday,
                            r1: r1,
                            r2: r2,
                            r3: r3,
                            r4: r4
                        });

                        // Ensure gang is mapped for the specific month
                        state.performance[targetYear][targetMonth].gangAssignments[blockId] = currentGang;
                    }
                }
            }

            if (newBlocks.length === 0) {
                alert("No valid data found in the Excel file format.");
                return;
            }

            // Select the target year in the UI as the active year
            state.selectedReportYear = targetYear;

            // Merge imported gangs with existing blocks. 
            // DOES NOT inject new blocks into Planting Phase Records.
            newBlocks.forEach(importedBlock => {
                const existing = state.reports[targetYear].find(b => b.block_id === importedBlock.block_id);
                if (existing) {
                    existing.gang = importedBlock.gang;
                }

                // Also update the performance data for the specific block in the target month
                const gangName = importedBlock.gang;
                if (!state.performance[targetYear][targetMonth][gangName]) {
                    state.performance[targetYear][targetMonth][gangName] = { manpower: 0, leave: 0, blocks: {} };
                }
                const pBlocks = state.performance[targetYear][targetMonth][gangName].blocks;

                pBlocks[importedBlock.block_id] = {
                    ha: importedBlock.ha,
                    budget: pBlocks[importedBlock.block_id]?.budget || 0, // preserve budget if it exists
                    manday: importedBlock.manday,
                    r1: importedBlock.r1,
                    r2: importedBlock.r2,
                    r3: importedBlock.r3,
                    r4: importedBlock.r4,
                    days: importedBlock.days
                };
            });

            // Reset input so the same file can be triggered again if needed
            e.target.value = '';

            // Switch view to the newly imported interval
            state.activeViewType = 'interval_month';
            state.activePerfMonth = targetMonth;

            // Update UI
            alert(`Successfully imported ${newBlocks.length} blocks!`);
            renderSidebar();
            renderTable();
            recalculateTotals();
        };
        reader.readAsArrayBuffer(file);
    };



    // Helper for manual import if needed
    const handleAddReportYearManual = (newYearStr) => {
        const newYear = newYearStr.trim();
        if (state.reports[newYear]) return;
        state.reports[newYear] = [];
        state.selectedReportYear = newYear;
        state.activeViewType = 'report_year';
        state.activeViewValue = newYear;
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
        const navHeaderInterval = document.getElementById('nav-header-interval');
        const navHeaderPerf = document.getElementById('nav-header-perf');
        const navHeaderRainfall = document.getElementById('nav-header-rainfall');

        if (navHeaderYear) navHeaderYear.style.color = state.activeViewType === 'report_year' ? 'var(--text-primary)' : '';
        if (navHeaderGangYear) navHeaderGangYear.style.color = state.activeViewType === 'gang' ? 'var(--text-primary)' : '';
        if (navHeaderInterval) navHeaderInterval.style.color = state.activeViewType === 'interval_month' ? 'var(--text-primary)' : '';
        const perfActiveTypes = ['perf_month', 'interval_month', 'harvesting_ytd', 'harvesters_comparison'];
        if (navHeaderPerf) navHeaderPerf.style.color = perfActiveTypes.includes(state.activeViewType) ? 'var(--text-primary)' : '';
        if (navHeaderRainfall) navHeaderRainfall.style.color = state.activeViewType === 'rainfall_record' ? 'var(--text-primary)' : '';

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
        const renderMonthNav = (containerId, targetViewType) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

            reportYears.forEach(year => {
                const liYear = document.createElement('li');
                liYear.className = 'nav-item';

                const isYearOpen = (state.activeViewType === targetViewType && state.selectedReportYear === year) ? 'open' : '';

                const divYearHeader = document.createElement('div');
                divYearHeader.className = `nav-item-header has-children ${isYearOpen}`;
                divYearHeader.innerHTML = `<span class="nav-label">${year}</span><span class="nav-chevron">▼</span>`;

                const ulMonthsContainer = document.createElement('div');
                ulMonthsContainer.className = 'nav-submenu';
                ulMonthsContainer.style.display = isYearOpen ? 'block' : 'none';
                ulMonthsContainer.style.padding = '0.5rem 1rem';

                const selectMonth = document.createElement('select');
                selectMonth.className = 'month-dropdown';
                selectMonth.style.width = '100%';
                selectMonth.style.padding = '0.4rem';
                selectMonth.style.borderRadius = '4px';
                selectMonth.style.border = '1px solid var(--border-color)';
                selectMonth.style.background = 'var(--bg-secondary)';
                selectMonth.style.color = 'var(--text-primary)';
                selectMonth.style.outline = 'none';

                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Select Month...';
                if (!state.activePerfMonth || state.selectedReportYear !== year || state.activeViewType !== targetViewType) {
                    defaultOpt.selected = true;
                }
                selectMonth.appendChild(defaultOpt);

                divYearHeader.onclick = (e) => {
                    e.stopPropagation();
                    const isClosing = divYearHeader.classList.contains('open');
                    if (isClosing) {
                        divYearHeader.classList.remove('open');
                        ulMonthsContainer.style.display = 'none';
                    } else {
                        divYearHeader.classList.add('open');
                        ulMonthsContainer.style.display = 'block';
                    }
                };

                months.forEach(month => {
                    const opt = document.createElement('option');
                    opt.value = month;
                    opt.textContent = month;
                    if (state.activeViewType === targetViewType && state.selectedReportYear === year && state.activePerfMonth === month) {
                        opt.selected = true;
                    }
                    selectMonth.appendChild(opt);
                });

                selectMonth.onchange = (e) => {
                    e.stopPropagation();
                    const selectedMonth = e.target.value;
                    if (selectedMonth) {
                        state.selectedReportYear = year;
                        state.activePerfMonth = selectedMonth;
                        state.activeViewType = targetViewType;
                        renderSidebar();
                        renderTable();
                    } else {
                        state.activeViewType = 'report_year';
                        renderSidebar();
                        renderTable();
                    }
                };

                ulMonthsContainer.appendChild(selectMonth);
                liYear.appendChild(divYearHeader);
                liYear.appendChild(ulMonthsContainer);
                container.appendChild(liYear);
            });
        };

        const updateHarvestingNavLink = (itemId, linkId, viewType) => {
            const item = document.getElementById(itemId);
            const link = document.getElementById(linkId);
            if (item) item.classList.toggle('active', state.activeViewType === viewType);
            if (link) {
                link.onclick = (e) => {
                    e.preventDefault();
                    state.activeViewType = viewType;
                    renderSidebar();
                    renderTable();
                };
            }
        };

        updateHarvestingNavLink('nav-item-harvesting-ytd', 'nav-link-harvesting-ytd', 'harvesting_ytd');
        updateHarvestingNavLink('nav-item-harvesters-comparison', 'nav-link-harvesters-comparison', 'harvesters_comparison');

        renderMonthNav('sidebar-interval-list', 'interval_month');
        renderMonthNav('sidebar-perf-list', 'perf_month');

        const rainfallYearList = document.getElementById('sidebar-rainfall-year-list');
        if (rainfallYearList) {
            rainfallYearList.innerHTML = '';
            const rainfallYears = Object.keys(state.rainfall || {}).sort((a, b) => Number(a) - Number(b));

            rainfallYears.forEach((year) => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                if (state.activeViewType === 'rainfall_record' && state.activeViewValue === year) {
                    li.classList.add('active');
                }

                const link = document.createElement('a');
                link.href = '#';
                link.className = 'nav-link';
                link.textContent = year;
                link.onclick = (e) => {
                    e.preventDefault();
                    state.activeViewType = 'rainfall_record';
                    state.activeViewValue = year;
                    renderSidebar();
                    renderTable();
                };

                li.appendChild(link);
                rainfallYearList.appendChild(li);
            });

            const liAdd = document.createElement('li');
            liAdd.className = 'nav-item';
            const addLink = document.createElement('a');
            addLink.href = '#';
            addLink.className = 'nav-link add-year-link';
            addLink.textContent = 'Add Rainfall Year';
            addLink.onclick = (e) => {
                e.preventDefault();
                const newYear = prompt('Enter rainfall year to add:', String(new Date().getFullYear()));
                if (!newYear || !newYear.trim()) return;
                if (!state.rainfall[newYear]) {
                    state.rainfall[newYear] = typeof createEmptyRainfallYear === 'function'
                        ? createEmptyRainfallYear()
                        : {};
                    persistRainfall();
                }
                state.activeViewType = 'rainfall_record';
                state.activeViewValue = newYear.trim();
                renderSidebar();
                renderTable();
            };
            liAdd.appendChild(addLink);
            rainfallYearList.appendChild(liAdd);
        }
    };

    const renderTable = () => {
        tableBody.innerHTML = '';
        perfWrapper.innerHTML = '';
        intervalWrapper.innerHTML = '';
        if (harvestingYtdWrapper) harvestingYtdWrapper.innerHTML = '';
        if (harvesterComparisonWrapper) harvesterComparisonWrapper.innerHTML = '';
        if (rainfallWrapper) rainfallWrapper.innerHTML = '';

        const isPerfView = state.activeViewType === 'perf_month';
        const isIntervalView = state.activeViewType === 'interval_month';
        const isHarvestingYtdView = state.activeViewType === 'harvesting_ytd';
        const isHarvestersComparisonView = state.activeViewType === 'harvesters_comparison';
        const isRainfallView = state.activeViewType === 'rainfall_record';

        if (!state.selectedReportYear && !isHarvestingYtdView && !isHarvestersComparisonView && !isRainfallView) {
            if (tableTitle) tableTitle.textContent = "No Report Year Selected";
            perfWrapper.classList.add('hidden');
            intervalWrapper.classList.add('hidden');
            tableContainer.classList.add('hidden');
            return;
        }
        if (harvestingYtdWrapper) harvestingYtdWrapper.classList.add('hidden');
        if (harvesterComparisonWrapper) harvesterComparisonWrapper.classList.add('hidden');
        if (rainfallWrapper) rainfallWrapper.classList.add('hidden');

        if (isHarvestingYtdView || isHarvestersComparisonView || isRainfallView) {
            mainReportWrapper.classList.add('hidden');
            perfWrapper.classList.add('hidden');
            intervalWrapper.classList.add('hidden');
            if (harvestingYtdWrapper) harvestingYtdWrapper.classList.toggle('hidden', !isHarvestingYtdView);
            if (harvesterComparisonWrapper) harvesterComparisonWrapper.classList.toggle('hidden', !isHarvestersComparisonView);
            if (rainfallWrapper) rainfallWrapper.classList.toggle('hidden', !isRainfallView);
            if (isHarvestingYtdView) {
                renderHarvestingYtdReport();
            }
            if (isHarvestersComparisonView) {
                renderHarvesterComparisonReport();
            }
            if (isRainfallView && rainfallWrapper && typeof renderRainfallTable === 'function') {
                renderRainfallTable({
                    wrapper: rainfallWrapper,
                    rainfall: state.rainfall || {},
                    activeYear: state.activeViewValue,
                    onDataChange: () => {
                        persistRainfall();
                        renderTable();
                    },
                    onSave: () => {
                        persistRainfall();
                        alert('Rainfall data saved in your browser for this dashboard.');
                    }
                });
            }
            return;
        }

        if (isPerfView) {
            mainReportWrapper.classList.add('hidden');
            intervalWrapper.classList.add('hidden');
            perfWrapper.classList.remove('hidden');
            renderPerformanceTable();
        } else if (isIntervalView) {
            mainReportWrapper.classList.add('hidden');
            perfWrapper.classList.add('hidden');
            intervalWrapper.classList.remove('hidden');
            if (typeof renderIntervalTable === 'function') {
                renderIntervalTable();
            }
        } else {
            perfWrapper.classList.add('hidden');
            intervalWrapper.classList.add('hidden');
            mainReportWrapper.classList.remove('hidden');
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

        perfWrapper.innerHTML = ''; // Start clean

        // Ensure state tree
        state.performance[year] = state.performance[year] || {};
        state.performance[year][month] = state.performance[year][month] || {};

        const blocks = state.reports[year] || [];

        // --- 1. Initialize Month-Specific Gang Assignments ---
        // If this month doesn't have a gang map yet, we build one.
        if (!state.performance[year][month].gangAssignments) {

            // Try to find the previous month to inherit from
            const sortedMonths = [...months]; // Jan, Feb, Mar...
            const currentMonthIdx = sortedMonths.indexOf(month);

            let inheritedMap = null;

            if (currentMonthIdx > 0) {
                // Check previous months in reverse order for an existing map
                for (let i = currentMonthIdx - 1; i >= 0; i--) {
                    const prevMonth = sortedMonths[i];
                    if (state.performance[year][prevMonth] && state.performance[year][prevMonth].gangAssignments) {
                        // Deep copy the previous month's map
                        inheritedMap = JSON.parse(JSON.stringify(state.performance[year][prevMonth].gangAssignments));
                        break;
                    }
                }
            }

            if (inheritedMap) {
                state.performance[year][month].gangAssignments = inheritedMap;
            } else {
                // Fallback: Build from the year's default state
                const newMap = {};
                blocks.forEach(b => {
                    newMap[b.block_id] = b.gang || "Unassigned";
                });
                state.performance[year][month].gangAssignments = newMap;
            }
        }

        const monthAssignments = state.performance[year][month].gangAssignments;

        // Extract gangs from the month-specific map, falling back to any new blocks
        const allGangsInMonth = new Set(Object.values(monthAssignments));
        // Also add any gangs from blocks that might be newly added to the year but not mapped yet
        blocks.forEach(b => {
            if (!monthAssignments[b.block_id]) {
                monthAssignments[b.block_id] = b.gang || "Unassigned";
                allGangsInMonth.add(b.gang || "Unassigned");
            }
        });

        const gangs = [...allGangsInMonth].filter(b => b && b !== "Unassigned").sort();

        if (gangs.length === 0) {
            perfWrapper.innerHTML = '<p style="padding: 2rem;">No harvesting gangs found for this year. Please assign blocks to gangs first.</p>';
            return;
        }

        gangs.forEach((gangName, gangIndex) => {
            const perfData = state.performance[year][month][gangName] || { manpower: 0, leave: 0, blocks: {} };
            state.performance[year][month][gangName] = perfData;

            // Filter blocks for this specific gang based on the MONTH-SPECIFIC map
            const gBlocks = blocks.filter(b => monthAssignments[b.block_id] === gangName);
            if (gBlocks.length === 0) return; // skip empty gangs

            // Create wrapper block for this gang
            const gangWrapper = document.createElement('div');
            // Adding specific bottom margin to separate gangs clearly
            gangWrapper.style.marginBottom = '3rem';
            gangWrapper.style.padding = '0'; // Clean grouping

            const safeGangId = gangName.replace(/[^a-zA-Z0-9]/g, '_');

            gangWrapper.innerHTML = `
                <div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <h2>HARVESTER PERFORMANCE CHART FOR THE MONTH OF ${month.toUpperCase()} ${year}</h2>
                        <div class="perf-stats">
                            <div class="stat-row">
                                <label>HARVESTER TEAM:</label>
                                <span class="font-bold">${gangName.toUpperCase()}</span>
                            </div>
                            <div class="stat-row">
                                <label>TOTAL MANPOWER:</label>
                                <input type="number" id="perf-manpower-${safeGangId}" class="edit-input" style="width: 80px; padding: 0.25rem; border: 1px solid var(--border-color);" value="${perfData.manpower || 0}" min="0">
                            </div>
                            <div class="stat-row">
                                <label>TOTAL ON LONG LEAVE:</label>
                                <input type="number" id="perf-leave-${safeGangId}" class="edit-input" style="width: 80px; padding: 0.25rem; border: 1px solid var(--border-color);" value="${perfData.leave || 0}" min="0">
                            </div>
                        </div>
                    </div>
                    <div>
                        <button class="btn-primary" id="btn-transfer-${safeGangId}" style="margin-bottom: 0.5rem; font-size: 0.8rem; padding: 0.4rem 0.8rem;">
                            <span>⇄</span> Transfer Block Here
                        </button>
                    </div>
                </div>

                <div class="table-container">
                    <table class="grouped-table" id="perf-table-${safeGangId}">
                        <thead>
                            <tr>
                                <th>Block</th>
                                <th>HA per Block</th>
                                <th>Budget ${year}</th>
                                <th>1st Round</th>
                                <th>2nd Round</th>
                                <th>3rd Round</th>
                                <th class="col-total">Total</th>
                                <th>Manday</th>
                                <th>MT / Manday</th>
                                <th class="col-actions"></th>
                            </tr>
                        </thead>
                        <tbody id="perf-table-body-${safeGangId}">
                            <!-- Generated by JS -->
                        </tbody>
                        <tfoot>
                            <tr class="row-grand-total">
                                <td colspan="1" class="grand-total-label">Total</td>
                                <td id="pTotalHa-${safeGangId}">0.00</td>
                                <td id="pTotalBudget-${safeGangId}">0.00</td>
                                <td id="pTotalR1-${safeGangId}">0.00</td>
                                <td id="pTotalR2-${safeGangId}">0.00</td>
                                <td id="pTotalR3-${safeGangId}">0.00</td>
                                <td id="pTotalAll-${safeGangId}">0.00</td>
                                <td id="pTotalManday-${safeGangId}">0.00</td>
                                <td id="pTotalMtManday-${safeGangId}">0.00</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="perf-dashboard-bottom">
                    <div class="chart-container">
                        <canvas id="performanceChart-${safeGangId}"></canvas>
                    </div>
                    <div class="summary-stats-side">
                        <div class="side-stat-box">
                            <div class="stat-title">MT per person</div>
                            <div class="stat-val" id="statMtPerson-${safeGangId}">0.00</div>
                        </div>
                        <div class="side-stat-box">
                            <div class="stat-title">HA per person</div>
                            <div class="stat-val" id="statHaPerson-${safeGangId}">0.00</div>
                        </div>
                        <div class="side-stat-box">
                            <div class="stat-title">Ratio HA to MT per person</div>
                            <div class="stat-val" id="statRatio-${safeGangId}">0:0</div>
                        </div>
                    </div>
                </div>
            `;

            perfWrapper.appendChild(gangWrapper);

            const perfTableBody = document.getElementById(`perf-table-body-${safeGangId}`);
            const inputManpower = document.getElementById(`perf-manpower-${safeGangId}`);
            const inputLeave = document.getElementById(`perf-leave-${safeGangId}`);

            inputManpower.oninput = (e) => { perfData.manpower = parseFloat(e.target.value) || 0; calculatePerformanceTotals(perfData, gBlocks, safeGangId); };
            inputLeave.oninput = (e) => { perfData.leave = parseFloat(e.target.value) || 0; calculatePerformanceTotals(perfData, gBlocks, safeGangId); };

            const btnTransfer = document.getElementById(`btn-transfer-${safeGangId}`);
            if (btnTransfer) {
                btnTransfer.onclick = () => {
                    const blockId = prompt(`Enter Block ID to transfer to ${gangName} for ${month} ${year}:`);
                    if (!blockId) return;

                    const blockToTransfer = blocks.find(b => b.block_id === blockId.trim());
                    if (!blockToTransfer) {
                        alert(`Block '${blockId}' not found in Year ${year}. Cannot transfer block.`);
                        return;
                    }

                    // Reassign just for this month
                    monthAssignments[blockToTransfer.block_id] = gangName;

                    // Add this gang to the master list if it somehow wasn't (edge case)
                    if (!allGangsInMonth.has(gangName)) allGangsInMonth.add(gangName);

                    renderPerformanceTable();
                };
            }

            const createPerfInput = (bData, field, onChange) => {
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'edit-input text-right';
                input.step = '0.01';
                input.value = (bData[field] || 0).toFixed(2);
                input.oninput = (e) => {
                    const parsed = parseFloat(e.target.value) || 0;
                    onChange(parsed);
                    calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                };
                input.onblur = (e) => { e.target.value = (parseFloat(e.target.value) || 0).toFixed(2); };
                td.appendChild(input);
                return td;
            };

            gBlocks.forEach(block => {
                const bId = block.block_id;
                if (!perfData.blocks[bId]) {
                    perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, manday: 0 };
                }
                const bData = perfData.blocks[bId];

                const tr = document.createElement('tr');
                tr.innerHTML = `<td class="text-center cell-block">${bId}</td><td class="text-right">${formatHA(block.ha)}</td>`;

                tr.appendChild(createPerfInput(bData, 'budget', (v) => bData.budget = v));
                tr.appendChild(createPerfInput(bData, 'r1', (v) => bData.r1 = v));
                tr.appendChild(createPerfInput(bData, 'r2', (v) => bData.r2 = v));
                tr.appendChild(createPerfInput(bData, 'r3', (v) => bData.r3 = v));

                const tdTotal = document.createElement('td');
                tdTotal.className = 'text-right font-bold col-total';
                tdTotal.id = `perf-row-total-${safeGangId}-${bId}`;
                tdTotal.textContent = formatHA(bData.r1 + bData.r2 + bData.r3);
                tr.appendChild(tdTotal);

                tr.appendChild(createPerfInput(bData, 'manday', (v) => bData.manday = v));

                const tdMtManday = document.createElement('td');
                tdMtManday.className = 'text-right font-bold';
                tdMtManday.id = `perf-row-mt-${safeGangId}-${bId}`;
                const totalRound = bData.r1 + bData.r2 + bData.r3;
                tdMtManday.textContent = bData.manday > 0 ? (totalRound / bData.manday).toFixed(2) : "0.00";
                tr.appendChild(tdMtManday);

                // Delete (Remove from Gang) Actions
                const tdActions = document.createElement('td');
                tdActions.className = 'cell-actions';
                const btnRemove = document.createElement('button');
                btnRemove.className = 'btn-icon delete';
                btnRemove.title = `Remove block from ${gangName} for ${month} ${year}`;
                btnRemove.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                btnRemove.onclick = () => {
                    const confirmRemove = confirm(`Are you sure you want to remove block ${bId} from ${gangName} for this month only?`);
                    if (!confirmRemove) return;

                    monthAssignments[bId] = "Unassigned";
                    renderPerformanceTable();
                };
                tdActions.appendChild(btnRemove);
                tr.appendChild(tdActions);

                perfTableBody.appendChild(tr);
            });

            calculatePerformanceTotals(perfData, gBlocks, safeGangId);
        });
    };

    const calculatePerformanceTotals = (perfData, blocks, safeGangId) => {
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

                const rowTotalEl = document.getElementById(`perf-row-total-${safeGangId}-${bId}`);
                const rowMtEl = document.getElementById(`perf-row-mt-${safeGangId}-${bId}`);

                if (rowTotalEl) rowTotalEl.textContent = formatHA(rowTotal);
                if (rowMtEl) rowMtEl.textContent = bData.manday > 0 ? (rowTotal / bData.manday).toFixed(2) : "0.00";
            }
        });

        const pTotalHa = document.getElementById(`pTotalHa-${safeGangId}`);
        const pTotalBudget = document.getElementById(`pTotalBudget-${safeGangId}`);
        const pTotalR1 = document.getElementById(`pTotalR1-${safeGangId}`);
        const pTotalR2 = document.getElementById(`pTotalR2-${safeGangId}`);
        const pTotalR3 = document.getElementById(`pTotalR3-${safeGangId}`);
        const pTotalAll = document.getElementById(`pTotalAll-${safeGangId}`);
        const pTotalManday = document.getElementById(`pTotalManday-${safeGangId}`);
        const pTotalMtManday = document.getElementById(`pTotalMtManday-${safeGangId}`);

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

        const statMtPerson = document.getElementById(`statMtPerson-${safeGangId}`);
        const statHaPerson = document.getElementById(`statHaPerson-${safeGangId}`);
        const statRatio = document.getElementById(`statRatio-${safeGangId}`);

        if (statMtPerson) statMtPerson.textContent = mtPerson;
        if (statHaPerson) statHaPerson.textContent = haPerson;

        if (statRatio && mtPerson !== "0.00" && haPerson !== "0.00") {
            const ratio = (parseFloat(mtPerson) / parseFloat(haPerson)).toFixed(2);
            statRatio.textContent = `1:${ratio}`;
        } else {
            if (statRatio) statRatio.textContent = "0:0";
        }

        updatePerformanceChart(blocks, perfData, safeGangId);
    };

    const updatePerformanceChart = (blocks, perfData, safeGangId) => {
        const ctx = document.getElementById(`performanceChart-${safeGangId}`);
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

        if (performanceChartInstances[safeGangId]) {
            performanceChartInstances[safeGangId].destroy();
        }

        performanceChartInstances[safeGangId] = new Chart(ctx, {
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

    const renderIntervalTable = () => {
        const year = state.selectedReportYear;
        const month = state.activePerfMonth;

        intervalWrapper.innerHTML = ''; // Start clean

        // Ensure state tree
        state.performance[year] = state.performance[year] || {};
        state.performance[year][month] = state.performance[year][month] || {};

        let blocks = [...(state.reports[year] || [])];
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
        blocks.sort((a, b) => parseFloat(a.block_id) - parseFloat(b.block_id));

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

        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '3rem';
        wrapper.style.padding = '0';

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
                <div class="summary-table-container" style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 0.85rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">1ST RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">2ND RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">3RD RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">4TH RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--primary-color); font-weight: 700;">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td id="interval-sum-r1" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r2" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r3" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r4" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-total" style="padding: 0.25rem 0.5rem; font-weight: 700; color: var(--primary-color);">0.00</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="table-container" style="overflow-x: auto; padding-bottom: 2rem;">
                <table class="grouped-table" style="min-width: 1500px;" id="interval-table-all">
                    <thead>
                        <tr>
                            <th style="min-width: 60px; position: sticky; left: 0; background: var(--bg-primary); z-index: 1; border-right: 2px solid var(--border-color);">BLOCK</th>
                            <th style="min-width: 80px; border-right: 2px solid var(--border-color);">HA</th>
                            ${Array.from({ length: 31 }, (_, i) => `<th style="min-width: 40px; text-align: center; font-size: 0.8em; padding: 0.2rem;">${i + 1}</th>`).join('')}
                            <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">TOTAL MANDAY</th>
                            <th style="min-width: 80px; text-align: center;">1ST RD</th>
                            <th style="min-width: 80px; text-align: center;">2ND RD</th>
                            <th style="min-width: 80px; text-align: center;">3RD RD</th>
                            <th style="min-width: 80px; text-align: center;">4TH RD</th>
                        </tr>
                    </thead>
                    <tbody id="interval-table-body-all">
                    </tbody>
                </table>
            </div>
        `;

        intervalWrapper.appendChild(wrapper);

        const tbody = document.getElementById(`interval-table-body-all`);

        let sR1 = 0, sR2 = 0, sR3 = 0, sR4 = 0;

        blocks.forEach(block => {
            const bId = block.block_id;
            const gangName = monthAssignments[bId] || block.gang || "Unassigned";

            // Ensure gang object exists
            if (!state.performance[year][month][gangName]) {
                state.performance[year][month][gangName] = { manpower: 0, leave: 0, blocks: {} };
            }
            const perfData = state.performance[year][month][gangName];

            if (!perfData.blocks[bId]) {
                perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, r4: 0, manday: 0, days: new Array(31).fill("") };
            }
            const bData = perfData.blocks[bId];
            if (!bData.days) bData.days = new Array(31).fill("");
            if (typeof bData.r4 === "undefined") bData.r4 = 0;

            sR1 += bData.r1 || 0;
            sR2 += bData.r2 || 0;
            sR3 += bData.r3 || 0;
            sR4 += bData.r4 || 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="position: sticky; left: 0; background: var(--bg-primary); font-weight: 500; border-right: 2px solid var(--border-color);" class="text-center cell-block">${bId}</td>
                            <td class="text-right" style="border-right: 2px solid var(--border-color);">${formatHA(block.ha)}</td>`;

            bData.days.forEach((dayObj, i) => {
                // Support both legacy array format and new object format
                const isObj = typeof dayObj === 'object' && dayObj !== null;
                const roundVal = isObj ? dayObj.roundVal : dayObj;
                const hpVal = isObj ? dayObj.hpVal : "";

                const td = document.createElement('td');
                td.style.padding = '0';

                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                wrapper.style.height = '100%';
                wrapper.style.minHeight = '3.5rem';

                const inputTop = document.createElement('input');
                inputTop.type = 'text';
                inputTop.className = 'edit-input text-center';
                inputTop.style.width = '100%';
                inputTop.style.flex = '1';
                inputTop.style.padding = '0.2rem 0';
                inputTop.style.border = 'none';
                inputTop.style.borderBottom = '1px solid var(--border-color)';
                inputTop.style.background = 'transparent';
                inputTop.value = roundVal || "";
                inputTop.onchange = (e) => {
                    if (!isObj) bData.days[i] = { roundVal: e.target.value, hpVal: "" };
                    else bData.days[i].roundVal = e.target.value;
                };

                const inputBot = document.createElement('input');
                inputBot.type = 'text';
                inputBot.className = 'edit-input text-center';
                inputBot.style.width = '100%';
                inputBot.style.flex = '1';
                inputBot.style.padding = '0.2rem 0';
                inputBot.style.border = 'none';
                inputBot.style.background = 'transparent';
                inputBot.style.color = '#ef4444'; // Red color for manpower
                inputBot.value = hpVal || "";
                inputBot.onchange = (e) => {
                    if (!isObj) bData.days[i] = { roundVal: dayObj, hpVal: e.target.value };
                    else bData.days[i].hpVal = e.target.value;
                };

                wrapper.appendChild(inputTop);
                wrapper.appendChild(inputBot);
                td.appendChild(wrapper);
                tr.appendChild(td);
            });

            const createPerfInput = (field, onChange, extraStyle = "") => {
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
                if (extraStyle) td.style.cssText = extraStyle;
                td.appendChild(input);
                return td;
            };

            tr.appendChild(createPerfInput('manday', (v) => bData.manday = v, "border-left: 2px solid var(--border-color);"));
            tr.appendChild(createPerfInput('r1', (v) => { bData.r1 = v; renderIntervalTable(); }));
            tr.appendChild(createPerfInput('r2', (v) => { bData.r2 = v; renderIntervalTable(); }));
            tr.appendChild(createPerfInput('r3', (v) => { bData.r3 = v; renderIntervalTable(); }));
            tr.appendChild(createPerfInput('r4', (v) => { bData.r4 = v; renderIntervalTable(); }));

            tbody.appendChild(tr);
        });

        // Set the summary totals
        const sumR1El = document.getElementById('interval-sum-r1');
        const sumR2El = document.getElementById('interval-sum-r2');
        const sumR3El = document.getElementById('interval-sum-r3');
        const sumR4El = document.getElementById('interval-sum-r4');
        const sumTotalEl = document.getElementById('interval-sum-total');

        if (sumR1El) sumR1El.textContent = formatHA(sR1);
        if (sumR2El) sumR2El.textContent = formatHA(sR2);
        if (sumR3El) sumR3El.textContent = formatHA(sR3);
        if (sumR4El) sumR4El.textContent = formatHA(sR4);
        if (sumTotalEl) sumTotalEl.textContent = formatHA(sR1 + sR2 + sR3 + sR4);
    };


    const renderHarvestingReportTable = (wrapper, report, fallbackTitle) => {
        if (!wrapper) return;
        wrapper.innerHTML = '';

        if (!report || !Array.isArray(report.rows) || report.rows.length === 0) {
            const message = document.createElement('p');
            message.style.padding = '1rem';
            message.textContent = 'Report data is not available yet. Please run the extraction script and refresh.';
            wrapper.appendChild(message);
            return;
        }

        const sanitized = report.rows.filter(row => row && row.some(cell => String(cell).trim()));
        if (sanitized.length === 0) {
            const message = document.createElement('p');
            message.style.padding = '1rem';
            message.textContent = 'No non-empty rows were found in this worksheet.';
            wrapper.appendChild(message);
            return;
        }

        const headerCount = Math.min(3, sanitized.length);
        const headerRows = sanitized.slice(0, headerCount);
        const bodyRows = sanitized.slice(headerCount);

        const titleEl = document.createElement('h2');
        titleEl.textContent = report.title || fallbackTitle || 'Harvesting Report';
        titleEl.style.marginBottom = '0.75rem';
        titleEl.style.fontSize = '1.1rem';
        titleEl.style.fontWeight = '700';
        wrapper.appendChild(titleEl);

        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        tableContainer.style.background = 'var(--bg-card)';
        tableContainer.style.padding = '0';
        tableContainer.style.overflowX = 'auto';

        const table = document.createElement('table');
        table.className = 'grouped-table';
        table.style.width = 'max-content';
        table.style.borderCollapse = 'collapse';
        table.style.marginBottom = '1rem';

        const buildRow = (row, isHeader = false) => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const cellEl = document.createElement(isHeader ? 'th' : 'td');
                cellEl.textContent = cell;
                cellEl.style.border = '1px solid #000';
                cellEl.style.padding = '0.35rem 0.6rem';
                cellEl.style.minWidth = '80px';
                cellEl.style.textAlign = 'right';
                if (isHeader) {
                    cellEl.style.fontWeight = '700';
                    cellEl.style.background = '#f7f7f7';
                    cellEl.style.textAlign = 'center';
                }
                tr.appendChild(cellEl);
            });
            return tr;
        };

        const thead = document.createElement('thead');
        headerRows.forEach(row => thead.appendChild(buildRow(row, true)));

        const tbody = document.createElement('tbody');
        if (bodyRows.length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = headerRows[headerRows.length - 1]?.length || 1;
            emptyCell.style.border = '1px solid #000';
            emptyCell.style.padding = '0.5rem';
            emptyCell.style.textAlign = 'center';
            emptyCell.textContent = 'No additional rows in this report.';
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
        } else {
            bodyRows.forEach(row => tbody.appendChild(buildRow(row)));
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        wrapper.appendChild(tableContainer);

        if (state.harvestingReportsMeta) {
            const meta = document.createElement('p');
            meta.style.fontSize = '0.85rem';
            meta.style.color = 'var(--text-secondary)';
            meta.style.margin = '0';
            meta.textContent = `Generated ${state.harvestingReportsMeta.generatedAt || ''} - Source: ${state.harvestingReportsMeta.sourceWorkbook || ''}`;
            wrapper.appendChild(meta);
        }
    };

    const renderHarvestingYtdReport = () => {
        renderHarvestingReportTable(harvestingYtdWrapper, state.harvestingReports?.harvestingYtdByGang, 'Harvesting YTD by Gang');
    };

    const renderHarvesterComparisonReport = () => {
        renderHarvestingReportTable(harvesterComparisonWrapper, state.harvestingReports?.harvestersMonthComparison, "Harvesters' Current vs Previous Month");
    };

    const loadHarvestingReports = async () => {
        try {
            const res = await fetch('harvesting_performance_reports.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.harvestingReports = data.reports || {};
            state.harvestingReportsMeta = {
                generatedAt: data.generatedAt,
                sourceWorkbook: data.sourceWorkbook
            };
        } catch (error) {
            console.error('Failed to load harvesting reports asset:', error);
            state.harvestingReports = null;
            state.harvestingReportsMeta = null;
        }
    };

    const init = async () => {
        try {
            initializeRainfallState();
            await loadHarvestingReports();

            const tBtn = document.getElementById('sidebar-download-template');
            if (tBtn) {
                tBtn.onclick = (e) => {
                    e.preventDefault();
                    const bStr = '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';
                    const uri = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + bStr;
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = uri;
                    a.download = 'Harvesting_Template.xlsx';
                    document.body.appendChild(a);
                    a.click();

                    setTimeout(() => {
                        document.body.removeChild(a);
                    }, 100);
                };
            }
            const addBlockBtn = document.getElementById('add-block-btn');
            if (addBlockBtn) addBlockBtn.onclick = handleGlobalAddBlock;

            const deleteYearBtn = document.getElementById('delete-year-btn');
            if (deleteYearBtn) deleteYearBtn.onclick = handleDeleteYear;


            const importExcelBtn = document.getElementById('sidebar-import-excel');
            const importExcelInput = document.getElementById('sidebar-import-input');

            if (importExcelBtn && importExcelInput) {
                importExcelBtn.onclick = () => importExcelInput.click();
                importExcelInput.onchange = handleImportExcel;
            }

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
