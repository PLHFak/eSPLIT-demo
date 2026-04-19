// eSplit — Serverless API for access code management & session tracking
// Netlify Function using Netlify Blobs for persistent storage

import { getStore } from "@netlify/blobs";

// ── Admin password hash (PLH) ──
const ADMIN_HASH = '6d00de5917661a19d01b7ebe75803e5a427423dee8f6bd4648cb95cb7b8eab3f';

// ── CORS headers ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// ── Helper: JSON response ──
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── Helper: Get or init store data ──
async function getCodesStore() {
  const store = getStore("access-codes");
  let data;
  try {
    const raw = await store.get("codes", { type: "json" });
    data = raw || { codes: [] };
  } catch {
    data = { codes: [] };
  }
  return { store, data };
}

async function getLogsStore() {
  const store = getStore("access-logs");
  let data;
  try {
    const raw = await store.get("logs", { type: "json" });
    data = raw || { logs: [] };
  } catch {
    data = { logs: [] };
  }
  return { store, data };
}

async function getSessionsStore() {
  const store = getStore("sessions");
  let data;
  try {
    const raw = await store.get("sessions", { type: "json" });
    data = raw || { sessions: [] };
  } catch {
    data = { sessions: [] };
  }
  return { store, data };
}

// ── Initialize default codes if store is empty ──
async function initDefaultCodes(store, data) {
  if (data.codes.length === 0) {
    data.codes = [
      { id: 'demo', code: 'demo', hash: '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea', label: 'Tests internes', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
      { id: 'fvaode2026', code: 'FVAODE2026', hash: '739b57a56b23dd3fee425cfaed20b5086729c8414c092b875e213ff4f42c44b0', label: 'François Valadoux · AMP Visual TV', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
      { id: 'gdedpa2026', code: 'GDEDPA2026', hash: '484c8d56da47b171e8b50a07e8284c3569c7d4e5341785ea1d894a24b99dfd77', label: 'GDE · DPA', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
      { id: 'hbsvoc2026', code: 'HBSVOC2026', hash: '1af8c147aefa4d291f9fd6770b55f3c0eaef54de37bb8d6a049443e0e415f078', label: 'HBS', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
      { id: 'amm042026', code: 'AMM042026', hash: 'fcfa982790c8a956bf3da80540387c48e6251857f3d7ca50b3f3eca1c6326e0a', label: 'AMM', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
      { id: 'fftc042026', code: 'FFTC042026', hash: 'a50abce77a0286c853d6a24ef520aeee949ce93da81ba137d5a3ff1e7a9cc39a', label: 'FFTC', status: 'active', maxUses: null, expiresAt: null, createdAt: new Date().toISOString(), usageCount: 0 },
    ];
    await store.setJSON("codes", data);
  }
  return data;
}

// ── Route: Verify access code ──
async function verifyCode(body, headers) {
  const { hash } = body;
  if (!hash) return json({ error: 'Missing hash' }, 400);

  const { store, data } = await getCodesStore();
  const codesData = await initDefaultCodes(store, data);

  const entry = codesData.codes.find(c => c.hash === hash);
  if (!entry) return json({ valid: false, reason: 'unknown_code' });
  if (entry.status !== 'active') return json({ valid: false, reason: 'inactive' });
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) return json({ valid: false, reason: 'expired' });
  if (entry.maxUses && entry.usageCount >= entry.maxUses) return json({ valid: false, reason: 'max_uses_reached' });

  // Increment usage count
  entry.usageCount = (entry.usageCount || 0) + 1;
  entry.lastUsedAt = new Date().toISOString();
  await store.setJSON("codes", codesData);

  // Log access
  const { store: logStore, data: logData } = await getLogsStore();
  const ip = headers.get('x-forwarded-for') || headers.get('x-nf-client-connection-ip') || 'unknown';
  const ua = headers.get('user-agent') || 'unknown';
  logData.logs.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    code: entry.code,
    label: entry.label,
    ip: ip.split(',')[0].trim(),
    userAgent: ua,
    timestamp: new Date().toISOString()
  });
  // Keep last 1000 logs
  if (logData.logs.length > 1000) logData.logs = logData.logs.slice(-1000);
  await logStore.setJSON("logs", logData);

  // Create session
  const { store: sessStore, data: sessData } = await getSessionsStore();
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  sessData.sessions.push({
    id: sessionId,
    code: entry.code,
    label: entry.label,
    ip: ip.split(',')[0].trim(),
    userAgent: ua,
    startedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    slidesViewed: [],
    pagesViewed: 0,
    duration: 0
  });
  // Keep last 500 sessions
  if (sessData.sessions.length > 500) sessData.sessions = sessData.sessions.slice(-500);
  await sessStore.setJSON("sessions", sessData);

  return json({ valid: true, code: entry.code, label: entry.label, sessionId });
}

// ── Route: Session heartbeat ──
async function heartbeat(body) {
  const { sessionId, currentSlide } = body;
  if (!sessionId) return json({ error: 'Missing sessionId' }, 400);

  const { store, data } = await getSessionsStore();
  const session = data.sessions.find(s => s.id === sessionId);
  if (!session) return json({ error: 'Session not found' }, 404);

  const now = new Date();
  session.lastActiveAt = now.toISOString();
  session.pagesViewed = (session.pagesViewed || 0) + 1;
  session.duration = Math.round((now - new Date(session.startedAt)) / 1000);

  if (currentSlide && !session.slidesViewed.includes(currentSlide)) {
    session.slidesViewed.push(currentSlide);
  }

  await store.setJSON("sessions", data);
  return json({ ok: true });
}

// ── Route: List codes (admin) ──
async function listCodes() {
  const { store, data } = await getCodesStore();
  const codesData = await initDefaultCodes(store, data);
  return json({ codes: codesData.codes });
}

// ── Route: Create code (admin) ──
async function createCode(body) {
  const { code, label, maxUses, expiresAt } = body;
  if (!code || !label) return json({ error: 'Missing code or label' }, 400);

  const { store, data } = await getCodesStore();
  await initDefaultCodes(store, data);

  // Generate hash (server-side)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(code.toLowerCase()));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Check duplicate
  if (data.codes.find(c => c.hash === hashHex)) {
    return json({ error: 'Code already exists' }, 409);
  }

  const newCode = {
    id: code.toLowerCase(),
    code,
    hash: hashHex,
    label,
    status: 'active',
    maxUses: maxUses || null,
    expiresAt: expiresAt || null,
    createdAt: new Date().toISOString(),
    usageCount: 0
  };

  data.codes.push(newCode);
  await store.setJSON("codes", data);
  return json({ ok: true, code: newCode }, 201);
}

// ── Route: Update code (admin) ──
async function updateCode(body) {
  const { id, label, status, maxUses, expiresAt } = body;
  if (!id) return json({ error: 'Missing id' }, 400);

  const { store, data } = await getCodesStore();
  await initDefaultCodes(store, data);

  const entry = data.codes.find(c => c.id === id);
  if (!entry) return json({ error: 'Code not found' }, 404);

  if (label !== undefined) entry.label = label;
  if (status !== undefined) entry.status = status;
  if (maxUses !== undefined) entry.maxUses = maxUses;
  if (expiresAt !== undefined) entry.expiresAt = expiresAt;
  entry.updatedAt = new Date().toISOString();

  await store.setJSON("codes", data);
  return json({ ok: true, code: entry });
}

// ── Route: Delete code (admin) ──
async function deleteCode(body) {
  const { id } = body;
  if (!id) return json({ error: 'Missing id' }, 400);

  const { store, data } = await getCodesStore();
  await initDefaultCodes(store, data);

  const idx = data.codes.findIndex(c => c.id === id);
  if (idx === -1) return json({ error: 'Code not found' }, 404);

  data.codes.splice(idx, 1);
  await store.setJSON("codes", data);
  return json({ ok: true });
}

// ── Route: Get logs (admin) ──
async function getLogs() {
  const { data } = await getLogsStore();
  return json({ logs: data.logs.slice().reverse() });
}

// ── Route: Get sessions (admin) ──
async function getSessions() {
  const { data } = await getSessionsStore();
  return json({ sessions: data.sessions.slice().reverse() });
}

// ── Route: Get dashboard stats (admin) ──
async function getDashboard() {
  const { store: cStore, data: cData } = await getCodesStore();
  await initDefaultCodes(cStore, cData);
  const { data: lData } = await getLogsStore();
  const { data: sData } = await getSessionsStore();

  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const recentLogs = lData.logs.filter(l => new Date(l.timestamp) > thirtyDaysAgo);
  const recentSessions = sData.sessions.filter(s => new Date(s.startedAt) > thirtyDaysAgo);

  // Active sessions (last heartbeat < 5 min ago)
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);
  const activeSessions = sData.sessions.filter(s => new Date(s.lastActiveAt) > fiveMinAgo);

  // Usage by code
  const usageByCode = {};
  recentLogs.forEach(l => {
    usageByCode[l.code] = (usageByCode[l.code] || 0) + 1;
  });

  // Average duration
  const durations = recentSessions.filter(s => s.duration > 0).map(s => s.duration);
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Slides popularity
  const slideCounts = {};
  recentSessions.forEach(s => {
    (s.slidesViewed || []).forEach(sl => {
      slideCounts[sl] = (slideCounts[sl] || 0) + 1;
    });
  });

  // Daily visits (last 30 days)
  const dailyVisits = {};
  recentLogs.forEach(l => {
    const day = l.timestamp.slice(0, 10);
    dailyVisits[day] = (dailyVisits[day] || 0) + 1;
  });

  return json({
    totalCodes: cData.codes.length,
    activeCodes: cData.codes.filter(c => c.status === 'active').length,
    totalVisits30d: recentLogs.length,
    totalSessions30d: recentSessions.length,
    activeSessions: activeSessions.length,
    avgDuration,
    usageByCode,
    slideCounts,
    dailyVisits,
    codes: cData.codes
  });
}

// ── Main handler ──
export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';

  // Admin authentication check for protected routes
  const adminRoutes = ['/codes', '/codes/create', '/codes/update', '/codes/delete', '/logs', '/sessions', '/dashboard'];
  if (adminRoutes.includes(path)) {
    const token = req.headers.get('x-admin-token');
    if (token !== ADMIN_HASH) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  try {
    // Parse body for POST/PUT/DELETE
    let body = {};
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      try { body = await req.json(); } catch { body = {}; }
    }

    switch (path) {
      case '/verify':
        return await verifyCode(body, req.headers);
      case '/heartbeat':
        return await heartbeat(body);
      case '/codes':
        return await listCodes();
      case '/codes/create':
        return await createCode(body);
      case '/codes/update':
        return await updateCode(body);
      case '/codes/delete':
        return await deleteCode(body);
      case '/logs':
        return await getLogs();
      case '/sessions':
        return await getSessions();
      case '/dashboard':
        return await getDashboard();
      default:
        return json({ error: 'Not found', path }, 404);
    }
  } catch (err) {
    console.error('API Error:', err);
    return json({ error: 'Internal server error', message: err.message }, 500);
  }
};

export const config = {
  path: "/api/*"
};
