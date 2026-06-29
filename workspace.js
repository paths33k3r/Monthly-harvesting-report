// =====================================================================
// workspace.js — multi-workspace support (Oil Palm / Tree Planting)
//
// The whole app talks to ONE Firebase Realtime Database object
// (firebase.database() is a singleton; every window._xxxDb handle points
// at it). So we namespace EVERY data path by patching that one object's
// .ref() method a single time (window._wsPatchDb, called from app_boot.js
// right after the db is created). No per-module edits needed.
//
// Path scheme:
//   • Oil Palm (default)   -> legacy paths unchanged   shared/app_state, ...
//                             (zero migration; existing data is untouched)
//   • Tree Planting (etc.) -> shared/ws/<id>/app_state, ...
//   • Global paths (user_roles, user_prefs, _ui_probe, users/<uid>/...)
//                             are NOT namespaced — logins & permissions are
//                             shared across workspaces.
//
// Switch model (per the product decisions): per-device choice stored in
// localStorage, page reload on switch so no data bleeds between workspaces.
// =====================================================================
(function () {
    var KEY = 'active_workspace';

    // Per-workspace config.
    //   hiddenAreas: data-menu-key values to hide ENTIRELY (whole functional
    //                area incl. its submenu). These mirror the permission keys:
    //                  ffbBudget, planting, gangs, performance, ironhorse,
    //                  wages, weekly, rainfall, maintenance, reports,
    //                  dataManagement, auditLog
    //   hiddenItems: individual sidebar element ids to hide a single row, e.g.
    //                  'sidebar-ytd', 'sidebar-ironhorse-costperha',
    //                  'sidebar-wages-ledger', 'sidebar-manuring'
    // Both default to [] → every menu is shown (Tree Planting is a full copy).
    // To make something exclusive later, just add its key/id to the list below.
    window.WORKSPACES = {
        oil_palm: {
            id: 'oil_palm', label: 'Oil Palm', logo: '🌴', subtitle: 'Harvesting Report',
            // Tree Logs Recording is a Tree-Planting-only feature → hide here.
            hiddenAreas: ['treelogs'], hiddenItems: []
        },
        tree_planting: {
            id: 'tree_planting', label: 'Tree Planting', logo: '🌳', subtitle: 'Tree Planting Report',
            hiddenAreas: [], hiddenItems: []
        }
    };

    function readActive() {
        try { return localStorage.getItem(KEY) || 'oil_palm'; } catch (e) { return 'oil_palm'; }
    }
    window.ACTIVE_WORKSPACE = readActive();
    if (!window.WORKSPACES[window.ACTIVE_WORKSPACE]) window.ACTIVE_WORKSPACE = 'oil_palm';

    // Rewrite a Firebase path for the active workspace.
    window._wsPath = function (path) {
        if (typeof path !== 'string') return path;
        var ws = window.ACTIVE_WORKSPACE;
        if (!ws || ws === 'oil_palm') return path;        // backward compatible
        if (path === 'shared') return 'shared/ws/' + ws;
        if (path.indexOf('shared/') === 0) return 'shared/ws/' + ws + '/' + path.slice(7);
        return path;                                       // global path — leave as-is
    };

    // Convenience: is the current workspace the original Oil Palm one?
    window._isOilPalmWorkspace = function () {
        return !window.ACTIVE_WORKSPACE || window.ACTIVE_WORKSPACE === 'oil_palm';
    };

    // Wrap a Firebase database handle so every string ref() is namespaced.
    // Idempotent — safe to call more than once on the same handle.
    window._wsPatchDb = function (db) {
        if (!db || db.__wsPatched) return db;
        var origRef = db.ref.bind(db);
        db.ref = function (p) {
            return origRef(arguments.length === 0 ? undefined : window._wsPath(p));
        };
        db.__wsPatched = true;
        return db;
    };

    // Switch workspace: confirm, persist, reload.
    window.switchWorkspace = function (id) {
        if (!window.WORKSPACES[id] || id === window.ACTIVE_WORKSPACE) return;
        var label = window.WORKSPACES[id].label;
        var ok = confirm('Switch to the ' + label + ' workspace?\n\n' +
            'The page will reload and show ' + label + ' data only. ' +
            'Your other workspace stays exactly as it is.');
        if (!ok) {
            // revert the <select> to the current workspace
            var sel = document.getElementById('workspace-switcher');
            if (sel) sel.value = window.ACTIVE_WORKSPACE;
            return;
        }
        try { localStorage.setItem(KEY, id); } catch (e) { }
        location.reload();
    };

    // Apply branding (logo + subtitle + title) and inject the switcher dropdown
    // into the sidebar header. Runs as soon as the header exists.
    function applyBrandingAndSwitcher() {
        var ws = window.WORKSPACES[window.ACTIVE_WORKSPACE] || window.WORKSPACES.oil_palm;
        var header = document.querySelector('.sidebar-header');
        if (!header) return;

        var logoEl = header.querySelector('.sidebar-logo');
        if (logoEl) logoEl.textContent = ws.logo;
        var sub = header.querySelector('h2 small');
        if (sub) sub.textContent = ws.subtitle;
        try { document.title = ws.label + ' — ' + ws.subtitle; } catch (e) { }

        if (document.getElementById('workspace-switcher')) return; // already injected
        var sel = document.createElement('select');
        sel.id = 'workspace-switcher';
        sel.className = 'workspace-switcher';
        sel.title = 'Switch between Oil Palm and Tree Planting';
        Object.keys(window.WORKSPACES).forEach(function (k) {
            var w = window.WORKSPACES[k];
            var o = document.createElement('option');
            o.value = k;
            o.textContent = w.logo + '  ' + w.label;
            if (k === window.ACTIVE_WORKSPACE) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function () { window.switchWorkspace(sel.value); });
        header.appendChild(sel);
    }

    // Hide menus that aren't part of the active workspace. Driven by the
    // hiddenAreas / hiddenItems config above. Idempotent: it first restores any
    // rows IT previously hid (data-ws-hidden marker) so it never reveals rows
    // hidden by role-permissions, and re-runs cleanly. Call this AFTER role
    // permissions are applied (wired in script.js, finishInit).
    window.applyWorkspaceMenus = function () {
        var ws = window.WORKSPACES[window.ACTIVE_WORKSPACE] || window.WORKSPACES.oil_palm;

        // restore previous workspace hides (only the ones we set)
        Array.prototype.forEach.call(document.querySelectorAll('[data-ws-hidden="1"]'), function (el) {
            el.style.display = '';
            el.removeAttribute('data-ws-hidden');
        });

        var hideEl = function (el) {
            if (!el) return;
            var target = (el.closest && el.closest('.nav-item')) || el;
            target.style.display = 'none';
            target.setAttribute('data-ws-hidden', '1');
        };

        (ws.hiddenAreas || []).forEach(function (key) {
            Array.prototype.forEach.call(
                document.querySelectorAll('.nav-item[data-menu-key="' + key + '"]'), hideEl);
        });
        (ws.hiddenItems || []).forEach(function (id) {
            hideEl(document.getElementById(id));
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyBrandingAndSwitcher);
    } else {
        applyBrandingAndSwitcher();
    }
})();
