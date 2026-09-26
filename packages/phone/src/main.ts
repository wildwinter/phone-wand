// The phone page: reads orientation, shows buttons, and talks to the relay over a WebSocket, or
// over HTTP (POST up, Server-Sent Events down) when a secure WebSocket will not connect.

import {
  type PhoneToRelay, type Quat, type RelayToPhone, type SensorKind,
  DEFAULT_LAYOUT, eulerToQuat, layoutValues,
} from "@phone-wand/core";
import { type RenderedLayout, renderLayout } from "./controls.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ storage

const STORE = `phone-wand:${location.host}`;
interface Saved { token?: string; name?: string; hand?: "left" | "right" }
function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}
function save(patch: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch }));
  } catch {
    // private mode: nothing to do
  }
}

const params = new URLSearchParams(location.search);
const joinKey = params.get("k") ?? "";
const platform = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ? "iOS"
  : /Android/.test(navigator.userAgent) ? "Android" : "other";

// ------------------------------------------------------------------ transports

interface Transport {
  kind: "ws" | "http";
  send(msg: PhoneToRelay): void;
  close(): void;
}

interface TransportEvents {
  open(): void;
  message(msg: RelayToPhone): void;
  close(): void;
}

function wsTransport(ev: TransportEvents, onFailEarly: () => void): Transport {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/phone`);
  let opened = false;
  let done = false;
  const early = setTimeout(() => {
    if (!opened && !done) {
      done = true;
      ws.close();
      onFailEarly();
    }
  }, 3000);
  ws.onopen = () => {
    opened = true;
    clearTimeout(early);
    ev.open();
  };
  ws.onmessage = (e) => {
    try {
      ev.message(JSON.parse(e.data));
    } catch {
      // ignore
    }
  };
  ws.onclose = () => {
    clearTimeout(early);
    if (done) return;
    done = true;
    if (opened) ev.close();
    else onFailEarly();
  };
  return {
    kind: "ws",
    send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
    close: () => {
      done = true;
      ws.close();
    },
  };
}

function httpTransport(ev: TransportEvents): Transport {
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  let queue: PhoneToRelay[] = [];
  let pose: PhoneToRelay | null = null;
  let busy = false;
  let closed = false;
  let events: EventSource | null = null;

  const shut = () => {
    if (closed) return;
    closed = true;
    events?.close();
    ev.close();
  };

  const flush = async () => {
    if (busy || closed) return;
    const batch = pose ? [...queue, pose] : queue;
    if (!batch.length) return;
    queue = [];
    pose = null;
    busy = true;
    try {
      const r = await fetch(`/phone/send?sid=${sid}`, { method: "POST", body: JSON.stringify(batch), keepalive: false });
      if (r.status === 410) return shut();
      if (!events) {
        events = new EventSource(`/phone/events?sid=${sid}`);
        events.onmessage = (e) => {
          try {
            ev.message(JSON.parse(e.data));
          } catch {
            // ignore
          }
        };
        events.onerror = () => {
          if (events?.readyState === EventSource.CLOSED) shut();
        };
      }
    } catch {
      return shut();
    } finally {
      busy = false;
    }
    // Only one request in flight; anything queued meanwhile goes next, with just the newest pose.
    flush();
  };

  queueMicrotask(() => ev.open());
  return {
    kind: "http",
    send(m) {
      if (closed) return;
      if (m.type === "pose") pose = m;
      else queue.push(m);
      flush();
    },
    close: shut,
  };
}

// ------------------------------------------------------------------ connection

let transport: Transport | null = null;
let preferHttp = sessionStorage.getItem(`${STORE}:http`) === "1";
let retryDelay = 1000;
let welcomed = false;
let rejected = false;
let started = false;
let sensorKind: SensorKind | "" = "";
let colour = "#2ec4ff";
let myName = load().name || "";

function connect(): void {
  if (rejected) return;
  const events: TransportEvents = {
    open() {
      retryDelay = 1000;
      send({ type: "hello", key: joinKey, token: load().token, name: myName, platform, sensor: sensorKind });
      if (started) send({ type: "ready", sensor: sensorKind as SensorKind });
    },
    message: onMessage,
    close() {
      transport = null;
      welcomed = false;
      setNet("bad", "offline");
      $("start-status").textContent = "Lost the relay. Reconnecting...";
      if (!rejected) setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5000);
    },
  };
  if (preferHttp) {
    transport = httpTransport(events);
  } else {
    transport = wsTransport(events, async () => {
      transport = null;
      // Safari can refuse a secure WebSocket to a self-signed server even after the page was
      // accepted. If the relay answers plain requests but the WebSocket failed, that is what
      // happened: switch to HTTP requests on the same (already trusted) origin for this session.
      // If the relay does not answer at all, it is down or restarting: keep trying the WebSocket,
      // so a relay restart does not leave the phone on the slower fallback.
      let relayUp = false;
      try {
        relayUp = (await fetch("/ping", { cache: "no-store" })).ok;
      } catch {
        // not reachable
      }
      if (relayUp) {
        preferHttp = true;
        sessionStorage.setItem(`${STORE}:http`, "1");
        connect();
      } else {
        events.close();
      }
    });
  }
}

function send(msg: PhoneToRelay): void {
  transport?.send(msg);
}

// ------------------------------------------------------------------ messages from the relay

let promptTimer: ReturnType<typeof setTimeout> | null = null;

function onMessage(msg: RelayToPhone): void {
  switch (msg.type) {
    case "welcome":
      welcomed = true;
      myCalibration = msg.calibration;
      save({ token: msg.token });
      applyStyle(msg.colour, msg.label);
      $("slot").textContent = String(msg.slot + 1);
      if (!myName) $("player-name").textContent = msg.name;
      ($("name") as HTMLInputElement).placeholder = msg.name;
      $("start-status").textContent = `Connected as player ${msg.slot + 1}.`;
      ($("start-button") as HTMLButtonElement).disabled = false;
      setNet("ok", transport?.kind === "http" ? "http" : "");
      break;
    case "rejected":
      rejected = true;
      transport?.close();
      if (msg.reason === "full") {
        showMessage("The game is full", "Every player slot is taken. Wait for someone to leave, then try again.", true);
      } else {
        showMessage("Scan the QR code again", "This link is out of date. Scan the code on the big screen to join.", false);
      }
      break;
    case "style":
      applyStyle(msg.colour, msg.label);
      break;
    case "prompt":
      showPrompt(msg.text, msg.duration);
      break;
    case "haptic":
      navigator.vibrate?.(msg.pattern);
      break;
    case "calibrate":
      if (!started) return;
      closeSettings();
      if (msg.mode === "screen") startCalibration();
      else showSetup();
      break;
    case "layout":
      showLayout(msg.layout, msg.values);
      break;
    case "set":
      rendered.set(msg.control, msg.value);
      break;
    case "calibration":
      onCalibration(msg);
      break;
    case "ping":
      send({ type: "pong", n: msg.n, ts: performance.now() });
      pingSeen = performance.now();
      break;
  }
}

let pingSeen = 0;
setInterval(() => {
  if (!welcomed) return;
  if (performance.now() - pingSeen > 3500) setNet("slow", "slow");
  else setNet("ok", transport?.kind === "http" ? "http" : "");
}, 1000);

function applyStyle(c: string, label: string): void {
  colour = c;
  document.documentElement.style.setProperty("--accent", c);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c);
  $("player-label").textContent = label;
}

function setNet(state: "ok" | "slow" | "bad", text: string): void {
  const el = $("net");
  el.classList.toggle("bad", state === "bad");
  el.classList.toggle("slow", state === "slow");
  $("net-text").textContent = text;
}

function showPrompt(text: string, duration: number): void {
  const el = $("prompt");
  if (promptTimer) clearTimeout(promptTimer);
  if (!text) return el.classList.add("hidden");
  el.textContent = text;
  el.classList.remove("hidden");
  if (duration > 0) promptTimer = setTimeout(() => el.classList.add("hidden"), duration);
}

function showMessage(title: string, text: string, retry: boolean): void {
  $("message-title").textContent = title;
  $("message-text").textContent = text;
  $("message-button").classList.toggle("hidden", !retry);
  $("message").classList.remove("hidden");
}

$("message-button").addEventListener("click", () => {
  $("message").classList.add("hidden");
  rejected = false;
  connect();
});

// ------------------------------------------------------------------ orientation

let seq = 0;
let lastQ: Quat | null = null;
let lastSample = 0;

// The latest acceleration (gravity removed, m/s^2, the phone's own axes), sent with each pose so the
// relay can spot gestures. Only if fresh: a stale reading would look like a movement.
let lastAccel: [number, number, number] | null = null;
let lastAccelAt = 0;

function onQuat(q: Quat): void {
  lastQ = q;
  lastSample = performance.now();
  if (!welcomed || document.hidden) return;
  const fresh = lastAccel && lastSample - lastAccelAt < 100;
  send(fresh ? { type: "pose", seq: seq++, ts: lastSample, q, a: lastAccel! } : { type: "pose", seq: seq++, ts: lastSample, q });
}

function startMotion(): void {
  window.addEventListener("devicemotion", (e) => {
    const a = e.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    lastAccel = [Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100, Math.round(a.z * 100) / 100];
    lastAccelAt = performance.now();
  });
}

async function startSensor(): Promise<SensorKind> {
  const DOE = (window as any).DeviceOrientationEvent;
  const DME = (window as any).DeviceMotionEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    // iOS: must be called from a tap, so both requests start together, before anything is awaited.
    // Motion (for gestures) is optional; orientation is not.
    const [orientation] = await Promise.all([
      DOE.requestPermission(),
      DME && typeof DME.requestPermission === "function" ? DME.requestPermission().catch(() => "denied") : "granted",
    ]);
    if (orientation !== "granted") throw new Error("denied");
  }
  startMotion();

  const ROS = (window as any).RelativeOrientationSensor;
  if (ROS) {
    try {
      const sensor = new ROS({ frequency: 60, referenceFrame: "device" });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 1500);
        sensor.onreading = () => {
          clearTimeout(timeout);
          resolve();
        };
        sensor.onerror = (e: any) => {
          clearTimeout(timeout);
          reject(e.error ?? new Error("sensor"));
        };
        sensor.start();
      });
      sensor.onreading = () => {
        const q = sensor.quaternion as number[] | null;
        if (q) onQuat([q[0], q[1], q[2], q[3]]);
      };
      sensor.onerror = () => showMessage("Motion stopped", "The phone stopped sending motion data. Reload to try again.", false);
      return "relative-orientation-sensor";
    } catch {
      // fall through to deviceorientation
    }
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("no-data")), 2000);
    const first = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      clearTimeout(timeout);
      window.removeEventListener("deviceorientation", first);
      resolve();
    };
    window.addEventListener("deviceorientation", first);
  });
  window.addEventListener("deviceorientation", (e) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    onQuat(eulerToQuat(e.alpha, e.beta, e.gamma));
  });
  return "deviceorientation";
}

// ------------------------------------------------------------------ wake lock and visibility

let wakeLock: any = null;
async function keepAwake(): Promise<void> {
  try {
    wakeLock = await (navigator as any).wakeLock?.request("screen");
  } catch {
    // not supported or refused; the phone may dim
  }
}

document.addEventListener("visibilitychange", () => {
  if (!started) return;
  if (document.hidden) {
    releaseAll();
    send({ type: "pause" });
  } else {
    send({ type: "resume" });
    if (!wakeLock || wakeLock.released) keepAwake();
  }
});

// ------------------------------------------------------------------ start

const nameInput = $("name") as HTMLInputElement;
nameInput.value = myName;
nameInput.addEventListener("change", () => {
  myName = nameInput.value.trim().slice(0, 24);
  save({ name: myName });
  $("player-name").textContent = myName || nameInput.placeholder;
  if (welcomed) send({ type: "name", name: myName });
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameInput.blur();
});

$("start-button").addEventListener("click", async () => {
  nameInput.blur();
  myName = nameInput.value.trim().slice(0, 24);
  save({ name: myName });
  if (welcomed) send({ type: "name", name: myName });
  $("player-name").textContent = myName || nameInput.placeholder;
  try {
    sensorKind = await startSensor();
  } catch (e) {
    const denied = (e as Error).message === "denied";
    showMessage(
      denied ? "Motion access needed" : "No motion data",
      denied
        ? "Phone Wand needs motion access to point. Reload the page and tap Allow when asked."
        : window.isSecureContext
          ? "This browser is not sending orientation data. Try Safari on iPhone or Chrome on Android."
          : "This page must be opened over https:// to read motion. Scan the QR code on the screen.",
      false,
    );
    return;
  }
  started = true;
  keepAwake();
  send({ type: "ready", sensor: sensorKind });
  $("start").classList.add("hidden");
  $("play").classList.remove("hidden");
  if (myCalibration === "none") showSetup();
});

// ------------------------------------------------------------------ controls

// Taps that land on the play screen just after an overlay closes are the tail of the tap that
// closed it (a "ghost click"), not a real press: without this, finishing calibration pressed Recentre.
let ignoreTapsUntil = 0;
const tapAllowed = () => performance.now() > ignoreTapsUntil;

let rendered: RenderedLayout = renderLayout($("controls"), DEFAULT_LAYOUT, layoutValues(DEFAULT_LAYOUT), { send, tapAllowed });

function showLayout(layout: typeof DEFAULT_LAYOUT, values: ReturnType<typeof layoutValues>): void {
  rendered.releaseAll();
  rendered = renderLayout($("controls"), layout, values, { send, tapAllowed });
}

function releaseAll(): void {
  rendered.releaseAll();
}

// ------------------------------------------------------------------ settings

function setHand(hand: "left" | "right"): void {
  document.body.classList.toggle("left-handed", hand === "left");
  for (const b of $("hand").querySelectorAll("button")) b.classList.toggle("on", b.dataset.hand === hand);
  save({ hand });
}
setHand(load().hand ?? "right");
$("hand").addEventListener("click", (e) => {
  const hand = (e.target as HTMLElement).dataset.hand;
  if (hand === "left" || hand === "right") setHand(hand);
});

function openSettings(): void {
  releaseAll();
  ($("settings-name") as HTMLInputElement).value = myName;
  ($("settings-name") as HTMLInputElement).placeholder = ($("name") as HTMLInputElement).placeholder;
  $("settings").classList.remove("hidden");
}

function closeSettings(): void {
  if ($("settings").classList.contains("hidden")) return;
  $("settings").classList.add("hidden");
  ignoreTapsUntil = performance.now() + 600;
}

$("settings-open").addEventListener("click", () => {
  if (tapAllowed()) openSettings();
});
$("settings-close").addEventListener("click", closeSettings);
const settingsName = $("settings-name") as HTMLInputElement;
settingsName.addEventListener("change", () => {
  myName = settingsName.value.trim().slice(0, 24);
  save({ name: myName });
  ($("name") as HTMLInputElement).value = myName;
  $("player-name").textContent = myName || settingsName.placeholder;
  if (welcomed) send({ type: "name", name: myName });
});
settingsName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") settingsName.blur();
});

$("recentre").addEventListener("click", () => {
  if (!tapAllowed()) return;
  send({ type: "recentre" });
  navigator.vibrate?.(20);
  $("recentre").classList.add("flash");
  setTimeout(() => $("recentre").classList.remove("flash"), 400);
});

// ------------------------------------------------------------------ screen calibration

let calibStep: "top-left" | "bottom-right" | null = null;

function startCalibration(): void {
  calibStep = "top-left";
  send({ type: "calibrate-start" });
  renderCalibration();
  $("calib").classList.remove("hidden");
}

function renderCalibration(): void {
  const br = calibStep === "bottom-right";
  $("corner-mark").classList.toggle("br", br);
  $("calib-title").textContent = br ? "Now aim at the bottom-right corner" : "Aim at the top-left corner";
  $("calib-sub").textContent = br
    ? "Point the top of your phone at the bottom-right corner of the screen itself, hold still, and tap anywhere here."
    : "Point the top of your phone at the top-left corner of the screen itself, hold still, and tap anywhere here. Your cursor is hidden while you do this.";
}

function endCalibration(): void {
  calibStep = null;
  $("calib").classList.add("hidden");
  ignoreTapsUntil = performance.now() + 600;
}

$("calibrate").addEventListener("click", () => {
  closeSettings();
  startCalibration();
});
$("calib-cancel").addEventListener("pointerdown", (e) => e.stopPropagation());
$("calib-cancel").addEventListener("click", (e) => {
  e.stopPropagation();
  send({ type: "calibrate-cancel" });
  endCalibration();
  // Still never aimed: back to the setup screen, since there's no cursor without it.
  if (myCalibration === "none") showSetup();
});

// The aim is taken when the finger touches down, while the phone is steadiest, but only sent when
// the tap completes, so the overlay is still there to take the end of the tap.
let aimAtTouch: Quat | null = null;
$("calib").addEventListener("pointerdown", () => {
  aimAtTouch = lastQ;
});
$("calib").addEventListener("click", () => {
  const q = aimAtTouch ?? lastQ;
  aimAtTouch = null;
  if (!calibStep || !q) return;
  navigator.vibrate?.(20);
  send({ type: "corner", step: calibStep, q });
  if (calibStep === "top-left") {
    calibStep = "bottom-right";
    renderCalibration();
  }
});

// ------------------------------------------------------------------ first-time setup

// A new player has no cursor until they have aimed once (the relay withholds it), so they are
// walked into calibration straight after Tap to start.
let myCalibration: "none" | "ray" | "screen" = "none";

function showSetup(): void {
  $("setup").classList.remove("hidden");
}

function hideSetup(): void {
  $("setup").classList.add("hidden");
  ignoreTapsUntil = performance.now() + 600;
}

$("setup-screen").addEventListener("click", () => {
  hideSetup();
  startCalibration();
});
$("setup-ray").addEventListener("click", () => {
  hideSetup();
  send({ type: "recentre" });
  navigator.vibrate?.(20);
});

function onCalibration(msg: Extract<RelayToPhone, { type: "calibration" }>): void {
  myCalibration = msg.calibration;
  if (msg.step === "done") {
    hideSetup();
    endCalibration();
    showPrompt(msg.calibration === "screen" ? "Screen calibrated" : "Recentred", 1500);
  } else if (msg.step === "failed") {
    calibStep = "top-left";
    renderCalibration();
    $("calib-sub").textContent = "That didn't look like a screen. Start again: point the top of your phone at the top-left corner of the screen itself, and tap.";
  }
}

// Stale-sensor watchdog: if the phone stops producing samples while visible, say so.
setInterval(() => {
  if (started && !document.hidden && lastSample && performance.now() - lastSample > 3000) {
    showPrompt("No motion data. Try reloading the page.", 2000);
  }
}, 3000);

connect();
