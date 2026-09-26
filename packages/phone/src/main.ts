// The phone page: reads orientation, shows buttons, and talks to the relay over a WebSocket, or
// over HTTP (POST up, Server-Sent Events down) when a secure WebSocket will not connect.

import { type PhoneToRelay, type Quat, type RelayToPhone, type SensorKind, eulerToQuat } from "@phone-wand/core";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ storage

const STORE = `phone-wand:${location.host}`;
interface Saved { token?: string; name?: string }
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
    transport = wsTransport(events, () => {
      // Safari can refuse a secure WebSocket to a self-signed server even after the page was
      // accepted. Fall back to plain HTTP requests on the same (already trusted) origin.
      preferHttp = true;
      sessionStorage.setItem(`${STORE}:http`, "1");
      transport = null;
      connect();
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
      if (msg.mode === "screen") startCalibration();
      else {
        showPrompt("Point at the middle of the screen and press Recentre", 5000);
        flash($("recentre"));
      }
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

function onQuat(q: Quat): void {
  lastQ = q;
  lastSample = performance.now();
  if (!welcomed || document.hidden) return;
  send({ type: "pose", seq: seq++, ts: lastSample, q });
}

async function startSensor(): Promise<SensorKind> {
  const DOE = (window as any).DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    // iOS: must be called from a tap.
    const result = await DOE.requestPermission();
    if (result !== "granted") throw new Error("denied");
  }

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
});

// ------------------------------------------------------------------ buttons

const held = new Map<HTMLElement, number>();

function bindButton(el: HTMLElement, down: () => void, up: () => void): void {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (held.has(el)) return;
    el.setPointerCapture?.(e.pointerId);
    held.set(el, e.pointerId);
    el.classList.add("down");
    navigator.vibrate?.(10);
    down();
  });
  const release = (e: PointerEvent) => {
    if (held.get(el) !== e.pointerId) return;
    held.delete(el);
    el.classList.remove("down");
    up();
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

const releasers = new Map<HTMLElement, () => void>();
function releaseAll(): void {
  for (const el of [...held.keys()]) {
    held.delete(el);
    el.classList.remove("down");
    releasers.get(el)?.();
  }
}

for (const [id, button] of [["primary", "primary"], ["secondary", "secondary"]] as const) {
  const up = () => send({ type: "button", button, down: false });
  releasers.set($(id), up);
  bindButton($(id), () => send({ type: "button", button, down: true }), up);
}

function flash(el: HTMLElement): void {
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 600);
}

$("recentre").addEventListener("click", () => {
  send({ type: "recentre" });
  navigator.vibrate?.(20);
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
}

$("calibrate").addEventListener("click", startCalibration);
$("calib-cancel").addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  send({ type: "calibrate-cancel" });
  endCalibration();
});
$("calib").addEventListener("pointerdown", () => {
  if (!calibStep || !lastQ) return;
  navigator.vibrate?.(20);
  send({ type: "corner", step: calibStep, q: lastQ });
  if (calibStep === "top-left") {
    calibStep = "bottom-right";
    renderCalibration();
  }
});

function onCalibration(msg: Extract<RelayToPhone, { type: "calibration" }>): void {
  if (msg.step === "done") {
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
