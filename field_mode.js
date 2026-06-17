// =====================================================================
// field_mode.js — Phone "field mode"
//
// On a phone-sized screen the app locks to the Weekly Activity report only,
// sized for touch. Desktop/laptop is left exactly as-is.
//
// Trigger: the screen's SHORT side <= 600 CSS px (so it catches phones in
// either orientation, but not tablets/laptops). Re-checked on resize and
// orientation change. A narrow desktop window will also switch (accepted).
//
// When active:
//   • <body> gets .field-mode  → CSS hides the sidebar / search / chrome and
//     restyles the Weekly view for touch (see style.css).
//   • the view is forced to Weekly Activity (the sidebar is hidden, so there is
//     no other navigation — this is a hard lock, by design).
//   • a compact Logout is injected into the header, because the only Logout
//     control lives inside the now-hidden sidebar.
//
// Self-contained, no dependencies; loaded after ui_enhancements.js.
// =====================================================================
(function () {
    const SHORT_SIDE_MAX = 600;
    const isPhone = () =>
        Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= SHORT_SIDE_MAX;

    let active = false;

    // The main app is only meaningful once it's visible (i.e. after login).
    const appVisible = () => {
        const el = document.getElementById('app-layout-main');
        return !!(el && el.style.display !== 'none' && el.offsetParent !== null);
    };

    // Switch to the Weekly Activity view by reusing the sidebar handler. Retries
    // briefly in case field mode evaluates before the sidebar is wired at boot.
    const forceWeekly = (tries) => {
        tries = tries || 0;
        const link = document.getElementById('sidebar-weekly');
        if (link && typeof window.renderWeeklyActivity === 'function') { link.click(); return; }
        if (tries < 25) setTimeout(() => forceWeekly(tries + 1), 150);
    };

    // The sidebar (hidden in field mode) holds the only Logout — surface one in
    // the header so field staff can still sign out.
    const ensureLogout = () => {
        if (document.getElementById('field-logout-btn')) return;
        const headerRight = document.querySelector('header .header-right');
        if (!headerRight) return;
        const btn = document.createElement('button');
        btn.id = 'field-logout-btn';
        btn.className = 'btn-secondary';
        btn.textContent = '🚪 Logout';
        btn.onclick = () => { const l = document.getElementById('sidebar-logout'); if (l) l.click(); };
        headerRight.appendChild(btn);
    };

    const setTitle = () => {
        const h1 = document.querySelector('header h1');
        if (h1) h1.textContent = 'Weekly Field Report';
    };

    const apply = () => {
        active = true;
        document.body.classList.add('field-mode');
        document.body.classList.remove('mobile-nav-open');
        ensureLogout();
        setTitle();
        forceWeekly();
        // Catch a late default-view (e.g. dashboard) render at boot and re-assert.
        setTimeout(enforce, 500);
        setTimeout(enforce, 1200);
    };

    const unapply = () => {
        active = false;
        document.body.classList.remove('field-mode');
    };

    // Keep Weekly enforced while in field mode (handles the boot race only — there
    // is no other navigation once the sidebar is hidden).
    const enforce = () => {
        if (!active) return;
        if (window.state && window.state.activeViewType !== 'weekly_activity') { forceWeekly(); setTitle(); }
    };

    const evaluate = () => {
        if (!appVisible()) return;
        if (isPhone()) { if (!active) apply(); else enforce(); }
        else if (active) unapply();
    };

    let resizeTimer;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(evaluate, 250); };

    const boot = () => {
        evaluate();
        // Re-evaluate when the main app becomes visible (i.e. on login).
        const target = document.getElementById('app-layout-main');
        if (target && window.MutationObserver) {
            new MutationObserver(evaluate).observe(target, { attributes: true, attributeFilter: ['style'] });
        }
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', () => setTimeout(evaluate, 300));
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
