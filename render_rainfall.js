const renderRainfallTable = () => {
    const rainfallWrapper = document.getElementById('rainfall-wrapper');
    if (!rainfallWrapper) return;
    
    rainfallWrapper.innerHTML = '';
    
    const yearStr = state.selectedReportYear;
    if (!yearStr) return;

    const currentYear = parseInt(yearStr);
    const prevYear = (currentYear - 1).toString();
    const isPrevYearAvailable = state.rainfall && state.rainfall[prevYear];
    
    // Header
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = `SUMMARY REPORT FOR RAINFALL RECORD FOR THE YEAR ${isPrevYearAvailable ? prevYear + ' VS ' : ''}${currentYear}`;
    headerTitle.style.marginBottom = '1.5rem';
    headerTitle.style.fontSize = '1.25rem';
    headerTitle.style.fontWeight = '700';
    headerTitle.style.textTransform = 'uppercase';
    rainfallWrapper.appendChild(headerTitle);

    // Provide a Save button at the top too 
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.style.justifyContent = 'flex-end';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.backgroundColor = '#10b981';
    saveBtn.style.borderColor = '#10b981';
    saveBtn.innerHTML = `<span>💾</span> Save Rainfall Data`;
    saveBtn.onclick = () => {
        saveState();
    };
    toolbar.appendChild(saveBtn);
    rainfallWrapper.appendChild(toolbar);

    // Table Container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    tableContainer.style.background = 'white';
    tableContainer.style.padding = '1.5rem';
    tableContainer.style.borderRadius = '8px';
    tableContainer.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

    const table = document.createElement('table');
    table.className = 'grouped-table';
    table.style.width = '100%';
    table.style.textAlign = 'center';
    
    const thead = document.createElement('thead');
    // Top header row has the Years
    let topHeaderHtml = `
        <tr>
            <th rowspan="2" style="background:#f8fafc; border-bottom:2px solid #e2e8f0; vertical-align:bottom;">MONTH</th>
    `;
    if (isPrevYearAvailable) {
        topHeaderHtml += `<th colspan="3" style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">${prevYear}</th>`;
    }
    topHeaderHtml += `
            <th colspan="3" style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">${currentYear}</th>
    `;
    if (isPrevYearAvailable) {
        topHeaderHtml += `<th colspan="3" style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">${prevYear} vs ${currentYear}</th>`;
    }
    topHeaderHtml += `</tr>`;

    // Sub header row has the column names
    let subHeaderHtml = `<tr>`;
    const colSet = `
        <th style="background:#f8fafc; font-size:0.8rem;">DAYS</th>
        <th style="background:#f8fafc; font-size:0.8rem;">MM</th>
        <th style="background:#f8fafc; font-size:0.8rem;">MM TO MONTH</th>
    `;
    const diffColSet = `
        <th style="background:#f8fafc; font-size:0.8rem;">DAYS DIFF.</th>
        <th style="background:#f8fafc; font-size:0.8rem;">MM DIFF.</th>
        <th style="background:#f8fafc; font-size:0.8rem;">M.T.M DIFF.</th>
    `;
    
    if (isPrevYearAvailable) subHeaderHtml += colSet;
    subHeaderHtml += colSet;
    if (isPrevYearAvailable) subHeaderHtml += diffColSet;
    subHeaderHtml += `</tr>`;

    thead.innerHTML = topHeaderHtml + subHeaderHtml;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    
    let prevCumulative = 0;
    let currCumulative = 0;
    
    let prevTotalDays = 0;
    let prevTotalMM = 0;
    let currTotalDays = 0;
    let currTotalMM = 0;

    months.forEach(month => {
        const tr = document.createElement('tr');
        
        let rowHtml = `<td style="font-weight:600; text-align:left; padding-left:1rem;">${month}</td>`;
        
        // Previous Year Data (Readonly)
        let prevDays = 0, prevMM = 0;
        if (isPrevYearAvailable) {
            const pData = state.rainfall[prevYear][month] || { days:0, mm:0 };
            prevDays = parseFloat(pData.days) || 0;
            prevMM = parseFloat(pData.mm) || 0;
            prevCumulative += prevMM;
            
            prevTotalDays += prevDays;
            prevTotalMM += prevMM;

            rowHtml += `
                <td style="text-align:right;">${prevDays > 0 ? prevDays.toFixed(2) : ''}</td>
                <td style="text-align:right;">${prevMM > 0 ? prevMM.toLocaleString('en-US', {minimumFractionDigits:2}) : ''}</td>
                <td style="text-align:right; font-weight:600;">${prevMM > 0 ? prevCumulative.toLocaleString('en-US', {minimumFractionDigits:2}) : ''}</td>
            `;
        }

        // Current Year Data (Editable)
        const cData = state.rainfall[yearStr][month] || { days:0, mm:0 };
        const currDays = parseFloat(cData.days) || 0;
        const currMM = parseFloat(cData.mm) || 0;
        currCumulative += currMM;

        currTotalDays += currDays;
        currTotalMM += currMM;

        // Current Year Editable Cells
        const tdDays = document.createElement('td');
        const inputDays = document.createElement('input');
        inputDays.type = 'number';
        inputDays.className = 'edit-input text-right';
        inputDays.value = currDays > 0 ? currDays : '';
        inputDays.placeholder = '-';
        inputDays.onchange = (e) => {
            state.rainfall[yearStr][month].days = parseFloat(e.target.value) || 0;
            renderRainfallTable(); // Re-render to update cumulatives and diffs
        };
        tdDays.appendChild(inputDays);

        const tdMM = document.createElement('td');
        const inputMM = document.createElement('input');
        inputMM.type = 'number';
        inputMM.className = 'edit-input text-right';
        inputMM.value = currMM > 0 ? currMM : '';
        inputMM.placeholder = '-';
        inputMM.onchange = (e) => {
            state.rainfall[yearStr][month].mm = parseFloat(e.target.value) || 0;
            renderRainfallTable();
        };
        tdMM.appendChild(inputMM);

        const tdCumMM = document.createElement('td');
        tdCumMM.style.textAlign = 'right';
        tdCumMM.style.fontWeight = '600';
        tdCumMM.textContent = currMM > 0 ? currCumulative.toLocaleString('en-US', {minimumFractionDigits:2}) : '';

        // Difference Data
        let diffHtml = '';
        if (isPrevYearAvailable) {
            // Only calculate diff if current month has data, otherwise shows blank or 0 difference vs large prev number? 
            // In user's image, if month is empty in 2026, diff is completely blank (blacked out).
            // Let's hide difference if current month has no inputted days/mm
            if (currDays > 0 || currMM > 0) {
                const diffDays = currDays - prevDays;
                const diffMM = currMM - prevMM;
                const diffCum = currCumulative - prevCumulative;

                diffHtml = `
                    <td style="text-align:right; ${diffDays < 0 ? 'color:#ef4444;' : ''}">${diffDays.toFixed(2)}</td>
                    <td style="text-align:right; ${diffMM < 0 ? 'color:#ef4444;' : ''}">${diffMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                    <td style="text-align:right; font-weight:600; ${diffCum < 0 ? 'color:#ef4444;' : ''}">${diffCum.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                `;
            } else {
                // Empty blackout cells for no data
                diffHtml = `
                    <td style="background:#1e293b;"></td>
                    <td style="background:#1e293b;"></td>
                    <td style="background:#1e293b;"></td>
                `;
            }
        }

        tr.innerHTML = rowHtml;
        tr.appendChild(tdDays);
        tr.appendChild(tdMM);
        tr.appendChild(tdCumMM);
        
        if (isPrevYearAvailable) {
            tr.insertAdjacentHTML('beforeend', diffHtml);
        }

        // If current year cells are empty, blackout current year cells too like image
        if (currDays === 0 && currMM === 0) {
            tdDays.style.background = '#1e293b';
            tdMM.style.background = '#1e293b';
            tdCumMM.style.background = '#1e293b';
            inputDays.style.color = '#fff';
            inputMM.style.color = '#fff';
            inputDays.style.textAlign = 'center';
            inputMM.style.textAlign = 'center';
        }

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Totals Row
    const tfoot = document.createElement('tfoot');
    const trTotals = document.createElement('tr');
    trTotals.style.background = '#f8fafc';
    trTotals.style.fontWeight = '700';

    let tfootHtml = `<td style="text-align:left; padding-left:1rem; border-top:2px solid #cbd5e1;">TOTAL</td>`;
    
    if (isPrevYearAvailable) {
        tfootHtml += `
            <td style="text-align:right; border-top:2px solid #cbd5e1;">${prevTotalDays.toFixed(2)}</td>
            <td style="text-align:right; border-top:2px solid #cbd5e1;">${prevTotalMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            <td style="border-top:2px solid #cbd5e1;"></td>
        `;
    }
    
    tfootHtml += `
        <td style="text-align:right; border-top:2px solid #cbd5e1;">${currTotalDays > 0 ? currTotalDays.toFixed(2) : ''}</td>
        <td style="text-align:right; border-top:2px solid #cbd5e1;">${currTotalMM > 0 ? currTotalMM.toLocaleString('en-US', {minimumFractionDigits:2}) : ''}</td>
        <td style="border-top:2px solid #cbd5e1;"></td>
    `;

    if (isPrevYearAvailable) {
        const totalDiffDays = currTotalDays - prevTotalDays;
        const totalDiffMM = currTotalMM - prevTotalMM;
        // Total Diff is only relevant if there's *any* data in current year
        if (currTotalDays > 0 || currTotalMM > 0) {
            tfootHtml += `
                <td style="text-align:right; border-top:2px solid #cbd5e1; ${totalDiffDays < 0 ? 'color:#ef4444;' : ''}">${totalDiffDays.toFixed(2)}</td>
                <td style="text-align:right; border-top:2px solid #cbd5e1; ${totalDiffMM < 0 ? 'color:#ef4444;' : ''}">${totalDiffMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                <td style="border-top:2px solid #cbd5e1;"></td>
            `;
        } else {
             tfootHtml += `
                <td style="border-top:2px solid #cbd5e1;"></td>
                <td style="border-top:2px solid #cbd5e1;"></td>
                <td style="border-top:2px solid #cbd5e1;"></td>
            `;
        }
    }

    trTotals.innerHTML = tfootHtml;
    tfoot.appendChild(trTotals);
    table.appendChild(tfoot);

    tableContainer.appendChild(table);
    rainfallWrapper.appendChild(tableContainer);


    // Optional Bottom Summary Widget (like in image: MM TO MONTH 2026 vs 2025)
    if (isPrevYearAvailable && (currTotalDays > 0 || currTotalMM > 0)) {
        // Find latest month with data to summarize
        let lastPopulatedMonthIdx = -1;
        for (let i = months.length - 1; i >= 0; i--) {
            const cm = state.rainfall[yearStr][months[i]] || {days:0, mm:0};
            if (parseFloat(cm.mm) > 0) {
                lastPopulatedMonthIdx = i;
                break;
            }
        }

        if (lastPopulatedMonthIdx > -1) {
            let pCum = 0;
            let cCum = 0;
            for(let i=0; i<=lastPopulatedMonthIdx; i++) {
                pCum += parseFloat(state.rainfall[prevYear][months[i]]?.mm || 0);
                cCum += parseFloat(state.rainfall[yearStr][months[i]]?.mm || 0);
            }
            const diff = cCum - pCum;
            const operator = cCum > pCum ? '>' : cCum < pCum ? '<' : '=';
            const actionWord = cCum < pCum ? 'less' : 'more';

            const summaryWidget = document.createElement('div');
            summaryWidget.style.marginTop = '3rem';
            summaryWidget.style.display = 'inline-block';
            
            summaryWidget.innerHTML = `
                <table class="grouped-table" style="width:auto; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                    <thead>
                        <tr><th colspan="3" style="background:#f8fafc; border:2px solid #1e293b;">MM TO MONTH ${currentYear} vs ${prevYear}</th></tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="3" style="font-weight:700; font-size:1.1rem; border:2px solid #1e293b; color:${diff < 0 ? '#ef4444' : '#16a34a'};">${diff.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
                        <tr>
                            <td style="font-weight:700;">${prevYear}</td>
                            <td style="font-weight:700; padding: 0 1rem;">${operator}</td>
                            <td style="font-weight:700;">${currentYear}</td>
                        </tr>
                    </tbody>
                </table>
                <div style="margin-top:1rem; font-size:0.9rem; font-weight:600; color:#475569;">
                    <p style="margin:0.25rem 0;">*MM TO MONTH as of ${months[lastPopulatedMonthIdx]} for both years</p>
                    <p style="margin:0.25rem 0;">**${currentYear} MM TO MONTH is ${actionWord} than ${prevYear} by ${Math.abs(diff).toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                </div>
            `;
            rainfallWrapper.appendChild(summaryWidget);
        }
    }
};
