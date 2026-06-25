/* ============================================================
   Service worker — offline support (roadmap Phase 4)

   Strategy:
   - same-origin (app shell, render_*.js, Excel templates):
     network-first, falling back to cache — so new ?v= versions
     are always picked up when online, but the app still opens
     in the field with no signal.
   - CDN libraries (Chart.js, XLSX, ExcelJS, JSZip, Leaflet,
     html-to-image, docx, Firebase SDK, fonts): cache-first —
     these URLs are versioned/immutable.
   - never intercepted: Firebase Realtime DB / Auth traffic,
     Google sign-in, map tile servers (tiles would balloon the
     cache; the map simply needs a connection).

   Bump VERSION to invalidate all caches after big changes.
   ============================================================ */
const VERSION = 'v12';
const SHELL_CACHE = 'shell-' + VERSION;
const CDN_CACHE = 'cdn-' + VERSION;

const SHELL_PRECACHE = [
    './',
    './index.html',
    './field.html',
    './field.css',
    './field_boot.js',
    './field.manifest.json',
    './style.css',
    './script.js',
    './app_boot.js',
    './app_user_mgmt.js',
    './ui_enhancements.js',
    './field_mode.js',
    './render_dashboard.js',
    './render_reports.js',
    './render_spraying.js',
    './render_manuring.js',
    './render_maintenance.js',
    './render_weekly.js',
    './render_ironhorse.js',
    './render_ytd_report.js',
    './render_rainfall.js',
        './render_current_vs_prev.js',
    './render_audit.js',
    './templates.js',
    './ffbData.js',
    './rainfallData.js'
];

const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'www.gstatic.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

const BYPASS_HOSTS = [
    'firebaseio.com',          // Realtime DB (websocket/long-poll)
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'accounts.google.com',
    'arcgisonline.com',        // Esri satellite tiles
    'googleapis.com'           // Drive etc. — keep API traffic live
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(SHELL_CACHE)
            // precache what we can; individual misses must not abort install
            .then(c => Promise.allSettled(SHELL_PRECACHE.map(u => c.add(u))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== SHELL_CACHE && k !== CDN_CACHE)
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (_) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (BYPASS_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

    if (url.origin === self.location.origin) {
        // network-first: fresh code when online, cached app when not
        e.respondWith(
            fetch(req)
                .then(res => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE).then(c => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(req).then(hit => {
                        if (hit) return hit;
                        // ?v= changed while offline — serve the previous version
                        return caches.match(req, { ignoreSearch: true }).then(loose => {
                            if (loose) return loose;
                            if (req.mode === 'navigate') {
                                return caches.match('./index.html').then(idx =>
                                    idx || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
                            }
                            // never resolve respondWith() with undefined — that throws
                            // "Failed to convert value to 'Response'" (e.g. missing favicon)
                            return new Response('', { status: 504, statusText: 'Offline (uncached)' });
                        });
                    })
                )
        );
        return;
    }

    if (CDN_HOSTS.includes(url.hostname)) {
        // cache-first: CDN URLs are versioned
        e.respondWith(
            caches.match(req).then(hit => hit || fetch(req).then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CDN_CACHE).then(c => c.put(req, copy));
                }
                return res;
            }))
        );
    }
});
