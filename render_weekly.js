// =====================================================================
// render_weekly.js — Weekly Activity (track-driven field report)
//
// A weekly plantation field report built from a GPS track + geotagged
// photos. The user imports a KMZ/KML/GPX export from their GPS app; the
// module draws the track + photo pins on a satellite map, pulls embedded
// photos / coordinates / captions into "observations", lets the user add
// narrative (Main Activity, Others, per-block notes), and exports a Word
// .docx matching their hand-made report.
//
// Image storage: photos + the rendered map image are downscaled and stored as
// data URLs in the Realtime Database under shared/weekly_images/<year>/<weekId>/
// — a SEPARATE path from the main record, loaded lazily and cached in memory, so
// the main weekly_activity_data blob stays small. (Firebase Storage was avoided
// because it now requires the paid Blaze plan.) The exported .docx — saved to
// Google Drive — is the permanent backup with images embedded.
//
// Data:  window.state.weekly  ->  Firebase shared/weekly_activity_data (text only)
//        images               ->  Firebase shared/weekly_images/<year>/<weekId>/<id>
// Save:  saveWeeklyActivityData(silent)   (window._weeklyDb)
// View:  state.activeViewType === 'weekly_activity'
// =====================================================================

const WK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────
const wkUid = () => 'wk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const wkEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wkCanEdit = () => (typeof window._canEdit === 'function') ? window._canEdit('weekly') : true;

// Day-of-week label from an ISO yyyy-mm-dd string (local, no TZ surprises).
const wkDayFromDate = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return WK_DAYS[new Date(y, m - 1, d).getDay()] || '';
};

// Strip leading "Blk"/"Block" so block dropdowns line up with stored block nos.
const wkCleanBlock = (s) => String(s || '').replace(/^\s*(blk|block)\s*/i, '').trim();

// Whether a week has been explicitly archived to Google Drive. (Images persist
// in the Realtime DB until a week is deleted — there is no auto-expiry, so age
// alone no longer flags a week.)
const wkIsArchivedAge = (week) => !!(week && week.archive && week.archive.archivedToDrive);

// ─────────────────────────────────────────────────────────────────────
// State helpers
// ─────────────────────────────────────────────────────────────────────
const wkEnsure = () => {
    if (!window.state.weekly) window.state.weekly = {};
    return window.state.weekly;
};

const wkEnsureYear = (yearStr) => {
    const w = wkEnsure();
    if (!w[yearStr]) w[yearStr] = { weeks: [] };
    if (!Array.isArray(w[yearStr].weeks)) w[yearStr].weeks = [];
    return w[yearStr];
};

const wkYears = () => Object.keys(wkEnsure()).filter(k => /^\d{4}$/.test(k)).sort();

const wkCurrentYear = () => window.state.weeklyYear || wkYears()[0] || String(new Date().getFullYear());

const wkWeeksFor = (yearStr) => wkEnsureYear(yearStr).weeks
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

const wkFindWeek = (yearStr, id) => wkEnsureYear(yearStr).weeks.find(w => w.id === id);

const wkNewWeek = () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return {
        id: wkUid(),
        date: iso,
        day: wkDayFromDate(iso),
        mainActivity: [],
        others: [],
        track: null,                 // { coords: [[lng,lat],...], source }
        mapImage: null,              // { path, type, mode:'auto'|'uploaded' } — path under shared/weekly_images
        observations: [],            // [{ id, block, caption, notes, lat, lng, photoPath, photoType }]
        blockSections: [],           // [{ block, title, notes:[] }] — narrative grouping
        archive: { archivedToDrive: false, driveFileLink: null, archivedAt: null },
        createdBy: (window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || ''),
        createdAt: Date.now()
    };
};

// Blocks available for the active report year (Planting Phase Record).
// state.reports[year] is an ARRAY of rows, each with a `block_id` — same source
// the Maintenance module uses (mntBlocksForYear). Free-text fallback if none.
const wkBlockOptions = () => {
    const rows = (window.state.reports && window.state.reports[wkCurrentYear()]) || [];
    const ids = (Array.isArray(rows) ? rows : []).map(r => wkCleanBlock(r && (r.block_id || r.blockNo || r.block))).filter(Boolean);
    return [...new Set(ids)].sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b));
    });
};

// ─────────────────────────────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────────────────────────────
const saveWeeklyActivityData = (silent = true) => {
    if (!window._weeklyDb) {
        if (!silent) alert('Not connected. Please login first.');
        return Promise.resolve();
    }
    return window._weeklyDb.ref('shared/weekly_activity_data').set(JSON.stringify(window.state.weekly))
        .then(() => {
            if (!silent) {
                alert('Weekly Activity saved!');
                if (typeof window.logAudit === 'function') window.logAudit('save', 'weekly', 'Weekly Activity', '');
            }
        })
        .catch(e => { console.error('Weekly Activity save error:', e); if (!silent) alert('Error: ' + e.message); });
};

// ─────────────────────────────────────────────────────────────────────
// Lazy CDN loaders (JSZip / Leaflet / html-to-image / docx)
// ─────────────────────────────────────────────────────────────────────
const wkLoadScript = (src, globalCheck) => new Promise((res, rej) => {
    if (globalCheck && globalCheck()) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
});

const wkLoadCss = (href) => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
};

const wkEnsureJSZip   = () => wkLoadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', () => typeof JSZip !== 'undefined');
const wkEnsureDocx    = () => wkLoadScript('https://unpkg.com/docx@8.5.0/build/index.umd.js', () => typeof window.docx !== 'undefined');
const wkEnsureHtmlToImage = () => wkLoadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', () => typeof window.htmlToImage !== 'undefined');
const wkEnsureLeaflet = async () => {
    wkLoadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await wkLoadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', () => typeof window.L !== 'undefined');
};

