# FollowCam

A lightweight, high-quality WebRTC streaming solution for iPhone to browser. Stream 2K 60fps video from your iPhone's camera directly to any web browser.

**Built by frankensteining [VDO.Ninja](https://vdo.ninja)'s WebRTC core** (AGPLv3) by Steve Seguin.

## 🚀 Quick Start

**Live Demo:** https://kaustubhdurgde.github.io/FollowCam/docs/

1. Open the website on both devices
2. Enter a session ID (or use random)
3. **iPhone**: Tap "Send" → "GO LIVE"
4. **PC/Viewer**: Click "View" with same session ID

## ✨ Features

- **2K 60fps streaming** — Optimized for iPhone Safari rear camera
- **Zero server setup** — Uses VDO.Ninja's public signaling infrastructure
- **Peer-to-peer** — Low latency WebRTC connections
- **Real-time stats** — Resolution, FPS, bitrate, RTT, jitter monitoring
- **Mobile optimized** — Wake Lock, fullscreen, theater mode

## 🎯 Use Cases

- Remote camera monitoring
- Live streaming production
- Event coverage
- Video conferencing
- Content creation

## 📱 Requirements

- **Sender**: iPhone with Safari (iOS 14.3+)
- **Viewer**: Any modern browser (Chrome, Firefox, Safari, Edge)
- **HTTPS required** for camera access (GitHub Pages provides this)

## 🛠️ Technology

- WebRTC (RTCPeerConnection)
- getUserMedia API with 2K60 constraints
- VDO.Ninja signaling server (wss://wss.vdo.ninja:443)
- STUN servers (Google, Cloudflare)
- Optimized encoding: 12Mbps bitrate, maintain-resolution degradation

## 📄 License

This project frankenstein's code from **[VDO.Ninja](https://github.com/steveseguin/vdo.ninja)**, which is licensed under **AGPLv3**. Therefore, FollowCam is also distributed under the **[AGPLv3 License](https://www.gnu.org/licenses/agpl-3.0.en.html)**.

Huge thanks to [Steve Seguin](https://github.com/steveseguin) for building VDO.Ninja and making it open source.

## 🔧 Development

```bash
# Clone the repo
git clone https://github.com/kaustubhdurgde/FollowCam.git
cd FollowCam

# Serve locally (requires HTTPS for camera on iPhone)
cd docs
python3 -m http.server 8080
# Open http://localhost:8080
```

## 🌐 Deploy Your Own

1. Fork this repo
2. Enable GitHub Pages in Settings → Pages
3. Set source to `main` branch, `/docs` folder
4. Your site will be at `https://yourusername.github.io/FollowCam/docs/`

---

Built with ❤️ by extracting the essential WebRTC magic from VDO.Ninja
