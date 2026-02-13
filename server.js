const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// static files (index.html)
app.use(express.static(__dirname));

/**
 * In-memory SMS inbox
 * record shape:
 * {
 *   id: string,
 *   ts: number, // arrival time (ms) -> always newest-on-top by arrival
 *   parts: { time: string, from: string, to: string, text: string }
 * }
 */
const messages = [];
const MAX_MESSAGES = 1000;

function safeStr(v) {
  return (v === undefined || v === null) ? '' : String(v);
}

function parseSmsTime(any) {
  if (any === undefined || any === null || any === '') return Date.now();

  if (typeof any === 'number') {
    return any < 1e12 ? Math.floor(any * 1000) : Math.floor(any);
  }

  const s = String(any).trim();

  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
  }

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}

function extractFirstPhoneLike(text) {
  const s = safeStr(text);
  const m = s.match(/(\+?88)?0?1\d{9}/);
  return m ? m[0] : '';
}

function parseIncomingSMS(body) {
  const text = safeStr(
    body.text ?? body.message ?? body.body ?? body.sms ?? body.key ?? body.msg ?? body.content
  );

  const from = safeStr(
    body.from ?? body.sender ?? body.number ?? body.mobile ?? body.phone ?? body.originatingAddress ?? body.address
  ) || extractFirstPhoneLike(text);

  const to = safeStr(body.to ?? body.receiver ?? body.destination ?? '');

  const timeRaw = body.time ?? body.timestamp ?? body.date ?? body.datetime ?? body.sentAt ?? body.receivedAt;
  const smsTs = parseSmsTime(timeRaw);

  // display time uses SMS time if provided
  const time = new Date(smsTs).toISOString();

  // ordering uses ARRIVAL time so newest received always goes top
  const arrivalTs = Date.now();

  return { ts: arrivalTs, parts: { time, from, to, text } };
}

function addMessage(rec) {
  messages.push(rec);
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }
}

function deleteMessageById(id) {
  const idx = messages.findIndex(m => m.id === id);
  if (idx === -1) return false;
  messages.splice(idx, 1);
  return true;
}

// receive SMS
app.post('/sms', (req, res) => {
  try {
    const parsed = parseIncomingSMS(req.body || {});
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const rec = { id, ...parsed };

    addMessage(rec);

    io.emit('sms:new', rec);

    console.log('Processed SMS:', { id, from: rec.parts.from, arrivalTs: rec.ts });
    res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('Failed to process /sms:', err);
    res.status(400).json({ success: false, error: 'Invalid SMS payload' });
  }
});

// list inbox
app.get('/api/messages', (req, res) => {
  res.json(messages);
});

// delete single
app.delete('/api/messages/:id', (req, res) => {
  const id = req.params.id;
  const ok = deleteMessageById(id);
  if (ok) io.emit('sms:delete', { id });
  res.status(200).json({ success: true, deleted: ok });
});

// optional: clear all
app.delete('/api/messages', (req, res) => {
  const count = messages.length;
  messages.length = 0;
  io.emit('sms:init', messages);
  res.status(200).json({ success: true, cleared: count });
});

// UI
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.emit('sms:init', messages);
  socket.on('disconnect', () => console.log('A user disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