// ─────────────────────────────────────────────────────────────────────
// Image storage — Realtime Database (Firebase Storage needs a paid Blaze plan).
// Photos live UNDER A SEPARATE PATH (shared/weekly_images/<year>/<weekId>/<id>)
// as downscaled data URLs, kept OUT of the main weekly_activity_data record so
// every save stays small and old weeks don't slow initial load. A module-level
// cache holds decoded data URLs in memory and is never serialised into
// state.weekly (observations/mapImage store only the `path` reference).
// ─────────────────────────────────────────────────────────────────────
const _wkImageCache = {};               // path -> dataURL (in-memory only)
const WK_IMG_ROOT = 'shared/weekly_images';

const wkBlobToDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Could not read image'));
    r.readAsDataURL(blob);
});

// Downscale a photo Blob to <= maxDim on its longest side and re-encode as
// JPEG — camera originals are 6–10 MB, which would blow the Storage budget and
// bloat the .docx. ~1600px / q0.82 keeps a report-quality image at a few
// hundred KB. Returns the original blob untouched if anything goes wrong or it
// isn't a raster image.
const wkResizeImage = (blob, maxDim = 1600, quality = 0.82) => new Promise((resolve) => {
    try {
        // NB: KMZ-extracted blobs (JSZip) have an empty MIME type, so we can't
        // gate on blob.type — just attempt to decode and fall back on error.
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const { width: w, height: h } = img;
            const scale = Math.min(1, maxDim / Math.max(w, h));
            // Already small and within bounds — keep as-is.
            if (scale >= 1 && blob.size < 1.2 * 1024 * 1024) { URL.revokeObjectURL(url); return resolve(blob); }
            const cw = Math.round(w * scale), ch = Math.round(h * scale);
            const canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            canvas.toBlob(b => resolve(b && b.size < blob.size ? b : blob), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
        img.src = url;
    } catch (e) { resolve(blob); }
});

// Reject if a promise hasn't settled within `ms` — keeps a stuck Storage
// upload (e.g. offline / rules denial that retries) from hanging an import.
const wkWithTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error((label || 'Operation') + ' timed out')), ms))
]);

// Store an (already-resized) image blob under shared/weekly_images/<path> and
// return its DB path + MIME type. The path — not the bytes — is what gets saved
// on the observation/mapImage record.
const wkUploadBlob = async (yearStr, weekId, name, blob) => {
    // Realtime DB keys may not contain . # $ [ ] — sanitise the file name.
    const key = String(name).replace(/[.#$\[\]]/g, '_');
    const path = `${yearStr}/${weekId}/${key}`;
    const dataUrl = await wkBlobToDataUrl(blob);
    if (window._weeklyDb) await window._weeklyDb.ref(`${WK_IMG_ROOT}/${path}`).set(dataUrl);
    _wkImageCache[path] = dataUrl;
    return { path, type: blob.type || 'image/jpeg' };
};

// Resolve an image path to a data URL — from the in-memory cache, else the DB.
// Returns null if the image is gone (e.g. an old week was cleaned up).
const wkLoadImage = async (path) => {
    if (!path) return null;
    if (_wkImageCache[path]) return _wkImageCache[path];
    if (!window._weeklyDb) return null;
    try {
        const snap = await window._weeklyDb.ref(`${WK_IMG_ROOT}/${path}`).once('value');
        const v = snap.val();
        if (v) { _wkImageCache[path] = v; return v; }
    } catch (e) { console.warn('Image load failed', path, e); }
    return null;
};

// Best-effort delete of a stored image (DB node + cache).
const wkDeleteStorage = async (path) => {
    if (!path) return;
    delete _wkImageCache[path];
    if (!window._weeklyDb) return;
    try { await window._weeklyDb.ref(`${WK_IMG_ROOT}/${path}`).remove(); } catch (e) { /* already gone */ }
};

// ─────────────────────────────────────────────────────────────────────
// KMZ / KML / GPX import + parse
// ─────────────────────────────────────────────────────────────────────

// Parse a KML "lng,lat[,alt] lng,lat..." coordinate blob into [[lng,lat],...]
const wkParseCoordString = (txt) => {
    const out = [];
    String(txt || '').trim().split(/\s+/).forEach(tok => {
        const parts = tok.split(',').map(Number);
        if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) out.push([parts[0], parts[1]]);
    });
    return out;
};

// Pull the first <img src> out of a KML <description> (often CDATA HTML).
const wkImgSrcFromDescription = (desc) => {
    const m = String(desc || '').match(/<img[^>]+src\s*=\s*["']?([^"'>\s]+)/i);
    return m ? m[1] : null;
};

// Resolve an image reference from a placemark against the KMZ zip entries.
const wkFindZipImage = (zip, ref) => {
    if (!zip || !ref) return null;
    const clean = decodeURIComponent(String(ref).replace(/^(\.\/|\/)/, '')).trim();
    const names = Object.keys(zip.files);
    let hit = names.find(n => n === clean);
    if (!hit) { const base = clean.split('/').pop(); hit = names.find(n => n.split('/').pop() === base); }
    return hit ? zip.files[hit] : null;
};

// Parse KML text into { track:[[lng,lat]...], placemarks:[{name,desc,lng,lat,imgRef}] }
const wkParseKML = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const track = [];
    // LineString / gx:Track coordinates
    doc.querySelectorAll('LineString coordinates').forEach(c => track.push(...wkParseCoordString(c.textContent)));
    if (!track.length) {
        // gx:Track uses <gx:coord>lng lat alt</gx:coord>
        doc.querySelectorAll('coord, *|coord').forEach(c => {
            const p = c.textContent.trim().split(/\s+/).map(Number);
            if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) track.push([p[0], p[1]]);
        });
    }
    const placemarks = [];
    doc.querySelectorAll('Placemark').forEach(pm => {
        const pt = pm.querySelector('Point coordinates');
        if (!pt) return;
        const coords = wkParseCoordString(pt.textContent);
        if (!coords.length) return;
        const name = (pm.querySelector('name') && pm.querySelector('name').textContent || '').trim();
        const desc = (pm.querySelector('description') && pm.querySelector('description').textContent || '').trim();
        // Prefer an explicit ExtendedData/Data[name=wptPhotos] photo ref (AlpineQuest);
        // fall back to the first <img src> inside the description HTML.
        let imgRef = null;
        pm.querySelectorAll('ExtendedData Data').forEach(d => {
            if (!imgRef && /wptphoto|photo|image/i.test(d.getAttribute('name') || '')) {
                const v = (d.textContent || '').trim();
                if (v) imgRef = v;
            }
        });
        if (!imgRef) imgRef = wkImgSrcFromDescription(desc);
        placemarks.push({ name, desc, lng: coords[0][0], lat: coords[0][1], imgRef });
    });
    return { track, placemarks };
};

// Parse GPX text into the same shape (track + waypoints).
const wkParseGPX = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const track = [];
    doc.querySelectorAll('trkpt, rtept').forEach(p => {
        const lat = parseFloat(p.getAttribute('lat')); const lng = parseFloat(p.getAttribute('lon'));
        if (isFinite(lat) && isFinite(lng)) track.push([lng, lat]);
    });
    const placemarks = [];
    doc.querySelectorAll('wpt').forEach(p => {
        const lat = parseFloat(p.getAttribute('lat')); const lng = parseFloat(p.getAttribute('lon'));
        if (!isFinite(lat) || !isFinite(lng)) return;
        const name = (p.querySelector('name') && p.querySelector('name').textContent || '').trim();
        const desc = (p.querySelector('desc') && p.querySelector('desc').textContent || '').trim();
        placemarks.push({ name, desc, lng, lat, imgRef: null });
    });
    return { track, placemarks };
};

