window.state = window.state || {};
const state = window.state;

document.addEventListener('DOMContentLoaded', () => {
    // --- FIREBASE INIT ---
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

    // --- LOGIN UI HANDLERS ---
    const loginOverlay = document.getElementById('login-overlay');
    const appLayout = document.getElementById('app-layout-main');
    const emailInp = document.getElementById('login-email');
    const passInp = document.getElementById('login-pass');
    const loginErr = document.getElementById('login-error');

    document.getElementById('btn-login').onclick = () => {
        loginErr.textContent = '';
        const email = emailInp.value.trim();
        const password = passInp.value;
        const rememberMe = document.getElementById('remember-me').checked;
        const persistence = rememberMe
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION;
        auth.setPersistence(persistence)
            .then(() => auth.signInWithEmailAndPassword(email, password))
            .then(() => {
                if (rememberMe) {
                    const expiry = Date.now() + 90 * 24 * 60 * 60 * 1000; // 3 months
                    localStorage.setItem('rm_expiry_' + email, String(expiry));
                } else {
                    localStorage.removeItem('rm_expiry_' + email);
                }
            })
            .catch(e => { loginErr.textContent = e.message; });
    };

    // Forgot password handlers
    const forgotPwOverlay = document.getElementById('forgot-pw-overlay');
    document.getElementById('btn-forgot-password').onclick = (e) => {
        e.preventDefault();
        loginErr.textContent = '';
        document.getElementById('forgot-pw-email').value = emailInp.value;
        document.getElementById('forgot-pw-msg').textContent = '';
        forgotPwOverlay.style.display = 'flex';
    };
    document.getElementById('btn-forgot-pw-cancel').onclick = () => {
        forgotPwOverlay.style.display = 'none';
    };
    document.getElementById('btn-forgot-pw-send').onclick = () => {
        const fpEmail = document.getElementById('forgot-pw-email').value.trim();
        const msgEl = document.getElementById('forgot-pw-msg');
        if (!fpEmail) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = 'Please enter your email.'; return; }
        auth.sendPasswordResetEmail(fpEmail)
            .then(() => { msgEl.style.color = '#10b981'; msgEl.textContent = 'Reset link sent! Check your inbox.'; })
            .catch(e => { msgEl.style.color = 'var(--danger)'; msgEl.textContent = e.message; });
    };

    // Logout sidebar handler
    const sidebarLogout = document.getElementById('sidebar-logout');
    if (sidebarLogout) {
        sidebarLogout.onclick = (e) => {
            e.preventDefault();
            auth.signOut();
        };
    }



    // --- IDLE TIMEOUT LOGIC ---
    let idleTimer;
    let warningCountdownTimer;
    const IDLE_LIMIT = 15 * 60 * 1000; // 15 minutes
    const WARNING_LIMIT = 30; // 30 seconds

    const startIdleTimer = () => {
        if (!auth.currentUser) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(showIdleWarning, IDLE_LIMIT);
    };

    const showIdleWarning = () => {
        const modal = document.getElementById('idle-modal-overlay');
        const countdownEl = document.getElementById('idle-countdown');
        if (!modal) return;

        modal.style.display = 'flex';
        let remaining = WARNING_LIMIT;
        countdownEl.textContent = remaining;

        clearInterval(warningCountdownTimer);
        warningCountdownTimer = setInterval(() => {
            remaining--;
            countdownEl.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(warningCountdownTimer);
                auth.signOut();
            }
        }, 1000);
    };

    const resetIdleState = () => {
        const modal = document.getElementById('idle-modal-overlay');
        if (modal && modal.style.display === 'flex') {
            modal.style.display = 'none';
            clearInterval(warningCountdownTimer);
            startIdleTimer();
        } else {
            startIdleTimer();
        }
    };

    // Listen for activity
    ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (auth.currentUser) startIdleTimer();
        }, true);
    });

    const btnStayIn = document.getElementById('btn-stay-logged-in');
    if (btnStayIn) btnStayIn.onclick = resetIdleState;


    let isAppRunning = false;
    auth.onAuthStateChanged(user => {
        if (user) {
            // Check remember me expiry
            const rmKey = 'rm_expiry_' + user.email;
            const rmExpiry = localStorage.getItem(rmKey);
            if (rmExpiry && Date.now() > parseInt(rmExpiry)) {
                localStorage.removeItem(rmKey);
                auth.signOut();
                return;
            }
            loginOverlay.style.display = 'none';
            appLayout.style.display = 'flex';
            startIdleTimer();
            if (!isAppRunning) {
                isAppRunning = true;
                runMainApplication();
            }
        } else {
            loginOverlay.style.display = 'flex';
            appLayout.style.display = 'none';
            clearTimeout(idleTimer);
            clearInterval(warningCountdownTimer);
            if (isAppRunning) {
                window.location.reload(); // Reload to reset state on logout
            }
        }
    });

    const runMainApplication = () => {
        // App State
        Object.assign(state, {
            reports: {}, // { "2025": [ { block_id, ha, op_year, gang }, ... ] }
            performance: {}, // { "2025": { "Jan": { "DARSO GANG": { manpower: 17, leave: 0, blocks: { "15": { budget: 56.34, r1: 33.38, r2: 10.51, r3: 20.07, manday: 56 } } } } } } }
            ffbBudget: null, // initialized later
            rainfall: null, // initialized later
            gangsByYear: {}, // { "2025": ["DARSO GANG", ...], "2026": [...] }
            selectedReportYear: null,
            activeViewType: 'report_year',
            activeViewValue: null,
            activePerfMonth: null // Used when activeViewType === 'perf_month'
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
            for (const [gang, blocks] of Object.entries(predefinedGangs)) {
                if (blocks.includes(blockId)) return gang;
            }
            return "Unassigned";
        };

        // =====================================================================
        // USER MANAGEMENT & ROLES
        // =====================================================================
        let currentUserRole = null; // { role, allowedMenus, firstLogin, email, ... }

        const ALL_MENU_KEYS = ['ffbBudget', 'planting', 'gangs', 'performance', 'rainfall', 'maintenance', 'dataManagement'];

        const loadUserRole = async (uid) => {
            try {
                const snap = await db.ref('user_roles/' + uid).once('value');
                const data = snap.val();
                if (data) {
                    currentUserRole = data;
                } else {
                    // First ever user — grant admin rights and save
                    currentUserRole = { role: 'admin', allowedMenus: 'all', firstLogin: false, email: auth.currentUser.email, createdAt: Date.now() };
                    await db.ref('user_roles/' + uid).set(currentUserRole);
                }
            } catch (e) {
                console.error('loadUserRole error:', e);
                currentUserRole = { role: 'admin', allowedMenus: 'all', firstLogin: false };
            }
        };

        const applyRolePermissions = () => {
            if (!currentUserRole) return;
            const isAdmin = currentUserRole.role === 'admin';
            const userMgmtItem = document.getElementById('nav-user-mgmt-item');
            if (userMgmtItem) userMgmtItem.style.display = isAdmin ? '' : 'none';

            if (!isAdmin && Array.isArray(currentUserRole.allowedMenus)) {
                const allowed = currentUserRole.allowedMenus;
                document.querySelectorAll('.nav-menu > .nav-item[data-menu-key]').forEach(item => {
                    const key = item.getAttribute('data-menu-key');
                    item.style.display = allowed.includes(key) ? '' : 'none';
                });
            }
        };

        const checkFirstLogin = () => {
            if (currentUserRole && currentUserRole.firstLogin) {
                const overlay = document.getElementById('first-login-overlay');
                if (overlay) overlay.style.display = 'flex';

                document.getElementById('btn-set-new-pw').onclick = () => {
                    const pw1 = document.getElementById('new-pw-1').value;
                    const pw2 = document.getElementById('new-pw-2').value;
                    const msgEl = document.getElementById('first-login-msg');
                    if (!pw1 || pw1.length < 6) { msgEl.textContent = 'Password must be at least 6 characters.'; return; }
                    if (pw1 !== pw2) { msgEl.textContent = 'Passwords do not match.'; return; }
                    auth.currentUser.updatePassword(pw1)
                        .then(() => {
                            db.ref('user_roles/' + auth.currentUser.uid + '/firstLogin').set(false);
                            currentUserRole.firstLogin = false;
                            overlay.style.display = 'none';
                            alert('Password updated successfully!');
                        })
                        .catch(e => { msgEl.textContent = e.message; });
                };
            }
        };

        // ── Google Drive helpers ────────────────────────────────────────
        // Replace YOUR_GOOGLE_OAUTH_CLIENT_ID with your OAuth 2.0 Client ID.
        // You can reuse the InventoryWeb client ID by adding this app's origin
        // (e.g. http://localhost or file://) to its Authorised JavaScript origins
        // at: https://console.cloud.google.com/apis/credentials
        const GDRIVE_CLIENT_ID = '1073324997940-8nocphvtf77673hkb3v0s5v1f1tmbeh9.apps.googleusercontent.com';
        const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
        const GDRIVE_FOLDER_NAME = 'Harvesting Report Backups';
        let gdriveTokenClient = null;

        const gdriveRequireToken = () => new Promise((resolve, reject) => {
            const saved = localStorage.getItem('gdrive_access_token');
            const exp = localStorage.getItem('gdrive_token_expires');
            if (saved && exp && Date.now() < parseInt(exp)) return resolve(saved);
            if (!window.google?.accounts?.oauth2) return reject(new Error('Google Identity SDK not loaded.'));
            if (!gdriveTokenClient) {
                gdriveTokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: GDRIVE_CLIENT_ID,
                    scope: GDRIVE_SCOPES,
                    callback: (res) => {
                        if (res.error) { reject(res); return; }
                        localStorage.setItem('gdrive_access_token', res.access_token);
                        localStorage.setItem('gdrive_token_expires', String(Date.now() + 3500000));
                        resolve(res.access_token);
                    }
                });
            }
            gdriveTokenClient.requestAccessToken({ prompt: '' });
        });

        const gdriveLogin = () => new Promise((resolve, reject) => {
            if (!window.google?.accounts?.oauth2) return reject(new Error('Google Identity SDK not loaded.'));
            gdriveTokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: GDRIVE_CLIENT_ID,
                scope: GDRIVE_SCOPES,
                callback: (res) => {
                    if (res.error) { reject(res); return; }
                    localStorage.setItem('gdrive_access_token', res.access_token);
                    localStorage.setItem('gdrive_token_expires', String(Date.now() + 3500000));
                    resolve(res.access_token);
                }
            });
            gdriveTokenClient.requestAccessToken({ prompt: 'consent' });
        });

        const gdriveLogout = () => {
            localStorage.removeItem('gdrive_access_token');
            localStorage.removeItem('gdrive_token_expires');
            gdriveTokenClient = null;
        };

        const gdriveIsConnected = () => {
            const exp = localStorage.getItem('gdrive_token_expires');
            return !!(exp && Date.now() < parseInt(exp));
        };

        const gdriveGetOrCreateFolder = async (token) => {
            const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${GDRIVE_FOLDER_NAME}' and trashed=false`);
            const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!listRes.ok) throw new Error(`Drive folder search failed: ${listRes.statusText}`);
            const listData = await listRes.json();
            if (listData.files && listData.files.length > 0) return listData.files[0].id;
            const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: GDRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
            });
            if (!createRes.ok) throw new Error(`Drive folder creation failed: ${createRes.statusText}`);
            const folder = await createRes.json();
            return folder.id;
        };

        const gdriveUpload = async () => {
            const token = await gdriveRequireToken();
            const folderId = await gdriveGetOrCreateFolder(token);
            const json = JSON.stringify(window.state, null, 2);
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `harvesting_backup_${dateStr}.json`;
            const boundary = '-------314159265358979323846';
            const body =
                `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                JSON.stringify({ name: filename, mimeType: 'application/json', parents: [folderId] }) +
                `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                json +
                `\r\n--${boundary}--`;
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
                body
            });
            if (!res.ok) {
                let msg = res.statusText;
                try { const e = await res.json(); if (e.error?.message) msg = e.error.message; } catch (_) { }
                throw new Error(`Google Drive upload failed: ${msg}`);
            }
            return await res.json();
        };

        const gdriveList = async () => {
            try {
                const token = await gdriveRequireToken();
                const folderId = await gdriveGetOrCreateFolder(token);
                const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
                const fields = encodeURIComponent("files(id,name,size,createdTime)");
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime desc`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(`Drive list failed: ${res.statusText}`);
                const data = await res.json();
                return (data.files || []).map(f => ({ id: f.id, name: f.name, size: f.size ? parseInt(f.size) : 0, timeCreated: f.createdTime }));
            } catch (e) { console.error('gdriveList:', e); return []; }
        };

        const gdriveDownload = async (fileId) => {
            const token = await gdriveRequireToken();
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`Drive download failed: ${res.statusText}`);
            return await res.json();
        };

        const gdriveDelete = async (fileId) => {
            const token = await gdriveRequireToken();
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok && res.status !== 204) throw new Error(`Drive delete failed: ${res.statusText}`);
            return true;
        };

        const gdriveEnforceRetention = async (retentionDays = 7) => {
            if (!gdriveIsConnected()) return 0;
            try {
                const backups = await gdriveList();
                const now = new Date();
                let deleted = 0;
                for (const b of backups) {
                    const diffDays = (now - new Date(b.timeCreated)) / (1000 * 60 * 60 * 24);
                    if (diffDays > retentionDays) { await gdriveDelete(b.id); deleted++; }
                }
                return deleted;
            } catch (e) { console.error('gdriveEnforceRetention:', e); return 0; }
        };

        // ── Backup helpers ──────────────────────────────────────────────
        const BACKUP_SETTINGS_KEY = 'harvestingBackupSettings';
        const BACKUP_DEFAULTS = { autoBackupEnabled: false, frequencyDays: 1, retentionDays: 7, lastBackupTime: null };

        const loadBackupSettings = () => {
            try {
                const saved = localStorage.getItem(BACKUP_SETTINGS_KEY);
                return saved ? { ...BACKUP_DEFAULTS, ...JSON.parse(saved) } : { ...BACKUP_DEFAULTS };
            } catch { return { ...BACKUP_DEFAULTS }; }
        };

        const saveBackupSettings = (s) => {
            localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(s));
        };

        const showToast = (msg) => {
            const t = document.createElement('div');
            t.textContent = msg;
            t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;font-size:0.9rem;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:1;transition:opacity 0.4s;';
            document.body.appendChild(t);
            setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
        };

        const triggerBackup = async (silent = false) => {
            const settings = loadBackupSettings();
            try {
                if (gdriveIsConnected()) {
                    await gdriveUpload();
                    await gdriveEnforceRetention(settings.retentionDays);
                    settings.lastBackupTime = new Date().toISOString();
                    saveBackupSettings(settings);
                    showToast(silent ? 'Auto-backup saved to Google Drive.' : 'Backup saved to Google Drive.');
                } else {
                    const dataStr = JSON.stringify(window.state, null, 2);
                    const blob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    a.download = `harvesting-backup-${dateStr}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    settings.lastBackupTime = new Date().toISOString();
                    saveBackupSettings(settings);
                    if (!silent) showToast('Backup downloaded locally (Google Drive not connected).');
                    else showToast('Auto-backup downloaded locally.');
                }
            } catch (err) {
                if (!silent) alert('Backup failed: ' + err.message);
                else console.error('Auto-backup failed:', err);
            }
        };

        const autoBackupCheck = () => {
            if (currentUserRole?.role !== 'admin') return;
            const settings = loadBackupSettings();
            if (!settings.autoBackupEnabled) return;
            const now = Date.now();
            const lastMs = settings.lastBackupTime ? new Date(settings.lastBackupTime).getTime() : 0;
            const diffDays = (now - lastMs) / (1000 * 60 * 60 * 24);
            if (diffDays >= settings.frequencyDays) triggerBackup(true);
        };

        let _activityDebounce = null;
        let _activityListenerAdded = false;
        const setupActivityBackupListener = () => {
            if (_activityListenerAdded || currentUserRole?.role !== 'admin') return;
            _activityListenerAdded = true;
            window.addEventListener('harvesting:activity', () => {
                if (_activityDebounce) clearTimeout(_activityDebounce);
                _activityDebounce = setTimeout(() => autoBackupCheck(), 15000);
            });
        };

        const renderBackupSettingsPanel = async () => {
            const wrapper = document.getElementById('user-mgmt-wrapper');
            if (!wrapper) return;

            ['main-report-wrapper', 'interval-wrapper', 'performance-wrapper',
                'ytd-wrapper', 'current-prev-wrapper', 'ffb-budget-wrapper', 'rainfall-wrapper']
                .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            wrapper.classList.remove('hidden');

            const settings = loadBackupSettings();
            const connected = gdriveIsConnected();
            const lastLabel = settings.lastBackupTime ? new Date(settings.lastBackupTime).toLocaleString() : 'Never';

            const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
            const fmtSize = (b) => { if (!b) return '—'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };

            const renderConnectView = () => {
                wrapper.innerHTML = `
            <div style="padding:1.5rem; max-width:680px;">
                <h2 style="margin-top:0; margin-bottom:1.5rem;">Backup Settings</h2>
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:2.5rem; text-align:center;">
                    <div style="font-size:3rem; margin-bottom:0.75rem;">☁️</div>
                    <h3 style="margin:0 0 0.5rem; color:var(--text-secondary);">Connect Google Drive</h3>
                    <p style="font-size:0.9rem; color:var(--text-muted); max-width:380px; margin:0 auto 1.5rem;">
                        Sign in with Google to enable cloud backups. All harvesting data will be saved to your Google Drive.
                    </p>
                    <button id="btn-gdrive-connect" class="btn-primary" style="padding:0.6rem 1.6rem;">Sign in with Google</button>
                    <p id="gdrive-connect-msg" style="margin-top:0.75rem; font-size:0.85rem; color:#ef4444; min-height:1.2rem;"></p>
                </div>
            </div>`;
                wrapper.querySelector('#btn-gdrive-connect').onclick = async () => {
                    const msg = wrapper.querySelector('#gdrive-connect-msg');
                    try {
                        msg.textContent = 'Connecting…';
                        msg.style.color = 'var(--text-secondary)';
                        await gdriveLogin();
                        renderBackupSettingsPanel();
                    } catch (e) {
                        msg.style.color = '#ef4444';
                        msg.textContent = 'Failed to connect: ' + (e.details || e.message || 'Unknown error. Check that the OAuth Client ID is configured.');
                    }
                };
            };

            const renderConnectedView = async () => {
                wrapper.innerHTML = `<div style="padding:1.5rem; max-width:680px;"><p style="color:var(--text-secondary);">Loading backups…</p></div>`;
                const backups = await gdriveList();

                const backupRows = backups.length === 0
                    ? `<tr><td colspan="3" style="padding:1.5rem; text-align:center; color:var(--text-muted); font-size:0.9rem;">No backups found in Google Drive.</td></tr>`
                    : backups.map(b => `
                    <tr data-id="${b.id}" data-name="${b.name}" style="border-bottom:1px solid var(--border-color);">
                        <td style="padding:10px 8px; font-size:0.88rem;">${fmtDate(b.timeCreated)}</td>
                        <td style="padding:10px 8px; font-size:0.88rem; color:var(--text-secondary);">${fmtSize(b.size)}</td>
                        <td style="padding:10px 8px; display:flex; gap:6px;">
                            <button class="btn-restore-backup btn-secondary" data-id="${b.id}" data-name="${b.name}" style="padding:3px 10px; font-size:0.8rem;">Restore</button>
                            <button class="btn-delete-backup" data-id="${b.id}" data-name="${b.name}" style="padding:3px 10px; font-size:0.8rem; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer;">Delete</button>
                        </td>
                    </tr>`).join('');

                wrapper.innerHTML = `
            <div style="padding:1.5rem; max-width:680px;">
                <h2 style="margin-top:0; margin-bottom:1.5rem;">Backup Settings</h2>

                <!-- Drive status bar -->
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1rem 1.5rem; margin-bottom:1.5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                    <span style="font-size:0.9rem;">☁️ <strong>Google Drive</strong> connected &nbsp;<span style="color:#22c55e;">●</span></span>
                    <div style="display:flex; gap:8px;">
                        <button id="btn-backup-now" class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;">Backup Now</button>
                        <button id="btn-gdrive-disconnect" class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;">Disconnect</button>
                    </div>
                </div>

                <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-start;">
                    <!-- Settings column -->
                    <div style="flex:1; min-width:220px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                        <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Automation</h3>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:1rem; cursor:pointer; font-size:0.9rem;">
                            <input type="checkbox" id="auto-backup-enabled" ${settings.autoBackupEnabled ? 'checked' : ''} style="width:15px;height:15px;" />
                            Auto-Backup on Login
                        </label>
                        <div style="margin-bottom:1rem;">
                            <label style="font-size:0.82rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Frequency</label>
                            <select id="auto-backup-frequency" class="edit-input" style="width:100%; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);" ${!settings.autoBackupEnabled ? 'disabled' : ''}>
                                <option value="1" ${settings.frequencyDays === 1 ? 'selected' : ''}>Every Day</option>
                                <option value="3" ${settings.frequencyDays === 3 ? 'selected' : ''}>Every 3 Days</option>
                                <option value="7" ${settings.frequencyDays === 7 ? 'selected' : ''}>Weekly</option>
                            </select>
                        </div>
                        <div style="margin-bottom:1rem;">
                            <label style="font-size:0.82rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Retention Policy</label>
                            <select id="backup-retention" class="edit-input" style="width:100%; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);">
                                <option value="3"  ${settings.retentionDays === 3 ? 'selected' : ''}>Keep 3 Days</option>
                                <option value="7"  ${settings.retentionDays === 7 ? 'selected' : ''}>Keep 7 Days</option>
                                <option value="14" ${settings.retentionDays === 14 ? 'selected' : ''}>Keep 14 Days</option>
                                <option value="30" ${settings.retentionDays === 30 ? 'selected' : ''}>Keep 30 Days</option>
                            </select>
                        </div>
                        <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:1rem;">
                            Last backup:<br><strong style="color:var(--text-primary);">${lastLabel}</strong>
                        </div>
                        <button id="btn-save-backup-settings" class="btn-primary" style="width:100%; padding:0.45rem;">Save Settings</button>
                        <p id="backup-settings-msg" style="margin:0.5rem 0 0; font-size:0.82rem; color:#22c55e; min-height:1rem;"></p>
                    </div>

                    <!-- History column -->
                    <div style="flex:2; min-width:280px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                        <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Google Drive Backups</h3>
                        <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
                            <thead>
                                <tr style="border-bottom:2px solid var(--border-color);">
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Date / Time</th>
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Size</th>
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${backupRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;

                // Toggle frequency on checkbox change
                const enabledCb = wrapper.querySelector('#auto-backup-enabled');
                const freqSel = wrapper.querySelector('#auto-backup-frequency');
                enabledCb.addEventListener('change', () => { freqSel.disabled = !enabledCb.checked; });

                // Save settings
                wrapper.querySelector('#btn-save-backup-settings').onclick = () => {
                    const s = loadBackupSettings();
                    s.autoBackupEnabled = enabledCb.checked;
                    s.frequencyDays = parseInt(freqSel.value);
                    s.retentionDays = parseInt(wrapper.querySelector('#backup-retention').value);
                    saveBackupSettings(s);
                    const msg = wrapper.querySelector('#backup-settings-msg');
                    msg.textContent = 'Settings saved!';
                    setTimeout(() => { msg.textContent = ''; }, 2500);
                };

                // Backup Now
                wrapper.querySelector('#btn-backup-now').onclick = async () => {
                    const btn = wrapper.querySelector('#btn-backup-now');
                    btn.disabled = true; btn.textContent = 'Backing up…';
                    await triggerBackup(false);
                    await renderBackupSettingsPanel();
                };

                // Disconnect
                wrapper.querySelector('#btn-gdrive-disconnect').onclick = () => {
                    gdriveLogout();
                    renderBackupSettingsPanel();
                };

                // Restore buttons
                wrapper.querySelectorAll('.btn-restore-backup').forEach(btn => {
                    btn.onclick = async () => {
                        const name = btn.getAttribute('data-name');
                        if (!confirm(`Restoring "${name}" will overwrite ALL current data.\n\nAre you sure?`)) return;
                        btn.disabled = true; btn.textContent = 'Restoring…';
                        try {
                            const data = await gdriveDownload(btn.getAttribute('data-id'));
                            window.state = data;
                            await saveState(false);
                            alert('Backup restored! The page will now reload.');
                            location.reload();
                        } catch (e) {
                            alert('Restore failed: ' + e.message);
                            btn.disabled = false; btn.textContent = 'Restore';
                        }
                    };
                });

                // Delete buttons
                wrapper.querySelectorAll('.btn-delete-backup').forEach(btn => {
                    btn.onclick = async () => {
                        const name = btn.getAttribute('data-name');
                        if (!confirm(`Delete backup "${name}"? This cannot be undone.`)) return;
                        btn.disabled = true;
                        try {
                            await gdriveDelete(btn.getAttribute('data-id'));
                            await renderBackupSettingsPanel();
                        } catch (e) {
                            alert('Delete failed: ' + e.message);
                            btn.disabled = false;
                        }
                    };
                });
            };

            if (connected) {
                await renderConnectedView();
            } else {
                renderConnectView();
            }
        };

        const renderUserManagementPanel = async () => {
            const wrapper = document.getElementById('user-mgmt-wrapper');
            if (!wrapper) return;

            // Hide all other wrappers
            ['main-report-wrapper', 'interval-wrapper', 'performance-wrapper',
                'ytd-wrapper', 'current-prev-wrapper', 'ffb-budget-wrapper', 'rainfall-wrapper']
                .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            wrapper.classList.remove('hidden');

            wrapper.innerHTML = '<div style="padding:1rem; color:var(--text-secondary);">Loading users...</div>';

            let usersData = {};
            try {
                const snap = await db.ref('user_roles').once('value');
                usersData = snap.val() || {};
            } catch (e) {
                // Permission denied on parent node — fall back to empty and continue
                console.warn('Could not read all user_roles:', e.message);
                usersData = {};
            }

            // Always ensure the currently logged-in user appears in the list.
            // This handles first-time setup or cases where the write was blocked.
            const currentUid = auth.currentUser && auth.currentUser.uid;
            if (currentUid && !usersData[currentUid]) {
                const entry = {
                    email: (auth.currentUser && auth.currentUser.email) || (currentUserRole && currentUserRole.email) || '(unknown)',
                    role: (currentUserRole && currentUserRole.role) || 'admin',
                    allowedMenus: (currentUserRole && currentUserRole.allowedMenus) || 'all',
                    firstLogin: (currentUserRole && currentUserRole.firstLogin) || false
                };
                usersData[currentUid] = entry;
                // Try to persist the entry so future reads have it
                db.ref('user_roles/' + currentUid).set(entry).catch(() => { });
            }

            const allMenuOptions = [
                { key: 'ffbBudget', label: 'FFB Budget Estimate' },
                { key: 'planting', label: 'Planting Phase Record' },
                { key: 'gangs', label: 'Harvesting Gangs' },
                { key: 'performance', label: 'Harvesting Performance' },
                { key: 'rainfall', label: 'Rainfall Record' },
                { key: 'dataManagement', label: 'Data Management' }
            ];

            wrapper.innerHTML = `
        <div style="padding:1.5rem;">
            <h2 style="margin-top:0; margin-bottom:1.5rem;">User Management</h2>

            <!-- Create New User -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem; margin-bottom:2rem;">
                <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Create New User</h3>
                <div style="display:flex; gap:1rem; align-items:flex-end; flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Email Address</label>
                        <input type="email" id="new-user-email" placeholder="user@example.com" class="edit-input" style="width:100%; padding:0.6rem; border:1px solid var(--border-color); border-radius:4px;" />
                    </div>
                    <div style="min-width:130px;">
                        <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Role</label>
                        <select id="new-user-role" class="edit-input" style="width:100%; padding:0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);">
                            <option value="user">Normal User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button id="btn-create-user" class="btn-primary" style="padding:0.6rem 1.5rem; white-space:nowrap;">Create User</button>
                </div>
                <div style="margin-top:1rem;">
                    <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:6px;">Allowed Menus (for Normal User role):</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${allMenuOptions.map(m => `
                            <label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;cursor:pointer;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);">
                                <input type="checkbox" class="new-user-menu-cb" value="${m.key}" checked /> ${m.label}
                            </label>`).join('')}
                    </div>
                </div>
                <p id="create-user-msg" style="margin-top:0.75rem; min-height:1.2rem; font-size:0.9rem;"></p>
            </div>

            <!-- Existing Users Table -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Existing Users</h3>
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead>
                        <tr style="border-bottom:2px solid var(--border-color);">
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Email</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Role</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Allowed Menus</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="user-table-body">
                        ${Object.entries(usersData).map(([uid, u]) => `
                            <tr data-uid="${uid}" style="border-bottom:1px solid var(--border-color);">
                                <td style="padding:10px 8px;">${u.email || '(unknown)'}</td>
                                <td style="padding:10px 8px;">
                                    <select class="user-role-select edit-input" data-uid="${uid}" style="padding:4px 8px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.85rem;">
                                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                        <option value="user" ${u.role === 'user' ? 'selected' : ''}>Normal User</option>
                                    </select>
                                </td>
                                <td style="padding:10px 8px; font-size:0.8rem; color:var(--text-secondary);">
                                    ${u.role === 'admin' ? 'All' : (Array.isArray(u.allowedMenus) ? u.allowedMenus.join(', ') : 'All')}
                                </td>
                                <td style="padding:10px 8px; display:flex; gap:6px;">
                                    <button class="btn-edit-user btn-primary" data-uid="${uid}" style="padding:4px 10px; font-size:0.8rem;">Edit</button>
                                    <button class="btn-reset-pw btn-secondary" data-uid="${uid}" data-email="${u.email || ''}" style="padding:4px 10px; font-size:0.8rem;">Reset PW</button>
                                    <button class="btn-delete-user" data-uid="${uid}" data-email="${u.email || ''}" style="padding:4px 10px; font-size:0.8rem; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer;">Delete</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

            // Edit User — opens inline edit modal
            wrapper.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.onclick = () => {
                    const uid = btn.getAttribute('data-uid');
                    const userData = usersData[uid];
                    if (!userData) return;
                    showEditUserModal(uid, userData, allMenuOptions, () => renderUserManagementPanel());
                };
            });

            // Reset Password
            wrapper.querySelectorAll('.btn-reset-pw').forEach(btn => {
                btn.onclick = () => {
                    const email = btn.getAttribute('data-email');
                    if (!email) { alert('No email address on record for this user.'); return; }
                    if (confirm(`Send password reset email to ${email}?`)) {
                        auth.sendPasswordResetEmail(email)
                            .then(() => alert(`Reset email sent to ${email}.`))
                            .catch(e => alert('Error: ' + e.message));
                    }
                };
            });

            // Delete User
            wrapper.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.onclick = async () => {
                    const uid = btn.getAttribute('data-uid');
                    const email = btn.getAttribute('data-email');
                    if (uid === currentUid) {
                        alert('You cannot delete your own account.');
                        return;
                    }
                    if (!confirm(`Delete user "${email}"?\n\nThis will remove their access permanently. The Firebase Auth account will remain but they will no longer be able to log in.`)) return;
                    try {
                        await db.ref('user_roles/' + uid).remove();
                        alert(`User "${email}" has been removed.`);
                        renderUserManagementPanel();
                    } catch (e) {
                        alert('Error deleting user: ' + e.message);
                    }
                };
            });

            // Create User
            document.getElementById('btn-create-user').onclick = () => createNewUser(allMenuOptions);
        };

        const showEditUserModal = (uid, userData, allMenuOptions, onSaved) => {
            const existing = document.getElementById('edit-user-modal-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'edit-user-modal-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;display:flex;justify-content:center;align-items:center;';
            overlay.innerHTML = `
            <div style="background:var(--bg-card);padding:2rem;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);width:480px;max-width:95vw;">
                <h3 style="margin-top:0;">Edit User: ${userData.email || uid}</h3>
                <div style="margin-bottom:1rem;">
                    <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">Role</label>
                    <select id="edit-role-select" style="padding:0.6rem;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);width:200px;">
                        <option value="user" ${userData.role === 'user' ? 'selected' : ''}>Normal User</option>
                        <option value="admin" ${userData.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>
                <div id="edit-menu-section" style="${userData.role === 'admin' ? 'opacity:0.4;pointer-events:none;' : ''}">
                    <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:6px;">Allowed Menus:</label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        ${allMenuOptions.map(m => {
                const checked = userData.role === 'admin' || userData.allowedMenus === 'all' || (Array.isArray(userData.allowedMenus) && userData.allowedMenus.includes(m.key));
                return `<label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;cursor:pointer;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);">
                                <input type="checkbox" class="edit-menu-cb" value="${m.key}" ${checked ? 'checked' : ''} /> ${m.label}
                            </label>`;
            }).join('')}
                    </div>
                </div>
                <div style="display:flex;gap:0.75rem;margin-top:1.5rem;justify-content:flex-end;">
                    <button id="edit-user-cancel" class="btn-secondary" style="padding:0.6rem 1.5rem;">Cancel</button>
                    <button id="edit-user-save" class="btn-primary" style="padding:0.6rem 1.5rem;">Save</button>
                </div>
                <p id="edit-user-msg" style="margin-top:0.5rem;min-height:1.2rem;font-size:0.85rem;color:var(--danger);"></p>
            </div>`;
            document.body.appendChild(overlay);

            const roleSelect = document.getElementById('edit-role-select');
            const menuSection = document.getElementById('edit-menu-section');
            roleSelect.onchange = () => {
                menuSection.style.opacity = roleSelect.value === 'admin' ? '0.4' : '1';
                menuSection.style.pointerEvents = roleSelect.value === 'admin' ? 'none' : '';
            };
            document.getElementById('edit-user-cancel').onclick = () => overlay.remove();
            document.getElementById('edit-user-save').onclick = async () => {
                const newRole = roleSelect.value;
                const checkedMenus = [...overlay.querySelectorAll('.edit-menu-cb:checked')].map(cb => cb.value);
                const allowedMenus = newRole === 'admin' ? 'all' : checkedMenus;
                try {
                    await db.ref('user_roles/' + uid).update({ role: newRole, allowedMenus });
                    overlay.remove();
                    if (onSaved) onSaved();
                } catch (e) {
                    document.getElementById('edit-user-msg').textContent = 'Error: ' + e.message;
                }
            };
        };

        const createNewUser = (allMenuOptions) => {
            const emailVal = document.getElementById('new-user-email').value.trim();
            const roleVal = document.getElementById('new-user-role').value;
            const msgEl = document.getElementById('create-user-msg');
            const checkedMenus = [...document.querySelectorAll('.new-user-menu-cb:checked')].map(cb => cb.value);

            if (!emailVal) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = 'Please enter an email address.'; return; }
            msgEl.style.color = 'var(--text-secondary)'; msgEl.textContent = 'Creating user...';

            // Use secondary Firebase app so admin doesn't get logged out
            let secondaryApp;
            try {
                secondaryApp = firebase.app('secondary');
            } catch (e) {
                secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');
            }
            const secondaryAuth = secondaryApp.auth();

            const tempPassword = 'user1234';
            secondaryAuth.createUserWithEmailAndPassword(emailVal, tempPassword)
                .then(async (cred) => {
                    const newUid = cred.user.uid;
                    const allowedMenus = roleVal === 'admin' ? 'all' : checkedMenus;
                    await db.ref('user_roles/' + newUid).set({
                        email: emailVal,
                        role: roleVal,
                        allowedMenus,
                        firstLogin: true,
                        createdAt: Date.now()
                    });
                    await secondaryAuth.signOut();

                    // Build welcome email via mailto
                    const appUrl = window.location.href.split('#')[0];
                    const emailBody = encodeURIComponent(
                        `Hello,\n\nYour account for the Harvesting Performance Dashboard has been created.\n\nLogin URL: ${appUrl}\nEmail: ${emailVal}\nTemporary Password: ${tempPassword}\n\nPlease login and change your password when prompted.\n\nThank you.`
                    );
                    const mailtoLink = `mailto:${emailVal}?subject=Your%20Dashboard%20Account&body=${emailBody}`;

                    msgEl.style.color = '#10b981';
                    msgEl.textContent = `User "${emailVal}" created successfully!`;
                    document.getElementById('new-user-email').value = '';

                    const sendNow = confirm(`User "${emailVal}" created!\nTemp password: ${tempPassword}\n\nClick OK to open your email client to send the welcome email, or Cancel to skip.`);
                    if (sendNow) window.open(mailtoLink, '_blank');

                    renderUserManagementPanel(); // Refresh list
                })
                .catch(e => {
                    secondaryAuth.signOut().catch(() => { });
                    msgEl.style.color = 'var(--danger)';
                    msgEl.textContent = 'Error: ' + e.message;
                });
        };
        // =====================================================================
        // END USER MANAGEMENT
        // =====================================================================

        const getPeakManpowerForGang = (year, month, gangName) => {
            if (!state.performance[year] || !state.performance[year][month] || !state.performance[year][month][gangName]) return 0;
            const gangData = state.performance[year][month][gangName];
            if (!gangData.blocks) return 0;

            // Days 1..31
            const dailyTotals = new Array(31).fill(0);

            Object.values(gangData.blocks).forEach(blockPerf => {
                if (blockPerf.days && Array.isArray(blockPerf.days)) {
                    blockPerf.days.forEach((day, index) => {
                        if (index < 31) {
                            const val = parseFloat(day.hpVal) || 0;
                            dailyTotals[index] += val;
                        }
                    });
                }
            });

            const peak = Math.max(...dailyTotals);
            return peak > 0 ? peak : 0;
        };

        const saveState = (silent = false) => {
            if (!auth.currentUser) return;
            try {
                db.ref('users/' + auth.currentUser.uid + '/app_state').set(JSON.stringify(state))
                    .then(() => {
                        window.dispatchEvent(new CustomEvent('harvesting:activity'));
                        if (!silent) alert("Data saved successfully to cloud!");
                    })
                    .catch(e => {
                        console.error("Firebase save error:", e);
                        if (!silent) alert("Failed to save data. Please check console for errors.");
                    });
            } catch (e) {
                console.error("Error saving state:", e);
                if (!silent) alert("Failed to save data completely.");
            }
        };
        window.saveState = saveState;


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
        const ffbWrapper = document.getElementById('ffb-budget-wrapper');
        const rainfallWrapper = document.getElementById('rainfall-wrapper');

        // Expose db and uid for render_spraying.js
        window._sprayingDb = db;
        window._sprayingUid = auth.currentUser ? auth.currentUser.uid : null;
        auth.onAuthStateChanged(u => {
            window._sprayingUid = u ? u.uid : null;
        });

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

        const handleImportExcel = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Sheet selection: auto-detect harvesting interval sheet, let user confirm or override
                const sheetNames = workbook.SheetNames;
                let sheetsToImport = [];

                // Auto-detect: look for sheet whose row 2 starts with GANG / YEAR / BLOCK / HA
                const isIntervalSheet = (name) => {
                    try {
                        const ws = workbook.Sheets[name];
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
                        for (let r = 0; r <= Math.min(5, rows.length - 1); r++) {
                            const row = rows[r];
                            if (row && String(row[0] || '').trim().toUpperCase() === 'GANG' &&
                                String(row[2] || '').trim().toUpperCase().startsWith('BLOCK')) {
                                return true;
                            }
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                };

                const detectedIndices = sheetNames.reduce((acc, name, idx) => {
                    if (isIntervalSheet(name)) acc.push(idx);
                    return acc;
                }, []);

                if (sheetNames.length === 1) {
                    sheetsToImport = [sheetNames[0]];
                } else {
                    const sheetList = sheetNames.map((name, idx) => {
                        const tag = detectedIndices.includes(idx) ? ' ✓ (harvesting data detected)' : '';
                        return `${idx + 1}. ${name}${tag}`;
                    }).join('\n');

                    const defaultChoice = detectedIndices.length > 0 ? String(detectedIndices[0] + 1) : '1';
                    const sheetChoice = prompt(
                        `This file has ${sheetNames.length} worksheets:\n${sheetList}\n\nEnter a sheet number to import (✓ = harvesting data detected):`,
                        defaultChoice
                    );
                    if (!sheetChoice) { e.target.value = ''; return; }
                    const sheetIndex = parseInt(sheetChoice.trim()) - 1;
                    if (isNaN(sheetIndex) || sheetIndex < 0 || sheetIndex >= sheetNames.length) {
                        alert("Invalid sheet selection. Import cancelled.");
                        e.target.value = '';
                        return;
                    }
                    sheetsToImport = [sheetNames[sheetIndex]];
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

                // Helper: parse a single sheet's rows into newBlocks
                const parseSheetData = (excelData) => {
                    if (!excelData || excelData.length < 4) return;
                    for (let i = 4; i < excelData.length; i++) {
                        const row = excelData[i];
                        if (!row || row.length === 0) continue;

                        const gangCol = row[0];
                        if (gangCol && typeof gangCol === 'string' && gangCol.trim() !== '') {
                            currentGang = gangCol.trim();
                        }

                        const yearCol = row[1];
                        const blockCol = row[2];
                        const haCol = row[3];

                        if (yearCol && blockCol) {
                            const parsedYear = String(yearCol).trim();
                            if (parsedYear) {
                                const blockId = String(blockCol).trim();
                                const haValue = parseFloat(haCol) || 0;
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
                                const totalManday = parseFloat(row[35]) || 0;
                                const r1 = parseFloat(row[36]) || 0;
                                const r2 = parseFloat(row[38]) || 0;
                                const r3 = parseFloat(row[40]) || 0;
                                const r4 = parseFloat(row[42]) || 0;

                                newBlocks.push({
                                    block_id: blockId, ha: haValue, op_year: parsedYear, gang: currentGang,
                                    days: daysData, manday: totalManday, r1, r2, r3, r4
                                });
                                state.performance[targetYear][targetMonth].gangAssignments[blockId] = currentGang;
                            }
                        }
                    }
                };

                // Parse all selected sheets
                sheetsToImport.forEach(sheetName => {
                    const ws = workbook.Sheets[sheetName];
                    const excelData = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
                    parseSheetData(excelData);
                });

                if (newBlocks.length === 0) {
                    alert("No valid data found in the Excel file format.");
                    return;
                }

                // Select the target year in the UI as the active year
                state.selectedReportYear = targetYear;

                // Check if existing data exists for this month and offer to overwrite
                const existingMonthData = state.performance[targetYear]?.[targetMonth];
                const hasExistingGangData = existingMonthData && Object.keys(existingMonthData).some(k => k !== 'gangAssignments');
                if (hasExistingGangData) {
                    const shouldOverwrite = confirm(
                        `Existing data found for ${targetMonth} ${targetYear}.\n\nClick OK to OVERWRITE (clears old data first).\nClick Cancel to MERGE (adds/updates blocks, keeps others).`
                    );
                    if (shouldOverwrite) {
                        state.performance[targetYear][targetMonth] = { gangAssignments: {} };
                    }
                }

                // Merge/overwrite imported gangs with existing blocks.
                // DOES NOT inject new blocks into Planting Phase Records.
                newBlocks.forEach(importedBlock => {
                    // Also update the performance data for the specific block in the target month
                    const gangName = importedBlock.gang;
                    if (!state.performance[targetYear][targetMonth][gangName]) {
                        state.performance[targetYear][targetMonth][gangName] = { manpower: 0, leave: 0, blocks: {} };
                    }

                    const pBlocks = state.performance[targetYear][targetMonth][gangName].blocks;
                    pBlocks[importedBlock.block_id] = {
                        ha: importedBlock.ha,
                        budget: pBlocks[importedBlock.block_id]?.budget || 0,
                        manday: importedBlock.manday,
                        r1: importedBlock.r1,
                        r2: importedBlock.r2,
                        r3: importedBlock.r3,
                        r4: importedBlock.r4,
                        days: importedBlock.days
                    };
                    // Always update gangAssignments so the renderer finds the correct gang key
                    state.performance[targetYear][targetMonth].gangAssignments[importedBlock.block_id] = gangName;
                });

                // After importing blocks, calculate and set peak manpower for all gangs in this month
                Object.keys(state.performance[targetYear][targetMonth]).forEach(key => {
                    if (key !== 'gangAssignments') {
                        const gangPerf = state.performance[targetYear][targetMonth][key];
                        if (!gangPerf.isManpowerManual) {
                            const peak = getPeakManpowerForGang(targetYear, targetMonth, key);
                            gangPerf.manpower = peak;
                        }
                    }
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
                saveState(true);
            };
            reader.readAsArrayBuffer(file);
        };



        const handleImportFfbBudget = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                const excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (excelData.length < 2) {
                    alert("Excel file does not contain enough data rows.");
                    return;
                }

                const importYear = prompt("Enter the year for this FFB Budget import (e.g., 2026):", state.selectedReportYear || "2026");
                if (!importYear) {
                    alert("Import cancelled. Year is required.");
                    return;
                }

                if (!state.ffbBudget) state.ffbBudget = {};
                state.ffbBudget[importYear] = [];

                // Format:
                // Row 0: Headers (BLK, AGE (MTH), HARVEST YR., etc.)
                // Row N: "SUBTOTAL OP2010" (in first column)
                // Row N+1: "1", "168-180", 11.00, etc.

                let currentPhase = "Unassigned";

                for (let i = 1; i < excelData.length; i++) {
                    const row = excelData[i];
                    if (!row || row.length < 1) continue;

                    const firstColRaw = String(row[0] || "").trim();
                    if (!firstColRaw) continue;

                    // Check for Subtotal/Phase row
                    const isSubtotal = firstColRaw.toUpperCase().startsWith("SUBTOTAL");
                    if (isSubtotal) {
                        // Extract phase name e.g. "SUBTOTAL OP2010" -> "OP2010"
                        currentPhase = firstColRaw.substring(8).trim();
                        continue;
                    }

                    // If it's not a subtotal, treat it as a block row.
                    // We need at least enough columns for block, age, harvest yr, mt/ha/yr, mt/ha/mth, ha, and jan
                    if (row.length < 7) continue;

                    const blockId = firstColRaw;
                    const ageMth = row[1] != null ? String(row[1]).trim() : "";
                    const harvestYr = parseFloat(row[2]) || 0;
                    const mtHaYr = parseFloat(row[3]) || 0;
                    const mtHaMth = parseFloat(row[4]) || 0;
                    const ha = parseFloat(row[5]) || 0;

                    const months = [];
                    for (let m = 0; m < 12; m++) {
                        months.push(parseFloat(row[6 + m]) || 0);
                    }

                    state.ffbBudget[importYear].push({
                        phase: currentPhase,
                        block_id: blockId,
                        ageMth,
                        harvestYr,
                        mtHaYr,
                        mtHaMth,
                        ha,
                        months
                    });
                }

                e.target.value = '';
                alert(`Successfully imported ${state.ffbBudget[importYear].length} blocks for year ${importYear}!`);

                // Switch view if it was FFB Budget already
                if (state.activeViewType === 'ffb_budget') {
                    state.activeViewValue = importYear;
                    renderTable();
                }
                saveState(true);
            };
            reader.readAsArrayBuffer(file);
        };

        // Helper for manual import if needed (removed per user request - layout hardcoded directly)

        const handleAddReportYearManual = (newYearStr) => {
            const newYear = newYearStr.trim();
            if (state.reports[newYear]) return;
            state.reports[newYear] = [];
            state.gangsByYear[newYear] = state.gangsByYear[state.selectedReportYear] ? JSON.parse(JSON.stringify(state.gangsByYear[state.selectedReportYear])) : [];
            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;
            saveState(true);
        };

        const handleAddReportYear = (e) => {
            console.log("handleAddReportYear triggered");
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

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

            const sourceGangs = state.gangsByYear[state.selectedReportYear] || [];
            state.gangsByYear[newYear] = JSON.parse(JSON.stringify(sourceGangs));

            // Initialize empty rainfall data for the new year
            if (!state.rainfall) state.rainfall = {};
            if (!state.rainfall[newYear]) {
                if (typeof createEmptyRainfallYear === 'function') {
                    state.rainfall[newYear] = createEmptyRainfallYear();
                } else {
                    state.rainfall[newYear] = {};
                    const monthsArr = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
                    monthsArr.forEach(m => state.rainfall[newYear][m] = { days: 0, mm: 0 });
                }
            }

            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;

            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const handleDuplicateGangYear = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const years = Object.keys(state.reports).sort((a, b) => parseInt(b) - parseInt(a));
            const sourceYear = state.selectedReportYear && state.reports[state.selectedReportYear] ?
                state.selectedReportYear : (years.length > 0 ? years[0] : null);

            if (!sourceYear) {
                alert("No existing year found to duplicate from.");
                return;
            }

            const newYearStr = prompt(`Duplicate gangs from Year ${sourceYear} to new Year (e.g., 2026):`);
            if (!newYearStr || newYearStr.trim() === "") return;
            const newYear = newYearStr.trim();

            if (state.reports[newYear]) {
                alert(`Year ${newYear} already exists!`);
                return;
            }

            // Deep copy
            state.reports[newYear] = JSON.parse(JSON.stringify(state.reports[sourceYear]));
            state.gangsByYear[newYear] = JSON.parse(JSON.stringify(state.gangsByYear[sourceYear] || []));

            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;

            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const renderSidebar = () => {
            // Handle Sidebar Header styling
            const navHeaderBudget = document.getElementById('nav-header-budget');
            const navHeaderYear = document.getElementById('nav-header-year');
            const navHeaderGangYear = document.getElementById('nav-header-gang-year');
            const navHeaderInterval = document.getElementById('nav-header-interval');
            const navHeaderPerf = document.getElementById('nav-header-perf');

            if (navHeaderBudget) navHeaderBudget.style.color = state.activeViewType === 'ffb_budget' ? 'var(--text-primary)' : '';
            if (navHeaderYear) navHeaderYear.style.color = state.activeViewType === 'report_year' ? 'var(--text-primary)' : '';
            if (navHeaderGangYear) navHeaderGangYear.style.color = state.activeViewType === 'gang' ? 'var(--text-primary)' : '';
            if (navHeaderInterval) navHeaderInterval.style.color = state.activeViewType === 'interval_month' ? 'var(--text-primary)' : '';
            if (navHeaderPerf) navHeaderPerf.style.color = state.activeViewType === 'perf_month' ? 'var(--text-primary)' : '';

            const navHeaderYtd = document.getElementById('nav-header-ytd');
            const navHeaderCurrentPrev = document.getElementById('nav-header-current-prev');
            if (navHeaderYtd) navHeaderYtd.style.color = state.activeViewType === 'ytd' ? 'var(--text-primary)' : '';
            if (navHeaderCurrentPrev) navHeaderCurrentPrev.style.color = state.activeViewType === 'current_prev' ? 'var(--text-primary)' : '';

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
                    a.dataset.viewHash = `#view=report_year&year=${year}`;
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

                    const blocks = state.reports[year] || [];
                    // Use persistent gang list for the year
                    const gangs = (state.gangsByYear[year] || []).sort();

                    // Helper for rendering edit/delete icons in Gang list
                    const createActionIcon = (text, className, onClick) => {
                        const span = document.createElement('span');
                        span.className = `sidebar-mini-icon ${className}`;
                        span.innerHTML = text;
                        span.style.cursor = 'pointer';
                        span.style.fontSize = '0.9em';
                        span.style.padding = '2px 4px';
                        span.onclick = (e) => {
                            e.preventDefault();
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
                        a.dataset.viewHash = `#view=gang&year=${year}&gang=${encodeURIComponent(gang)}`;

                        a.style.display = 'flex';
                        a.style.justifyContent = 'space-between';
                        a.style.alignItems = 'center';

                        const labelSpan = document.createElement('span');
                        labelSpan.textContent = gang;
                        a.appendChild(labelSpan);

                        const actionDiv = document.createElement('div');
                        actionDiv.style.display = 'flex';
                        actionDiv.style.gap = '0.5rem';

                        actionDiv.appendChild(createActionIcon('✏️', 'edit-gang', () => {
                            const newName = prompt(`Rename gang '${gang}' in Year ${year}:`);
                            if (newName && newName.trim() !== "" && newName.trim() !== gang) {
                                const trimmedName = newName.trim();
                                // Update reports
                                blocks.forEach(b => {
                                    if (b.gang === gang) b.gang = trimmedName;
                                });
                                // Update persistent gang list
                                const gIdx = state.gangsByYear[year].indexOf(gang);
                                if (gIdx > -1) state.gangsByYear[year][gIdx] = trimmedName;

                                // Update performance data if exists
                                if (state.performance[year]) {
                                    Object.keys(state.performance[year]).forEach(m => {
                                        const mData = state.performance[year][m];
                                        if (mData.gangAssignments) {
                                            Object.keys(mData.gangAssignments).forEach(bId => {
                                                if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = trimmedName;
                                            });
                                        }
                                        if (mData[gang]) {
                                            mData[trimmedName] = mData[gang];
                                            delete mData[gang];
                                        }
                                    });
                                }
                                if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                                    state.activeViewValue = trimmedName;
                                }
                                renderSidebar();
                                renderTable();
                            }
                        }));

                        actionDiv.appendChild(createActionIcon('🗑️', 'delete-gang', () => {
                            if (confirm(`WARNING: Remove Gang '${gang}' from Year ${year}? This will return all blocks in this gang to 'Unassigned' (it will NOT delete the planting phase data).`)) {
                                // Non-destructive: Just unassign blocks
                                blocks.forEach(b => {
                                    if (b.gang === gang) b.gang = "Unassigned";
                                });

                                // Remove from persistent gang list
                                state.gangsByYear[year] = state.gangsByYear[year].filter(g => g !== gang);

                                // Update performance data
                                if (state.performance[year]) {
                                    Object.keys(state.performance[year]).forEach(m => {
                                        const mData = state.performance[year][m];
                                        if (mData.gangAssignments) {
                                            Object.keys(mData.gangAssignments).forEach(bId => {
                                                if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = "Unassigned";
                                            });
                                        }
                                        if (mData[gang]) delete mData[gang];
                                    });
                                }

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
                            const trimmed = newGang.trim();
                            if (!state.gangsByYear[year]) state.gangsByYear[year] = [];
                            if (!state.gangsByYear[year].includes(trimmed)) {
                                state.gangsByYear[year].push(trimmed);
                            }
                            state.selectedReportYear = year;
                            state.activeViewType = 'gang';
                            state.activeViewValue = trimmed;
                            renderSidebar();
                            renderTable();
                            recalculateTotals();
                        }
                    };
                    liAddGang.appendChild(aAddGang);
                    ulGangs.appendChild(liAddGang);

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

                    const monthNavRow = document.createElement('div');
                    monthNavRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
                    monthNavRow.appendChild(selectMonth);

                    const openTabBtn = document.createElement('button');
                    openTabBtn.title = 'Open in new tab';
                    openTabBtn.textContent = '↗';
                    openTabBtn.style.cssText = 'padding:2px 6px;cursor:pointer;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-secondary);color:var(--text-secondary);font-size:0.85rem;flex-shrink:0;';
                    openTabBtn.onclick = (e) => {
                        e.stopPropagation();
                        const selectedMonth = selectMonth.value;
                        if (selectedMonth) {
                            const hash = `#view=${targetViewType}&year=${year}&month=${encodeURIComponent(selectedMonth)}`;
                            window.open(window.location.pathname + hash, '_blank');
                        } else {
                            alert('Please select a month first.');
                        }
                    };
                    monthNavRow.appendChild(openTabBtn);

                    ulMonthsContainer.appendChild(monthNavRow);
                    liYear.appendChild(divYearHeader);
                    liYear.appendChild(ulMonthsContainer);
                    container.appendChild(liYear);
                });
            };

            // Render FFB Budget Navigation
            const renderFfbBudgetNav = () => {
                const container = document.getElementById('sidebar-budget-list');
                if (!container) return;
                container.innerHTML = '';

                const ffbYears = state.ffbBudget ?
                    Object.keys(state.ffbBudget)
                        .filter(key => /^\d{4}$/.test(key)) // Only 4-digit years
                        .sort((a, b) => parseInt(a) - parseInt(b)) : [];

                ffbYears.forEach(year => {
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    if (state.activeViewType === 'ffb_budget' && state.activeViewValue === year) {
                        li.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.textContent = year;
                    a.dataset.viewHash = `#view=ffb_budget&year=${year}`;
                    a.onclick = (e) => {
                        e.preventDefault();
                        state.selectedReportYear = year;
                        state.activeViewType = 'ffb_budget';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    li.appendChild(a);
                    container.appendChild(li);
                });

                // Add FFB Year Button
                const liAddFfbYear = document.createElement('li');
                liAddFfbYear.className = 'nav-item';
                const aAddFfbYear = document.createElement('a');
                aAddFfbYear.href = '#';
                aAddFfbYear.className = 'nav-link add-year-link';
                aAddFfbYear.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
                aAddFfbYear.onclick = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    const newYearStr = prompt("Enter the new FFB Budget Year (e.g., 2027):");
                    if (!newYearStr || newYearStr.trim() === "") return;
                    const newYear = newYearStr.trim();

                    if (state.ffbBudget && state.ffbBudget[newYear]) {
                        alert(`FFB Budget Year ${newYear} already exists!`);
                        return;
                    }

                    if (!state.ffbBudget) state.ffbBudget = {};

                    // Duplicate last year's data or create empty if none exists
                    const existingYears = Object.keys(state.ffbBudget).sort((a, b) => parseInt(a) - parseInt(b));
                    if (existingYears.length > 0) {
                        const lastYear = existingYears[existingYears.length - 1];
                        state.ffbBudget[newYear] = JSON.parse(JSON.stringify(state.ffbBudget[lastYear]));
                        // Reset amounts to zero for the new year clone? Or keep as requested: "duplicate previous year's data so i could edit it with ease"
                        // We will keep it exactly identical as requested.
                    } else {
                        state.ffbBudget[newYear] = [];
                    }

                    state.selectedReportYear = newYear;
                    state.activeViewType = 'ffb_budget';
                    state.activeViewValue = newYear;

                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                };
                liAddFfbYear.appendChild(aAddFfbYear);
                container.appendChild(liAddFfbYear);
            };
            // Render Rainfall Navigation
            const renderRainfallNav = () => {
                const container = document.getElementById('sidebar-rainfall-list');
                if (!container) return;
                container.innerHTML = '';

                const rfYears = state.rainfall ?
                    Object.keys(state.rainfall)
                        .filter(key => /^\d{4}$/.test(key))
                        .sort((a, b) => parseInt(a) - parseInt(b)) : [];

                rfYears.forEach(year => {
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    if (state.activeViewType === 'rainfall_record' && state.activeViewValue === year) {
                        li.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.textContent = year;
                    a.dataset.viewHash = `#view=rainfall_record&year=${year}`;
                    a.onclick = (e) => {
                        e.preventDefault();
                        state.selectedReportYear = year;
                        state.activeViewType = 'rainfall_record';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    li.appendChild(a);
                    container.appendChild(li);
                });

                // Add Rainfall Year Button
                const liAddYear = document.createElement('li');
                liAddYear.className = 'nav-item';
                const aAddYear = document.createElement('a');
                aAddYear.href = '#';
                aAddYear.className = 'nav-link add-year-link';
                aAddYear.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
                aAddYear.onclick = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    const newYearStr = prompt("Enter the new Rainfall Year (e.g., 2026):");
                    if (!newYearStr || newYearStr.trim() === "") return;
                    const newYear = newYearStr.trim();

                    if (state.rainfall && state.rainfall[newYear]) {
                        alert(`Rainfall Record for ${newYear} already exists!`);
                        return;
                    }

                    if (!state.rainfall) state.rainfall = {};

                    // Use the helper from rainfallData.js to construct an empty object
                    if (typeof createEmptyRainfallYear === 'function') {
                        state.rainfall[newYear] = createEmptyRainfallYear();
                    }

                    state.selectedReportYear = newYear;
                    state.activeViewType = 'rainfall_record';
                    state.activeViewValue = newYear;

                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                    saveState(true);
                };
                liAddYear.appendChild(aAddYear);
                container.appendChild(liAddYear);
            };

            renderFfbBudgetNav();
            renderRainfallNav();
            renderMonthNav('sidebar-interval-list', 'interval_month');
            renderMonthNav('sidebar-perf-list', 'perf_month');
            renderMonthNav('sidebar-ytd-list', 'ytd');
            renderMonthNav('sidebar-current-prev-list', 'current_prev');
        };

        const renderTable = () => {
            tableBody.innerHTML = '';
            perfWrapper.innerHTML = ''; // Clear dynamically appended performance widgets
            intervalWrapper.innerHTML = ''; // Clear dynamically appended interval widgets
            const ffbWrapper = document.getElementById('ffb-budget-wrapper');
            const rainfallWrapper = document.getElementById('rainfall-wrapper');
            const ytdWrapper = document.getElementById('ytd-wrapper');
            const currentPrevWrapper = document.getElementById('current-prev-wrapper');

            const userMgmtWrapper = document.getElementById('user-mgmt-wrapper');
            const excelReportsWrapper = document.getElementById('excel-reports-wrapper');
            const sprayingWrapper = document.getElementById('spraying-wrapper');
            const maintenanceComingSoonWrapper = document.getElementById('maintenance-coming-soon-wrapper');
            if (ffbWrapper) ffbWrapper.innerHTML = ''; // Clear FFB budget widgets
            if (rainfallWrapper) rainfallWrapper.innerHTML = ''; // Clear Rainfall widgets
            if (ytdWrapper) ytdWrapper.innerHTML = '';
            if (currentPrevWrapper) currentPrevWrapper.innerHTML = '';
            if (sprayingWrapper) sprayingWrapper.innerHTML = '';
            if (maintenanceComingSoonWrapper) maintenanceComingSoonWrapper.innerHTML = '';
            if (userMgmtWrapper) { userMgmtWrapper.innerHTML = ''; userMgmtWrapper.classList.add('hidden'); }
            if (excelReportsWrapper) { excelReportsWrapper.innerHTML = ''; excelReportsWrapper.classList.add('hidden'); }

            // Hide special wrappers by default
            if (ffbWrapper) ffbWrapper.classList.add('hidden');
            if (rainfallWrapper) rainfallWrapper.classList.add('hidden');
            if (ytdWrapper) ytdWrapper.classList.add('hidden');
            if (currentPrevWrapper) currentPrevWrapper.classList.add('hidden');
            const sprayingWrapperEl = document.getElementById('spraying-wrapper');
            const maintenanceCSWrapperEl = document.getElementById('maintenance-coming-soon-wrapper');
            if (sprayingWrapperEl) sprayingWrapperEl.classList.add('hidden');
            if (maintenanceCSWrapperEl) maintenanceCSWrapperEl.classList.add('hidden');

            // User Management view
            if (state.activeViewType === 'user_mgmt') {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                renderUserManagementPanel();
                return;
            }

            // Excel Reports view
            if (state.activeViewType === 'excel_reports') {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                if (excelReportsWrapper) {
                    excelReportsWrapper.classList.remove('hidden');
                    if (typeof window.renderReportsPanel === 'function') window.renderReportsPanel();
                }
                return;
            }

            const isPerfView = state.activeViewType === 'perf_month';
            const isIntervalView = state.activeViewType === 'interval_month';
            const isHarvestingYtdView = state.activeViewType === 'harvesting_ytd';
            const isHarvestersComparisonView = state.activeViewType === 'harvesters_comparison';

            if (!state.selectedReportYear && !isHarvestingYtdView && !isHarvestersComparisonView) {
                if (tableTitle) tableTitle.textContent = "No Report Year Selected";
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                return;
            }

            const isFfbBudgetView = state.activeViewType === 'ffb_budget';
            const isRainfallView = state.activeViewType === 'rainfall_record';
            const isYtdView = state.activeViewType === 'ytd';
            const isCurrentPrevView = state.activeViewType === 'current_prev';

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
            } else if (isFfbBudgetView) {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                if (ffbWrapper) {
                    ffbWrapper.classList.remove('hidden');
                    renderFfbBudgetTable();
                }
                tableContainer.classList.add('hidden');
            } else if (isRainfallView) {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                if (rainfallWrapper) {
                    rainfallWrapper.classList.remove('hidden');
                    if (typeof renderRainfallTable === 'function') {
                        renderRainfallTable();
                    }
                }
            } else if (isYtdView) {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                if (ytdWrapper) {
                    ytdWrapper.classList.remove('hidden');
                    if (typeof renderYtdReport === 'function') {
                        renderYtdReport();
                    }
                }
            } else if (isCurrentPrevView) {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                if (currentPrevWrapper) {
                    currentPrevWrapper.classList.remove('hidden');
                    if (typeof renderCurrentPrevReport === 'function') {
                        renderCurrentPrevReport();
                    }
                }
            } else if (state.activeViewType === 'spraying') {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                const sw = document.getElementById('spraying-wrapper');
                if (sw) {
                    sw.classList.remove('hidden');
                    if (typeof renderSprayingReport === 'function') renderSprayingReport();
                }
            } else if (state.activeViewType === 'maintenance_coming_soon') {
                mainReportWrapper.classList.add('hidden');
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                const csw = document.getElementById('maintenance-coming-soon-wrapper');
                if (csw) {
                    csw.classList.remove('hidden');
                    const label = state.activeViewValue || 'Feature';
                    csw.innerHTML = `
                    <div style="padding:3rem 2rem; text-align:center;">
                        <div style="font-size:4rem; margin-bottom:1rem;">🚧</div>
                        <h2 style="margin-top:0; color:var(--text-primary);">${label}</h2>
                        <p style="color:var(--text-secondary); font-size:1rem;">This feature is under development.<br>Please check back later.</p>
                    </div>
                `;
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
                            if (state.activeViewType === 'gang') {
                                const confirmUnassign = confirm(`Are you sure you want to unassign block ${block.block_id} from gang ${state.activeViewValue}? It will remain in the Planting Phase Record.`);
                                if (!confirmUnassign) return;
                                block.gang = "Unassigned";
                            } else {
                                const confirmDelete = confirm(`WARNING: Are you sure you want to PERMANENTLY delete block ${block.block_id} from the Planting Phase Record for ${state.selectedReportYear}?`);
                                if (!confirmDelete) return;
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
                            <div class="stat-row" style="display: flex; align-items: center; gap: 0.5rem;">
                                <label>TOTAL MANPOWER:</label>
                                <input type="number" id="perf-manpower-${safeGangId}" class="edit-input" style="width: 80px; padding: 0.25rem; border: 1px solid var(--border-color);" value="${perfData.manpower || 0}" min="0">
                                <button class="btn-icon" id="btn-sync-manpower-${safeGangId}" title="Refresh from Interval data for ${month} ${year}" style="padding: 2px 6px; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                                    🔄 Sync
                                </button>
                                <span id="perf-manpower-badge-${safeGangId}" style="font-size: 0.75rem; color: #f59e0b; font-weight: 600; display: ${perfData.isManpowerManual ? 'inline' : 'none'};" title="Manually set — will not be overridden by Sync or re-import">✏ Manual</span>
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
                                <th>1st Round (MT)</th>
                                <th>2nd Round (MT)</th>
                                <th>3rd Round (MT)</th>
                                <th class="col-total">Total (MT)</th>
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
                const manpowerBadge = document.getElementById(`perf-manpower-badge-${safeGangId}`);

                let manpowerSaveTimer = null;
                inputManpower.oninput = (e) => {
                    perfData.manpower = parseFloat(e.target.value) || 0;
                    perfData.isManpowerManual = true;
                    if (manpowerBadge) manpowerBadge.style.display = 'inline';
                    calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                    clearTimeout(manpowerSaveTimer);
                    manpowerSaveTimer = setTimeout(() => saveState(true), 800);
                };
                inputManpower.onchange = () => {
                    clearTimeout(manpowerSaveTimer);
                    saveState(true);
                };

                let leaveSaveTimer = null;
                inputLeave.oninput = (e) => {
                    perfData.leave = parseFloat(e.target.value) || 0;
                    calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                    clearTimeout(leaveSaveTimer);
                    leaveSaveTimer = setTimeout(() => saveState(true), 800);
                };
                inputLeave.onchange = () => {
                    clearTimeout(leaveSaveTimer);
                    saveState(true);
                };

                const btnSync = document.getElementById(`btn-sync-manpower-${safeGangId}`);
                if (btnSync) {
                    btnSync.onclick = () => {
                        const peak = getPeakManpowerForGang(year, month, gangName);
                        perfData.manpower = peak;
                        perfData.isManpowerManual = false;
                        inputManpower.value = peak;
                        if (manpowerBadge) manpowerBadge.style.display = 'none';
                        calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                        saveState(true);
                    };
                }

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

                    // Dynamically sync FFB Budget for current month
                    const monthIndex = months.indexOf(month);
                    if (state.ffbBudget && state.ffbBudget[year]) {
                        // Try to find matching block budget. FFB rows might have 'block_id' or 'block'
                        const ffbRow = state.ffbBudget[year].find(r => String(r.block_id).trim() === String(bId).trim());
                        if (ffbRow && ffbRow.months && ffbRow.months.length > monthIndex) {
                            bData.budget = ffbRow.months[monthIndex] || 0;
                        }
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td class="text-center cell-block">${bId}</td><td class="text-right">${formatHA(block.ha)}</td>`;

                    // createPerfInput handles input logic. If linked, any manual edits here are volatile until next render, serving purely as a temporary view if they don't want to use FFB structure.
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

                    if (rowTotalEl) {
                        rowTotalEl.textContent = formatHA(rowTotal);
                        if (parseFloat(bData.budget) > 0 && rowTotal < parseFloat(bData.budget)) {
                            rowTotalEl.classList.add('text-danger-important');
                        } else {
                            rowTotalEl.classList.remove('text-danger-important');
                        }
                    }
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
            if (pTotalAll) {
                pTotalAll.textContent = formatHA(tTotal);
                if (tBudget > 0 && tTotal < tBudget) {
                    pTotalAll.classList.add('text-danger-important');
                } else {
                    pTotalAll.classList.remove('text-danger-important');
                }
            }
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
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">FFB BUDGET</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">1ST RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">2ND RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">3RD RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">4TH RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--primary-color); font-weight: 700;">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td id="interval-sum-budget" style="padding: 0.25rem 0.5rem; font-weight: 700; color: var(--text-primary);">0.00</td>
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
                            <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">FFB BUDGET</th>
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

            let sBudget = 0, sR1 = 0, sR2 = 0, sR3 = 0, sR4 = 0;

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

                // Dynamically sync FFB Budget for current month
                const monthIndex = months.indexOf(month);
                if (state.ffbBudget && state.ffbBudget[year]) {
                    const ffbRow = state.ffbBudget[year].find(r => String(r.block_id).trim() === String(bId).trim());
                    if (ffbRow && ffbRow.months && ffbRow.months.length > monthIndex) {
                        bData.budget = ffbRow.months[monthIndex] || 0;
                    }
                }

                sBudget += bData.budget || 0;
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
                tr.appendChild(createPerfInput('budget', (v) => bData.budget = v, "border-left: 2px solid var(--border-color);"));
                tr.appendChild(createPerfInput('r1', (v) => { bData.r1 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r2', (v) => { bData.r2 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r3', (v) => { bData.r3 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r4', (v) => { bData.r4 = v; renderIntervalTable(); }));

                tbody.appendChild(tr);
            });

            // Set the summary totals
            const sumBudgetEl = document.getElementById('interval-sum-budget');
            const sumR1El = document.getElementById('interval-sum-r1');
            const sumR2El = document.getElementById('interval-sum-r2');
            const sumR3El = document.getElementById('interval-sum-r3');
            const sumR4El = document.getElementById('interval-sum-r4');
            const sumTotalEl = document.getElementById('interval-sum-total');

            if (sumBudgetEl) sumBudgetEl.textContent = formatHA(sBudget);
            if (sumR1El) sumR1El.textContent = formatHA(sR1);
            if (sumR2El) sumR2El.textContent = formatHA(sR2);
            if (sumR3El) sumR3El.textContent = formatHA(sR3);
            if (sumR4El) sumR4El.textContent = formatHA(sR4);
            if (sumTotalEl) sumTotalEl.textContent = formatHA(sR1 + sR2 + sR3 + sR4);
        };

        const renderFfbBudgetTable = () => {
            const ffbBudgetWrapper = document.getElementById('ffb-budget-wrapper');
            if (!ffbBudgetWrapper) return;

            // Capture current scroll positions and active element
            const tableContainer = ffbBudgetWrapper.querySelector('.table-container');
            const scrollLeft = tableContainer ? tableContainer.scrollLeft : 0;
            const scrollTop = tableContainer ? tableContainer.scrollTop : 0;

            const activeEl = document.activeElement;
            const activeData = (activeEl && activeEl.dataset && activeEl.dataset.blockId) ? {
                blockId: activeEl.dataset.blockId,
                phase: activeEl.dataset.phase,
                field: activeEl.dataset.field,
                monthIdx: activeEl.dataset.monthIdx
            } : null;

            // Capture current group collapse state BEFORE clearing the DOM
            const isAlreadyRendered = !!document.getElementById('ffb-expand-all-btn');
            const collapsedGroups = new Set();
            document.body.classList.forEach(cls => {
                if (cls.startsWith('ffb-budget-toggle-group-')) {
                    collapsedGroups.add(cls);
                }
            });

            ffbBudgetWrapper.innerHTML = '';

            const year = state.activeViewValue;
            if (!state.ffbBudget || !state.ffbBudget[year] || state.ffbBudget[year].length === 0) {
                ffbBudgetWrapper.innerHTML = '<p style="padding: 2rem;">No FFB Budget data found for this year. Please import data first.</p>';
                return;
            }

            const data = state.ffbBudget[year];

            // Group the data by phase
            const groupedData = {};
            data.forEach(row => {
                const p = row.phase || "Unassigned";
                if (!groupedData[p]) groupedData[p] = { rows: [], tHa: 0, tMonths: new Array(12).fill(0) };
                groupedData[p].rows.push(row);
                groupedData[p].tHa += row.ha || 0;
                row.months.forEach((m, i) => {
                    groupedData[p].tMonths[i] += (m || 0);
                });
            });

            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '3rem';
            wrapper.style.padding = '0';

            let grandTotalHa = 0;
            let grandTotalMonths = new Array(12).fill(0);
            let tbodyHtml = '';

            Object.keys(groupedData).sort().forEach((phaseName, index) => {
                const group = groupedData[phaseName];
                grandTotalHa += group.tHa;

                let groupRowTotal = 0;
                let subTMonthsHtml = '';
                group.tMonths.forEach((m, i) => {
                    grandTotalMonths[i] += m;
                    groupRowTotal += m;
                    subTMonthsHtml += `<td class="text-right" style="padding: 0.4rem; font-weight: 600;">${Math.round(m)}</td>`;
                });

                // Add the Group Header Row (now combined with Subtotal)
                const toggleId = `ffb-budget-toggle-group-${index}`;
                tbodyHtml += `
                <tr class="row-group-header" onclick="document.body.classList.toggle('${toggleId}')" style="cursor: pointer; background: var(--bg-overlay, var(--group-bg));">
                    <td colspan="5" style="position: sticky; left: 0; width: 340px; min-width: 340px; max-width: 340px; background-color: var(--bg-secondary); z-index: 6; border-right: 1px solid var(--border-color); padding: 0 1rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span class="group-toggle" id="${toggleId}-icon">▼</span>
                                <span class="text-muted" style="font-weight: normal; font-size: 0.9em; white-space: nowrap;">(${group.rows.length} blocks)</span>
                            </div>
                            <div class="font-bold text-right" style="white-space: nowrap;">SUBTOTAL ${phaseName}</div>
                        </div>
                    </td>
                    <td class="text-right font-bold" style="position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--bg-secondary); z-index: 6; border-right: 2px solid var(--border-color);">${group.tHa.toFixed(2)}</td>
                    ${subTMonthsHtml}
                    <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(groupRowTotal)}</td>
                </tr>
            `;

                // Add individual block rows
                group.rows.forEach(row => {
                    let rowTotal = 0;
                    let monthsHtml = '';
                    row.months.forEach((m, mIdx) => {
                        rowTotal += (m || 0);
                        monthsHtml += `
                        <td style="padding: 0;">
                            <input type="number" step="1" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: transparent; padding: 0.4rem;" 
                                data-field="month" data-month-idx="${mIdx}" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${Math.round(m || 0)}"
                            />
                        </td>
                    `;
                    });

                    tbodyHtml += `
                    <tr class="row-block ffb-budget-row-block ffb-budget-group-${index} ${toggleId}-hideable">
                        <td style="padding: 0; position: sticky; left: 0; width: 60px; min-width: 60px; max-width: 60px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color); text-align: center; font-weight: 500;">
                            ${row.block_id}
                        </td>
                        <td style="padding: 0; position: sticky; left: 60px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="text" class="edit-input ffb-input text-center" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="ageMth" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${row.ageMth || ''}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 130px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-center" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="harvestYr" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(parseFloat(row.harvestYr) || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 200px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="mtHaYr" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.mtHaYr || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 270px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="mtHaMth" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.mtHaMth || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--bg-primary); z-index: 5; border-right: 2px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right font-bold" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem;" 
                                data-field="ha" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.ha || 0).toFixed(2)}"
                            />
                        </td>
                        ${monthsHtml}
                        <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(rowTotal)}</td>
                        <td style="padding: 0.2rem 0.4rem; text-align: center; white-space: nowrap;">
                            <button class="ffb-delete-btn" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                style="background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; color: var(--danger); padding: 0.2rem 0.5rem; font-size: 1rem; line-height: 1; transition: background 0.2s;"
                                title="Delete this block">🗑️</button>
                        </td>
                    </tr>
                `;
                });

                // Insert dynamic CSS for toggling
                if (!document.getElementById(`style-${toggleId}`)) {
                    const style = document.createElement('style');
                    style.id = `style-${toggleId}`;
                    style.innerHTML = `
                    body.${toggleId} .${toggleId}-hideable { display: none !important; }
                    body.${toggleId} #${toggleId}-icon { transform: rotate(-90deg); }
                `;
                    document.head.appendChild(style);
                }
                // Restore previous collapse state; collapse by default only on first render
                if (isAlreadyRendered) {
                    if (collapsedGroups.has(toggleId)) {
                        document.body.classList.add(toggleId);
                    } else {
                        document.body.classList.remove(toggleId);
                    }
                } else {
                    // First render for this view: default to collapsed
                    document.body.classList.add(toggleId);
                }
            });

            let grandTotalRowSum = grandTotalMonths.reduce((a, b) => a + b, 0);
            let tFootMonthsHtml = grandTotalMonths.map(m => `<td class="text-right font-bold col-total" style="font-size: 0.9em;">${Math.round(m)}</td>`).join('');

            wrapper.innerHTML = `
            <div class="performance-header">
                <h2>PROPOSED FFB ESTIMATE PRODUCTION FOR YEAR ${year}</h2>
            </div>
            <div class="summary-table-container" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                 <div class="toolbar-left" style="display: flex; gap: 0.5rem; align-items: center;">
                     <button class="btn-secondary" id="ffb-expand-all-btn" style="padding: 0.5rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                        <span>+</span> Expand All
                     </button>
                     <button class="btn-secondary" id="ffb-collapse-all-btn" style="padding: 0.5rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                        <span>-</span> Collapse All
                     </button>
                 </div>
                 <div class="toolbar-right" style="display: flex; gap: 0.5rem; align-items: center;">
                     <button class="btn-danger" id="clear-budget-btn"><span>🗑️</span> Clear Budget for ${year}</button>
                     <button class="btn-primary" id="add-ffb-block-btn"><span>➕</span> Add Block</button>
                     <button class="btn-primary" id="save-ffb-btn" style="background-color: #10b981; border-color: #10b981;" title="Save all changes"><span>💾</span> Save</button>
                 </div>
            </div>
            <div class="table-container" style="overflow-x: auto; padding-bottom: 2rem;">
                <table class="grouped-table" style="min-width: 1600px;">
                    <thead>
                        <tr>
                            <th style="width: 60px; min-width: 60px; max-width: 60px; position: sticky; left: 0; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">BLK</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 60px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Age<br/>(mth)</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 130px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Harvest<br/>Yr.</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 200px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Mt/ha/yr</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 270px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Mt/ha/mth</th>
                            <th style="width: 100px; min-width: 100px; max-width: 100px; position: sticky; left: 340px; background-color: var(--bg-secondary); z-index: 7; border-right: 2px solid var(--border-color);">HA</th>
                            ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((m) => `<th style="min-width: 60px; text-align: right; padding: 0.4rem; font-size: 0.85em;">${m}</th>`).join('')}
                            <th style="min-width: 80px; text-align: right; border-left: 2px solid var(--border-color);" class="col-total">TOTAL</th>
                            <th style="min-width: 40px; text-align: center;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHtml}
                    </tbody>
                    <tfoot>
                        <tr class="row-grand-total">
                            <td colspan="5" class="grand-total-label" style="position: sticky; left: 0; width: 340px; min-width: 340px; max-width: 340px; background-color: var(--grand-total-bg); z-index: 6; border-right: 1px solid var(--border-color); text-align: right; padding-right: 1rem;">GRAND TOTAL</td>
                            <td class="text-right font-bold" style="position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--grand-total-bg); z-index: 6; border-right: 2px solid var(--border-color);">${grandTotalHa.toFixed(2)}</td>
                            ${tFootMonthsHtml}
                            <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(grandTotalRowSum)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

            ffbBudgetWrapper.appendChild(wrapper);

            // Global Expand/Collapse Handlers
            const expandAllBtn = document.getElementById('ffb-expand-all-btn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', () => {
                    Object.keys(groupedData).forEach((_, idx) => {
                        document.body.classList.remove(`ffb-budget-toggle-group-${idx}`);
                    });
                });
            }

            const collapseAllBtn = document.getElementById('ffb-collapse-all-btn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => {
                    Object.keys(groupedData).forEach((_, idx) => {
                        document.body.classList.add(`ffb-budget-toggle-group-${idx}`);
                    });
                });
            }

            // Restore scroll positions
            const newTableContainer = ffbBudgetWrapper.querySelector('.table-container');
            if (newTableContainer) {
                newTableContainer.scrollLeft = scrollLeft;
                newTableContainer.scrollTop = scrollTop;
            }

            // Restore focus
            if (activeData) {
                let selector = `.ffb-input[data-block-id="${activeData.blockId}"][data-phase="${activeData.phase}"][data-field="${activeData.field}"]`;
                if (activeData.monthIdx !== undefined) {
                    selector += `[data-month-idx="${activeData.monthIdx}"]`;
                }
                const elToFocus = ffbBudgetWrapper.querySelector(selector);
                if (elToFocus) {
                    elToFocus.focus();
                    // For number inputs, selecting the text usually works better on mobile/desktop
                    if (elToFocus.tagName === 'INPUT') elToFocus.select();
                }
            }

            // Helper to show modal
            const showModal = (title, bodyHtml, onConfirm) => {
                const overlay = document.getElementById('ffb-modal-overlay');
                const titleEl = document.getElementById('ffb-modal-title');
                const bodyEl = document.getElementById('ffb-modal-body');
                const confirmBtn = document.getElementById('ffb-modal-confirm');
                const cancelBtn = document.getElementById('ffb-modal-cancel');

                if (!overlay || !titleEl || !bodyEl || !confirmBtn || !cancelBtn) return;

                titleEl.textContent = title;
                bodyEl.innerHTML = bodyHtml;
                overlay.style.display = 'flex';

                // Clean up old listeners
                const newConfirmBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                const newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

                newCancelBtn.onclick = () => { overlay.style.display = 'none'; };
                newConfirmBtn.onclick = () => {
                    if (onConfirm()) {
                        overlay.style.display = 'none';
                    }
                };
            };

            const clearBtn = document.getElementById('clear-budget-btn');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    showModal(
                        `Clear Budget for ${year}`,
                        `<p>Are you sure you want to delete all FFB budget data for Year ${year}? This action cannot be undone.</p>`,
                        () => {
                            state.ffbBudget[year] = [];
                            renderFfbBudgetTable();
                            return true;
                        }
                    );
                };
            }

            const addFfbBlockBtn = document.getElementById('add-ffb-block-btn');
            if (addFfbBlockBtn) {
                addFfbBlockBtn.onclick = () => {
                    const bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Phase (e.g., OP2010)</label>
                            <input type="text" id="modal-phase-input" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" value="OP" />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Block ID</label>
                            <input type="text" id="modal-block-input" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="e.g. BLK-1" />
                        </div>
                    </div>
                `;

                    showModal('Add New Block', bodyHtml, () => {
                        const phaseInput = document.getElementById('modal-phase-input');
                        const blockInput = document.getElementById('modal-block-input');
                        const phase = phaseInput ? phaseInput.value.trim() : "";
                        const blockId = blockInput ? blockInput.value.trim() : "";

                        if (!phase || !blockId) {
                            alert("Phase and Block ID are required.");
                            return false; // don't close modal
                        }

                        state.ffbBudget[year].push({
                            phase: phase,
                            block_id: blockId,
                            ha: 0,
                            ageMth: "",
                            harvestYr: "",
                            ageYrMth: "",
                            harvestYrMth: "",
                            mtHaYr: 0,
                            mtHaMth: 0,
                            months: new Array(12).fill(0)
                        });
                        renderFfbBudgetTable();
                        return true;
                    });
                };
            }

            const saveFfbBtn = document.getElementById('save-ffb-btn');
            if (saveFfbBtn) {
                saveFfbBtn.onclick = saveState;
            }
            // Attach event listeners
            const inputs = wrapper.querySelectorAll('.ffb-input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    const target = e.target;
                    const field = target.dataset.field;
                    const blockId = target.dataset.blockId;
                    const phase = target.dataset.phase;

                    const rowData = state.ffbBudget[year].find(r => r.block_id === blockId && r.phase === phase);
                    if (!rowData) return;

                    if (field === 'month') {
                        const idx = parseInt(target.dataset.monthIdx);
                        rowData.months[idx] = parseFloat(target.value) || 0;
                    } else if (['mtHaYr', 'mtHaMth', 'ha'].includes(field)) {
                        rowData[field] = parseFloat(target.value) || 0;
                    } else {
                        rowData[field] = target.value; // string fields
                    }

                    // Re-render immediately to update subtotals
                    renderFfbBudgetTable();
                });

                if (input.type === 'number') {
                    input.addEventListener('blur', (e) => {
                        const field = e.target.dataset.field;
                        const val = parseFloat(e.target.value) || 0;
                        if (['harvestYr', 'mtHaYr', 'mtHaMth', 'ha'].includes(field)) {
                            e.target.value = val.toFixed(2);
                        } else {
                            e.target.value = Math.round(val).toString();
                        }
                    });
                }
            });

            // Attach delete button handlers
            const deleteBtns = wrapper.querySelectorAll('.ffb-delete-btn');
            deleteBtns.forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(239,68,68,0.1)'; btn.style.borderColor = 'var(--danger)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.borderColor = 'transparent'; });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const blockId = btn.dataset.blockId;
                    const phase = btn.dataset.phase;
                    if (!confirm(`Delete block "${blockId}" (${phase}) from Year ${year}? This only affects ${year} and cannot be undone.`)) return;
                    // Remove only from the current year — other years are untouched
                    state.ffbBudget[year] = state.ffbBudget[year].filter(
                        r => !(r.block_id === blockId && r.phase === phase)
                    );
                    renderFfbBudgetTable();
                });
            });
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
            tableContainer.style.background = 'white';
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
                meta.style.color = '#475569';
                meta.style.margin = '0';
                meta.textContent = `Generated ${state.harvestingReportsMeta.generatedAt || ''} · Source: ${state.harvestingReportsMeta.sourceWorkbook || ''}`;
                wrapper.appendChild(meta);
            }
        };

        const renderHarvestingYtdReport = () => {
            const wrapper = document.getElementById('ytd-wrapper');
            renderHarvestingReportTable(wrapper, state.harvestingReports?.harvestingYtdByGang, 'Harvesting YTD by Gang');
        };

        const renderHarvesterComparisonReport = () => {
            const wrapper = document.getElementById('current-prev-wrapper');
            renderHarvestingReportTable(wrapper, state.harvestingReports?.harvestersMonthComparison, "Harvesters' Current vs Previous Month");
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
                const downloadAsExcel = async (filename, templateKey) => {
                    try {
                        const bStr = window.AppTemplates[templateKey];
                        if (!bStr) throw new Error(`Template base64 data not found in templates.js for key ${templateKey}`);

                        // Convert base64 to raw binary data held in a string
                        const byteCharacters = atob(bStr);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);

                        // Create a Blob with the Excel MIME type and trigger download using Object URL
                        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const blobUrl = URL.createObjectURL(blob);

                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => {
                            document.body.removeChild(a);
                            URL.revokeObjectURL(blobUrl);
                        }, 100);
                    } catch (error) {
                        console.error("Download error:", error);
                        alert("Failed to download " + filename + ". " + error.message);
                    }
                };

                const tBtnInterval = document.getElementById('sidebar-download-template');
                const tBtnFfb = document.getElementById('sidebar-download-ffb-template');

                if (tBtnInterval) {
                    tBtnInterval.addEventListener('click', (e) => {
                        e.preventDefault();
                        downloadAsExcel('Harvesting_Template.xlsx', 'harvestingInterval');
                    });
                }

                if (tBtnFfb) {
                    tBtnFfb.addEventListener('click', (e) => {
                        e.preventDefault();
                        downloadAsExcel('FFB_Budget_Template.xlsx', 'ffbBudget');
                    });
                }
                const addBlockBtn = document.getElementById('add-block-btn');
                if (addBlockBtn) {
                    addBlockBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleGlobalAddBlock();
                    });
                }

                const globalAddYearGangBtn = document.getElementById('global-add-year-gang-btn');
                if (globalAddYearGangBtn) {
                    console.log("Binding Add Year (Duplicate) listener (addEventListener)");
                    globalAddYearGangBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        console.log("Add Year (Duplicate) clicked");
                        handleDuplicateGangYear(e);
                    });
                } else {
                    console.warn("Add Year (Duplicate) button NOT found in DOM");
                }

                const deleteYearBtn = document.getElementById('delete-year-btn');
                if (deleteYearBtn) {
                    deleteYearBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleDeleteYear();
                    });
                }

                const importExcelBtn = document.getElementById('sidebar-import-excel');
                const importExcelInput = document.getElementById('sidebar-import-input');

                if (importExcelBtn && importExcelInput) {
                    importExcelBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importExcelInput.click();
                    });
                    importExcelInput.onchange = handleImportExcel;
                }

                const importFfbBtn = document.getElementById('sidebar-import-ffb');
                const importFfbInput = document.getElementById('sidebar-import-ffb-input');

                if (importFfbBtn && importFfbInput) {
                    importFfbBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importFfbInput.click();
                    });
                    importFfbInput.onchange = handleImportFfbBudget;
                }

                // (Google Drive helpers and backup utilities are defined at runMainApplication scope above)

                // Backup & Restore
                const exportBackupBtn = document.getElementById('sidebar-export-backup');
                const importBackupBtn = document.getElementById('sidebar-import-backup');
                const importBackupInput = document.getElementById('sidebar-import-backup-input');

                if (exportBackupBtn) {
                    exportBackupBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        triggerBackup(false);
                    });
                }

                if (importBackupBtn && importBackupInput) {
                    importBackupBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importBackupInput.click();
                    });
                    importBackupInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        if (!confirm('Restoring a backup will overwrite ALL current data. This cannot be undone.\n\nAre you sure you want to continue?')) {
                            e.target.value = '';
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                            try {
                                const restored = JSON.parse(ev.target.result);
                                window.state = restored;
                                await saveState(false);
                                alert('Backup restored successfully! The page will now reload.');
                                location.reload();
                            } catch (err) {
                                alert('Failed to restore backup: ' + err.message);
                            }
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                    });
                }

                // Backup Settings nav handler
                const sidebarBackupSettings = document.getElementById('sidebar-backup-settings');
                if (sidebarBackupSettings) {
                    sidebarBackupSettings.addEventListener('click', (e) => {
                        e.preventDefault();
                        renderBackupSettingsPanel();
                    });
                }

                // User Management nav handler
                const sidebarUserMgmt = document.getElementById('sidebar-user-mgmt');
                if (sidebarUserMgmt) {
                    sidebarUserMgmt.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'user_mgmt';
                        renderSidebar();
                        renderTable();
                    };
                }

                // Excel Reports nav handler
                const sidebarExcelReports = document.getElementById('sidebar-excel-reports');
                if (sidebarExcelReports) {
                    sidebarExcelReports.onclick = () => {
                        state.activeViewType = 'excel_reports';
                        renderSidebar();
                        renderTable();
                    };
                }

                // ── Maintenance nav handlers ────────────────────────────
                const sidebarSpraying = document.getElementById('sidebar-spraying');
                if (sidebarSpraying) {
                    sidebarSpraying.onclick = (e) => {
                        e.preventDefault();
                        if (!state.spraying) state.spraying = {};
                        const availYears = Object.keys(state.spraying).filter(k => /^\d{4}$/.test(k));
                        if (availYears.length === 0) {
                            // Initialize with current year if none exists
                            const y = String(new Date().getFullYear());
                            state.spraying[y] = typeof getDefaultSprayingData === 'function' ? getDefaultSprayingData() : { phases: [] };
                            state.sprayingYear = y;
                        }
                        state.activeViewType = 'spraying';
                        state.activeViewValue = 'spraying';
                        renderSidebar();
                        renderTable();
                    };
                }

                const sidebarSlashing = document.getElementById('sidebar-slashing');
                if (sidebarSlashing) {
                    sidebarSlashing.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'maintenance_coming_soon';
                        state.activeViewValue = '🔪 Slashing — Coming Soon';
                        renderSidebar();
                        renderTable();
                    };
                }

                const sidebarPruning = document.getElementById('sidebar-pruning');
                if (sidebarPruning) {
                    sidebarPruning.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'maintenance_coming_soon';
                        state.activeViewValue = '✂️ Pruning — Coming Soon';
                        renderSidebar();
                        renderTable();
                    };
                }
                // ── End Maintenance nav handlers ────────────────────────

                // Bind Global Save button for Planting Phase Record
                const saveMainBtn = document.getElementById('save-main-btn');
                if (saveMainBtn) {
                    saveMainBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        saveState();
                    });
                }

                // --- RIGHT-CLICK CONTEXT MENU ---
                const ctxMenu = document.getElementById('nav-context-menu');
                const ctxNewTab = document.getElementById('nav-ctx-newtab');
                let ctxTargetHash = null;

                if (ctxMenu && ctxNewTab) {
                    document.addEventListener('contextmenu', (ev) => {
                        const navLink = ev.target.closest('[data-view-hash]');
                        if (!navLink) {
                            ctxMenu.style.display = 'none';
                            return;
                        }
                        ev.preventDefault();
                        ctxTargetHash = navLink.getAttribute('data-view-hash');
                        // Keep menu within viewport
                        const menuWidth = 160, menuHeight = 40;
                        const left = Math.min(ev.clientX, window.innerWidth - menuWidth - 8);
                        const top = Math.min(ev.clientY, window.innerHeight - menuHeight - 8);
                        ctxMenu.style.left = left + 'px';
                        ctxMenu.style.top = top + 'px';
                        ctxMenu.style.display = 'block';
                    });

                    document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });
                    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') ctxMenu.style.display = 'none'; });

                    ctxNewTab.onmouseenter = () => { ctxNewTab.style.background = 'var(--group-bg)'; };
                    ctxNewTab.onmouseleave = () => { ctxNewTab.style.background = ''; };
                    ctxNewTab.onclick = () => {
                        if (ctxTargetHash) {
                            window.open(window.location.pathname + ctxTargetHash, '_blank');
                        }
                        ctxMenu.style.display = 'none';
                    };
                }

                console.log("Listeners bound. Checking cloud storage...");

                // Helper function to hydrate gangs and render
                const finishInit = () => {
                    if (!state.ffbBudget || Object.keys(state.ffbBudget).length === 0) {
                        state.ffbBudget = {};
                        if (typeof INITIAL_FFB_BUDGET !== 'undefined') {
                            state.ffbBudget["2026"] = JSON.parse(JSON.stringify(INITIAL_FFB_BUDGET));
                        }
                    }
                    if (!state.rainfall) state.rainfall = {};
                    if (!state.rainfall["2025"] && typeof INITIAL_RAINFALL_2025 !== 'undefined') {
                        state.rainfall["2025"] = JSON.parse(JSON.stringify(INITIAL_RAINFALL_2025));
                    }
                    if (!state.rainfall["2026"] && typeof INITIAL_RAINFALL_2026 !== 'undefined') {
                        state.rainfall["2026"] = JSON.parse(JSON.stringify(INITIAL_RAINFALL_2026));
                    }
                    if (!state.reports) state.reports = {};
                    if (!state.gangsByYear) state.gangsByYear = {};

                    Object.keys(state.reports).forEach(year => {
                        if (!state.gangsByYear[year] || state.gangsByYear[year].length === 0) {
                            const yearBlocks = state.reports[year] || [];
                            const uniqueGangs = [...new Set(yearBlocks.map(b => b.gang))].filter(g => g && g !== "Unassigned");
                            if (year === "2025" && typeof predefinedGangs !== 'undefined') {
                                const baseGangs = Object.keys(predefinedGangs);
                                state.gangsByYear[year] = [...new Set([...baseGangs, ...uniqueGangs])].sort();
                            } else {
                                state.gangsByYear[year] = uniqueGangs.sort();
                            }
                        }
                    });

                    renderSidebar();
                    renderTable();
                    recalculateTotals();

                    // Apply URL hash for "Open in New Tab" deep linking
                    const hash = window.location.hash.substring(1);
                    if (hash) {
                        const params = {};
                        hash.split('&').forEach(p => {
                            const [k, v] = p.split('=');
                            if (k && v !== undefined) params[decodeURIComponent(k)] = decodeURIComponent(v);
                        });
                        if (params.view) {
                            if (params.year) state.selectedReportYear = params.year;
                            if (params.month) state.activePerfMonth = params.month;
                            state.activeViewType = params.view;
                            if (params.view === 'gang' && params.gang) state.activeViewValue = params.gang;
                            else if (params.year) state.activeViewValue = params.year;
                            renderSidebar();
                            renderTable();
                        }
                    }

                    loadingEl.classList.add('hidden');
                    tableContainer.classList.remove('hidden');

                    // Load user role and apply permissions
                    loadUserRole(auth.currentUser.uid).then(() => {
                        applyRolePermissions();
                        checkFirstLogin();
                        autoBackupCheck();
                        setupActivityBackupListener();
                    });
                };

                const loadFreshData = async () => {
                    const res = await fetch('grouped_data.json');
                    if (!res.ok) throw new Error("Failed to load block data.");
                    const data = await res.json();

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

                    finishInit();
                    saveState(true); // Push fresh data to cloud
                };

                const loadLocalOrFresh = async () => {
                    const savedStateStr = localStorage.getItem('harvesting_app_state');
                    if (savedStateStr) {
                        try {
                            Object.assign(state, JSON.parse(savedStateStr));
                            finishInit();
                            saveState(true); // Migrate local data to cloud
                        } catch (e) {
                            console.error("Local storage Parse error", e);
                            await loadFreshData();
                        }
                    } else {
                        await loadFreshData();
                    }
                };

                // Main DB Fetch
                try {
                    const snapshot = await db.ref('users/' + auth.currentUser.uid + '/app_state').once('value');
                    const cloudData = snapshot.val();

                    if (cloudData) {
                        console.log("Loading cloud state...");
                        Object.assign(state, JSON.parse(cloudData));
                        finishInit();
                    } else {
                        console.log("No cloud state found. Checking local storage for migration...");
                        await loadLocalOrFresh();
                    }
                } catch (e) {
                    console.error("Firebase read error:", e);
                    // Fallback completely to local if offline or error
                    await loadLocalOrFresh();
                }

                // Load Spraying data (stored separately so it does not overwrite main state)
                try {
                    const spraySnap = await db.ref('users/' + auth.currentUser.uid + '/spraying_data').once('value');
                    const sprayData = spraySnap.val();
                    if (sprayData) {
                        state.spraying = JSON.parse(sprayData);
                        // Reinitialize any year whose blocks all have empty month data (e.g. first-time load before data was entered)
                        if (typeof getDefaultSprayingData === 'function') {
                            Object.keys(state.spraying).filter(k => /^\d{4}$/.test(k)).forEach(yr => {
                                const yd = state.spraying[yr];
                                if (!yd || !yd.phases) return;
                                const hasData = yd.phases.some(p => (p.blocks || []).some(b =>
                                    Object.values(b.months || {}).some(mv =>
                                        mv.roundGly || mv.roundAly || mv.litresGly || mv.gmAly || mv.haGly || mv.haAly
                                    )
                                ));
                                if (!hasData) state.spraying[yr] = getDefaultSprayingData();
                            });
                        }
                        console.log("Spraying data loaded from cloud.");
                    } else {
                        if (!state.spraying) state.spraying = {};
                    }
                } catch (e) {
                    console.warn("Could not load spraying data:", e.message);
                    if (!state.spraying) state.spraying = {};
                }

            } catch (error) {
                console.error(error);
                loadingEl.innerHTML = `< p style = "color:var(--danger)" > Error initializing dashboard: ${error.message}</p > `;
            }
        }; // end init

        init();
    }; // end runMainApplication
});
