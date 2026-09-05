/* ============================================================================
 * render_ai_assist.js — 🤖 AI Assist
 * ----------------------------------------------------------------------------
 * Ad-hoc data questions answered by Claude, computed by THIS app's own engines.
 *
 * Design rule (the whole point of the module):
 *   The model never produces a number. It chooses a tool and its arguments;
 *   the tool computes the answer from window.state using the same traversal the
 *   existing reports use. Excel downloads are built from the cached tool result
 *   (by result_id), never from figures the model retyped — so a download can
 *   never disagree with what the engine computed.
 *
 * Purely derived — reads state, stores nothing in Firebase. Menu key 'aiassist'.
 * ==========================================================================*/
(function () {
    'use strict';

    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const perfMonthKey = (m) => m.charAt(0) + m.slice(1).toLowerCase();   // "APR" → "Apr"
    const num = (v) => parseFloat(v) || 0;
    const round2 = (n) => Math.round(n * 100) / 100;

    const MODEL = 'claude-opus-5';
    const API_URL = 'https://api.anthropic.com/v1/messages';
    const LS_KEY = 'ai_assist_key';
    const LS_PROXY = 'ai_assist_proxy';

    // Conversation + cached tool results for this session (never persisted).
    let _aiMessages = [];
    let _aiResults = {};
    let _aiResultSeq = 0;
    let _aiBusy = false;

    const aiCanEdit = () => typeof window._canEdit !== 'function' || window._canEdit('aiassist');

    /* ══════════════════════════════════════════════════════════════════════
     * TOOL IMPLEMENTATIONS — each returns real computed data from state
     * ════════════════════════════════════════════════════════════════════*/

    const cacheResult = (title, columns, rows, extra) => {
        const id = 'res_' + (++_aiResultSeq);
        _aiResults[id] = { id, title, columns, rows, extra: extra || null };
        return _aiResults[id];
    };

    /* ── What data exists at all — delegates to the Report Builder ──────*/
    const toolDataScope = () => {
        const st = window.state || {};
        const scope = typeof window.rbScope === 'function'
            ? window.rbScope() : { years: [], detail: {} };
        return {
            ffb_production: scope,
            other_datasets: {
                wage_calculator_years: Object.keys(st.wages || {}),
                wage_ledger_years: Object.keys(st.wagesLedger || {}),
                employee_master_count: ((st.wagesEmployees || {}).list || []).length,
                planting_record_years: Object.keys(st.reports || {}),
                interval_engine_available: typeof window.imIntervals === 'function',
            },
        };
    };

    /* ── FFB production pivot ────────────────────────────────────────────
     * The engine lives in render_report_builder.js (window.rbPivot) so the
     * dropdown UI and this natural-language front end can never disagree.
     */
    const toolQueryFfb = (args) => {
        if (typeof window.rbPivot !== 'function') {
            return { error: 'Report Builder engine not loaded (render_report_builder.js).' };
        }
        const res = window.rbPivot(args || {});
        if (res.error) return res;
        const cached = cacheResult(res.title, res.columns, res.rows, { total_mt: res.total_mt });
        return Object.assign({ result_id: cached.id }, res);
    };

    /* ── Harvesting intervals — delegates to the interval engine ─────────*/
    const toolQueryIntervals = (args) => {
        if (typeof window.imIntervals !== 'function') {
            return { error: 'Interval engine not loaded (render_interval_monitor.js).' };
        }
        const year = String(args.year || '');
        let list = window.imIntervals(year) || [];
        if (!list.length) return { error: `No closed intervals for ${year}.` };

        if (args.month) {
            const mon = String(args.month).toUpperCase().slice(0, 3);
            list = list.filter((i) => {
                const d = new Date(i.start);
                return !isNaN(d) && MONTHS[d.getMonth()] === mon;
            });
        }
        if (args.gang) {
            const g = String(args.gang).toLowerCase();
            list = list.filter((i) => String(i.gang || '').toLowerCase().includes(g));
        }
        if (args.breaches_only) list = list.filter((i) => i.breach);
        if (!list.length) return { error: 'No intervals matched those filters.' };

        const target = typeof window.imTarget === 'function' ? window.imTarget() : 15;
        list.sort((a, b) => b.interval - a.interval);

        const columns = ['Block', 'Gang', 'Round start', 'Round no', 'Interval (days)', 'Over target'];
        const rows = list.map((i) => [
            String(i.blockId), i.gang || '', i.start || '', i.roundNo ?? '',
            i.interval, i.breach ? 'YES' : '',
        ]);
        const breaches = list.filter((i) => i.breach).length;
        const avg = round2(list.reduce((s, i) => s + i.interval, 0) / list.length);
        const title = `Harvesting intervals ${year}`
            + (args.month ? ` — ${String(args.month).toUpperCase()}` : '')
            + (args.gang ? ` — ${args.gang}` : '');

        const res = cacheResult(title, columns, rows);
        return {
            result_id: res.id, title, columns, rows,
            summary: {
                target_days: target, intervals_closed: list.length, average_days: avg,
                breaches, pct_within_target: round2(((list.length - breaches) / list.length) * 100),
                longest: list[0] ? { block: list[0].blockId, days: list[0].interval } : null,
            },
        };
    };

    /* ── Wages — delegates to the calculator engine ─────────────────────*/
    const toolQueryWages = (args) => {
        if (typeof window.wgCompute !== 'function') return { error: 'Wages engine not loaded.' };
        const year = String(args.year || '');
        const month = String(args.month || '').toUpperCase().slice(0, 3);
        if (!MONTHS.includes(month)) return { error: 'month must be one of ' + MONTHS.join(', ') };

        const stored = (((window.state.wages || {})[year] || {}).gangs) || {};
        let gangs = Object.keys(stored).filter((g) => stored[g] && stored[g].months && stored[g].months[month]);
        if (args.gangs && args.gangs.length) {
            const want = new Set(args.gangs.map((g) => String(g).toLowerCase()));
            gangs = gangs.filter((g) => want.has(g.toLowerCase()));
        }
        if (!gangs.length) return { error: `No saved wage entries for ${month} ${year}.` };

        const columns = ['Gang', 'Net MT', 'FFB pay (RM)', 'Daily rate (RM)', 'Penalty (RM)', 'Total (RM)'];
        const rows = [];
        let grand = 0;
        gangs.forEach((g) => {
            const c = window.wgCompute(year, g, month) || {};
            grand += num(c.total);
            rows.push([g, round2(num(c.netMt)), round2(num(c.ffbPay)), round2(num(c.dailyPay)),
                round2(num(c.penalty)), round2(num(c.total))]);
        });
        rows.sort((a, b) => b[5] - a[5]);

        const title = `Wages ${month} ${year}`;
        const res = cacheResult(title, columns, rows, { total_rm: round2(grand) });
        return { result_id: res.id, title, columns, rows, grand_total_rm: round2(grand), gangs_included: gangs.length };
    };

    /* ── Employee master ────────────────────────────────────────────────*/
    const toolQueryEmployees = (args) => {
        const list = ((window.state.wagesEmployees || {}).list) || [];
        if (!list.length) return { error: 'Employee Master is empty — import the EMS listing first.' };

        const isActive = (e) => ['CONFIRMED', 'PROBATION'].includes(String(e.staffStatus || '').toUpperCase());
        const scope = args.active_only === false ? list : list.filter(isActive);
        if (!scope.length) return { error: 'No employees matched.' };

        const dim = args.group_by || 'agent';
        const field = { agent: 'vendor', position: 'position', category: 'staffCategory', status: 'staffStatus' }[dim] || 'vendor';

        const agg = new Map();
        scope.forEach((e) => {
            const k = e[field] || '(none)';
            if (!agg.has(k)) agg.set(k, { n: 0, permit: 0, gtf: 0 });
            const a = agg.get(k);
            a.n++;
            if (String(e.employeeId || '').startsWith('GTF-')) {
                a.gtf++;
                if (e.workPermit) a.permit++;
            }
        });

        const columns = [dim.charAt(0).toUpperCase() + dim.slice(1), 'Headcount', 'GTF (foreign)', 'With permit'];
        const rows = [...agg.entries()].map(([k, a]) => [k, a.n, a.gtf, a.permit]).sort((a, b) => b[1] - a[1]);
        const title = `Employees by ${dim}` + (args.active_only === false ? ' (all)' : ' (active)');
        const res = cacheResult(title, columns, rows);
        return { result_id: res.id, title, columns, rows, total_headcount: scope.length };
    };

    /* ── Excel export of a cached result ────────────────────────────────*/
    const buildExcel = async (resultId, filename) => {
        const r = _aiResults[resultId];
        if (!r) throw new Error('Unknown result_id ' + resultId);
        if (typeof window.rbToExcel !== 'function') {
            throw new Error('Excel exporter not loaded (render_report_builder.js).');
        }
        await window.rbToExcel(r, filename);
        return r;
    };

    /* ══════════════════════════════════════════════════════════════════════
     * TOOL SCHEMAS
     * ════════════════════════════════════════════════════════════════════*/

    const TOOLS = [
        {
            name: 'get_data_scope',
            description: 'List what data exists: production years, which months have FFB data, gang and block names, and which other datasets are loaded. Call this FIRST when you are unsure what years, months, gangs or blocks are valid.',
            input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
        {
            name: 'query_ffb_production',
            description: 'Compute FFB production tonnage from the Harvesting Performance record, grouped however you need. This is the general-purpose pivot for production questions — month-by-month summaries, per-block or per-gang breakdowns, single rounds, or any filtered subset.',
            input_schema: {
                type: 'object',
                properties: {
                    year: { type: 'string', description: 'Four-digit year, e.g. "2026".' },
                    months: { type: 'array', items: { type: 'string' }, description: 'Three-letter months e.g. ["JAN","FEB"]. Omit for the whole year.' },
                    group_by: {
                        type: 'string',
                        enum: ['month', 'block', 'gang', 'month_block', 'month_gang', 'gang_block'],
                        description: 'How to group rows. Use "month" for a month-to-month summary.',
                    },
                    rounds: { type: 'array', items: { type: 'integer' }, description: 'Harvest rounds to include, 1-4. Omit for all.' },
                    blocks: { type: 'array', items: { type: 'string' }, description: 'Restrict to these block ids.' },
                    gangs: { type: 'array', items: { type: 'string' }, description: 'Restrict to these gang names.' },
                },
                required: ['year', 'group_by'],
                additionalProperties: false,
            },
        },
        {
            name: 'query_intervals',
            description: 'Closed harvesting intervals (days between round starts) per block, with breach counts against the estate target. Use for rotation and compliance questions.',
            input_schema: {
                type: 'object',
                properties: {
                    year: { type: 'string' },
                    month: { type: 'string', description: 'Optional three-letter month filter on the round start date.' },
                    gang: { type: 'string', description: 'Optional gang name substring.' },
                    breaches_only: { type: 'boolean', description: 'Only intervals that exceeded the target.' },
                },
                required: ['year'],
                additionalProperties: false,
            },
        },
        {
            name: 'query_wages',
            description: 'Per-gang wage calculation for one month (net MT, FFB pay, daily rate, penalty, total) from saved Calculator entries.',
            input_schema: {
                type: 'object',
                properties: {
                    year: { type: 'string' },
                    month: { type: 'string', description: 'Three-letter month, e.g. "APR".' },
                    gangs: { type: 'array', items: { type: 'string' } },
                },
                required: ['year', 'month'],
                additionalProperties: false,
            },
        },
        {
            name: 'query_employees',
            description: 'Headcount from the Employee Master, grouped by agent (vendor), position, category or status, including foreign (GTF) and working-permit counts.',
            input_schema: {
                type: 'object',
                properties: {
                    group_by: { type: 'string', enum: ['agent', 'position', 'category', 'status'] },
                    active_only: { type: 'boolean', description: 'Default true (CONFIRMED + PROBATION only).' },
                },
                required: ['group_by'],
                additionalProperties: false,
            },
        },
        {
            name: 'download_excel',
            description: 'Download a previous query result as a formatted Excel file. Pass the result_id returned by that query — never retype the figures.',
            input_schema: {
                type: 'object',
                properties: {
                    result_id: { type: 'string', description: 'The result_id from an earlier query in this conversation.' },
                    filename: { type: 'string', description: 'Optional file name without extension.' },
                },
                required: ['result_id'],
                additionalProperties: false,
            },
        },
    ];

    const runTool = async (name, args) => {
        switch (name) {
            case 'get_data_scope': return toolDataScope();
            case 'query_ffb_production': return toolQueryFfb(args || {});
            case 'query_intervals': return toolQueryIntervals(args || {});
            case 'query_wages': return toolQueryWages(args || {});
            case 'query_employees': return toolQueryEmployees(args || {});
            case 'download_excel': {
                const r = await buildExcel(args.result_id, args.filename);
                return { downloaded: true, rows: r.rows.length, title: r.title };
            }
            default: return { error: 'Unknown tool ' + name };
        }
    };

    const SYSTEM_PROMPT = [
        'You are a data assistant embedded in the AntiGravity plantation management app.',
        'You answer questions about the estate\'s own records and compile ad-hoc summaries.',
        '',
        'ABSOLUTE RULE: never state a figure you worked out yourself. Every number in your',
        'answer must come from a tool result. If no tool can produce it, say so plainly.',
        'If you are unsure which years, months, gangs or blocks are valid, call get_data_scope first.',
        '',
        'Context on the data:',
        '- FFB production lives per year > month > gang > block, with four harvest rounds (r1-r4).',
        '- Tonnage is metric tonnes (MT). Money is Malaysian Ringgit (RM).',
        '- Months are three-letter uppercase codes (JAN..DEC).',
        '',
        'Style: answer briefly and directly. Lead with the figure asked for. Present tabular',
        'results as a compact markdown table. Do not restate every row of a long table —',
        'summarise and mention the full table is shown below your answer.',
        'When a result would be useful as a file, offer the Excel download; only call',
        'download_excel when the user actually asks for a file.',
    ].join('\n');

    /* ══════════════════════════════════════════════════════════════════════
     * TRANSPORT — local (localhost dev) or proxy (production)
     * ════════════════════════════════════════════════════════════════════*/

    const isLocalhost = () => ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
    const getProxyUrl = () => (localStorage.getItem(LS_PROXY) || '').trim();
    const getLocalKey = () => (localStorage.getItem(LS_KEY) || '').trim();

    const transportMode = () => {
        if (getProxyUrl()) return 'proxy';
        if (getLocalKey() && isLocalhost()) return 'local';
        return 'none';
    };

    const callClaude = async (body) => {
        const mode = transportMode();

        if (mode === 'proxy') {
            let idToken = '';
            try {
                const u = window._fb && window._fb.auth && window._fb.auth.currentUser;
                if (u) idToken = await u.getIdToken();
            } catch (e) { /* proxy will reject if it requires a token */ }
            const r = await fetch(getProxyUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`Proxy ${r.status}: ${(await r.text()).slice(0, 300)}`);
            return r.json();
        }

        if (mode === 'local') {
            // Dev only. Refuses to run anywhere but localhost so a key can never
            // ship to a hosted page — see the note in the settings panel.
            if (!isLocalhost()) throw new Error('Local key mode is only allowed on localhost.');
            const r = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': getLocalKey(),
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
            return r.json();
        }

        throw new Error('Not configured — open ⚙ Setup and add a proxy URL, or an API key when running on localhost.');
    };

    /* ── Agentic loop: model picks tools, we compute, repeat ─────────────*/
    const ask = async (question, onProgress) => {
        _aiMessages.push({ role: 'user', content: question });
        const usedResults = [];

        for (let turn = 0; turn < 8; turn++) {
            const resp = await callClaude({
                model: MODEL,
                max_tokens: 16000,
                system: SYSTEM_PROMPT,
                tools: TOOLS,
                messages: _aiMessages,
            });

            if (resp.type === 'error') throw new Error(resp.error && resp.error.message || 'API error');
            if (resp.stop_reason === 'refusal') throw new Error('The request was declined.');

            _aiMessages.push({ role: 'assistant', content: resp.content });

            const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
            if (!toolUses.length) {
                const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
                return { text, results: usedResults };
            }

            // Execute every requested tool, return all results in ONE user message.
            const toolResults = [];
            for (const tu of toolUses) {
                if (onProgress) onProgress(tu.name, tu.input);
                let out;
                try {
                    out = await runTool(tu.name, tu.input);
                } catch (err) {
                    out = { error: String(err && err.message || err) };
                }
                if (out && out.result_id && _aiResults[out.result_id]
                    && !usedResults.includes(out.result_id)) {
                    usedResults.push(out.result_id);
                }
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tu.id,
                    content: JSON.stringify(out).slice(0, 100000),
                    is_error: !!(out && out.error),
                });
            }
            _aiMessages.push({ role: 'user', content: toolResults });
        }
        throw new Error('Gave up after 8 tool rounds.');
    };

    /* ══════════════════════════════════════════════════════════════════════
     * VIEW
     * ════════════════════════════════════════════════════════════════════*/

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Minimal markdown: bold, code, and pipe tables — enough for the answers.
    const mdToHtml = (md) => {
        const lines = String(md || '').split('\n');
        const out = [];
        let tbl = null;
        const flush = () => {
            if (!tbl) return;
            const [head, ...body] = tbl;
            out.push('<div style="overflow-x:auto"><table class="ai-tbl"><thead><tr>'
                + head.map((h) => `<th>${esc(h)}</th>`).join('')
                + '</tr></thead><tbody>'
                + body.map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('')
                + '</tbody></table></div>');
            tbl = null;
        };
        lines.forEach((ln) => {
            const t = ln.trim();
            if (/^\|.*\|$/.test(t)) {
                const cells = t.slice(1, -1).split('|').map((c) => c.trim());
                if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;   // separator row
                (tbl = tbl || []).push(cells);
                return;
            }
            flush();
            if (!t) { out.push(''); return; }
            out.push('<p>' + esc(t)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.+?)`/g, '<code>$1</code>') + '</p>');
        });
        flush();
        return out.join('');
    };

    const renderResultTable = (res) => {
        const MAXR = 60;
        const shown = res.rows.slice(0, MAXR);
        return `
            <div class="ai-result">
                <div class="ai-result-head">
                    <strong>${esc(res.title)}</strong>
                    <button class="btn-secondary ai-dl" data-rid="${esc(res.id)}">⬇ Excel</button>
                </div>
                <div style="overflow-x:auto">
                    <table class="ai-tbl">
                        <thead><tr>${res.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
                        <tbody>${shown.map((r) => '<tr>' + r.map((c) => `<td>${typeof c === 'number' ? c.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : esc(c)}</td>`).join('') + '</tr>').join('')}</tbody>
                    </table>
                </div>
                ${res.rows.length > MAXR ? `<div class="ai-note">Showing ${MAXR} of ${res.rows.length} rows — download for the full set.</div>` : ''}
            </div>`;
    };

    const EXAMPLES = [
        'Month-to-month FFB production for 2026',
        'Which blocks produced the most in Q2 2026?',
        'FFB by gang per month this year',
        'Which blocks breached the interval target in JUN 2026?',
        'Headcount by agent, and how many have work permits',
    ];

    window.renderAiAssist = function renderAiAssist() {
        const host = document.getElementById('ai-assist-wrapper');
        if (!host) return;

        const mode = transportMode();
        const modeChip = {
            proxy: '<span class="ai-chip ai-chip-ok">proxy</span>',
            local: '<span class="ai-chip ai-chip-warn">local key (dev)</span>',
            none: '<span class="ai-chip ai-chip-off">not configured</span>',
        }[mode];

        host.innerHTML = `
            <div class="report-header-bar">
                <h2 style="margin:0">🤖 AI Assist</h2>
                <div style="display:flex;gap:8px;align-items:center">
                    ${modeChip}
                    <button class="btn-secondary" id="ai-setup-btn">⚙ Setup</button>
                    <button class="btn-secondary" id="ai-clear-btn">🗑 Clear</button>
                </div>
            </div>

            <div id="ai-setup-panel" class="ai-setup hidden">
                <div class="ai-setup-row">
                    <label>Proxy URL <span class="ai-note">(production — the proxy holds the API key)</span></label>
                    <input type="text" id="ai-proxy-url" class="edit-input" placeholder="https://your-worker.workers.dev"
                           value="${esc(getProxyUrl())}">
                </div>
                <div class="ai-setup-row">
                    <label>API key <span class="ai-note">(localhost only — for trying it out before the proxy exists)</span></label>
                    <input type="password" id="ai-api-key" class="edit-input" placeholder="sk-ant-..."
                           value="${getLocalKey() ? '••••••••••••' : ''}">
                    <div class="ai-note">
                        Stored in this browser only, and requests are refused unless the page is on
                        localhost. Never set this on the hosted site — use the proxy there.
                        ${isLocalhost() ? '' : '<strong> This page is not localhost, so a key here will not be used.</strong>'}
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px">
                    <button class="btn-primary" id="ai-save-cfg">Save</button>
                    <button class="btn-secondary" id="ai-forget-cfg">Forget key</button>
                </div>
            </div>

            <div id="ai-log" class="ai-log"></div>

            <div class="ai-examples" id="ai-examples">
                ${EXAMPLES.map((q) => `<button class="ai-example" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
            </div>

            <div class="ai-ask">
                <textarea id="ai-question" class="edit-input" rows="2"
                          placeholder="Ask about production, intervals, wages or headcount…"></textarea>
                <button class="btn-primary" id="ai-send">Ask</button>
            </div>
            <div class="ai-note" style="margin-top:6px">
                Figures come from this app's own engines — the assistant selects the query, it does not calculate.
            </div>`;

        const logEl = host.querySelector('#ai-log');
        const qEl = host.querySelector('#ai-question');

        const append = (html, cls) => {
            const d = document.createElement('div');
            d.className = 'ai-msg ' + (cls || '');
            d.innerHTML = html;
            logEl.appendChild(d);
            logEl.scrollTop = logEl.scrollHeight;
            return d;
        };

        const send = async (question) => {
            if (_aiBusy) return;
            const q = (question || qEl.value || '').trim();
            if (!q) return;
            if (!aiCanEdit()) {
                if (window.notify) window.notify('You do not have permission to use AI Assist.', 'warn');
                return;
            }
            if (transportMode() === 'none') {
                if (window.notify) window.notify('Open ⚙ Setup first — no proxy URL or key configured.', 'warn');
                host.querySelector('#ai-setup-panel').classList.remove('hidden');
                return;
            }

            _aiBusy = true;
            qEl.value = '';
            host.querySelector('#ai-examples').classList.add('hidden');
            append(esc(q), 'ai-user');
            const thinking = append('<em>Working…</em>', 'ai-bot');

            try {
                const { text, results } = await ask(q, (name, input) => {
                    thinking.innerHTML = `<em>Running <code>${esc(name)}</code>${
                        input && input.year ? ' for ' + esc(input.year) : ''}…</em>`;
                });
                thinking.innerHTML = mdToHtml(text || '(no answer)')
                    + results.map((id) => renderResultTable(_aiResults[id])).join('');
                thinking.querySelectorAll('.ai-dl').forEach((b) => {
                    b.onclick = async () => {
                        try {
                            await buildExcel(b.dataset.rid);
                            if (window.notify) window.notify('Excel downloaded.', 'success');
                        } catch (e) {
                            if (window.notify) window.notify('Download failed: ' + e.message, 'error');
                        }
                    };
                });
            } catch (err) {
                thinking.className = 'ai-msg ai-err';
                thinking.innerHTML = '⚠ ' + esc(err && err.message || err);
            } finally {
                _aiBusy = false;
                logEl.scrollTop = logEl.scrollHeight;
            }
        };

        host.querySelector('#ai-send').onclick = () => send();
        qEl.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        };
        host.querySelectorAll('.ai-example').forEach((b) => { b.onclick = () => send(b.dataset.q); });

        host.querySelector('#ai-setup-btn').onclick = () => {
            host.querySelector('#ai-setup-panel').classList.toggle('hidden');
        };
        host.querySelector('#ai-clear-btn').onclick = () => {
            _aiMessages = []; _aiResults = {}; _aiResultSeq = 0;
            logEl.innerHTML = '';
            host.querySelector('#ai-examples').classList.remove('hidden');
        };
        host.querySelector('#ai-save-cfg').onclick = () => {
            const proxy = host.querySelector('#ai-proxy-url').value.trim();
            const key = host.querySelector('#ai-api-key').value.trim();
            if (proxy) localStorage.setItem(LS_PROXY, proxy); else localStorage.removeItem(LS_PROXY);
            if (key && !/^•+$/.test(key)) localStorage.setItem(LS_KEY, key);
            if (window.notify) window.notify('Saved.', 'success');
            window.renderAiAssist();
        };
        host.querySelector('#ai-forget-cfg').onclick = () => {
            localStorage.removeItem(LS_KEY);
            if (window.notify) window.notify('Key removed from this browser.', 'success');
            window.renderAiAssist();
        };
    };

    // Exposed so the tool layer can be exercised from the console or a test page
    // without going near the API.
    window._aiTools = { runTool, TOOLS, results: () => _aiResults };
})();