// Import a track file into the given week. Reads track + placemarks, uploads
// any embedded photos to Storage, and appends observations. Returns a summary.
const wkImportTrackFile = async (file, yearStr, week) => {
    const lower = file.name.toLowerCase();
    let parsed, zip = null;

    if (lower.endsWith('.kmz')) {
        await wkEnsureJSZip();
        zip = await JSZip.loadAsync(await file.arrayBuffer());
        // Main KML is usually doc.kml; otherwise first *.kml
        const kmlName = Object.keys(zip.files).find(n => /\.kml$/i.test(n) && /doc\.kml$/i.test(n))
            || Object.keys(zip.files).find(n => /\.kml$/i.test(n));
        if (!kmlName) throw new Error('No .kml found inside the KMZ.');
        parsed = wkParseKML(await zip.files[kmlName].async('string'));
    } else if (lower.endsWith('.kml')) {
        parsed = wkParseKML(await file.text());
    } else if (lower.endsWith('.gpx')) {
        parsed = wkParseGPX(await file.text());
    } else {
        throw new Error('Unsupported file. Use .kmz, .kml or .gpx');
    }

    if (parsed.track && parsed.track.length) {
        week.track = { coords: parsed.track, source: file.name };
    }

    let added = 0, photos = 0, failed = 0;
    for (const pm of parsed.placemarks) {
        const obs = {
            id: wkUid(),
            block: '',
            caption: pm.name || '',
            notes: (pm.desc && !pm.imgRef) ? pm.desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
            lat: pm.lat, lng: pm.lng,
            photoPath: null, photoType: null
        };
        // Capture the observation first so its caption/coords survive even if the
        // photo upload fails or times out — the photo can be re-attached later.
        week.observations.push(obs);
        added++;
        if (zip && pm.imgRef) {
            const entry = wkFindZipImage(zip, pm.imgRef);
            if (entry) {
                try {
                    const raw = await entry.async('blob');
                    const blob = await wkResizeImage(raw);
                    const up = await wkWithTimeout(wkUploadBlob(yearStr, week.id, `${obs.id}.jpg`, blob), 30000, 'Photo save');
                    obs.photoPath = up.path; obs.photoType = up.type;
                    photos++;
                } catch (e) { console.warn('Photo upload failed for', pm.imgRef, e); failed++; }
            }
        }
    }
    return { track: (parsed.track || []).length, observations: added, photos, failed };
};

// ─────────────────────────────────────────────────────────────────────
// Leaflet satellite map + rasterize
// ─────────────────────────────────────────────────────────────────────
let _wkMap = null;
let _wkTileLayer = null;
let _wkTilesReady = false;

const wkRenderMap = async (containerId, week) => {
    await wkEnsureLeaflet();
    const el = document.getElementById(containerId);
    if (!el) return null;
    if (_wkMap) { try { _wkMap.remove(); } catch (e) {} _wkMap = null; }

    const map = window.L.map(el, { preferCanvas: false, attributionControl: true });
    _wkTilesReady = false;
    _wkTileLayer = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, crossOrigin: true,
        attribution: 'Tiles &copy; Esri'
    });
    _wkTileLayer.on('load', () => { _wkTilesReady = true; });
    _wkTileLayer.addTo(map);

    const latlngs = (week.track && week.track.coords || []).map(([lng, lat]) => [lat, lng]);
    if (latlngs.length) {
        window.L.polyline(latlngs, { color: '#ff3b30', weight: 4, opacity: 0.9 }).addTo(map);
    }
    // Vector circle dots (not marker-icon images) — these render reliably in the
    // leaflet-image snapshot and don't taint the export canvas. The numbered
    // tooltip is for the live map; the report lists captions per block anyway.
    (week.observations || []).forEach((o, i) => {
        if (!isFinite(o.lat) || !isFinite(o.lng)) return;
        window.L.circleMarker([o.lat, o.lng], { radius: 6, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
            .addTo(map).bindTooltip(String(i + 1), { permanent: true, direction: 'top' });
    });

    // Fit bounds to everything we have
    const pts = latlngs.concat((week.observations || []).filter(o => isFinite(o.lat) && isFinite(o.lng)).map(o => [o.lat, o.lng]));
    if (pts.length) map.fitBounds(window.L.latLngBounds(pts).pad(0.15));
    else map.setView([3.0, 113.0], 6); // fallback (roughly Borneo)

    _wkMap = map;
    return map;
};

// Rasterize the live map div to a PNG Blob. Waits for Esri tiles to finish
// loading (so the snapshot isn't half-grey), then uses html-to-image to capture
// the rendered DOM (tiles + track + dots), excluding the zoom/attribution
// controls. Behind a hard timeout so a stuck capture can't hang the button.
// (Replaces leaflet-image, which silently hangs under Leaflet 1.9.)
const wkRasterizeMap = async (containerId) => {
    await wkEnsureHtmlToImage();
    const el = document.getElementById(containerId);
    if (!el || typeof window.htmlToImage === 'undefined') throw new Error('Map not ready');
    // Wait up to ~6s for tiles to report loaded, then a small settle margin.
    for (let i = 0; i < 24 && !_wkTilesReady; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 500));
    const snap = window.htmlToImage.toBlob(el, {
        pixelRatio: 2,
        backgroundColor: '#000',
        filter: (node) => !(node.classList && (node.classList.contains('leaflet-control-container') || node.classList.contains('leaflet-control')))
    });
    return wkWithTimeout(snap, 15000, 'Map snapshot');
};

