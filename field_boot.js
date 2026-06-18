// =====================================================================
// field_boot.js — standalone boot for the phone-native Weekly page (field.html)
//
// A lean entry point that reuses the SAME Firebase backend and the SAME weekly
// engine (render_weekly.js) as the desktop app, so everything captured here shows
// up on the desktop and vice-versa. It only sets up what render_weekly.js needs:
//   • window._weeklyDb  — the Realtime DB handle
//   • window.state      — { weekly, reports, weeklyYear, weeklyWeekId }
//   • window._canEdit / window.notify / window.notifyUndo  (lightweight versions)
// then loads the data (shared/app_state for blocks, shared/weekly_activity_data
// for the reports) and calls window.renderWeeklyActivity().
// =====================================================================
(function () {
    'use strict';

    // --- Firebase (same project as the desktop app) ---
    const firebaseConfig = {
        apiKey: "AIzaSyAavuTK1wjzYRqw54GAS5QW8ku0ahREN10",
        authDomain: "ffb-harvesting-report.firebaseapp.com",
        databaseURL: "https://ffb-harvesting-report-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "ffb-harvesting-report",
        storageBucket: "ffb-harvesting-report.firebasestorage.app",
        messagingSenderId: "783684002527",
        appId: "1:783684002527:web:f0a5396d9495ebaf5abf6a"
    };
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.database();

    // --- Globals render_weekly.js reads ---
    window._fb = { auth, db };
    window._weeklyDb = db;
    window._canEdit = () => true;          // edits are governed by Firebase rules
    window.state = window.state || {};
    window.state.reports = window.state.reports || {};
    window.state.weekly = window.state.weekly || {};
    if (!window.state.weeklyYear) window.state.weeklyYear = String(new Date().getFullYear());
    if (!('weeklyWeekId' in window.state)) window.state.weeklyWeekId = null;

    // --- Offline cache (localStorage) ---
    // The Realtime DB keeps no on-disk copy, so a fresh offline load has no data.
    // We mirror the (text-only) weekly record + block list into localStorage so the
    // app opens and works with no connection. Photos already persist in IndexedDB.
    const LS_WEEKLY = 'wk_cache_weekly';
    const LS_REPORTS = 'wk_cache_reports';
    try { const c = localStorage.getItem(LS_WEEKLY); if (c) window.state.weekly = JSON.parse(c); } catch (e) {}
    try { const r = localStorage.getItem(LS_REPORTS); if (r) window.state.reports = JSON.parse(r); } catch (e) {}
    // Mirror every save into the cache (so offline captures survive a reload too).
    const _origSaveWeekly = window.saveWeeklyActivityData;
    window.saveWeeklyActivityData = function (silent) {
        try { localStorage.setItem(LS_WEEKLY, JSON.stringify(window.state.weekly)); } catch (e) {}
        return typeof _origSaveWeekly === 'function' ? _origSaveWeekly.call(this, silent) : undefined;
    };
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

    // --- Lightweight toast helpers (render_weekly.js calls these) ---
    const toastHost = () => document.getElementById('toast-host') || document.body;
    window.notify = function (msg, type, ms) {
        const t = document.createElement('div');
        t.className = 'toast toast-' + (type || 'info');
        t.textContent = msg;
        toastHost().appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        const dur = ms || (type === 'error' ? 5000 : 3200);
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, dur);
    };
    window.notifyUndo = function (msg, onUndo, toastMs, onExpire) {
        const t = document.createElement('div');
        t.className = 'toast toast-undo show';
        const span = document.createElement('span'); span.textContent = msg;
        const btn = document.createElement('button'); btn.className = 'toast-undo-btn'; btn.textContent = 'Undo';
        t.appendChild(span); t.appendChild(btn);
        toastHost().appendChild(t);
        let done = false;
        const finish = (expired) => {
            if (done) return; done = true;
            t.classList.remove('show'); setTimeout(() => t.remove(), 300);
            if (expired && typeof onExpire === 'function') { try { onExpire(); } catch (e) {} }
        };
        btn.onclick = () => { if (done) return; done = true; t.remove(); try { onUndo(); } catch (e) {} };
        setTimeout(() => finish(true), toastMs || 7000);
    };

    // --- Login UI ---
    const loginOverlay = document.getElementById('login-overlay');
    const appMain = document.getElementById('app-main');
    const emailInp = document.getElementById('login-email');
    const passInp = document.getElementById('login-pass');
    const loginErr = document.getElementById('login-error');
    const btnLogin = document.getElementById('btn-login');

    [emailInp, passInp].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') btnLogin.click(); }));

    btnLogin.onclick = () => {
        loginErr.textContent = '';
        btnLogin.disabled = true; btnLogin.textContent = 'Signing in…';
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
            .then(() => auth.signInWithEmailAndPassword(emailInp.value.trim(), passInp.value))
            .catch(e => { loginErr.textContent = e.message; })
            .finally(() => { btnLogin.disabled = false; btnLogin.textContent = 'Sign In'; });
    };

    const linkForgot = document.getElementById('link-forgot');
    if (linkForgot) linkForgot.onclick = (e) => {
        e.preventDefault();
        const em = (emailInp.value || '').trim();
        if (!em) { loginErr.textContent = 'Enter your email above first, then tap Forgot password.'; return; }
        auth.sendPasswordResetEmail(em)
            .then(() => { loginErr.style.color = '#0e7c5a'; loginErr.textContent = 'Reset link sent — check your inbox.'; })
            .catch(e => { loginErr.style.color = ''; loginErr.textContent = e.message; });
    };

    document.getElementById('btn-logout').onclick = () => auth.signOut();

    // --- Render now (from cache, instant, offline-safe), refresh from cloud after ---
    const renderNow = () => {
        if (typeof window.renderWeeklyActivity !== 'function') return;
        try { window.renderWeeklyActivity(); }
        catch (e) { console.error('Render failed:', e); window.notify('Could not load the weekly view: ' + e.message, 'error'); }
    };

    const refreshFromCloud = async () => {
        // Blocks (reports) live in the main shared/app_state blob — best-effort refresh.
        try {
            const appSnap = await withTimeout(db.ref('shared/app_state').once('value'), 12000);
            const appData = appSnap.val();
            if (appData) {
                const p = JSON.parse(appData);
                if (p && p.reports) { window.state.reports = p.reports; try { localStorage.setItem(LS_REPORTS, JSON.stringify(p.reports)); } catch (e) {} }
            }
        } catch (e) { console.warn('Reports refresh skipped (offline?):', e); }

        // Weekly reports — only pull from the cloud when online at startup, so an
        // offline session keeps using the local cache and never clobbers offline edits.
        if (navigator.onLine) {
            try {
                const wkSnap = await withTimeout(db.ref('shared/weekly_activity_data').once('value'), 12000);
                const wkData = wkSnap.val();
                if (wkData) { window.state.weekly = JSON.parse(wkData); try { localStorage.setItem(LS_WEEKLY, JSON.stringify(window.state.weekly)); } catch (e) {} }
            } catch (e) { console.warn('Weekly refresh skipped (offline?):', e); }
        }
        renderNow();
    };

    // --- Auth state → render (cache) → refresh (cloud) ---
    let started = false;
    auth.onAuthStateChanged((user) => {
        if (user) {
            loginOverlay.style.display = 'none';
            appMain.style.display = 'block';
            if (started) return;
            started = true;
            renderNow();         // instant UI from cache — works with no connection
            refreshFromCloud();  // background; refreshes + re-renders when online
        } else {
            appMain.style.display = 'none';
            loginOverlay.style.display = 'flex';
            if (started) location.reload(); // clean slate on logout
        }
    });

    // --- Service worker (offline + auto-update to the latest deploy) ---
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing; if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) setTimeout(() => location.reload(), 800);
                });
            });
            setInterval(() => { try { reg.update(); } catch (e) {} }, 60000);
        }).catch(() => {});
    }
})();
