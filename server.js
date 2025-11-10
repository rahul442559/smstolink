// server.js  — conflict-free, works with x-www-form-urlencoded / json / plain
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ❗ Use ONE body reader only (no urlencoded/json parsers)
app.use(express.text({ type: '*/*', limit: '1mb' }));

const received = [];

// helper: pull "message" out of whatever came
function extractMessage(raw) {
  if (!raw || typeof raw !== 'string') return '';

  // Try URL-encoded first (key=value&key2=...)
  try {
    const u = new URLSearchParams(raw);
    const m = u.get('message');
    if (m !== null) return String(m);
  } catch {}

  // Try JSON next
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && 'message' in o) return String(o.message ?? '');
  } catch {}

  // Fallback: treat whole raw body as message
  return raw;
}

function handleIncoming(req, res) {
  const raw = typeof req.body === 'string' ? req.body : '';
  const parsed = extractMessage(raw);
  const parts = parsed ? parsed.split('##') : [];

  const record = {
    ts: new Date().toISOString(),
    headers: req.headers,
    rawBody: raw,
    parsedMessage: parsed,
    parts: {
      time: parts[0] || '',
      from: parts[1] || '',
      country: parts[2] || '',
      to: parts[3] || '',
      text: parts.slice(4).join('##') || ''
    }
  };
  received.push(record);
  if (received.length > 200) received.shift();

  // ⚠️ Always reply with plain "successful" so your app shows success
  res.status(200).type('text/plain').send('successful');
}

// New endpoint you configured in the app
app.post('/sms', handleIncoming);

// Backward-compatible old PHP path (optional)
app.post('/android-sms/android-sms.php', handleIncoming);

// Simple viewer
app.get('/api/messages', (_req, res) => res.json(received.slice().reverse()));
app.delete('/api/messages', (_req, res) => { received.length = 0; res.json({ ok: true }); });

// Static + home
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));