// ─────────────────────────────────────────────────────────────────────
// Word .docx export
// ─────────────────────────────────────────────────────────────────────
const wkFetchImageBytes = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
};

const wkDocImgType = (mime, url) => {
    const s = (mime || url || '').toLowerCase();
    if (s.includes('png')) return 'png';
    if (s.includes('gif')) return 'gif';
    if (s.includes('bmp')) return 'bmp';
    return 'jpg';
};

const downloadWeeklyActivityDoc = async (yearStr, weekId) => {
    const week = wkFindWeek(yearStr, weekId);
    if (!week) { alert('Week not found.'); return; }
    try {
        await wkEnsureDocx();
        const D = window.docx;
        const children = [];

        children.push(new D.Paragraph({ children: [new D.TextRun({ text: `${week.date || ''}${week.day ? ', ' + week.day : ''}`, bold: true, size: 28 })] }));
        children.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Activity for the Day', bold: true, size: 24 })], spacing: { before: 160, after: 80 } }));

        // Main Activity
        children.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Main Activity', bold: true })] }));
        (week.mainActivity && week.mainActivity.length ? week.mainActivity : ['—']).forEach(line => {
            children.push(new D.Paragraph({ bullet: { level: 0 }, children: [new D.TextRun(String(line))] }));
        });

        // Others
        if (week.others && week.others.length) {
            children.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Others', bold: true })], spacing: { before: 120 } }));
            week.others.forEach(line => children.push(new D.Paragraph({ children: [new D.TextRun(String(line))] })));
        }

        // Track map (lead image)
        if (week.mapImage && week.mapImage.path) {
            try {
                const src = await wkLoadImage(week.mapImage.path);
                if (src) {
                    const bytes = await wkFetchImageBytes(src);
                    children.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Activity Track', bold: true })], spacing: { before: 200, after: 80 } }));
                    children.push(new D.Paragraph({ children: [new D.ImageRun({
                        type: wkDocImgType(week.mapImage.type, src),
                        data: bytes,
                        transformation: { width: 600, height: 380 },
                        altText: { title: 'Activity track map', description: 'GPS track', name: 'track-map' }
                    })] }));
                }
            } catch (e) { console.warn('Map image embed failed:', e); }
        }

        // Group observations by block (blockSections provide titles/notes)
        const byBlock = {};
        (week.observations || []).forEach(o => { const k = o.block || 'General'; (byBlock[k] = byBlock[k] || []).push(o); });
        const sectionTitle = (block) => {
            const sec = (week.blockSections || []).find(s => s.block === block);
            return (sec && sec.title) || (block === 'General' ? 'Observations' : 'Block ' + block);
        };

        for (const block of Object.keys(byBlock)) {
            children.push(new D.Paragraph({ children: [new D.TextRun({ text: sectionTitle(block), bold: true, size: 24 })], spacing: { before: 240, after: 80 } }));
            const sec = (week.blockSections || []).find(s => s.block === block);
            (sec && sec.notes || []).forEach(n => children.push(new D.Paragraph({ children: [new D.TextRun(String(n))] })));

            for (const o of byBlock[block]) {
                if (o.photoPath) {
                    try {
                        const src = await wkLoadImage(o.photoPath);
                        if (src) {
                            const bytes = await wkFetchImageBytes(src);
                            children.push(new D.Paragraph({ children: [new D.ImageRun({
                                type: wkDocImgType(o.photoType, src),
                                data: bytes,
                                transformation: { width: 380, height: 285 },
                                altText: { title: o.caption || 'Photo', description: o.caption || 'Observation', name: o.id }
                            })], spacing: { before: 120 } }));
                        }
                    } catch (e) { console.warn('Photo embed failed:', o.id, e); }
                }
                if (o.caption) children.push(new D.Paragraph({ children: [new D.TextRun({ text: o.caption, italics: true })] }));
                if (o.notes)   children.push(new D.Paragraph({ children: [new D.TextRun(String(o.notes))] }));
                if (isFinite(o.lat) && isFinite(o.lng)) {
                    children.push(new D.Paragraph({ children: [
                        new D.TextRun({ text: 'Location: ', bold: true }),
                        new D.ExternalHyperlink({
                            link: `https://www.google.com/maps?q=${o.lat},${o.lng}`,
                            children: [new D.TextRun({ text: `${o.lat.toFixed(6)}, ${o.lng.toFixed(6)}`, style: 'Hyperlink' })]
                        })
                    ] }));
                }
            }
        }

        const doc = new D.Document({
            styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
            sections: [{
                properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
                children
            }]
        });

        const blob = await D.Packer.toBlob(doc);
        const fname = `Weekly Activity ${(week.date || '').replace(/-/g, '.')}.docx`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        if (typeof window.logAudit === 'function') window.logAudit('export', 'weekly', fname, '');
    } catch (e) {
        console.error('Weekly Word export failed:', e);
        alert('Could not generate the Word document: ' + e.message);
    }
};

