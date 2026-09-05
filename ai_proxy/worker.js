/* ============================================================================
 * ai_proxy/worker.js — Cloudflare Worker that holds the Anthropic API key.
 * ----------------------------------------------------------------------------
 * The app is a static site, so it has nowhere safe to keep an API key. This
 * Worker is the only piece that ever sees it. It:
 *
 *   1. verifies the caller's Firebase ID token (signature, issuer, audience,
 *      expiry) against Google's published keys — so it is not an open relay,
 *   2. forwards the request body to the Anthropic Messages API,
 *   3. returns the response verbatim.
 *
 * It is deliberately dumb: it does not build prompts or interpret results.
 * All of that stays in render_ai_assist.js where you can read it.
 *
 * ── Deploy ──────────────────────────────────────────────────────────────────
 *   npm create cloudflare@latest ai-proxy -- --type=hello-world
 *   # replace src/index.js with this file, then:
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler deploy
 *
 * Then paste the resulting https://<name>.<subdomain>.workers.dev URL into
 * AI Assist → ⚙ Setup → Proxy URL.
 *
 * Free tier covers 100k requests/day — far beyond this app's use.
 * ==========================================================================*/

const FIREBASE_PROJECT_ID = 'ffb-harvesting-report';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Restrict which origins may call the proxy. Add your production host here.
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    // 'https://your-production-host',
];

const corsHeaders = (origin) => ({
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
});

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
});

/* ── JWT verification ───────────────────────────────────────────────────── */

const b64urlToBytes = (s) => {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

let _jwkCache = { at: 0, keys: null };

const getJwks = async () => {
    // Google rotates these roughly daily; an hour of caching is plenty and
    // keeps the proxy from fetching on every request.
    if (_jwkCache.keys && Date.now() - _jwkCache.at < 3600_000) return _jwkCache.keys;
    const r = await fetch(JWK_URL);
    if (!r.ok) throw new Error('Could not fetch Google signing keys');
    const body = await r.json();
    _jwkCache = { at: Date.now(), keys: body.keys };
    return body.keys;
};

/**
 * Verifies a Firebase ID token. Returns its payload, or throws.
 * Checks: RS256 signature against Google's keys, issuer, audience, expiry.
 */
const verifyFirebaseToken = async (token) => {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [h, p, s] = parts;

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

    if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

    const jwk = (await getJwks()).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('Unknown signing key');

    const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.n ? 'RSA' : jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
    );

    const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        b64urlToBytes(s),
        new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) throw new Error('Bad token signature');

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) throw new Error('Token expired');
    if (payload.iat > now + 300) throw new Error('Token issued in the future');
    if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('Wrong audience');
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
        throw new Error('Wrong issuer');
    }
    if (!payload.sub) throw new Error('No subject');

    return payload;
};

/* ── Handler ────────────────────────────────────────────────────────────── */

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }
        if (request.method !== 'POST') {
            return json({ error: { message: 'POST only' } }, 405, origin);
        }
        if (!env.ANTHROPIC_API_KEY) {
            return json({ error: { message: 'Proxy misconfigured: ANTHROPIC_API_KEY not set' } }, 500, origin);
        }

        // Authenticate the caller.
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        let user;
        try {
            user = await verifyFirebaseToken(token);
        } catch (err) {
            return json({ error: { message: 'Unauthorized: ' + err.message } }, 401, origin);
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: { message: 'Invalid JSON body' } }, 400, origin);
        }

        // Cap the blast radius of a runaway client.
        if (typeof body.max_tokens === 'number') body.max_tokens = Math.min(body.max_tokens, 16000);

        const upstream = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        const text = await upstream.text();
        console.log(JSON.stringify({
            uid: user.sub,
            email: user.email || null,
            status: upstream.status,
            model: body.model,
        }));

        return new Response(text, {
            status: upstream.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
    },
};
