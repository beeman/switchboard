const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const connectBtn = document.querySelector("#connect");
const talkBtn = document.querySelector("#talk");
const form = document.querySelector("#say");
const textInput = document.querySelector("#text");
const sendBtn = form.querySelector("button");

const MIC_RATE = 16000;
const MIC_FRAME = 960;

let socket = null;
let sessionId = "";
let speaking = false;
let recording = false;
let playbackRate = 24000;
let playAt = 0;
let playNodes = [];
let audioCtx = null;
let encoder = null;
let decoder = null;
let pcmCarry = new Int16Array(0);
let micRate = MIC_RATE;
let micReady = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function addLine(role, text) {
  const item = document.createElement("li");
  const who = document.createElement("span");
  who.className = role;
  who.textContent = role === "you" ? "You: " : "Switchboard: ";
  item.append(who, document.createTextNode(text));
  logEl.append(item);
  logEl.scrollTop = logEl.scrollHeight;
}

function id(key, make) {
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const value = make();
  localStorage.setItem(key, value);
  return value;
}

function mac() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  bytes[0] = (bytes[0] | 2) & 0xfe;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(":");
}

const deviceId = id("switchboard-device-id", mac);
const clientId = id("switchboard-client-id", () => crypto.randomUUID());

function opus() {
  if (typeof Module === "undefined") throw new Error("Opus codec failed to load");
  if (Module.instance && Module.instance._opus_decoder_get_size) return Module.instance;
  if (typeof Module._opus_decoder_get_size === "function") return Module;
  throw new Error("Opus codec failed to load");
}

function makeEncoder() {
  const mod = opus();
  const size = mod._opus_encoder_get_size(1);
  const ptr = mod._malloc(size);
  const err = mod._opus_encoder_init(ptr, MIC_RATE, 1, 2048);
  if (err < 0) throw new Error("Opus encoder failed: " + err);
  mod._opus_encoder_ctl(ptr, 4002, 16000);
  mod._opus_encoder_ctl(ptr, 4010, 5);
  return {
    encode(frame) {
      const pcmPtr = mod._malloc(frame.length * 2);
      mod.HEAP16.set(frame, pcmPtr >> 1);
      const outPtr = mod._malloc(4000);
      const len = mod._opus_encode(ptr, pcmPtr, MIC_FRAME, outPtr, 4000);
      let packet = null;
      if (len > 0) packet = new Uint8Array(mod.HEAPU8.subarray(outPtr, outPtr + len));
      mod._free(pcmPtr);
      mod._free(outPtr);
      return packet;
    },
  };
}

function makeDecoder(rate) {
  const mod = opus();
  const size = mod._opus_decoder_get_size(1);
  const ptr = mod._malloc(size);
  const err = mod._opus_decoder_init(ptr, rate, 1);
  if (err < 0) throw new Error("Opus decoder failed: " + err);
  const maxSamples = Math.floor(rate * 0.12);
  return {
    decode(packet) {
      const opusPtr = mod._malloc(packet.length);
      mod.HEAPU8.set(packet, opusPtr);
      const pcmPtr = mod._malloc(maxSamples * 2);
      const samples = mod._opus_decode(ptr, opusPtr, packet.length, pcmPtr, maxSamples, 0);
      mod._free(opusPtr);
      if (samples < 0) {
        mod._free(pcmPtr);
        return new Int16Array(0);
      }
      const pcm = new Int16Array(mod.HEAP16.subarray(pcmPtr >> 1, (pcmPtr >> 1) + samples));
      mod._free(pcmPtr);
      return pcm;
    },
  };
}

function context() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function stopPlayback() {
  for (const node of playNodes) {
    try { node.stop(); } catch (err) { /* already stopped */ }
  }
  playNodes = [];
  playAt = 0;
}

function playPcm(pcm) {
  if (!pcm.length) return;
  const ctx = context();
  const floats = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) floats[i] = pcm[i] / 32768;
  const buffer = ctx.createBuffer(1, floats.length, playbackRate);
  buffer.copyToChannel(floats, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const now = ctx.currentTime;
  if (playAt < now + 0.05) playAt = now + 0.08;
  source.start(playAt);
  playAt += buffer.duration;
  playNodes.push(source);
  source.onended = () => {
    playNodes = playNodes.filter((item) => item !== source);
  };
}

