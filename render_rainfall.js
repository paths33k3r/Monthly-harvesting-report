(() => {
    const MONTHS = window.RAINFALL_MONTHS || ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const formatNumber = (value) => Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const getCumulativeByMonth = (yearData) => {
        let running = 0;
        const totals = {};
        MONTHS.forEach(month => {
            running += Number(yearData?.[month]?.mm || 0);
            totals[month] = running;
        });
        return totals;
    };

    const calculateTotals = (yearData) => MONTHS.reduce((acc, month) => {
        acc.days += Number(yearData?.[month]?.days || 0);
        acc.mm += Number(yearData?.[month]?.mm || 0);
        return acc;
    }, { days: 0, mm: 0 });

    const buildNumberInput = (value, onChange) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.className = 'edit-input text-right rainfall-input';
        input.value = Number(value || 0).toFixed(2);
        input.addEventListener('change', (event) => {
            onChange(parseFloat(event.target.value) || 0);
        });
        input.addEventListener('blur', () => {
            input.value = Number(input.value || 0).toFixed(2);
        });
        return input;
    };

    window.renderRainfallTable = ({ wrapper, rainfall, activeYear, onDataChange, onSave }) => {
        if (!wrapper) return;
        wrapper.innerHTML = '';

        const years = Object.keys(rainfall || {}).sort((a, b) => Number(a) - Number(b));
        const currentYear = activeYear || years[years.length - 1] || '2026';
        const previousYear = String(Number(currentYear) - 1);

        if (!rainfall[currentYear] && typeof window.createEmptyRainfallYear === 'function') {
            rainfall[currentYear] = window.createEmptyRainfallYear();
        }
        if (!rainfall[previousYear] && typeof window.createEmptyRainfallYear === 'function') {
            rainfall[previousYear] = window.createEmptyRainfallYear();
        }

        const currentData = rainfall[currentYear];
        const previousData = rainfall[previousYear];
        const currentCumulative = getCumulativeByMonth(currentData);
        const previousCumulative = getCumulativeByMonth(previousData);

        const card = document.createElement('section');
        card.className = 'rainfall-card';

        const toolbar = document.createElement('div');
        toolbar.className = 'rainfall-toolbar';
        toolbar.innerHTML = `
            <div>
                <h2>Summary Report for Rainfall Record for the Year ${previousYear} vs ${currentYear}</h2>
                <p>Monthly rainfall comparison with cumulative month-to-month totals.</p>
            </div>
        `;

        const saveButton = document.createElement('button');
        saveButton.className = 'btn-primary';
        saveButton.textContent = 'Save Rainfall Data';
        saveButton.addEventListener('click', () => {
            if (typeof onSave === 'function') onSave();
        });
        toolbar.appendChild(saveButton);
        card.appendChild(toolbar);

        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-container rainfall-table-container';

        const table = document.createElement('table');
        table.className = 'grouped-table rainfall-table';

        table.innerHTML = `
            <thead>
                <tr>
                    <th rowspan="3">MONTH</th>
                    <th colspan="3">${previousYear}</th>
                    <th colspan="3">${currentYear}</th>
                    <th colspan="3">${currentYear} vs ${previousYear}</th>
                </tr>
                <tr>
                    <th colspan="3">RECORD</th>
                    <th colspan="3">RECORD</th>
                    <th colspan="3">DIFF.</th>
                </tr>
                <tr>
                    <th>DAYS</th>
                    <th>MM</th>
                    <th>MM TO MONTH</th>
                    <th>DAYS</th>
                    <th>MM</th>
                    <th>MM TO MONTH</th>
                    <th>DAYS</th>
                    <th>MM</th>
                    <th>MM TO MONTH</th>
                </tr>
            </thead>
        `;

        const tbody = document.createElement('tbody');

        MONTHS.forEach(month => {
            const prevMonth = previousData[month] || { days: 0, mm: 0 };
            const currMonth = currentData[month] || { days: 0, mm: 0 };
            const diffDays = Number(currMonth.days || 0) - Number(prevMonth.days || 0);
            const diffMm = Number(currMonth.mm || 0) - Number(prevMonth.mm || 0);
            const diffCum = Number(currentCumulative[month] || 0) - Number(previousCumulative[month] || 0);

            const tr = document.createElement('tr');
            const monthCell = document.createElement('td');
            monthCell.className = 'rainfall-month';
            monthCell.textContent = month;
            tr.appendChild(monthCell);

            const prevDaysCell = document.createElement('td');
            prevDaysCell.appendChild(buildNumberInput(prevMonth.days, (value) => {
                previousData[month].days = value;
                if (typeof onDataChange === 'function') onDataChange();
            }));
            tr.appendChild(prevDaysCell);

            const prevMmCell = document.createElement('td');
            prevMmCell.appendChild(buildNumberInput(prevMonth.mm, (value) => {
                previousData[month].mm = value;
                if (typeof onDataChange === 'function') onDataChange();
            }));
            tr.appendChild(prevMmCell);

            const prevCumCell = document.createElement('td');
            prevCumCell.textContent = formatNumber(previousCumulative[month]);
            tr.appendChild(prevCumCell);

            const currDaysCell = document.createElement('td');
            currDaysCell.appendChild(buildNumberInput(currMonth.days, (value) => {
                currentData[month].days = value;
                if (typeof onDataChange === 'function') onDataChange();
            }));
            tr.appendChild(currDaysCell);

            const currMmCell = document.createElement('td');
            currMmCell.appendChild(buildNumberInput(currMonth.mm, (value) => {
                currentData[month].mm = value;
                if (typeof onDataChange === 'function') onDataChange();
            }));
            tr.appendChild(currMmCell);

            const currCumCell = document.createElement('td');
            currCumCell.textContent = formatNumber(currentCumulative[month]);
            tr.appendChild(currCumCell);

            const diffDaysCell = document.createElement('td');
            diffDaysCell.textContent = formatNumber(diffDays);
            tr.appendChild(diffDaysCell);

            const diffMmCell = document.createElement('td');
            diffMmCell.textContent = formatNumber(diffMm);
            tr.appendChild(diffMmCell);

            const diffCumCell = document.createElement('td');
            diffCumCell.textContent = formatNumber(diffCum);
            tr.appendChild(diffCumCell);

            tbody.appendChild(tr);
        });

        const previousTotals = calculateTotals(previousData);
        const currentTotals = calculateTotals(currentData);
        const currentYearTotalCumulative = currentCumulative.DEC || 0;
        const previousYearTotalCumulative = previousCumulative.DEC || 0;

        const totalRow = document.createElement('tr');
        totalRow.className = 'row-grand-total rainfall-total-row';
        totalRow.innerHTML = `
            <td>TOTAL</td>
            <td>${formatNumber(previousTotals.days)}</td>
            <td>${formatNumber(previousTotals.mm)}</td>
            <td>${formatNumber(previousYearTotalCumulative)}</td>
            <td>${formatNumber(currentTotals.days)}</td>
            <td>${formatNumber(currentTotals.mm)}</td>
            <td>${formatNumber(currentYearTotalCumulative)}</td>
            <td>${formatNumber(currentTotals.days - previousTotals.days)}</td>
            <td>${formatNumber(currentTotals.mm - previousTotals.mm)}</td>
            <td>${formatNumber(currentYearTotalCumulative - previousYearTotalCumulative)}</td>
        `;
        tbody.appendChild(totalRow);

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);

        // Determine latest month with data to show in summary
        let latestMonthWithData = MONTHS[0];
        MONTHS.forEach(month => {
            const mmValue = Number(currentData?.[month]?.mm || 0);
            if (mmValue > 0) {
                latestMonthWithData = month;
            }
        });

        const latestDiffCumulative = Number(currentCumulative[latestMonthWithData] || 0) - Number(previousCumulative[latestMonthWithData] || 0);

        const note = document.createElement('div');
        note.className = 'rainfall-note';
        note.innerHTML = `
            <div>MM TO MONTH ${currentYear} vs ${previousYear}: <strong>${formatNumber(latestDiffCumulative)}</strong></div>
            <div class="rainfall-note-muted">Edit any month and the comparison updates immediately. Use Save Rainfall Data to persist changes in the browser.</div>
        `;
        card.appendChild(note);

        wrapper.appendChild(card);
    };
})();
