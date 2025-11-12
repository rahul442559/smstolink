// server.js — SMS receiver with SSE auto-push & per-message delete
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- One body reader (avoid conflicts) ----
app.use(express.text({ type: '*/*', limit: '1mb' }));

// ---- In-memory store ----
let NEXT_ID = 1;
const store = []; // { id, tsIso, parts:{ time, to, text } }

// ---- SSE clients ----
const clients = new Set(); // each is { id, res }

// ---- Helpers ----
function extractMessage(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // urlencoded
  try {
    const u = new URLSearchParams(raw);
    const m = u.get('message');
    if (m !== null) return String(m);
  } catch {}
  // json
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && 'message' in o) return String(o.message ?? '');
  } catch {}
  // plain text fallback
  return String(raw);
}

function extractTo(raw) {
  // optional “to” parsing if forwarded as JSON/urlencoded
  try {
    const u = new URLSearchParams(raw);
    const t = u.get('to');
    if (t) return String(t);
  } catch {}
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && 'to' in o) return String(o.to ?? '');
  } catch {}
  return '';
}

function pushAndBroadcast(rec) {
  store.push(rec);
  // broadcast 'new'
  const data = `data: ${JSON.stringify({ type: 'new', data: rec })}\n\n`;
  for (const { res } of clients) res.write(data);
}

// ---- REST: list all messages (raw order) ----
app.get('/api/messages', (_req, res) => {
  res.json(store);
});

// ---- REST: delete by id ----
app.delete('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = store.findIndex(x => x.id === id);
  if (idx !== -1) {
    store.splice(idx, 1);
    // broadcast 'delete'
    const data = `data: ${JSON.stringify({ type: 'delete', id })}\n\n`;
    for (const { res: r } of clients) r.write(data);
  }
  res.json({ ok: true });
});

// ---- Ingest endpoints (use either) ----
// 1) Generic “/api/messages” POST {message, to, time}
app.post('/api/messages', (req, res) => {
  const parsed = (() => { try { return JSON.parse(req.body) } catch { return {} } })();
  const text = String(parsed.text ?? parsed.message ?? '');
  const to = String(parsed.to ?? '');
  const time = String(parsed.time ?? new Date().toISOString());
  const rec = {
    id: NEXT_ID++,
    tsIso: new Date().toISOString(),
    parts: { time, to, text }
  };
  pushAndBroadcast(rec);
  res.json({ ok: true, id: rec.id });
});

// 2) SMS forwarder friendly “/sms” (form-urlencoded or JSON)
// accepts: message=...&to=...  OR  { "message": "...", "to": "..." }
app.post('/sms', (req, res) => {
  const text = extractMessage(req.body);
  const to = extractTo(req.body);
  const time = new Date().toISOString();
  const rec = {
    id: NEXT_ID++,
    tsIso: time,
    parts: { time, to, text }
  };
  pushAndBroadcast(rec);
  res.json({ ok: true, id: rec.id });
});

// ---- SSE stream ----
app.get('/events', (req, res) => {
  // headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client = { id: Date.now() + Math.random(), res };
  clients.add(client);

  // send initial list (client will sort newest→top)
  res.write(`data: ${JSON.stringify({ type: 'init', data: store })}\n\n`);

  // keep-alive ping
  const ping = setInterval(() => res.write(':\n\n'), 15000);

  req.on('close', () => { clearInterval(ping); clients.delete(client); });
});

// ---- Static site ----
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));