// ─────────────────────────────────────────────────────────────────────
// Generic line-list editor (Main Activity / Others / section notes)
// ─────────────────────────────────────────────────────────────────────
const wkRenderLineEditor = (arr, placeholder, onChange) => {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:0.35rem;';
    const editable = wkCanEdit();

    const rebuild = () => {
        box.innerHTML = '';
        arr.forEach((line, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:0.4rem; align-items:flex-start;';
            const ta = document.createElement('textarea');
            ta.rows = 1; ta.value = line;
            ta.style.cssText = 'flex:1; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card); resize:vertical; min-height:34px;';
            ta.disabled = !editable;
            ta.oninput = () => { arr[i] = ta.value; };
            ta.onchange = () => onChange();
            row.appendChild(ta);
            if (editable) {
                const del = document.createElement('button');
                del.textContent = '✕';
                del.style.cssText = 'padding:0.3rem 0.55rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); cursor:pointer;';
                del.onclick = () => { arr.splice(i, 1); onChange(); rebuild(); };
                row.appendChild(del);
            }
            box.appendChild(row);
        });
        if (editable) {
            const add = document.createElement('button');
            add.textContent = '➕ Add line';
            add.style.cssText = 'align-self:flex-start; padding:0.3rem 0.7rem; border:1px dashed var(--border-color); border-radius:6px; background:transparent; cursor:pointer; font-size:0.8rem; color:var(--text-secondary);';
            add.onclick = () => { arr.push(''); rebuild(); };
            box.appendChild(add);
        }
        if (!arr.length && !editable) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:0.82rem; color:var(--text-secondary);';
            empty.textContent = placeholder || '—';
            box.appendChild(empty);
        }
    };
    rebuild();
    return box;
};

const wkSectionLabel = (text) => {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.cssText = 'font-size:0.95rem; font-weight:700; color:var(--text-primary); margin:1.25rem 0 0.5rem;';
    return h;
};

// ─────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────
const renderWeeklyActivity = () => {
    const wrapper = document.getElementById('weekly-activity-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wkEnsure();

    const yearStr = wkCurrentYear();
    wkEnsureYear(yearStr);
    const editable = wkCanEdit();

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.25rem; flex-wrap:wrap;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = '🗺️ Weekly Activity';
    leftGroup.appendChild(titleEl);

    const yearOpts = (wkYears().length ? wkYears() : [yearStr]).map(y => ({ value: y, label: y }));
    leftGroup.appendChild(wkMakeSelector('Year:', yearOpts, yearStr, v => { window.state.weeklyYear = v; window.state.weeklyWeekId = null; renderWeeklyActivity(); }));

    if (editable) {
        const btnAddYear = document.createElement('button');
        btnAddYear.className = 'btn-secondary';
        btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
        btnAddYear.innerHTML = '➕ Year';
        btnAddYear.onclick = () => {
            const latest = wkYears().pop() || yearStr;
            const ny = (prompt('Enter year (e.g. 2027):', String(parseInt(latest) + 1)) || '').trim();
            if (!ny) return;
            if (wkEnsure()[ny]) { alert(`Year ${ny} already exists.`); return; }
            wkEnsureYear(ny); window.state.weeklyYear = ny; window.state.weeklyWeekId = null;
            saveWeeklyActivityData(); renderWeeklyActivity();
        };
        leftGroup.appendChild(btnAddYear);
    }
    toolbar.appendChild(leftGroup);

    if (editable) {
        const btnNew = document.createElement('button');
        btnNew.className = 'btn-primary';
        btnNew.style.cssText = 'background:#10b981; border-color:#10b981; padding:0.4rem 1rem; font-size:0.85rem;';
        btnNew.innerHTML = '➕ New Week';
        btnNew.onclick = () => {
            const wk = wkNewWeek();
            wkEnsureYear(yearStr).weeks.push(wk);
            window.state.weeklyWeekId = wk.id;
            saveWeeklyActivityData();
            if (typeof window.logAudit === 'function') window.logAudit('add', 'weekly', `Week ${wk.date}`, '');
            renderWeeklyActivity();
        };
        toolbar.appendChild(btnNew);
    }
    wrapper.appendChild(toolbar);

    // ── Week list (left) + editor (right) ─────────────────────────────
    const layout = document.createElement('div');
    layout.style.cssText = 'display:flex; gap:1.25rem; align-items:flex-start; flex-wrap:wrap;';

    const listCol = document.createElement('div');
    listCol.style.cssText = 'flex:0 0 230px; display:flex; flex-direction:column; gap:0.4rem;';
    const weeks = wkWeeksFor(yearStr);
    if (!weeks.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.85rem; color:var(--text-secondary); padding:0.5rem;';
        empty.textContent = editable ? 'No weeks yet. Click "New Week" to start.' : 'No weekly reports recorded.';
        listCol.appendChild(empty);
    }
    weeks.forEach(wk => {
        const card = document.createElement('button');
        const active = wk.id === window.state.weeklyWeekId;
        card.style.cssText = `text-align:left; padding:0.55rem 0.75rem; border:1px solid ${active ? 'var(--accent-color,#10b981)' : 'var(--border-color)'}; border-radius:8px; background:${active ? 'var(--bg-secondary)' : 'var(--bg-card)'}; cursor:pointer; font-size:0.85rem;`;
        const archived = wkIsArchivedAge(wk);
        card.innerHTML = `<div style="font-weight:700; color:var(--text-primary);">${wkEsc(wk.date || '—')}</div>`
            + `<div style="font-size:0.78rem; color:var(--text-secondary);">${wkEsc(wk.day || '')} · ${(wk.observations || []).length} obs${archived ? ' · 📦' : ''}</div>`;
        card.onclick = () => { window.state.weeklyWeekId = wk.id; renderWeeklyActivity(); };
        listCol.appendChild(card);
    });
    layout.appendChild(listCol);

    const editCol = document.createElement('div');
    editCol.style.cssText = 'flex:1 1 560px; min-width:320px;';
    const week = wkFindWeek(yearStr, window.state.weeklyWeekId);
    if (!week) {
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:2rem; text-align:center; color:var(--text-secondary);';
        hint.textContent = weeks.length ? 'Select a week to view or edit.' : 'Create a week to begin.';
        editCol.appendChild(hint);
    } else {
        wkRenderWeekEditor(editCol, yearStr, week);
    }
    layout.appendChild(editCol);
    wrapper.appendChild(layout);
};

// Selector helper (local copy so the module is self-contained)
const wkMakeSelector = (labelText, options, currentVal, onChange) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    lbl.textContent = labelText;
    const sel = document.createElement('select');
    sel.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';
    options.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if (value === currentVal) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.onchange = e => onChange(e.target.value);
    wrap.appendChild(lbl); wrap.appendChild(sel);
    return wrap;
};

