# Running FollowCam Locally with Self-Hosted Signaling

## 🚀 Quick Start

### 1. Start the Signaling Server
```bash
cd /Users/kaustubhdurgde/piyu-projects/FollowCam
node signaling-server.js
```
You should see:
```
🚀 FollowCam Signaling Server running on ws://localhost:8443
📡 Waiting for connections...
```

### 2. Start the Web Server (in a new terminal)
```bash
cd /Users/kaustubhdurgde/piyu-projects/FollowCam/docs
python3 -m http.server 8081
```

### 3. Test Locally

**On your Mac:**
- Open `http://localhost:8081` in two browser tabs
- Tab 1 (Sender): Enter session ID `test123`, click "Send" → "GO LIVE"
- Tab 2 (Viewer): Enter session ID `test123`, click "View"
- You should see the webcam feed!

**Watch the signaling server terminal** - you'll see:
```
✅ New connection: <uuid1>
→ Sent UUID to <uuid1>
🎥 Sender <uuid1> seeding stream: test123
✅ New connection: <uuid2>
→ Sent UUID to <uuid2>
📺 Viewer <uuid2> requesting stream: test123
→ Asking sender <uuid1> to create offer for <uuid2>
🔄 Relay messages...
```

## 📱 Testing with iPhone (same WiFi)

### 1. Find your Mac's IP address:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```
Look for something like `192.168.1.x`

### 2. Open on iPhone Safari:
```
http://192.168.1.x:8081
```

### 3. Use localtunnel for HTTPS (required for camera):
```bash
# In a new terminal
npx localtunnel --port 8081
```
This will output something like:
```
your url is: https://random-words-here.loca.lt
```

**Use that HTTPS URL on your iPhone!** (Click "Click to Continue" on first visit)

**Note:** ngrok requires signup. Use localtunnel instead (no auth needed).

## 🌐 Deploy to Production

For GitHub Pages (or any HTTPS host), the code automatically falls back to `wss://wss.vdo.ninja:443`.

To use your own signaling server in production:
1. Deploy `signaling-server.js` to a server with WebSocket support
2. Get an SSL certificate (use Let's Encrypt)
3. Add `?wss=wss://your-server.com:443` to the URL

## 🔧 Troubleshooting

**Nothing happens after "GO LIVE"?**
- Check the signaling server terminal for connection logs
- Open browser console (F12) to see debug logs
- Make sure both sender and viewer use the SAME session ID

**"Address already in use" error?**
- Port 8443 or 8081 is taken
- Change the port: `PORT=9000 node signaling-server.js`
- Update the WSS_URL in `docs/followcam.js` to match

**iPhone can't access camera?**
- Must use HTTPS (use ngrok or localtunnel)
- Safari will ask for camera permission - allow it
