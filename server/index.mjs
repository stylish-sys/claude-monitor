import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import routes from './routes.mjs';
import { checkOfflineAgents, getAgents } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.MONITOR_PORT || 7777;

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: { origin: '*' }
});

// Make io accessible in routes
app.set('io', io);

// Middleware
app.use(express.json({ limit: '10mb' }));

// Static files
app.use(express.static(join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send current agent states on connect
  socket.emit('init', { agents: getAgents() });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Heartbeat: check for offline agents every 15 seconds
setInterval(() => {
  const changes = checkOfflineAgents(60000);
  if (changes.changes > 0) {
    io.emit('agents_refresh', { agents: getAgents() });
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`\n  Claude Monitor Dashboard`);
  console.log(`  ========================`);
  console.log(`  Server:    http://127.0.0.1:${PORT}`);
  console.log(`  WebSocket: ws://127.0.0.1:${PORT}`);
  console.log(`  API:       http://127.0.0.1:${PORT}/api\n`);
});
