// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- Body parsers ---------- */
// অ্যাপ যে ফরম্যাটে পাঠায় (FormBody -> x-www-form-urlencoded)
app.use(bodyParser.urlencoded({ extended: false }));
// ভবিষ্যতে যদি JSON আসে
app.use(bodyParser.json());

// স্ট্যাটিক (ইচ্ছা করলে index.html সার্ভ করুন)
app.use(express.static(__dirname));

/* ---------- Helper: message বের করার ফাংশন ---------- */
function extractMessage(req) {
  // ১) নরমাল কেস: req.body.message
  if (req.body && typeof req.body === 'object' && 'message' in req.body) {
    return String(req.body.message || '');
  }

  // ২) কিছু হোস্টে (বা ভুল header এ) পুরো বডি একটাই key হয়ে আসে
  // যেমন: { "2025-11-10 13:17:54##+8801...##bd##0167...##Use ... code." : "" }
  if (req.body && typeof req.body === 'object') {
    const keys = Object.keys(req.body);
    if (keys.length === 1 && !('message' in req.body)) {
      return String(keys[0] || '');
    }
  }

  // পেলাম না
  return '';
}

/* ---------- আপনার মূল রুট ---------- */
app.post('/sms', (req, res) => {
  const raw = extractMessage(req);

  if (!raw) {
    console.log('No message received. headers=', req.headers, ' body=', req.body);
    // অ্যাপকে 200 দিলেও ‘successful’ না থাকলে সে “Failed: Upload” দেখাতে পারে
    return res.status(200).send('received but no message');
  }

  // অ্যাপ যে ফরম্যাটে পাঠায়: time##from##country##to##text
  const parts = raw.split('##');
  const [smsTime, from, country, to, text] = [
    parts[0] || '',
    parts[1] || '',
    parts[2] || '',
    parts[3] || '',
    parts.slice(4).join('##') || '' // টেক্সটে যদি নিজেই '##' থাকে, নিরাপদে জোড়া লাগালাম
  ];

  console.log('---- SMS FORWARDED ----');
  console.log('time   :', smsTime);
  console.log('from   :', from);
  console.log('country:', country);
  console.log('to     :', to);
  console.log('text   :', text);

  // TODO: এখানে চাইলে DB/save/webhook এ পাঠাতে পারেন

  // অ্যান্ড্রয়েড অ্যাপ OK ধরতে ‘successful’ টেক্সটই দিন
  res.status(200).send('successful');
});

/* ---------- Root পেজ (ঐচ্ছিক) ---------- */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