// ─────────────────────────────────────────────────────────────────────
// Week editor
// ─────────────────────────────────────────────────────────────────────
const wkRenderWeekEditor = (host, yearStr, week) => {
    const editable = wkCanEdit();
    host.innerHTML = '';

    // Archive banner
    if (wkIsArchivedAge(week)) {
        const banner = document.createElement('div');
        banner.style.cssText = 'background:#eff6ff; border:1px solid #93c5fd; border-radius:6px; padding:0.5rem 0.9rem; margin-bottom:1rem; font-size:0.82rem; color:#1e40af; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;';
        const link = week.archive && week.archive.driveFileLink;
        banner.innerHTML = '📦 <strong>Archived to Google Drive</strong>. '
            + (link ? `<a href="${wkEsc(link)}" target="_blank" rel="noopener">Open the backup in Google Drive ↗</a>` : 'The permanent copy is the exported Word file in your Google Drive backup.');
        host.appendChild(banner);
    }

    // Header: date + day + actions
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border-color);';

    const dateLbl = document.createElement('span');
    dateLbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    dateLbl.textContent = 'Date:';
    const dateInput = document.createElement('input');
    dateInput.type = 'date'; dateInput.value = week.date || ''; dateInput.disabled = !editable;
    dateInput.style.cssText = 'padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-card); font-size:0.9rem;';
    const dayBadge = document.createElement('span');
    dayBadge.style.cssText = 'font-size:0.85rem; font-weight:600; color:var(--text-primary);';
    dayBadge.textContent = week.day || wkDayFromDate(week.date);
    dateInput.onchange = () => { week.date = dateInput.value; week.day = wkDayFromDate(week.date); dayBadge.textContent = week.day; saveWeeklyActivityData(); };
    header.appendChild(dateLbl); header.appendChild(dateInput); header.appendChild(dayBadge);

    const spacer = document.createElement('div'); spacer.style.flex = '1'; header.appendChild(spacer);

    const btnExport = document.createElement('button');
    btnExport.className = 'btn-secondary';
    btnExport.style.cssText = 'padding:0.4rem 0.9rem; font-size:0.85rem;';
    btnExport.innerHTML = '⬇️ Export to Word';
    btnExport.onclick = () => downloadWeeklyActivityDoc(yearStr, week.id);
    header.appendChild(btnExport);

    if (editable) {
        const btnSave = document.createElement('button');
        btnSave.className = 'btn-primary';
        btnSave.style.cssText = 'background:#10b981; border-color:#10b981; padding:0.4rem 0.9rem; font-size:0.85rem;';
        btnSave.innerHTML = '💾 Save';
        btnSave.onclick = () => saveWeeklyActivityData(false);
        header.appendChild(btnSave);

        const btnDel = document.createElement('button');
        btnDel.style.cssText = 'padding:0.4rem 0.7rem; font-size:0.85rem; border:1px solid #ef4444; color:#ef4444; border-radius:6px; background:transparent; cursor:pointer;';
        btnDel.innerHTML = '🗑 Delete';
        btnDel.onclick = async () => {
            if (!confirm(`Delete the week of ${week.date}? This cannot be undone.`)) return;
            // best-effort cleanup of this week's storage objects
            for (const o of (week.observations || [])) await wkDeleteStorage(o.photoPath);
            if (week.mapImage && week.mapImage.path) await wkDeleteStorage(week.mapImage.path);
            const arr = wkEnsureYear(yearStr).weeks;
            const i = arr.findIndex(w => w.id === week.id);
            if (i >= 0) arr.splice(i, 1);
            window.state.weeklyWeekId = null;
            saveWeeklyActivityData();
            if (typeof window.logAudit === 'function') window.logAudit('delete', 'weekly', `Week ${week.date}`, '');
            renderWeeklyActivity();
        };
        header.appendChild(btnDel);
    }
    host.appendChild(header);

    // Import bar
    if (editable) {
        const importBar = document.createElement('div');
        importBar.style.cssText = 'display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; margin-bottom:0.75rem; padding:0.6rem 0.8rem; background:var(--bg-secondary); border-radius:8px;';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:0.85rem; color:var(--text-primary); font-weight:600;';
        lbl.textContent = 'Import track (KMZ / KML / GPX):';
        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = '.kmz,.kml,.gpx';
        fileInput.style.cssText = 'font-size:0.82rem;';
        const status = document.createElement('span');
        status.style.cssText = 'font-size:0.8rem; color:var(--text-secondary);';
        fileInput.onchange = async () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            status.textContent = 'Importing…';
            try {
                const sum = await wkImportTrackFile(f, yearStr, week);
                saveWeeklyActivityData();
                status.textContent = `Imported: ${sum.track} track pts, ${sum.observations} observations, ${sum.photos} photos`
                    + (sum.failed ? ` (${sum.failed} photo(s) could not be saved — check your connection and that you are logged in).` : '.');
                if (typeof window.logAudit === 'function') window.logAudit('import', 'weekly', `Track ${f.name}`, `${sum.observations} obs`);
                wkRenderWeekEditor(host, yearStr, week);
            } catch (e) {
                console.error(e); status.textContent = 'Failed: ' + e.message;
            }
            fileInput.value = '';
        };
        importBar.appendChild(lbl); importBar.appendChild(fileInput); importBar.appendChild(status);
        host.appendChild(importBar);
    }

    // Map section
    host.appendChild(wkSectionLabel('Activity Track Map'));
    const mapWrap = document.createElement('div');
    mapWrap.style.cssText = 'margin-bottom:0.5rem;';
    const mapDiv = document.createElement('div');
    mapDiv.id = 'wk-map';
    mapDiv.style.cssText = 'width:100%; max-width:640px; height:360px; border:1px solid var(--border-color); border-radius:8px; overflow:hidden; background:var(--bg-secondary);';
    mapWrap.appendChild(mapDiv);

    const mapActions = document.createElement('div');
    mapActions.style.cssText = 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-top:0.5rem;';
    if (editable) {
        const btnGen = document.createElement('button');
        btnGen.className = 'btn-secondary';
        btnGen.style.cssText = 'padding:0.35rem 0.8rem; font-size:0.82rem;';
        btnGen.innerHTML = '📸 Generate map image';
        btnGen.onclick = async () => {
            btnGen.disabled = true; btnGen.textContent = 'Rendering…';
            try {
                const blob = await wkRasterizeMap('wk-map');
                const up = await wkWithTimeout(wkUploadBlob(yearStr, week.id, `map.jpg`, await wkResizeImage(blob, 2000, 0.85)), 30000, 'Map save');
                if (week.mapImage && week.mapImage.path && week.mapImage.path !== up.path) await wkDeleteStorage(week.mapImage.path);
                week.mapImage = { path: up.path, type: up.type, mode: 'auto' };
                saveWeeklyActivityData();
                wkRenderWeekEditor(host, yearStr, week);
            } catch (e) {
                console.error(e);
                alert('Could not generate the map image: ' + e.message + '\n\nTip: make sure the map has finished loading, then try again — or use "Upload screenshot" to add your own Google Maps image.');
                btnGen.disabled = false; btnGen.innerHTML = '📸 Generate map image';
            }
        };
        mapActions.appendChild(btnGen);

        const upLbl = document.createElement('label');
        upLbl.className = 'btn-secondary';
        upLbl.style.cssText = 'padding:0.35rem 0.8rem; font-size:0.82rem; cursor:pointer;';
        upLbl.innerHTML = '🖼 Upload screenshot';
        const upInput = document.createElement('input');
        upInput.type = 'file'; upInput.accept = 'image/*'; upInput.style.display = 'none';
        upInput.onchange = async () => {
            const f = upInput.files && upInput.files[0]; if (!f) return;
            const prevLbl = upLbl.innerHTML; upLbl.textContent = '⏳ uploading…';
            try {
                const up = await wkWithTimeout(wkUploadBlob(yearStr, week.id, `map_upload.jpg`, await wkResizeImage(f, 2000)), 30000, 'Map save');
                if (week.mapImage && week.mapImage.path && week.mapImage.path !== up.path) await wkDeleteStorage(week.mapImage.path);
                week.mapImage = { path: up.path, type: up.type, mode: 'uploaded' };
                saveWeeklyActivityData(); wkRenderWeekEditor(host, yearStr, week);
            } catch (e) {
                console.error(e); upLbl.innerHTML = prevLbl; upLbl.appendChild(upInput);
                alert('Could not save the image: ' + e.message + '\n\nCheck your connection and that you are logged in, then try again.');
            }
        };
        upLbl.appendChild(upInput);
        mapActions.appendChild(upLbl);
    }
    if (week.mapImage && week.mapImage.path) {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:0.78rem; color:var(--text-secondary);';
        tag.textContent = `Report image set (${week.mapImage.mode}).`;
        mapActions.appendChild(tag);
    }
    mapWrap.appendChild(mapActions);
    host.appendChild(mapWrap);
    // Render the live map (async; after the div is in the DOM)
    setTimeout(() => { wkRenderMap('wk-map', week).catch(e => console.warn('Map render:', e)); }, 50);

    // Main Activity
    host.appendChild(wkSectionLabel('Main Activity'));
    host.appendChild(wkRenderLineEditor(week.mainActivity, 'No activities recorded.', () => saveWeeklyActivityData()));

    // Others
    host.appendChild(wkSectionLabel('Others / Follow-ups'));
    host.appendChild(wkRenderLineEditor(week.others, 'None.', () => saveWeeklyActivityData()));

    // Observations
    host.appendChild(wkSectionLabel(`Observations (${(week.observations || []).length})`));
    host.appendChild(wkRenderObservations(yearStr, week, host));
};

