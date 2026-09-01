// ─────────────────────────────────────────────────────────────────────────
// render_interval_monitor.js — ⏱ Interval Monitor
//
// Fifth sub-tab under 📈 Harvesting Performance. Turns the day-counter grid
// already imported into the Harvesting Interval view into interval-compliance
// monitoring against the estate's "no gap between rounds beyond N days"
// target (default 15).
//
// HOW THE SOURCE GRID ENCODES INTERVALS (decoded from the daily-report
// workbook, validated against all 33 blocks of Aug 2026):
//   • row N  (days[i].roundVal) = days since the CURRENT round started,
//     incremented every calendar day whether harvested or not.
//   • row N+1 (days[i].hpVal)   = manpower that day; blank = no harvesting.
//   • counter back to 1         = a new round starts that day.
//   • counter on the day BEFORE a reset = the interval just closed, i.e. the
//     days between two round starts. It already carries the tail of the
//     previous month, so an interval is computable from one month's sheet.
//   • the green / yellow / red fills in the workbook carry NO extra
//     information: a filled cell is exactly a cell with manpower under it
//     (checked cell by cell over E5:AI70 — 100% match, no exceptions), and
//     the round number is simply the order of WORKED rounds within the
//     month. Deriving it that way reproduced the clerk's colouring on 60 of
//     61 rounds, so this module derives instead of reading fills (which the
//     SheetJS importer cannot see anyway) and flags the divergences.
//   • a round carried in from the previous month counts as that month's 1st
//     round ONLY if harvesting actually continued into the month; a bare
//     counter with no manpower is just the tail of last month's interval.
//
// Purely a DERIVED view: reads state.performance and stores nothing but the
// user's own settings (target days, selected week) inside state — no new
// Firebase path, no security-rule change, no save function of its own.
// Access: menu key 'performance' (shared with the rest of the group).
// ─────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const IM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const IM_DEFAULT_TARGET = 15;
    // Round colours mirror the workbook: 1st green, 2nd yellow, 3rd red.
    // A 4th round has no colour in the source sheet (though it has a 4TH RD
    // column), so it gets blue here rather than being indistinguishable.
    const IM_ROUND_COLORS = { 1: '#00B050', 2: '#FFFF00', 3: '#FF0000', 4: '#00B0F0' };
    const IM_ROUND_TEXT = { 1: '#ffffff', 2: '#111111', 3: '#ffffff', 4: '#111111' };
    const IM_ROUND_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
    // A block whose counter never resets for this long is treated as out of
    // the harvesting rotation (the workbook carries a couple sitting at 416
    // days) and kept out of the compliance averages.
    const IM_DORMANT_DAYS = 60;

    const imEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));
    const imNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const imPad = (n) => String(n).padStart(2, '0');
    const imIso = (d) => d.getFullYear() + '-' + imPad(d.getMonth() + 1) + '-' + imPad(d.getDate());
    const imDayMs = 86400000;
    const imDaysInMonth = (y, mIdx) => new Date(y, mIdx + 1, 0).getDate();
    const imDiffDays = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
        new Date(a.getFullYear(), a.getMonth(), a.getDate())) / imDayMs);
    const imFmtDate = (d) => d ? `${imPad(d.getDate())} ${IM_MONTHS[d.getMonth()]}` : '—';
    const imFmtFull = (d) => d ? `${imPad(d.getDate())} ${IM_MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
    const imFmtHa = (n) => imNum(n).toFixed(2);

    // ── target ───────────────────────────────────────────────────────────
    window.imTarget = () => {
        const t = parseInt(window.state && window.state.intervalTargetDays, 10);
        return (!isNaN(t) && t >= 3 && t <= 60) ? t : IM_DEFAULT_TARGET;
    };

    // ── ISO week helpers (Mon–Sun, weeks cross month ends) ───────────────
    const imIsoWeek = (d) => {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = (t.getUTCDay() + 6) % 7;           // Mon = 0
        t.setUTCDate(t.getUTCDate() - dayNum + 3);        // the week's Thursday
        const isoYear = t.getUTCFullYear();
        const jan4 = new Date(Date.UTC(isoYear, 0, 4));
        const week = 1 + Math.round(((t - jan4) / imDayMs - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
        return { year: isoYear, week };
    };
    const imIsoWeekStart = (isoYear, week) => {
        const jan4 = new Date(isoYear, 0, 4);
        const mon1 = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7));
        return new Date(mon1.getFullYear(), mon1.getMonth(), mon1.getDate() + (week - 1) * 7);
    };
    const imWeekKey = (isoYear, week) => `${isoYear}-W${imPad(week)}`;
    const imParseWeekKey = (key) => {
        const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ''));
        return m ? { year: parseInt(m[1], 10), week: parseInt(m[2], 10) } : null;
    };
    const imWeekLabel = (isoYear, week) => {
        const s = imIsoWeekStart(isoYear, week);
        const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
        return `W${imPad(week)} · ${imFmtDate(s)} – ${imFmtFull(e)}`;
    };

    // ── read one grid cell (supports the legacy plain-string format) ─────
    const imCell = (cell) => {
        const isObj = cell && typeof cell === 'object';
        const rvRaw = isObj ? cell.roundVal : cell;
        const hvRaw = isObj ? cell.hpVal : '';
        const rv = String(rvRaw == null ? '' : rvRaw).trim();
        const hv = String(hvRaw == null ? '' : hvRaw).trim();
        const counter = /^\d+$/.test(rv) ? parseInt(rv, 10) : null;
        return { counter, manday: imNum(hv) };
    };

    // ── collect every block's day records for a year ─────────────────────
    // → { blockId: { blockId, ha, opYear, gangByMonth, tl:[dayRec] } } where
    //   dayRec = { date, monthIdx, day, counter, manday, gang }.
    const imCollect = (year) => {
        const perfYear = (window.state.performance || {})[year] || {};
        const reports = (window.state.reports || {})[year] || [];
        const haById = {}, opYearById = {};
        (Array.isArray(reports) ? reports : []).forEach(b => {
            const k = String(b.block_id).trim();
            haById[k] = imNum(b.ha);
            opYearById[k] = b.op_year || b.year || '';
        });

        const out = {};
        IM_MONTHS.forEach((mName, mIdx) => {
            const monthObj = perfYear[mName];
            if (!monthObj || typeof monthObj !== 'object') return;
            const dim = imDaysInMonth(parseInt(year, 10), mIdx);
            Object.keys(monthObj).forEach(gang => {
                if (gang === 'gangAssignments') return;
                const blocks = monthObj[gang] && monthObj[gang].blocks;
                if (!blocks || typeof blocks !== 'object') return;
                Object.keys(blocks).forEach(bId => {
                    const bd = blocks[bId];
                    const days = bd && bd.days;
                    if (!Array.isArray(days)) return;
                    const key = String(bId).trim();
                    const rec = out[key] || (out[key] = {
                        blockId: key, ha: haById[key] || imNum(bd.ha), opYear: opYearById[key] || '',
                        gangByMonth: {}, tl: []
                    });
                    if (!rec.ha) rec.ha = imNum(bd.ha);
                    rec.gangByMonth[mIdx] = gang;
                    for (let d = 0; d < days.length && d < dim; d++) {
                        const cell = imCell(days[d]);
                        if (cell.counter == null && !cell.manday) continue;
                        rec.tl.push({
                            date: new Date(parseInt(year, 10), mIdx, d + 1),
                            monthIdx: mIdx, day: d + 1, counter: cell.counter, manday: cell.manday, gang
                        });
                    }
                });
            });
        });
        Object.keys(out).forEach(k => out[k].tl.sort((a, b) => a.date - b.date));
        return out;
    };

    // ── split a timeline into rounds (segments between counter resets) ───
    const imRounds = (tl) => {
        const rounds = [];
        let cur = null;
        tl.forEach((rec, i) => {
            if (rec.counter === 1) {
                if (cur) rounds.push(cur);
                cur = { start: rec.date, startIdx: i, days: [], workDays: [], manpower: 0 };
            } else if (!cur) {
                // data opens mid-round (carried in from an un-imported month)
                cur = { start: null, startIdx: i, days: [], workDays: [], manpower: 0, carriedIn: true };
            }
            cur.days.push(rec);
            if (rec.manday > 0) { cur.workDays.push(rec); cur.manpower += rec.manday; }
        });
        if (cur) rounds.push(cur);

        rounds.forEach((r, k) => {
            r.worked = r.workDays.length > 0;
            r.end = r.days[r.days.length - 1].date;
            r.lastCounter = null;
            for (let i = r.days.length - 1; i >= 0; i--) {
                if (r.days[i].counter != null) { r.lastCounter = r.days[i].counter; break; }
            }
            r.open = (k === rounds.length - 1);
            r.firstWork = r.workDays.length ? r.workDays[0].date : null;
            // The interval this round's start closed. The clerk's own counter
            // on the preceding day is the authority (it carries the previous
            // month even when that month was never imported); fall back to the
            // gap between the two starts when the days aren't contiguous.
            r.interval = null; r.intervalSrc = null;
            if (r.start) {
                const prev = tl[r.startIdx - 1];
                if (prev && prev.counter != null && imDiffDays(prev.date, r.start) === 1) {
                    r.interval = prev.counter; r.intervalSrc = 'counter';
                } else {
                    const pr = rounds[k - 1];
                    if (pr && pr.start) { r.interval = imDiffDays(pr.start, r.start); r.intervalSrc = 'dates'; }
                }
            }
        });

        // Round number WITHIN each month = order of the rounds actually worked
        // in that month (a carried-in round with no work doesn't count).
        const seen = {};
        rounds.forEach(r => {
            r.roundNoByMonth = {};
            const monthsWorked = [];
            r.workDays.forEach(w => { if (monthsWorked.indexOf(w.monthIdx) < 0) monthsWorked.push(w.monthIdx); });
            monthsWorked.forEach(mIdx => {
                seen[mIdx] = (seen[mIdx] || 0) + 1;
                r.roundNoByMonth[mIdx] = seen[mIdx];
            });
        });
        return rounds;
    };

    // ── whole-year analysis, memoised until the grid changes ─────────────
    let _imCache = null;
    const imAnalyze = (year) => {
        const stamp = window.state._imStamp || 0;
        if (_imCache && _imCache.year === year && _imCache.stamp === stamp) return _imCache;
        const collected = imCollect(year);
        const blocks = [];
        let asAt = null;
        Object.keys(collected).forEach(bId => {
            const rec = collected[bId];
            if (!rec.tl.length) return;
            rec.rounds = imRounds(rec.tl);
            const last = rec.tl[rec.tl.length - 1];
            rec.lastDataDate = last.date;
            if (!asAt || last.date > asAt) asAt = last.date;
            rec.openRound = rec.rounds[rec.rounds.length - 1];
            rec.gang = rec.gangByMonth[last.monthIdx] ||
                rec.gangByMonth[Object.keys(rec.gangByMonth).pop()] || 'Unassigned';
            rec.dormant = !rec.rounds.some(r => r.start) &&
                (rec.openRound.lastCounter == null || rec.openRound.lastCounter > IM_DORMANT_DAYS);
            blocks.push(rec);
        });
        blocks.sort((a, b) => (parseFloat(a.blockId) - parseFloat(b.blockId)) ||
            String(a.blockId).localeCompare(String(b.blockId)));
        _imCache = { year, stamp, blocks, byId: collected, asAt };
        return _imCache;
    };
    // Any edit to the grid invalidates the cache.
    window.imInvalidate = () => {
        window.state._imStamp = (window.state._imStamp || 0) + 1;
        _imCache = null;
    };

    // ── per-day flags for one month, used to colour the Interval grid ────
    // → array(31) of { counter, manday, roundNo, isStart, over, interval } | null
    window.imDayFlags = (year, monthName, blockId) => {
        try {
            const mIdx = IM_MONTHS.indexOf(monthName);
            if (mIdx < 0) return null;
            const a = imAnalyze(String(year));
            const rec = a.byId[String(blockId).trim()];
            if (!rec || !rec.rounds) return null;
            const target = window.imTarget();
            const out = new Array(31).fill(null);
            rec.rounds.forEach(r => {
                const roundNo = r.roundNoByMonth[mIdx];
                r.days.forEach(d => {
                    if (d.monthIdx !== mIdx) return;
                    const isStart = !!(r.start && d.date.getTime() === r.start.getTime());
                    out[d.day - 1] = {
                        counter: d.counter,
                        manday: d.manday,
                        roundNo: (d.manday > 0 && roundNo) ? roundNo : null,
                        isStart,
                        over: (d.counter != null && d.counter > target),
                        interval: isStart ? r.interval : null
                    };
                });
            });
            return out;
        } catch (e) { return null; }
    };

    // ── block status as at a date ────────────────────────────────────────
    const imStatusOf = (days, target) => {
        if (days == null) return { key: 'none', label: 'no data', color: '#6b7280' };
        if (days > target) return { key: 'over', label: 'OVERDUE', color: '#dc2626' };
        if (days >= target - 2) return { key: 'due', label: 'due now', color: '#d97706' };
        return { key: 'ok', label: 'ok', color: '#16a34a' };
    };
    window.imBlockStatus = (year, asAtDate) => {
        const a = imAnalyze(String(year));
        const target = window.imTarget();
        const asAt = asAtDate || a.asAt;
        if (!asAt) return [];
        return a.blocks.map(rec => {
            let rd = null;                       // last day record on or before asAt
            for (let i = rec.tl.length - 1; i >= 0; i--) {
                if (rec.tl[i].date <= asAt) { rd = rec.tl[i]; break; }
            }
            let round = null;                    // the round running on that date
            rec.rounds.forEach(r => { if (r.days[0].date <= asAt) round = r; });
            let days = rd ? rd.counter : null;
            // the counter is only valid on the day it was written — extrapolate
            // forward when the sheet hasn't been filled up to asAt yet
            if (days != null && rd && rd.date < asAt) days += imDiffDays(rd.date, asAt);
            const refDate = round ? (round.firstWork || round.start || asAt) : asAt;
            const roundNo = round ? (round.roundNoByMonth[asAt.getMonth()] ||
                round.roundNoByMonth[refDate.getMonth()] || null) : null;
            return {
                blockId: rec.blockId, gang: rec.gang, ha: rec.ha, opYear: rec.opYear,
                lastStart: round ? round.start : null,
                lastWork: (round && round.workDays.length) ? round.workDays[round.workDays.length - 1].date : null,
                roundNo, days, dormant: rec.dormant,
                staleTo: (rd && rd.date < asAt) ? rd.date : null,
                status: rec.dormant ? { key: 'dormant', label: 'not in rotation', color: '#6b7280' }
                    : imStatusOf(days, target)
            };
        });
    };

    // ── closed intervals across the year ─────────────────────────────────
    window.imIntervals = (year) => {
        const a = imAnalyze(String(year));
        const target = window.imTarget();
        const out = [];
        a.blocks.forEach(rec => {
            if (rec.dormant) return;
            rec.rounds.forEach(r => {
                if (!r.start || r.interval == null) return;
                const mIdx = (r.firstWork || r.start).getMonth();
                out.push({
                    blockId: rec.blockId, gang: rec.gangByMonth[mIdx] || rec.gang, ha: rec.ha,
                    start: r.start, monthIdx: mIdx, roundNo: r.roundNoByMonth[mIdx] || null,
                    interval: r.interval, src: r.intervalSrc, breach: r.interval > target,
                    workDays: r.workDays.length, manpower: r.manpower
                });
            });
        });
        out.sort((x, y) => x.start - y.start);
        return out;
    };

    // ── one ISO week's picture ───────────────────────────────────────────
    const imWeekAnalysis = (year, isoYear, week) => {
        const a = imAnalyze(String(year));
        const target = window.imTarget();
        const monday = imIsoWeekStart(isoYear, week);
        const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
        const rows = [];
        a.blocks.forEach(rec => {
            const inWeek = rec.tl.filter(d => d.date >= monday && d.date <= sunday);
            const starts = [];
            rec.rounds.forEach(r => {
                if (!r.start || r.start < monday || r.start > sunday) return;
                const mIdx = (r.firstWork || r.start).getMonth();
                starts.push({
                    date: r.start, roundNo: r.roundNoByMonth[mIdx] || null,
                    interval: r.interval, breach: r.interval != null && r.interval > target
                });
            });
            if (!inWeek.length && !starts.length) return;
            let peak = null, endDays = null, manpower = 0, workDays = 0;
            inWeek.forEach(d => {
                if (d.counter != null) { if (peak == null || d.counter > peak) peak = d.counter; endDays = d.counter; }
                if (d.manday > 0) { manpower += d.manday; workDays++; }
            });
            rows.push({
                blockId: rec.blockId, gang: rec.gangByMonth[monday.getMonth()] || rec.gang, ha: rec.ha,
                dormant: rec.dormant, starts, peak, endDays, manpower, workDays,
                status: rec.dormant ? { key: 'dormant', label: 'not in rotation', color: '#6b7280' }
                    : imStatusOf(endDays, target),
                overInWeek: !rec.dormant && peak != null && peak > target
            });
        });
        const closed = [];
        rows.forEach(r => r.starts.forEach(s => { if (s.interval != null && !r.dormant) closed.push(s.interval); }));
        const breaches = closed.filter(v => v > target).length;
        const rank = (r) => r.dormant ? 3 : (r.status.key === 'over' ? 0 : (r.status.key === 'due' ? 1 : 2));
        rows.sort((x, y) => rank(x) - rank(y) || (y.endDays || 0) - (x.endDays || 0) ||
            (parseFloat(x.blockId) - parseFloat(y.blockId)));
        let thirdPlus = [];
        rows.forEach(r => r.starts.forEach(s => {
            if (s.roundNo >= 3) thirdPlus.push({ blockId: r.blockId, gang: r.gang, date: s.date, roundNo: s.roundNo });
        }));
        return {
            monday, sunday, rows, closed, breaches, target, thirdPlus,
            avg: closed.length ? closed.reduce((s, v) => s + v, 0) / closed.length : null,
            roundsStarted: rows.reduce((s, r) => s + r.starts.length, 0),
            blocksWorked: rows.filter(r => r.workDays > 0).length,
            manpower: rows.reduce((s, r) => s + r.manpower, 0),
            overAtEnd: rows.filter(r => r.status.key === 'over').length,
            dueAtEnd: rows.filter(r => r.status.key === 'due').length
        };
    };

    // ── weeks that actually have data (for the selector) ─────────────────
    const imWeeksWithData = (year) => {
        const a = imAnalyze(String(year));
        const set = {};
        a.blocks.forEach(rec => rec.tl.forEach(d => {
            const w = imIsoWeek(d.date);
            set[imWeekKey(w.year, w.week)] = w;
        }));
        return Object.keys(set).sort().map(k => ({ key: k, year: set[k].year, week: set[k].week }));
    };

    const imYearList = () => {
        const set = new Set();
        [window.state.performance, window.state.reports].forEach(obj => {
            if (obj) Object.keys(obj).forEach(k => { if (/^\d{4}$/.test(k)) set.add(k); });
        });
        if (!set.size) set.add(String(new Date().getFullYear()));
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // ── styling (matches the other modules) ──────────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const TH = 'padding:6px 8px; border-bottom:2px solid var(--border-color,#ccc); font-size:0.78rem; color:var(--text-secondary); white-space:nowrap;';
    const TD = 'padding:5px 8px; border-bottom:1px solid var(--border-color,#eee); font-size:0.86rem; color:var(--text-primary); white-space:nowrap;';
    const chip = (st) => `<span class="im-chip" style="font-size:0.72rem; font-weight:700; color:${st.color}; border:1px solid ${st.color}; border-radius:10px; padding:0.06rem 0.5rem;">${imEsc(st.label)}</span>`;
    const tile = (label, value, color) => `<div style="min-width:118px;">
        <div style="font-size:0.75rem; color:var(--text-secondary);">${label}</div>
        <div style="font-weight:700; font-size:1.15rem; color:${color || 'var(--text-primary)'};">${value}</div></div>`;
    const rdLabel = (n) => IM_ROUND_LABEL[n] || (n + 'th');

    // ── main render ──────────────────────────────────────────────────────
    let _imMode = 'week';   // week | field | log

    window.renderIntervalMonitor = () => {
        const host = document.getElementById('interval-monitor-wrapper');
        if (!host) return;
        const state = window.state;

        const years = imYearList();
        if (!state.selectedReportYear || years.indexOf(state.selectedReportYear) < 0) {
            state.selectedReportYear = years[0];
        }
        const year = state.selectedReportYear;
        const target = window.imTarget();
        const a = imAnalyze(year);

        const tabBtn = (id, label, mode) =>
            `<button id="${id}" style="padding:0.4rem 0.9rem; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:600;
                border:1px solid ${_imMode === mode ? 'var(--primary-color,#16a34a)' : 'var(--border-color,#ccc)'};
                background:${_imMode === mode ? 'var(--primary-color,#16a34a)' : 'var(--bg-card,#fff)'};
                color:${_imMode === mode ? '#fff' : 'var(--text-primary)'};">${label}</button>`;

        host.innerHTML = `
        <div class="im-root" style="padding:1.25rem 1.5rem; max-width:1300px;">
          <h2 class="im-title" style="margin:0 0 0.25rem; color:var(--text-primary);">⏱ Interval Monitor</h2>
          <p class="im-noprint" style="color:var(--text-secondary); margin:0 0 1rem; font-size:0.85rem;">
            Days between harvesting rounds, per block, against the
            <strong>≤ ${target}-day</strong> target — derived from the day-counter grid in
            <strong>Harvesting Interval</strong>. Weeks run Monday–Sunday and cross month ends.
          </p>
          <div class="im-noprint" style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="im-year" style="${SS} margin-left:4px;">
                ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
              </select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);" title="An interval longer than this counts as a breach">
              Target ≤
              <input type="number" id="im-target" min="3" max="60" step="1" value="${target}"
                     style="${SS} width:70px; margin-left:4px;"> days</label>
            <div style="flex:1;"></div>
            ${tabBtn('im-tab-week', '📅 Weekly', 'week')}
            ${tabBtn('im-tab-field', '📋 Field sheet', 'field')}
            ${tabBtn('im-tab-log', '🧾 Interval log', 'log')}
            <button id="im-print" style="padding:0.4rem 0.9rem; border-radius:6px; cursor:pointer; font-size:0.85rem;
                border:1px solid var(--border-color,#ccc); background:var(--bg-card,#fff); color:var(--text-primary);"
                title="Print this view (or save it as PDF)">🖨️ Print</button>
          </div>
          <div id="im-body"></div>
        </div>`;

        host.querySelector('#im-year').onchange = (e) => {
            state.selectedReportYear = e.target.value;
            state.imWeek = null;
            window.renderIntervalMonitor();
        };
        const tEl = host.querySelector('#im-target');
        if (typeof window._canEdit === 'function' && !window._canEdit('performance')) tEl.disabled = true;
        tEl.onchange = (e) => {
            const v = parseInt(e.target.value, 10);
            if (isNaN(v) || v < 3 || v > 60) { e.target.value = window.imTarget(); return; }
            state.intervalTargetDays = v;
            if (typeof window.saveState === 'function') window.saveState(true);
            window.renderIntervalMonitor();
        };
        const setMode = (m) => { _imMode = m; window.renderIntervalMonitor(); };
        host.querySelector('#im-tab-week').onclick = () => setMode('week');
        host.querySelector('#im-tab-field').onclick = () => setMode('field');
        host.querySelector('#im-tab-log').onclick = () => setMode('log');
        host.querySelector('#im-print').onclick = () => {
            const old = document.title;
            const d = new Date();
            const stamp = `${d.getFullYear()}-${imPad(d.getMonth() + 1)}-${imPad(d.getDate())}`;
            document.title = (_imMode === 'field' ? 'Field inspection — harvesting interval'
                : _imMode === 'log' ? 'Interval log' : 'Weekly interval monitor') + ' — ' + stamp;
            const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
            window.addEventListener('afterprint', restore);
            setTimeout(restore, 60000);
            window.print();
        };

        const body = host.querySelector('#im-body');
        if (!a.blocks.length) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No interval data for <strong>${imEsc(year)}</strong> yet.<br><br>
                Import the daily report's <strong>HARVESTING INTERVAL</strong> sheet from
                <strong>Data Management → Import Excel</strong> — this view reads the same grid.</div>`;
            return;
        }
        if (_imMode === 'week') imRenderWeek(body, year);
        else if (_imMode === 'field') imRenderField(body, year);
        else imRenderLog(body, year);
    };

    // ── weekly monitor ───────────────────────────────────────────────────
    const imRenderWeek = (body, year) => {
        const state = window.state;
        const weeks = imWeeksWithData(year);
        if (!weeks.length) { body.innerHTML = `<div style="${CARD}">No dated grid entries for ${imEsc(year)}.</div>`; return; }

        let sel = imParseWeekKey(state.imWeek);
        if (!sel || !weeks.some(w => w.key === imWeekKey(sel.year, sel.week))) {
            const a = imAnalyze(year);
            sel = a.asAt ? imIsoWeek(a.asAt) : weeks[weeks.length - 1];
        }
        state.imWeek = imWeekKey(sel.year, sel.week);

        const idx = weeks.findIndex(w => w.key === state.imWeek);
        const prev = idx > 0 ? weeks[idx - 1] : null;
        const next = (idx >= 0 && idx < weeks.length - 1) ? weeks[idx + 1] : null;
        const W = imWeekAnalysis(year, sel.year, sel.week);
        const target = W.target;
        const pct = W.closed.length ? Math.round((W.closed.length - W.breaches) / W.closed.length * 100) : null;

        const arrow = (id, sym, on) => `<button id="${id}" ${on ? '' : 'disabled'}
            style="width:34px;height:34px;border-radius:6px;cursor:${on ? 'pointer' : 'default'};opacity:${on ? 1 : 0.35};
            border:1px solid var(--border-color,#ccc);background:var(--bg-card,#fff);color:var(--primary-color,#16a34a);font-weight:700;">${sym}</button>`;

        const rowsHtml = W.rows.map(r => {
            const startCells = r.starts.length
                ? r.starts.map(s => `<div>${imFmtDate(s.date)} <span style="color:var(--text-secondary);">${s.roundNo ? rdLabel(s.roundNo) + ' rd' : ''}</span></div>`).join('')
                : '<span style="color:var(--text-secondary);">—</span>';
            const ivCells = r.starts.length
                ? r.starts.map(s => s.interval == null
                    ? '<div style="color:var(--text-secondary);">n/a</div>'
                    : `<div style="font-weight:700; color:${s.breach ? '#dc2626' : '#16a34a'};">${s.interval} d${s.breach ? ' ⚠' : ''}</div>`).join('')
                : '<span style="color:var(--text-secondary);">—</span>';
            const flag3 = r.starts.some(s => s.roundNo >= 3)
                ? ' <span title="3rd round or later this month — fill it RED in the Excel sheet" style="color:#dc2626;">③</span>' : '';
            return `<tr>
                <td style="${TD} font-weight:600;">${imEsc(r.blockId)}${flag3}</td>
                <td style="${TD}">${imEsc(r.gang)}</td>
                <td style="${TD} text-align:right;">${imFmtHa(r.ha)}</td>
                <td style="${TD}">${startCells}</td>
                <td style="${TD} text-align:right;">${ivCells}</td>
                <td style="${TD} text-align:right; ${r.overInWeek ? 'color:#dc2626; font-weight:700;' : ''}">${r.peak == null ? '—' : r.peak}</td>
                <td style="${TD} text-align:right;">${r.workDays || '—'}</td>
                <td style="${TD} text-align:right;">${r.manpower || '—'}</td>
                <td style="${TD} text-align:right; font-weight:700; color:${r.status.color};">${r.endDays == null ? '—' : r.endDays}</td>
                <td style="${TD}">${chip(r.status)}</td>
            </tr>`;
        }).join('');

        // per-gang rollup for the week
        const byGang = {};
        W.rows.forEach(r => {
            if (r.dormant) return;
            const g = byGang[r.gang] || (byGang[r.gang] = { gang: r.gang, blocks: 0, closed: [], breaches: 0, over: 0, due: 0, manpower: 0 });
            g.blocks++; g.manpower += r.manpower;
            if (r.status.key === 'over') g.over++;
            if (r.status.key === 'due') g.due++;
            r.starts.forEach(s => { if (s.interval != null) { g.closed.push(s.interval); if (s.breach) g.breaches++; } });
        });
        const gangRows = Object.keys(byGang).map(k => byGang[k])
            .sort((x, y) => (y.over - x.over) || (y.breaches - x.breaches) || x.gang.localeCompare(y.gang))
            .map(g => {
                const avg = g.closed.length ? g.closed.reduce((s, v) => s + v, 0) / g.closed.length : null;
                const bad = avg != null && avg > target;
                return `<tr>
                    <td style="${TD}">${imEsc(g.gang)}</td>
                    <td style="${TD} text-align:right;">${g.blocks}</td>
                    <td style="${TD} text-align:right;">${g.closed.length}</td>
                    <td style="${TD} text-align:right; font-weight:700; color:${avg == null ? 'var(--text-secondary)' : (bad ? '#dc2626' : '#16a34a')};">${avg == null ? '—' : avg.toFixed(1)}</td>
                    <td style="${TD} text-align:right; ${g.breaches ? 'color:#dc2626;' : ''}">${g.breaches}</td>
                    <td style="${TD} text-align:right; ${g.over ? 'color:#dc2626;' : ''}">${g.over}</td>
                    <td style="${TD} text-align:right; ${g.due ? 'color:#d97706;' : ''}">${g.due}</td>
                    <td style="${TD} text-align:right;">${g.manpower || '—'}</td>
                </tr>`;
            }).join('');

        body.innerHTML = `
        <div class="im-noprint" style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.9rem;">
            ${arrow('im-wk-prev', '❮', !!prev)}
            <select id="im-wk" style="${SS} min-width:280px;">
              ${weeks.map(w => `<option value="${w.key}" ${w.key === state.imWeek ? 'selected' : ''}>${imWeekLabel(w.year, w.week)}</option>`).join('')}
            </select>
            ${arrow('im-wk-next', '❯', !!next)}
        </div>
        <div class="im-print-head" style="display:none;">
            <div style="font-size:1.05rem; font-weight:700;">WEEKLY HARVESTING-INTERVAL MONITOR</div>
            <div style="font-size:0.85rem;">${imEsc(imWeekLabel(sel.year, sel.week))} · target ≤ ${target} days between rounds</div>
        </div>

        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.7rem; font-size:1rem;">${imEsc(imWeekLabel(sel.year, sel.week))}</h3>
          <div style="display:flex; gap:1.6rem; flex-wrap:wrap;">
            ${tile('Intervals closed', W.closed.length)}
            ${tile('Average interval', W.avg == null ? '—' : W.avg.toFixed(1) + ' d', W.avg != null && W.avg > target ? '#dc2626' : '#16a34a')}
            ${tile('Breaches (over ' + target + ' d)', W.breaches, W.breaches ? '#dc2626' : '#16a34a')}
            ${tile('Within target', pct == null ? '—' : pct + '%', pct == null ? null : (pct >= 80 ? '#16a34a' : (pct >= 50 ? '#d97706' : '#dc2626')))}
            ${tile('Rounds started', W.roundsStarted)}
            ${tile('Blocks harvested', W.blocksWorked)}
            ${tile('Overdue at week end', W.overAtEnd, W.overAtEnd ? '#dc2626' : '#16a34a')}
            ${tile('Due now at week end', W.dueAtEnd, W.dueAtEnd ? '#d97706' : null)}
            ${tile('Mandays', W.manpower)}
          </div>
          ${W.thirdPlus.length ? `<div style="margin-top:0.8rem; font-size:0.82rem; color:#dc2626;">
              ③ <strong>3rd round or later started this week</strong> —
              ${W.thirdPlus.map(s => `blk ${imEsc(s.blockId)} (${imFmtDate(s.date)}, ${rdLabel(s.roundNo)})`).join(', ')}.
              In the Excel sheet those days must be filled <strong>red</strong> and their tonnage entered in the
              <strong>3RD RD</strong> column — they are easily left yellow by mistake.</div>` : ''}
        </div>

        <div style="${CARD} padding:0; overflow:auto;">
          <table class="im-table" style="width:100%; border-collapse:collapse; min-width:1000px;">
            <thead><tr>
              <th style="${TH} text-align:left;">Block</th>
              <th style="${TH} text-align:left;">Gang</th>
              <th style="${TH} text-align:right;">Ha</th>
              <th style="${TH} text-align:left;">Round started</th>
              <th style="${TH} text-align:right;">Interval closed</th>
              <th style="${TH} text-align:right;" title="Highest days-since-round-start reached during the week">Peak days</th>
              <th style="${TH} text-align:right;">Work days</th>
              <th style="${TH} text-align:right;">Mandays</th>
              <th style="${TH} text-align:right;" title="Days since the running round started, as at Sunday">At week end</th>
              <th style="${TH} text-align:left;">Status</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div style="${CARD} padding:0; overflow:auto;">
          <div style="padding:0.7rem 1rem; font-weight:600; font-size:0.9rem;">By gang — this week</div>
          <table class="im-table" style="width:100%; border-collapse:collapse; min-width:700px;">
            <thead><tr>
              <th style="${TH} text-align:left;">Gang</th>
              <th style="${TH} text-align:right;">Blocks</th>
              <th style="${TH} text-align:right;">Intervals</th>
              <th style="${TH} text-align:right;">Avg days</th>
              <th style="${TH} text-align:right;">Breaches</th>
              <th style="${TH} text-align:right;">Overdue</th>
              <th style="${TH} text-align:right;">Due now</th>
              <th style="${TH} text-align:right;">Mandays</th>
            </tr></thead>
            <tbody>${gangRows || `<tr><td style="${TD}" colspan="8">No gang activity this week.</td></tr>`}</tbody>
          </table>
        </div>`;

        const wkSel = body.querySelector('#im-wk');
        if (wkSel) wkSel.onchange = (e) => { state.imWeek = e.target.value; window.renderIntervalMonitor(); };
        const pBtn = body.querySelector('#im-wk-prev');
        if (pBtn && prev) pBtn.onclick = () => { state.imWeek = prev.key; window.renderIntervalMonitor(); };
        const nBtn = body.querySelector('#im-wk-next');
        if (nBtn && next) nBtn.onclick = () => { state.imWeek = next.key; window.renderIntervalMonitor(); };
    };

    // ── printable field inspection sheet ─────────────────────────────────
    const imRenderField = (body, year) => {
        const state = window.state;
        const a = imAnalyze(year);
        const target = window.imTarget();
        let asAt = a.asAt;
        if (/^\d{4}-\d{2}-\d{2}$/.test(state.imAsAt || '')) {
            const p = state.imAsAt.split('-').map(Number);
            asAt = new Date(p[0], p[1] - 1, p[2]);
        }
        state.imAsAt = imIso(asAt);

        const list = window.imBlockStatus(year, asAt);
        const live = list.filter(r => !r.dormant);
        const dormant = list.filter(r => r.dormant);
        live.sort((x, y) => (y.days == null ? -1 : y.days) - (x.days == null ? -1 : x.days) ||
            parseFloat(x.blockId) - parseFloat(y.blockId));
        const over = live.filter(r => r.status.key === 'over');
        const due = live.filter(r => r.status.key === 'due');

        const rows = live.map(r => `<tr>
            <td style="${TD} text-align:center;"><span class="im-box"></span></td>
            <td style="${TD} font-weight:700;">${imEsc(r.blockId)}</td>
            <td style="${TD} text-align:right;">${imFmtHa(r.ha)}</td>
            <td style="${TD}">${imEsc(r.gang)}</td>
            <td style="${TD}">${imFmtDate(r.lastStart)}${r.roundNo ? ` <span style="color:var(--text-secondary);">${rdLabel(r.roundNo)}</span>` : ''}</td>
            <td style="${TD}">${imFmtDate(r.lastWork)}</td>
            <td style="${TD} text-align:right; font-weight:700; font-size:1rem; color:${r.status.color};">${r.days == null ? '—' : r.days}</td>
            <td style="${TD}">${chip(r.status)}${r.staleTo ? ` <span title="grid filled only to ${imFmtFull(r.staleTo)} — days extrapolated" style="color:#d97706;">*</span>` : ''}</td>
            <td style="${TD} width:22%;">&nbsp;</td>
        </tr>`).join('');

        body.innerHTML = `
        <div class="im-noprint" style="display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; margin-bottom:0.9rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">As at
              <input type="date" id="im-asat" value="${imIso(asAt)}" style="${SS} margin-left:4px;"></label>
            <button id="im-asat-latest" style="${SS} cursor:pointer;">Latest data (${imFmtFull(a.asAt)})</button>
            <span style="font-size:0.8rem; color:var(--text-secondary);">Longest-waiting first — print it and tick as you inspect.</span>
        </div>

        <div class="im-sheet" style="${CARD}">
          <div class="im-sheet-head" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid var(--text-primary); padding-bottom:0.5rem; margin-bottom:0.8rem;">
            <div>
              <div style="font-size:1.05rem; font-weight:700;">FIELD INSPECTION — HARVESTING INTERVAL</div>
              <div style="font-size:0.85rem; color:var(--text-secondary);">Target: next round within <strong>${target} days</strong> of the last round start</div>
            </div>
            <div style="text-align:right; font-size:0.85rem;">
              <div><strong>As at:</strong> ${imFmtFull(asAt)}</div>
              <div>${over.length} overdue · ${due.length} due now · ${live.length} blocks</div>
            </div>
          </div>
          <table class="im-table im-fieldtable" style="width:100%; border-collapse:collapse;">
            <thead><tr>
              <th style="${TH} text-align:center; width:28px;">✓</th>
              <th style="${TH} text-align:left;">Block</th>
              <th style="${TH} text-align:right;">Ha</th>
              <th style="${TH} text-align:left;">Gang</th>
              <th style="${TH} text-align:left;">Round started</th>
              <th style="${TH} text-align:left;">Last cut</th>
              <th style="${TH} text-align:right;">Days</th>
              <th style="${TH} text-align:left;">Status</th>
              <th style="${TH} text-align:left;">Findings / action</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${dormant.length ? `<div style="margin-top:0.8rem; font-size:0.8rem; color:var(--text-secondary);">
             Not in rotation (counter never reset this year): ${dormant.map(d => imEsc(d.blockId) + (d.days ? ` — ${d.days} d` : '')).join(', ')}</div>` : ''}
          <div class="im-sign" style="margin-top:1.4rem; display:flex; gap:3rem; font-size:0.85rem;">
            <div style="flex:1; border-top:1px solid var(--text-primary); padding-top:0.3rem;">Inspected by</div>
            <div style="flex:1; border-top:1px solid var(--text-primary); padding-top:0.3rem;">Date</div>
            <div style="flex:1; border-top:1px solid var(--text-primary); padding-top:0.3rem;">Verified by</div>
          </div>
        </div>`;

        const dEl = body.querySelector('#im-asat');
        if (dEl) dEl.onchange = (e) => { if (e.target.value) { state.imAsAt = e.target.value; window.renderIntervalMonitor(); } };
        const lBtn = body.querySelector('#im-asat-latest');
        if (lBtn) lBtn.onclick = () => { state.imAsAt = a.asAt ? imIso(a.asAt) : null; window.renderIntervalMonitor(); };
    };

    // ── interval log ─────────────────────────────────────────────────────
    const imRenderLog = (body, year) => {
        const state = window.state;
        const target = window.imTarget();
        const all = window.imIntervals(year);
        const monthFilter = state.imLogMonth || '__all__';
        const gangFilter = state.imLogGang || '__all__';
        const gangs = [...new Set(all.map(i => i.gang))].sort();
        const rows = all.filter(i =>
            (monthFilter === '__all__' || IM_MONTHS[i.monthIdx] === monthFilter) &&
            (gangFilter === '__all__' || i.gang === gangFilter));

        const vals = rows.map(r => r.interval);
        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
        const breaches = rows.filter(r => r.breach).length;

        const byBlock = {};
        rows.forEach(r => {
            const b = byBlock[r.blockId] || (byBlock[r.blockId] = { blockId: r.blockId, gang: r.gang, vals: [], breaches: 0 });
            b.vals.push(r.interval); if (r.breach) b.breaches++;
        });
        const blockRows = Object.keys(byBlock).map(k => {
            const b = byBlock[k];
            return {
                blockId: b.blockId, gang: b.gang, vals: b.vals, breaches: b.breaches,
                avg: b.vals.reduce((s, v) => s + v, 0) / b.vals.length,
                max: Math.max.apply(null, b.vals), min: Math.min.apply(null, b.vals)
            };
        }).sort((x, y) => y.avg - x.avg);

        body.innerHTML = `
        <div class="im-noprint" style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:0.9rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Month
              <select id="im-log-month" style="${SS} margin-left:4px;">
                <option value="__all__">All months</option>
                ${IM_MONTHS.map(m => `<option value="${m}" ${m === monthFilter ? 'selected' : ''}>${m}</option>`).join('')}
              </select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Gang
              <select id="im-log-gang" style="${SS} margin-left:4px;">
                <option value="__all__">All gangs</option>
                ${gangs.map(g => `<option value="${imEsc(g)}" ${g === gangFilter ? 'selected' : ''}>${imEsc(g)}</option>`).join('')}
              </select></label>
        </div>

        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.7rem; font-size:1rem;">Completed intervals — ${imEsc(year)}${monthFilter === '__all__' ? '' : ' · ' + imEsc(monthFilter)}${gangFilter === '__all__' ? '' : ' · ' + imEsc(gangFilter)}</h3>
          <div style="display:flex; gap:1.6rem; flex-wrap:wrap;">
            ${tile('Intervals', rows.length)}
            ${tile('Average', avg == null ? '—' : avg.toFixed(1) + ' d', avg != null && avg > target ? '#dc2626' : '#16a34a')}
            ${tile('Shortest', vals.length ? Math.min.apply(null, vals) + ' d' : '—')}
            ${tile('Longest', vals.length ? Math.max.apply(null, vals) + ' d' : '—', vals.length && Math.max.apply(null, vals) > target ? '#dc2626' : null)}
            ${tile('Breaches (over ' + target + ' d)', breaches, breaches ? '#dc2626' : '#16a34a')}
            ${tile('Within target', vals.length ? Math.round((vals.length - breaches) / vals.length * 100) + '%' : '—')}
          </div>
          <div style="margin-top:0.7rem; font-size:0.78rem; color:var(--text-secondary);">
            An interval is the gap between two consecutive round starts on the same block. A month's first interval
            includes the tail of the previous month, so it grades both.
          </div>
        </div>

        <div style="${CARD} padding:0; overflow:auto;">
          <div style="padding:0.7rem 1rem; font-weight:600; font-size:0.9rem;">Per block</div>
          <table class="im-table" style="width:100%; border-collapse:collapse; min-width:700px;">
            <thead><tr>
              <th style="${TH} text-align:left;">Block</th><th style="${TH} text-align:left;">Gang</th>
              <th style="${TH} text-align:right;">Intervals</th><th style="${TH} text-align:right;">Average</th>
              <th style="${TH} text-align:right;">Shortest</th><th style="${TH} text-align:right;">Longest</th>
              <th style="${TH} text-align:right;">Breaches</th>
            </tr></thead>
            <tbody>${blockRows.map(b => `<tr>
                <td style="${TD} font-weight:600;">${imEsc(b.blockId)}</td>
                <td style="${TD}">${imEsc(b.gang)}</td>
                <td style="${TD} text-align:right;">${b.vals.length}</td>
                <td style="${TD} text-align:right; font-weight:700; color:${b.avg > target ? '#dc2626' : '#16a34a'};">${b.avg.toFixed(1)}</td>
                <td style="${TD} text-align:right;">${b.min}</td>
                <td style="${TD} text-align:right; ${b.max > target ? 'color:#dc2626;' : ''}">${b.max}</td>
                <td style="${TD} text-align:right; ${b.breaches ? 'color:#dc2626;' : ''}">${b.breaches}</td>
              </tr>`).join('') || `<tr><td style="${TD}" colspan="7">Nothing to show.</td></tr>`}</tbody>
          </table>
        </div>

        <div style="${CARD} padding:0; overflow:auto;">
          <div style="padding:0.7rem 1rem; font-weight:600; font-size:0.9rem;">Every interval (${rows.length}) — longest first</div>
          <table class="im-table" style="width:100%; border-collapse:collapse; min-width:800px;">
            <thead><tr>
              <th style="${TH} text-align:left;">Round started</th><th style="${TH} text-align:left;">Block</th>
              <th style="${TH} text-align:left;">Gang</th><th style="${TH} text-align:left;">Round</th>
              <th style="${TH} text-align:right;">Interval</th><th style="${TH} text-align:right;">Work days</th>
              <th style="${TH} text-align:right;">Mandays</th><th style="${TH} text-align:left;">Flag</th>
            </tr></thead>
            <tbody>${rows.slice().sort((x, y) => y.interval - x.interval).map(r => `<tr>
                <td style="${TD}">${imFmtFull(r.start)}</td>
                <td style="${TD} font-weight:600;">${imEsc(r.blockId)}</td>
                <td style="${TD}">${imEsc(r.gang)}</td>
                <td style="${TD}">${r.roundNo ? rdLabel(r.roundNo) : '—'}</td>
                <td style="${TD} text-align:right; font-weight:700; color:${r.breach ? '#dc2626' : '#16a34a'};">${r.interval} d</td>
                <td style="${TD} text-align:right;">${r.workDays}</td>
                <td style="${TD} text-align:right;">${r.manpower || '—'}</td>
                <td style="${TD}">${r.breach ? chip({ label: `over by ${r.interval - target}`, color: '#dc2626' }) : chip({ label: 'within target', color: '#16a34a' })}</td>
              </tr>`).join('') || `<tr><td style="${TD}" colspan="8">Nothing to show.</td></tr>`}</tbody>
          </table>
        </div>`;

        const mSel = body.querySelector('#im-log-month');
        if (mSel) mSel.onchange = (e) => { state.imLogMonth = e.target.value; window.renderIntervalMonitor(); };
        const gSel = body.querySelector('#im-log-gang');
        if (gSel) gSel.onchange = (e) => { state.imLogGang = e.target.value; window.renderIntervalMonitor(); };
    };

    // Expose the palette so the Interval grid can colour itself identically.
    window.IM_ROUND_COLORS = IM_ROUND_COLORS;
    window.IM_ROUND_TEXT = IM_ROUND_TEXT;
    window.IM_ROUND_LABEL = IM_ROUND_LABEL;
})();
