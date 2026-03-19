(() => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const createEmptyRainfallYear = () => {
        const months = {};
        MONTHS.forEach(month => {
            months[month] = { days: 0, mm: 0 };
        });
        return months;
    };

    const rainfall2025 = createEmptyRainfallYear();
    Object.assign(rainfall2025, {
        JAN: { days: 25, mm: 1059 },
        FEB: { days: 14, mm: 415 },
        MAR: { days: 22, mm: 524 },
        APR: { days: 19, mm: 344 },
        MAY: { days: 16, mm: 295 },
        JUN: { days: 15, mm: 172 },
        JUL: { days: 11, mm: 86 },
        AUG: { days: 15, mm: 166 },
        SEP: { days: 16, mm: 298 },
        OCT: { days: 14, mm: 213 },
        NOV: { days: 20, mm: 384 },
        DEC: { days: 25, mm: 639 }
    });

    const rainfall2026 = createEmptyRainfallYear();
    rainfall2026.JAN = { days: 12, mm: 704 };

    window.RAINFALL_MONTHS = MONTHS;
    window.createEmptyRainfallYear = createEmptyRainfallYear;
    window.INITIAL_RAINFALL_DATA = {
        '2025': rainfall2025,
        '2026': rainfall2026
    };
})();