function sendJson(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function onControl(message) {
  if (message.type === "hello" && message.session_id) {
    sessionId = message.session_id;
    const rate = message.audio_params && message.audio_params.sample_rate;
    if (rate) {
      playbackRate = rate;
      decoder = makeDecoder(rate);
    }
    setStatus("Connected.");
    talkBtn.disabled = false;
    textInput.disabled = false;
    sendBtn.disabled = false;
    return;
  }
  if (message.type === "stt" && message.text) addLine("you", message.text);
  if (message.type === "tts") {
    if (message.state === "start") {
      speaking = true;
      stopPlayback();
    }
    if (message.state === "sentence_start" && message.text) addLine("assistant", message.text);
    if (message.state === "stop") speaking = false;
  }
  }

async function onBinary(data) {
  const bytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
  if (!decoder) decoder = makeDecoder(playbackRate);
  playPcm(decoder.decode(bytes));
}

async function connect() {
  const otaUrl = window.SWITCHBOARD && window.SWITCHBOARD.otaUrl;
  if (!otaUrl) {
    setStatus("This page has no OTA URL. It is set when the Instance starts.");
    return;
  }
  connectBtn.disabled = true;
  setStatus("Asking OTA for the WebSocket…");
  await context().resume();
  try {
    const response = await fetch(otaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Device-Id": deviceId,
        "Client-Id": clientId,
      },
      body: JSON.stringify({
        version: 0,
        application: { name: "switchboard-client", version: "0.1.0" },
        board: { type: "switchboard-client", mac: deviceId },
        mac_address: deviceId,
      }),
    });
    if (!response.ok) throw new Error("OTA returned " + response.status);
    const body = await response.json();
    const wsUrl = body.websocket && body.websocket.url;
    if (!wsUrl) throw new Error("OTA response has no WebSocket URL");
    if (body.activation && body.activation.code) {
      addLine(
        "assistant",
        "Open the console and bind this client with code " + body.activation.code + "."
      );
    }
    const url = new URL(wsUrl);
    url.searchParams.set("device-id", deviceId);
    url.searchParams.set("client-id", clientId);
    if (body.websocket.token) {
      const token = body.websocket.token.startsWith("Bearer ")
        ? body.websocket.token
        : "Bearer " + body.websocket.token;
      url.searchParams.set("authorization", token);
    }
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      encoder = makeEncoder();
      sendJson({
        type: "hello",
        device_id: deviceId,
        device_name: "Switchboard",
        device_mac: deviceId,
        token: "",
        features: { mcp: false, emoji: false },
      });
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") onControl(JSON.parse(event.data));
      else onBinary(event.data);
    };
    socket.onclose = () => {
      setStatus("Disconnected.");
      talkBtn.disabled = true;
      textInput.disabled = true;
      sendBtn.disabled = true;
      connectBtn.disabled = false;
      recording = false;
    };
    socket.onerror = () => setStatus("WebSocket failed. The Advertised WebSocket URL has to be reachable from this browser.");
  } catch (err) {
    setStatus(err.message);
    connectBtn.disabled = false;
  }
}

function resample(samples, fromRate) {
  if (fromRate === MIC_RATE) return samples;
  const ratio = fromRate / MIC_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const mix = pos - left;
    out[i] = samples[left] * (1 - mix) + samples[right] * mix;
  }
  return out;
}

function sendMic(floatSamples) {
  const scaled = resample(floatSamples, micRate);
  const merged = new Int16Array(pcmCarry.length + scaled.length);
  merged.set(pcmCarry);
  for (let i = 0; i < scaled.length; i++) {
    const value = Math.max(-1, Math.min(1, scaled[i]));
    merged[pcmCarry.length + i] = value < 0 ? value * 32768 : value * 32767;
  }
  let offset = 0;
  while (offset + MIC_FRAME <= merged.length) {
    const frame = merged.subarray(offset, offset + MIC_FRAME);
    const packet = encoder.encode(frame);
    if (packet && socket && socket.readyState === WebSocket.OPEN) socket.send(packet);
    offset += MIC_FRAME;
  }
  pcmCarry = merged.slice(offset);
}

async function startTalk() {
  if (!socket || socket.readyState !== WebSocket.OPEN || recording) return;
  const ctx = context();
  await ctx.resume();
  micRate = ctx.sampleRate;
  if (speaking && sessionId) {
    sendJson({ session_id: sessionId, type: "abort", reason: "user_interrupt" });
    stopPlayback();
    speaking = false;
  }
  pcmCarry = new Int16Array(0);
  sendJson({ session_id: sessionId, type: "listen", state: "start", mode: "manual" });
  if (!micReady) {
    const worklet = `
      class Mic extends AudioWorkletProcessor {
        process(inputs) {
          const channel = inputs[0] && inputs[0][0];
          if (channel) this.port.postMessage(channel.slice(0));
          return true;
        }
      }
      registerProcessor("switchboard-mic", Mic);
    `;
    const blob = new Blob([worklet], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);
    micReady = true;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "switchboard-mic");
  node.port.onmessage = (event) => {
    if (recording) sendMic(event.data);
  };
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(node);
  node.connect(silent);
  silent.connect(ctx.destination);
  recording = true;
  talkBtn.textContent = "Release to send";
  talkBtn._stop = () => {
    recording = false;
    talkBtn.textContent = "Hold to talk";
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    node.disconnect();
    sendJson({ session_id: sessionId, type: "listen", state: "stop" });
  };
}

function stopTalk() {
  if (talkBtn._stop) {
    const stop = talkBtn._stop;
    talkBtn._stop = null;
    stop();
  }
}

connectBtn.addEventListener("click", connect);
talkBtn.addEventListener("pointerdown", (event) => {
  talkBtn.setPointerCapture(event.pointerId);
  startTalk().catch((err) => setStatus(err.message));
});
talkBtn.addEventListener("pointerup", stopTalk);
talkBtn.addEventListener("pointercancel", stopTalk);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  if (speaking && sessionId) {
    sendJson({ session_id: sessionId, type: "abort", reason: "user_interrupt" });
    stopPlayback();
    speaking = false;
  }
  sendJson({ session_id: sessionId, type: "listen", state: "detect", text });
  textInput.value = "";
});
