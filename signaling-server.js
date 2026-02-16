#!/usr/bin/env node
/* FollowCam Signaling Server
   Minimal WebSocket server for routing WebRTC signaling messages
   Based on VDO.Ninja's signaling protocol */

const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8443;

const wss = new WebSocket.Server({ port: PORT });

// Track all connections: uuid → { ws, streamID, role }
const clients = new Map();

// Track streams: streamID → Set of viewer UUIDs
const streams = new Map();

console.log(`🚀 FollowCam Signaling Server running on ws://localhost:${PORT}`);
console.log(`📡 Waiting for connections...`);

wss.on('connection', (ws, req) => {
  const uuid = crypto.randomUUID();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  console.log(`✅ New connection: ${uuid} from ${ip}`);
  
  clients.set(uuid, { ws, streamID: null, role: null });
  
  // Send UUID assignment immediately
  send(ws, { UUID: uuid });
  console.log(`→ Sent UUID to ${uuid}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`📨 From ${uuid}:`, JSON.stringify(msg).substring(0, 100));
      handleMessage(uuid, msg);
    } catch (e) {
      console.error(`❌ Parse error from ${uuid}:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`❌ Disconnected: ${uuid}`);
    const client = clients.get(uuid);
    
    // Clean up stream tracking
    if (client?.streamID) {
      const viewers = streams.get(client.streamID);
      if (viewers) {
        viewers.delete(uuid);
        if (viewers.size === 0) streams.delete(client.streamID);
      }
    }
    
    clients.delete(uuid);
  });

  ws.on('error', (err) => {
    console.error(`⚠️  Error ${uuid}:`, err.message);
  });
});

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function handleMessage(fromUUID, msg) {
  const client = clients.get(fromUUID);
  if (!client) return;

  // SEED - Sender announces their stream
  if (msg.request === 'seed' && msg.streamID) {
    console.log(`🎥 Sender ${fromUUID} seeding stream: ${msg.streamID}`);
    client.streamID = msg.streamID;
    client.role = 'sender';
    
    // Notify any waiting viewers
    const viewers = streams.get(msg.streamID);
    if (viewers) {
      viewers.forEach(viewerUUID => {
        const viewer = clients.get(viewerUUID);
        if (viewer) {
          console.log(`→ Notifying sender to offer to viewer ${viewerUUID}`);
          send(client.ws, { UUID: viewerUUID, request: 'offerSDP' });
        }
      });
    }
    return;
  }

  // OFFER SDP - Viewer requests to watch a stream
  if (msg.request === 'offerSDP' && msg.streamID) {
    console.log(`📺 Viewer ${fromUUID} requesting stream: ${msg.streamID}`);
    client.streamID = msg.streamID;
    client.role = 'viewer';
    
    // Track this viewer
    if (!streams.has(msg.streamID)) {
      streams.set(msg.streamID, new Set());
    }
    streams.get(msg.streamID).add(fromUUID);
    
    // Find the sender
    const sender = Array.from(clients.entries()).find(
      ([_, c]) => c.streamID === msg.streamID && c.role === 'sender'
    );
    
    if (sender) {
      const [senderUUID, senderClient] = sender;
      console.log(`→ Asking sender ${senderUUID} to create offer for ${fromUUID}`);
      send(senderClient.ws, { UUID: fromUUID, request: 'offerSDP' });
    } else {
      console.log(`⏳ Sender not online yet for ${msg.streamID}, viewer queued`);
    }
    return;
  }

  // RELAY - Forward messages to target UUID (SDP, ICE candidates)
  if (msg.UUID) {
    const target = clients.get(msg.UUID);
    if (target) {
      // Swap UUID to sender's UUID
      const fwd = { ...msg, UUID: fromUUID };
      delete fwd.streamID; // Don't forward streamID in relay
      console.log(`🔄 Relay ${fromUUID} → ${msg.UUID}:`, Object.keys(fwd).join(','));
      send(target.ws, fwd);
    } else {
      console.warn(`⚠️  Target ${msg.UUID} not found`);
    }
    return;
  }

  console.log(`⚠️  Unhandled message from ${fromUUID}:`, Object.keys(msg).join(','));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  wss.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
