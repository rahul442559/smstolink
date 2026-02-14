const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// মেসেজ স্টোরেজ - প্রতিটি মেসেজের জন্য TTL টাইমার সহ
let messages = []; // { id, message, to, time, expiresAt, timer }
const TTL_MS = 3 * 60 * 1000; // ৩ মিনিট

// Generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// মেসেজ অটো-ডিলিট করার ফাংশন
function scheduleMessageDeletion(messageId) {
  const msgIndex = messages.findIndex(m => m.id === messageId);
  if (msgIndex === -1) return;

  // আগের টাইমার থাকলে ক্লিয়ার করি
  if (messages[msgIndex].timer) {
    clearTimeout(messages[msgIndex].timer);
  }

  // নতুন টাইমার সেট করি
  const timer = setTimeout(() => {
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      messages.splice(index, 1);
      io.emit('delete', { id: messageId, reason: 'expired' });
      console.log(`Message ${messageId} auto-removed after 3 minutes.`);
    }
  }, TTL_MS);

  messages[msgIndex].timer = timer;
  messages[msgIndex].expiresAt = Date.now() + TTL_MS;
}

// SMS রিসিভ
app.post('/sms', (req, res) => {
  const message = req.body.key || 'No message received';
  const to = req.body.to || req.body.sender || 'Unknown';
  const time = req.body.time || new Date().toISOString();

  // নতুন মেসেজ তৈরি
  const newMessage = {
    id: generateId(),
    message,
    to,
    time,
    receivedAt: new Date().toISOString()
  };

  // স্টোর করুন
  messages.push(newMessage);
  scheduleMessageDeletion(newMessage.id);

  console.log('New SMS received:', { message, to, time, id: newMessage.id });

  // সকল ক্লায়েন্টকে নতুন মেসেজ পাঠান
  io.emit('new', newMessage);

  res.status(200).json({ 
    success: true, 
    message: 'SMS received successfully', 
    id: newMessage.id,
    expiresIn: '3 minutes'
  });
});

// সব মেসেজ দেখুন (API)
app.get('/api/messages', (req, res) => {
  // টাইমার ছাড়া মেসেজ ডেটা পাঠাই (timer প্রপার্টি বাদ দিয়ে)
  const messagesWithoutTimer = messages.map(({ timer, ...msg }) => msg);
  res.json(messagesWithoutTimer);
});

// নির্দিষ্ট মেসেজ ডিলিট
app.delete('/api/messages/:id', (req, res) => {
  const id = req.params.id;
  const index = messages.findIndex(m => m.id === id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Message not found' });
  }

  // টাইমার ক্লিয়ার করুন
  if (messages[index].timer) {
    clearTimeout(messages[index].timer);
  }

  // মেসেজ রিমুভ করুন
  messages.splice(index, 1);
  
  // সব ক্লায়েন্টকে জানান
  io.emit('delete', { id });

  console.log(`Message ${id} deleted by user.`);
  res.json({ success: true, message: 'Message deleted' });
});

// ফallback ডিলিট API
app.post('/api/messages/:id/delete', (req, res) => {
  const id = req.params.id;
  const index = messages.findIndex(m => m.id === id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Message not found' });
  }

  if (messages[index].timer) {
    clearTimeout(messages[index].timer);
  }

  messages.splice(index, 1);
  io.emit('delete', { id });

  res.json({ success: true, message: 'Message deleted (fallback)' });
});

// UI সার্ভ করুন
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Socket.IO কানেকশন
io.on('connection', (socket) => {
  console.log('Client connected');

  // টাইমার ছাড়া সব মেসেজ পাঠাই (reverse করে যাতে লেটেস্ট শেষে থাকে, UI reverse করবে)
  const messagesWithoutTimer = messages.map(({ timer, ...msg }) => msg);
  socket.emit('init', messagesWithoutTimer);

  socket.on('disconnect', () => console.log('Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
