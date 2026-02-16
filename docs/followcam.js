/* FollowCam — WebRTC signaling & streaming engine
   Core WebRTC logic extracted & simplified from VDO.Ninja (AGPLv3)
   by Steve Seguin — https://github.com/steveseguin/vdo.ninja */

const FollowCam = (() => {
  "use strict";

  // ── Config ──────────────────────────────────────────────────
  const WSS_URL = "wss://wss.vdo.ninja:443";

  const STUN_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }
  ];

  // 2K 60fps constraints tuned for iPhone Safari
  const VIDEO_CONSTRAINTS_SAFARI = {
    width:  { min: 1280, ideal: 2560 },
    height: { min: 720,  ideal: 1440 },
    frameRate: { ideal: 60, max: 60 },
    facingMode: { ideal: "environment" }
  };
  const VIDEO_CONSTRAINTS_DEFAULT = {
    width:  { min: 1280, ideal: 2560, max: 2560 },
    height: { min: 720,  ideal: 1440, max: 1440 },
    frameRate: { ideal: 60, max: 60 },
    facingMode: { ideal: "environment" }
  };

  const AUDIO_CONSTRAINTS = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 48000,
    channelCount: 2
  };

  const TARGET_BITRATE_KBPS = 12000; // 12 Mbps for 2K60
  const CONTENT_HINT = "detail";      // optimize for sharpness over motion smoothing
  const DEGRADATION_PREF = "maintain-resolution"; // keep pixels, drop FPS if needed

  // ── State ───────────────────────────────────────────────────
  let ws = null;
  let localStream = null;
  let peerConnections = {};  // uuid → RTCPeerConnection
  let myUUID = crypto.randomUUID();
  let myStreamID = null;
  let myRole = null; // "sender" or "viewer"
  let iceCandidateBuffer = {}; // uuid → [candidates]

  // callbacks set by page code
  let onStatusChange = () => {};
  let onRemoteStream = () => {};
  let onStatsUpdate = () => {};
  let onError = () => {};

  // ── Helpers ─────────────────────────────────────────────────
  const isSafari = () => {
    const ua = navigator.userAgent;
    return /Safari/.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua);
  };

  const log = (...args) => console.log("[FollowCam]", ...args);
  const warn = (...args) => console.warn("[FollowCam]", ...args);
  const err = (...args) => console.error("[FollowCam]", ...args);

  function generateStreamID(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    let id = "";
    for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  // ── ICE Configuration ──────────────────────────────────────
  function getIceConfig() {
    return { iceServers: [...STUN_SERVERS], iceCandidatePoolSize: 2 };
  }

  // ── WebSocket Signaling ────────────────────────────────────
  function connectSignaling(streamID, role) {
    myStreamID = streamID;
    myRole = role;

    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      onStatusChange("connecting");
      log("Connecting to signaling server:", WSS_URL);
      
      // Timeout if server doesn't respond in 10s
      const connectTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          err("Connection timeout - server not responding");
          onError("Connection timeout. Check your internet connection.");
          ws.close();
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      ws = new WebSocket(WSS_URL);
      
      ws.onerror = (e) => {
        clearTimeout(connectTimeout);
        err("WebSocket error:", e);
        onError("Cannot connect to signaling server. Check network.");
        reject(e);
      };

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        log("✓ WebSocket OPEN, readyState:", ws.readyState);
        onStatusChange("connecting");
        
        // IMMEDIATELY try sending (don't wait for UUID)
        setTimeout(() => {
          log("🔥 Fallback timeout fired! Sending request...");
          if (myRole === "sender") {
            const msg = { request: "seed", streamID: myStreamID };
            log("→ Sending seed:", JSON.stringify(msg));
            ws.send(JSON.stringify(msg));
          } else if (myRole === "viewer") {
            const msg = { request: "offerSDP", streamID: myStreamID };
            log("→ Sending offerSDP:", JSON.stringify(msg));
            ws.send(JSON.stringify(msg));
          }
        }, 1000); // Try after just 1 second
        
        resolve();
      };

      ws.onmessage = (evt) => {
        log("🔵 RAW MESSAGE RECEIVED!");
        log("← RAW data:", evt.data);
        try {
          const msg = JSON.parse(evt.data);
          log("← Parsed:", JSON.stringify(msg).substring(0, 300));
          handleSignalingMessage(msg);
        } catch (e) {
          warn("❌ Parse error:", e.message, "Data:", evt.data);
        }
      };

      ws.onclose = (e) => {
        log("WebSocket closed:", e.code, e.reason);
        onStatusChange("disconnected");
        // Auto-reconnect after 3s
        setTimeout(() => {
          if (myStreamID) {
            log("Reconnecting...");
            connectSignaling(myStreamID, myRole).catch(err);
          }
        }, 3000);
      };
    });
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      log("→ Sending:", JSON.stringify(obj).substring(0, 200));
      ws.send(JSON.stringify(obj));
    } else {
      warn("Cannot send, WebSocket not ready:", ws?.readyState);
    }
  }

  // ── Signaling Message Handler ──────────────────────────────
  function handleSignalingMessage(msg) {
    log("Processing message type:", typeof msg, "Keys:", Object.keys(msg).join(","));
    
    // If no UUID assigned yet and message contains a UUID, assume it's our assignment
    if (!myUUID && msg.UUID) {
      myUUID = msg.UUID;
      log("✓ Server assigned UUID:", myUUID);
      onStatusChange("connected");

      // Now send our request
      if (myRole === "sender") {
        wsSend({ request: "seed", streamID: myStreamID });
        log("✓ Seeded stream:", myStreamID);
      } else if (myRole === "viewer") {
        wsSend({ request: "offerSDP", streamID: myStreamID });
        log("✓ Requesting stream:", myStreamID);
      }
      return;
    }
    
    // If we still don't have UUID after 2s, send request anyway
    if (!myUUID) {
      warn("No UUID received yet, sending request anyway...");
      if (myRole === "sender") {
        wsSend({ request: "seed", streamID: myStreamID });
      } else if (myRole === "viewer") {
        wsSend({ request: "offerSDP", streamID: myStreamID });
      }
      return;
    }

    const remoteUUID = msg.UUID || msg.from;

    // Viewer receives an offer from the sender
    if (msg.description && msg.description.type === "offer" && myRole === "viewer") {
      log("Received offer from", remoteUUID);
      handleOffer(remoteUUID, msg.description);
    }

    // Sender receives an answer from the viewer
    if (msg.description && msg.description.type === "answer" && myRole === "sender") {
      log("Received answer from", remoteUUID);
      handleAnswer(remoteUUID, msg.description);
    }

    // Sender is asked to create an offer (viewer joined)
    if (msg.request === "offerSDP" && myRole === "sender") {
      log("Viewer requesting stream, creating offer for:", remoteUUID);
      createOfferForViewer(remoteUUID);
    }

    // ICE candidates
    if (msg.candidate) {
      handleRemoteCandidate(remoteUUID, msg.candidate);
    }
    if (msg.candidates) {
      msg.candidates.forEach(c => handleRemoteCandidate(remoteUUID, c));
    }
  }

  // ── Camera Capture ─────────────────────────────────────────
  async function startCamera() {
    const constraints = {
      video: isSafari() ? VIDEO_CONSTRAINTS_SAFARI : VIDEO_CONSTRAINTS_DEFAULT,
      audio: AUDIO_CONSTRAINTS
    };

    log("Requesting camera with constraints:", JSON.stringify(constraints, null, 2));

    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Set content hints for quality optimization
      localStream.getVideoTracks().forEach(track => {
        if ("contentHint" in track) {
          track.contentHint = CONTENT_HINT;
          log("Set video contentHint:", CONTENT_HINT);
        }
        log("Video track settings:", JSON.stringify(track.getSettings()));
      });

      return localStream;
    } catch (e) {
      err("getUserMedia failed:", e);
      // Fallback: try lower resolution
      warn("Falling back to 1080p60...");
      try {
        const fallback = {
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60, max: 60 },
            facingMode: { ideal: "environment" }
          },
          audio: AUDIO_CONSTRAINTS
        };
        localStream = await navigator.mediaDevices.getUserMedia(fallback);
        localStream.getVideoTracks().forEach(t => {
          if ("contentHint" in t) t.contentHint = CONTENT_HINT;
        });
        return localStream;
      } catch (e2) {
        err("Fallback also failed:", e2);
        onError("Camera access denied or unavailable");
        throw e2;
      }
    }
  }

  // ── Peer Connection ────────────────────────────────────────
  function createPeerConnection(remoteUUID) {
    if (peerConnections[remoteUUID]) {
      peerConnections[remoteUUID].close();
    }

    const pc = new RTCPeerConnection(getIceConfig());
    peerConnections[remoteUUID] = pc;

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        wsSend({
          candidate: evt.candidate.toJSON(),
          UUID: remoteUUID,
          streamID: myStreamID
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      log("ICE state:", pc.iceConnectionState, "for", remoteUUID);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        onStatusChange("streaming");
      } else if (pc.iceConnectionState === "failed") {
        onStatusChange("failed");
        onError("Connection failed — check network");
      } else if (pc.iceConnectionState === "disconnected") {
        onStatusChange("disconnected");
      }
    };

    pc.ontrack = (evt) => {
      log("Remote track received:", evt.track.kind);
      if (evt.streams && evt.streams[0]) {
        onRemoteStream(evt.streams[0]);
      }
    };

    // Start stats polling
    startStatsPolling(remoteUUID, pc);

    return pc;
  }

  // ── Sender: Create Offer ──────────────────────────────────
  async function createOfferForViewer(remoteUUID) {
    if (!remoteUUID) {
      err("No remote UUID for createOffer");
      return;
    }
    const pc = createPeerConnection(remoteUUID);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);

        // Optimize video encoding for 2K60
        if (track.kind === "video") {
          setTimeout(() => optimizeSender(sender), 1000);
        }
      });
    }

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });

      // Modify SDP for higher bitrate
      offer.sdp = enhanceSDP(offer.sdp);

      await pc.setLocalDescription(offer);

      const offerMsg = {
        description: pc.localDescription.toJSON(),
        UUID: remoteUUID,
        streamID: myStreamID
      };
      wsSend(offerMsg);
      log("Offer sent to:", remoteUUID, "SDP type:", offerMsg.description.type);

      // Flush buffered ICE candidates
      flushCandidates(remoteUUID);
    } catch (e) {
      err("createOffer failed:", e);
    }
  }

  // ── Viewer: Handle Offer ──────────────────────────────────
  async function handleOffer(remoteUUID, description) {
    const pc = createPeerConnection(remoteUUID);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(description));

      const answer = await pc.createAnswer();
      answer.sdp = enhanceSDP(answer.sdp);
      await pc.setLocalDescription(answer);

      const answerMsg = {
        description: pc.localDescription.toJSON(),
        UUID: remoteUUID,
        streamID: myStreamID
      };
      wsSend(answerMsg);
      log("Answer sent to:", remoteUUID, "SDP type:", answerMsg.description.type);

      // Flush buffered ICE candidates
      flushCandidates(remoteUUID);
    } catch (e) {
      err("handleOffer failed:", e);
    }
  }

  // ── Sender: Handle Answer ─────────────────────────────────
  async function handleAnswer(remoteUUID, description) {
    const pc = peerConnections[remoteUUID];
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(description));
      log("Remote description set for:", remoteUUID);
      flushCandidates(remoteUUID);
    } catch (e) {
      err("handleAnswer failed:", e);
    }
  }

  // ── ICE Candidate Handling ─────────────────────────────────
  function handleRemoteCandidate(remoteUUID, candidate) {
    const pc = peerConnections[remoteUUID];
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        warn("addIceCandidate error:", e);
      });
    } else {
      // Buffer until remote description is set
      if (!iceCandidateBuffer[remoteUUID]) iceCandidateBuffer[remoteUUID] = [];
      iceCandidateBuffer[remoteUUID].push(candidate);
    }
  }

  function flushCandidates(remoteUUID) {
    const pc = peerConnections[remoteUUID];
    const buf = iceCandidateBuffer[remoteUUID];
    if (pc && pc.remoteDescription && buf) {
      buf.forEach(c => {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(warn);
      });
      iceCandidateBuffer[remoteUUID] = [];
    }
  }

  // ── Encoding Optimization ──────────────────────────────────
  function optimizeSender(sender) {
    if (!sender || !sender.getParameters) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      // Set max bitrate (kbps → bps)
      params.encodings[0].maxBitrate = TARGET_BITRATE_KBPS * 1000;

      // Don't scale down resolution
      params.encodings[0].scaleResolutionDownBy = 1;

      // Prioritize resolution over framerate
      params.degradationPreference = DEGRADATION_PREF;

      sender.setParameters(params).then(() => {
        log("Sender optimized: bitrate=" + TARGET_BITRATE_KBPS + "kbps, degradation=" + DEGRADATION_PREF);
      }).catch(e => warn("setParameters failed:", e));
    } catch (e) {
      warn("optimizeSender error:", e);
    }
  }

  // ── SDP Enhancement ────────────────────────────────────────
  function enhanceSDP(sdp) {
    // Boost video bandwidth in SDP
    // Replace any existing b=AS line or add one
    if (sdp.includes("m=video")) {
      const lines = sdp.split("\r\n");
      const enhanced = [];
      let inVideo = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("m=video")) {
          inVideo = true;
          enhanced.push(line);
          continue;
        }
        if (line.startsWith("m=") && !line.startsWith("m=video")) {
          inVideo = false;
        }

        // Skip existing bandwidth lines in video section
        if (inVideo && line.startsWith("b=AS:")) continue;
        if (inVideo && line.startsWith("b=TIAS:")) continue;

        enhanced.push(line);

        // Add bandwidth after c= line in video section
        if (inVideo && line.startsWith("c=IN")) {
          enhanced.push("b=AS:" + TARGET_BITRATE_KBPS);
        }
      }
      sdp = enhanced.join("\r\n");
    }
    return sdp;
  }

  // ── Stats Polling ──────────────────────────────────────────
  let statsInterval = null;

  function startStatsPolling(uuid, pc) {
    if (statsInterval) clearInterval(statsInterval);

    statsInterval = setInterval(async () => {
      if (pc.connectionState === "closed") {
        clearInterval(statsInterval);
        return;
      }
      try {
        const stats = await pc.getStats();
        const report = parseStats(stats);
        onStatsUpdate(report);
      } catch (e) { /* ignore */ }
    }, 2000);
  }

  function parseStats(stats) {
    const report = {
      resolution: "—",
      fps: "—",
      bitrate: "—",
      codec: "—",
      rtt: "—",
      jitter: "—",
      packetsLost: 0
    };

    let prevBytes = parseStats._prevBytes || 0;
    let prevTime = parseStats._prevTime || 0;

    stats.forEach(s => {
      // Inbound (viewer side)
      if (s.type === "inbound-rtp" && s.kind === "video") {
        if (s.frameWidth) report.resolution = s.frameWidth + "×" + s.frameHeight;
        if (s.framesPerSecond) report.fps = Math.round(s.framesPerSecond);
        report.packetsLost = s.packetsLost || 0;
        if (s.jitter) report.jitter = (s.jitter * 1000).toFixed(1) + "ms";

        const now = Date.now();
        const bytes = s.bytesReceived || 0;
        if (prevTime > 0) {
          const dt = (now - prevTime) / 1000;
          const db = bytes - prevBytes;
          report.bitrate = ((db * 8) / dt / 1000).toFixed(0) + " kbps";
        }
        parseStats._prevBytes = bytes;
        parseStats._prevTime = now;
      }

      // Outbound (sender side)
      if (s.type === "outbound-rtp" && s.kind === "video") {
        if (s.frameWidth) report.resolution = s.frameWidth + "×" + s.frameHeight;
        if (s.framesPerSecond) report.fps = Math.round(s.framesPerSecond);

        const now = Date.now();
        const bytes = s.bytesSent || 0;
        if (prevTime > 0) {
          const dt = (now - prevTime) / 1000;
          const db = bytes - prevBytes;
          report.bitrate = ((db * 8) / dt / 1000).toFixed(0) + " kbps";
        }
        parseStats._prevBytes = bytes;
        parseStats._prevTime = now;
      }

      if (s.type === "codec" && s.mimeType && s.mimeType.startsWith("video/")) {
        report.codec = s.mimeType.replace("video/", "");
      }

      if (s.type === "candidate-pair" && s.state === "succeeded") {
        if (s.currentRoundTripTime) {
          report.rtt = (s.currentRoundTripTime * 1000).toFixed(0) + "ms";
        }
      }
    });

    return report;
  }

  // ── Cleanup ────────────────────────────────────────────────
  function disconnect() {
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    iceCandidateBuffer = {};

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }

    if (statsInterval) clearInterval(statsInterval);
    myStreamID = null;
    onStatusChange("disconnected");
    log("Disconnected");
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    // Config
    generateStreamID,

    // Lifecycle
    connectSignaling,
    startCamera,
    disconnect,

    // Callbacks
    set onStatusChange(fn) { onStatusChange = fn; },
    set onRemoteStream(fn) { onRemoteStream = fn; },
    set onStatsUpdate(fn)  { onStatsUpdate = fn; },
    set onError(fn)        { onError = fn; },

    // State
    get localStream() { return localStream; },
    get streamID()    { return myStreamID; },
    get uuid()        { return myUUID; },
    get connected()   { return ws && ws.readyState === WebSocket.OPEN; }
  };
})();