// ─────────────────────────────────────────────────────────────────────
// Observations list
// ─────────────────────────────────────────────────────────────────────
const wkRenderObservations = (yearStr, week, host) => {
    const editable = wkCanEdit();
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:0.75rem;';
    const blockOpts = wkBlockOptions();

    (week.observations || []).forEach((o, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'display:flex; gap:0.8rem; padding:0.75rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-card); flex-wrap:wrap;';

        // Thumbnail — load the image lazily from the DB image cache.
        const thumb = document.createElement('div');
        thumb.style.cssText = 'flex:0 0 120px; height:90px; border-radius:6px; overflow:hidden; background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; font-size:0.7rem; color:var(--text-secondary);';
        if (o.photoPath) {
            thumb.textContent = '…';
            wkLoadImage(o.photoPath).then(src => {
                if (src) {
                    thumb.textContent = '';
                    const img = document.createElement('img');
                    img.src = src; img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
                    thumb.appendChild(img);
                } else { thumb.textContent = '📦 expired'; }
            });
        } else { thumb.textContent = 'no photo'; }
        card.appendChild(thumb);

        // Fields
        const fields = document.createElement('div');
        fields.style.cssText = 'flex:1 1 260px; display:flex; flex-direction:column; gap:0.4rem;';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;';
        const numTag = document.createElement('span');
        numTag.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:0.85rem;';
        numTag.textContent = '#' + (idx + 1);
        topRow.appendChild(numTag);

        // Block selector: dropdown from the Planting Phase Record when that year
        // has blocks; free-text input as a fallback so a block can always be set.
        if (blockOpts.length) {
            const blockSel = document.createElement('select');
            blockSel.disabled = !editable;
            blockSel.style.cssText = 'padding:0.3rem 0.5rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-card); font-size:0.82rem;';
            const optBlank = document.createElement('option'); optBlank.value = ''; optBlank.textContent = 'Block…'; blockSel.appendChild(optBlank);
            const opts = blockOpts.slice();
            if (o.block && !opts.includes(o.block)) opts.unshift(o.block);
            opts.forEach(b => { const op = document.createElement('option'); op.value = b; op.textContent = 'Block ' + b; if (b === o.block) op.selected = true; blockSel.appendChild(op); });
            blockSel.onchange = () => { o.block = blockSel.value; saveWeeklyActivityData(); };
            topRow.appendChild(blockSel);
        } else {
            const blockInput = document.createElement('input');
            blockInput.type = 'text'; blockInput.value = o.block || ''; blockInput.placeholder = 'Block'; blockInput.disabled = !editable;
            blockInput.title = 'No Planting Phase Record blocks for this year — type a block number';
            blockInput.style.cssText = 'width:90px; padding:0.3rem 0.5rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-card); font-size:0.82rem;';
            blockInput.oninput = () => { o.block = wkCleanBlock(blockInput.value); };
            blockInput.onchange = () => saveWeeklyActivityData();
            topRow.appendChild(blockInput);
        }
        fields.appendChild(topRow);

        const cap = document.createElement('input');
        cap.type = 'text'; cap.value = o.caption || ''; cap.placeholder = 'Caption (what was observed)'; cap.disabled = !editable;
        cap.style.cssText = 'padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card);';
        cap.oninput = () => { o.caption = cap.value; }; cap.onchange = () => saveWeeklyActivityData();
        fields.appendChild(cap);

        const notes = document.createElement('textarea');
        notes.rows = 2; notes.value = o.notes || ''; notes.placeholder = 'Notes / findings'; notes.disabled = !editable;
        notes.style.cssText = 'padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card); resize:vertical;';
        notes.oninput = () => { o.notes = notes.value; }; notes.onchange = () => saveWeeklyActivityData();
        fields.appendChild(notes);

        const coordRow = document.createElement('div');
        coordRow.style.cssText = 'display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;';
        const mkCoord = (val, key, ph) => {
            const c = document.createElement('input');
            c.type = 'number'; c.step = 'any'; c.value = (val != null && isFinite(val)) ? val : ''; c.placeholder = ph; c.disabled = !editable;
            c.style.cssText = 'width:120px; padding:0.3rem 0.5rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.8rem; background:var(--bg-card);';
            c.onchange = () => { o[key] = c.value === '' ? null : parseFloat(c.value); saveWeeklyActivityData(); };
            return c;
        };
        coordRow.appendChild(mkCoord(o.lat, 'lat', 'lat'));
        coordRow.appendChild(mkCoord(o.lng, 'lng', 'lng'));
        if (isFinite(o.lat) && isFinite(o.lng)) {
            const link = document.createElement('a');
            link.href = `https://www.google.com/maps?q=${o.lat},${o.lng}`; link.target = '_blank'; link.rel = 'noopener';
            link.textContent = '📍 map'; link.style.cssText = 'font-size:0.8rem;';
            coordRow.appendChild(link);
        }
        fields.appendChild(coordRow);
        card.appendChild(fields);

        if (editable) {
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem;';
            const photoLbl = document.createElement('label');
            photoLbl.style.cssText = 'font-size:0.75rem; color:var(--text-secondary); cursor:pointer; border:1px solid var(--border-color); border-radius:6px; padding:0.25rem 0.45rem; text-align:center;';
            photoLbl.textContent = o.photoPath ? '↻ photo' : '📷 photo';
            const photoInput = document.createElement('input');
            photoInput.type = 'file'; photoInput.accept = 'image/*'; photoInput.style.display = 'none';
            photoInput.onchange = async () => {
                const f = photoInput.files && photoInput.files[0]; if (!f) return;
                const prev = photoLbl.textContent; photoLbl.textContent = '⏳ uploading…';
                try {
                    const up = await wkWithTimeout(wkUploadBlob(yearStr, week.id, `${o.id}.jpg`, await wkResizeImage(f)), 30000, 'Photo save');
                    if (o.photoPath && o.photoPath !== up.path) await wkDeleteStorage(o.photoPath);
                    o.photoPath = up.path; o.photoType = up.type;
                    saveWeeklyActivityData(); wkRenderWeekEditor(host, yearStr, week);
                } catch (e) {
                    console.error(e); photoLbl.textContent = prev;
                    alert('Could not save the photo: ' + e.message + '\n\nCheck your connection and that you are logged in, then try again.');
                }
            };
            photoLbl.appendChild(photoInput);
            actions.appendChild(photoLbl);

            const del = document.createElement('button');
            del.textContent = '🗑'; del.title = 'Delete observation';
            del.style.cssText = 'font-size:0.8rem; border:1px solid #ef4444; color:#ef4444; border-radius:6px; background:transparent; cursor:pointer; padding:0.25rem 0.45rem;';
            del.onclick = async () => {
                if (!confirm('Delete this observation?')) return;
                await wkDeleteStorage(o.photoPath);
                const i = week.observations.findIndex(x => x.id === o.id);
                if (i >= 0) week.observations.splice(i, 1);
                saveWeeklyActivityData(); wkRenderWeekEditor(host, yearStr, week);
            };
            actions.appendChild(del);
            card.appendChild(actions);
        }
        box.appendChild(card);
    });

    if (editable) {
        const addBtn = document.createElement('button');
        addBtn.textContent = '➕ Add observation';
        addBtn.style.cssText = 'align-self:flex-start; padding:0.4rem 0.8rem; border:1px dashed var(--border-color); border-radius:8px; background:transparent; cursor:pointer; font-size:0.83rem; color:var(--text-secondary);';
        addBtn.onclick = () => {
            week.observations.push({ id: wkUid(), block: '', caption: '', notes: '', lat: null, lng: null, photoPath: null, photoType: null });
            saveWeeklyActivityData(); wkRenderWeekEditor(host, yearStr, week);
        };
        box.appendChild(addBtn);
    }
    return box;
};

// ─────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────
window.renderWeeklyActivity = renderWeeklyActivity;
window.saveWeeklyActivityData = saveWeeklyActivityData;
window.downloadWeeklyActivityDoc = downloadWeeklyActivityDoc;
