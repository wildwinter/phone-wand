// The relay dashboard: status, QR code, players and a test screen with live cursors. It is an
// ordinary Phone Wand app built on the JavaScript client, so it doubles as the JS sample.

import { type Layout, PhoneWand, type Player } from "phone-wand";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wand = new PhoneWand({ url: `ws://${location.host}/app` });

// ------------------------------------------------------------------ status panel

wand.on("connected", (hello) => {
  $("relay").textContent = `relay ${hello.relay}`;
  $("relay").classList.remove("off");
  const link = $<HTMLAnchorElement>("join-url");
  link.textContent = hello.joinUrl;
  link.href = hello.joinUrl;
  $("max").textContent = String(hello.maxPlayers);
  const qr = `/qr.svg?t=${Date.now()}`;
  $<HTMLImageElement>("qr").src = qr;
  $<HTMLImageElement>("qr2").src = qr;
  applySmoothing();
  applyGestures();
  renderPlayers();
});

wand.on("disconnected", () => {
  $("relay").textContent = "relay stopped";
  $("relay").classList.add("off");
  renderPlayers();
});

for (const ev of ["join", "leave", "player", "calibrated", "stats"] as const) {
  wand.on(ev, () => renderPlayers());
}

interface Card {
  el: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  meta: HTMLElement;
}
const cards = new Map<string, Card>();

function makeCard(id: string): Card {
  const el = document.createElement("div");
  el.className = "player";
  el.innerHTML = `
    <span class="swatch"></span>
    <span class="name"></span>
    <span class="state"></span>
    <span class="meta"></span>
    <span class="tools">
      <button data-a="screen">Calibrate</button>
      <button data-a="buzz">Buzz</button>
      <button data-a="hello">Say hello</button>
    </span>`;
  el.querySelector(".tools")!.addEventListener("click", (e) => {
    const p = wand.players.get(id);
    const a = (e.target as HTMLElement).dataset.a;
    if (!p) return;
    if (a === "screen") wand.calibrate("screen", { id });
    if (a === "buzz") wand.haptic([60, 60, 60], { id });
    if (a === "hello") wand.prompt(`Hello, ${p.name}!`, { id });
  });
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  return { el, swatch: q(".swatch"), name: q(".name"), state: q(".state"), meta: q(".meta") };
}

// Cards are created once per player and updated in place, so buttons keep working while stats
// arrive every second.
function renderPlayers(): void {
  const list = wand.list;
  $("count").textContent = String(list.length);
  $("no-players").style.display = list.length ? "none" : "";
  for (const [id, card] of cards) {
    if (!wand.players.has(id)) {
      card.el.remove();
      cards.delete(id);
    }
  }
  const root = $("players");
  list.forEach((p, i) => {
    let card = cards.get(p.id);
    if (!card) cards.set(p.id, (card = makeCard(p.id)));
    // Only move a card when the order changed: moving it mid-click would lose the click.
    if (root.children[i] !== card.el) root.insertBefore(card.el, root.children[i] ?? null);
    const s = p.stats;
    card.swatch.style.background = p.colour;
    card.name.textContent = `${p.slot + 1}. ${p.name}${p.label ? ` (${p.label})` : ""}`;
    card.state.textContent = p.state;
    card.state.className = `state ${p.state}`;
    card.meta.textContent = [
      p.device.platform,
      p.device.transport === "http" ? "HTTP fallback" : "WebSocket",
      p.calibration === "none" ? "not calibrated" : p.calibration === "ray" ? "recentred" : "screen calibrated",
      s ? `${s.rate} Hz` : "",
      s ? `${Math.round(s.rtt)} ms round trip` : "",
      s && s.dropped ? `${s.dropped} dropped` : "",
    ].filter(Boolean).join(" · ");
  });
}

$("stop").addEventListener("click", async () => {
  if (!confirm("Stop the relay? Phones will lose their connection.")) return;
  try {
    await fetch("/shutdown", { method: "POST", headers: { "x-phone-wand": "shutdown" } });
  } catch {
    // it may already be gone
  }
});

// Sample layouts, to try templates and controls on real phones without writing an app.
const LAYOUTS: Record<string, Layout | null> = {
  default: null,
  primary: { template: "primary", controls: [{ id: "go", type: "button", label: "Go" }] },
  pair: {
    template: "pair",
    controls: [{ id: "left", type: "button", label: "Left" }, { id: "right", type: "button", label: "Right" }],
  },
  row: {
    template: "primary-row",
    controls: [
      { id: "shoot", type: "button", label: "Shoot" },
      { id: "reload", type: "button", label: "Reload" },
      { id: "zoom", type: "toggle", label: "Zoom" },
      { id: "ammo", type: "label", label: "Ammo", text: "12" },
    ],
  },
  grid: {
    template: "grid",
    controls: [
      { id: "fire", type: "button", label: "Fire" },
      { id: "shield", type: "toggle", label: "Shield" },
      { id: "power", type: "slider", label: "Power", value: 0.5 },
      { id: "throttle", type: "slider", label: "Throttle", orientation: "vertical", spring: 0.5 },
      { id: "weapon", type: "choice", label: "Weapon", options: ["Bow", "Sling", "Net"] },
      { id: "score", type: "label", label: "Score", text: "0" },
    ],
  },
  dpad: {
    template: "primary-secondary",
    controls: [{ id: "move", type: "dpad" }, { id: "select", type: "button", label: "Select" }],
  },
  crawl: {
    template: "primary-row",
    controls: [
      { id: "walk", type: "crawl" },
      { id: "attack", type: "button", label: "Attack" },
      { id: "use", type: "button", label: "Use" },
      { id: "map", type: "toggle", label: "Map" },
    ],
  },
  retro: {
    template: "grid",
    controls: [
      { id: "move", type: "dpad" },
      { id: "a", type: "button", label: "A" },
      { id: "b", type: "button", label: "B" },
      { id: "start", type: "button", label: "Start" },
    ],
  },
};
$<HTMLSelectElement>("layout-pick").addEventListener("change", (e) => {
  wand.layout(LAYOUTS[(e.target as HTMLSelectElement).value] ?? null);
});
// Show control changes on the test screen, briefly, so they're easy to check.
wand.on("control", (e, p) => {
  ripples.push({ x: 0.5, y: 0.08, colour: p.colour, start: performance.now(), big: false });
  lastControl = { text: `${p.name}: ${e.control} = ${JSON.stringify(e.value)}`, colour: p.colour, at: performance.now() };
});
// Each gesture shows on the test screen: its name, an arrow for movements, and any held buttons.
interface Shown { name: string; dir: [number, number, number]; strength: number; colour: string; at: number; x: number; y: number }
const gestures: Shown[] = [];
wand.on("gesture", (g, p) => {
  const [x, y] = p.pose?.screen ?? [0.5, 0.5];
  const held = g.buttons.length ? ` + ${g.buttons.join(", ")}` : "";
  // Flicks have no movement direction; show the way the phone turned.
  const turned: Record<string, [number, number, number]> = {
    "flick-up": [0, 1, 0], "flick-down": [0, -1, 0], "flick-left": [-1, 0, 0], "flick-right": [1, 0, 0],
  };
  gestures.push({ name: `${g.gesture}${held}`, dir: turned[g.gesture] ?? g.dir, strength: g.strength, colour: p.colour, at: performance.now(), x, y });
  const size = g.angle ? `${Math.round(g.angle)} degrees` : `${g.speed.toFixed(2)} m/s`;
  lastControl = { text: `${p.name}: ${g.gesture}${held} (strength ${g.strength.toFixed(2)}, ${size})`, colour: p.colour, at: performance.now() };
});

wand.on("error", (message) => {
  lastControl = { text: `Relay error: ${message}`, colour: "#ff5c6c", at: performance.now() };
});
let lastControl: { text: string; colour: string; at: number } | null = null;

$("all-screen").addEventListener("click", () => wand.calibrate("screen"));
$("all-ray").addEventListener("click", () => wand.calibrate("ray"));
$("all-buzz").addEventListener("click", () => wand.haptic(80));
$("prompt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("prompt-text");
  wand.prompt(input.value, { duration: 4000 });
  input.value = "";
});

// ------------------------------------------------------------------ smoothing

const mc = $<HTMLInputElement>("mc");
const beta = $<HTMLInputElement>("beta");
const raw = $<HTMLInputElement>("raw");
try {
  const saved = JSON.parse(localStorage.getItem("phone-wand:smoothing") || "null");
  if (saved) {
    mc.value = saved.mc;
    beta.value = saved.beta;
    raw.checked = saved.raw;
  }
} catch {
  // ignore
}

// Gesture sensitivity 1 (needs a vigorous flick) to 10 (a light one), as the movement threshold.
const gs = $<HTMLInputElement>("gs");
const gsOff = $<HTMLInputElement>("gs-off");
try {
  const saved = JSON.parse(localStorage.getItem("phone-wand:gestures") || "null");
  if (saved) {
    gs.value = saved.gs;
    gsOff.checked = saved.off;
  }
} catch {
  // ignore
}
const gestureThreshold = () => 16 - Number(gs.value) * 1.8; // 1 -> 14.2, 5 -> 7, 10 -> -2 -> clamp
function applyGestures(): void {
  const threshold = Math.max(2.5, gestureThreshold());
  $("gs-v").textContent = `${gs.value} (starts at ${threshold.toFixed(1)} m/s²)`;
  wand.configure({ gestures: gsOff.checked ? false : { threshold } });
  try {
    localStorage.setItem("phone-wand:gestures", JSON.stringify({ gs: gs.value, off: gsOff.checked }));
  } catch {
    // ignore
  }
}
for (const el of [gs, gsOff]) el.addEventListener("input", applyGestures);

function applySmoothing(): void {
  $("mc-v").textContent = `${mc.value} Hz`;
  $("beta-v").textContent = beta.value;
  wand.configure({
    smoothing: raw.checked ? false : { minCutoff: Number(mc.value), beta: Number(beta.value), dCutoff: 1 },
  });
  try {
    localStorage.setItem("phone-wand:smoothing", JSON.stringify({ mc: mc.value, beta: beta.value, raw: raw.checked }));
  } catch {
    // ignore
  }
}
for (const el of [mc, beta, raw]) el.addEventListener("input", applySmoothing);

// ------------------------------------------------------------------ test screen

const stage = $("stage");
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;

function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
}
$("fullscreen").addEventListener("click", toggleFullscreen);
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.key === "f" || e.key === "F") toggleFullscreen();
});

interface Ripple { x: number; y: number; colour: string; start: number; big: boolean }
const ripples: Ripple[] = [];
const trails = new Map<string, [number, number][]>();

wand.on("button", (e, p) => {
  // Name every press but the default two, so d-pad and crawl directions are easy to check.
  if (e.down && e.button !== "primary" && e.button !== "secondary") {
    lastControl = { text: `${p.name}: ${e.button}`, colour: p.colour, at: performance.now() };
  }
  if (!e.down || !p.pose?.screen) return;
  const [x, y] = p.pose.screen;
  ripples.push({ x, y, colour: p.colour, start: performance.now(), big: e.button === "primary" });
});

wand.on("pose", (pose, p) => {
  if (!pose.screen) return;
  let t = trails.get(p.id);
  if (!t) trails.set(p.id, (t = []));
  t.push(pose.screen);
  if (t.length > 14) t.shift();
});
wand.on("leave", (p) => trails.delete(p.id));

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(stage);

function draw(now: number): void {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  // Grid, so pointing accuracy is easy to judge.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo((w * i) / 8, 0);
    ctx.lineTo((w * i) / 8, h);
    ctx.moveTo(0, (h * i) / 8);
    ctx.lineTo(w, (h * i) / 8);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
  ctx.stroke();

  const unit = Math.min(w, h);

  // Corner markers while anyone is calibrating.
  for (const p of wand.list) {
    if (!p.calibrating) continue;
    const [cx, cy] = p.calibrating === "top-left" ? [0, 0] : [w, h];
    const pulse = 0.5 + 0.5 * Math.sin(now / 150);
    ctx.fillStyle = p.colour;
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * (0.06 + 0.02 * pulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = `600 ${Math.round(unit * 0.03)}px system-ui, sans-serif`;
    ctx.textAlign = p.calibrating === "top-left" ? "left" : "right";
    ctx.textBaseline = p.calibrating === "top-left" ? "top" : "bottom";
    const pad = unit * 0.1;
    ctx.fillText(`${p.name}: point here and tap`, p.calibrating === "top-left" ? pad : w - pad, p.calibrating === "top-left" ? pad : h - pad);
  }

  // Click ripples.
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    const age = (now - r.start) / 450;
    if (age > 1) {
      ripples.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = r.colour;
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = r.big ? 5 : 3;
    ctx.beginPath();
    ctx.arc(r.x * w, r.y * h, unit * (0.02 + age * (r.big ? 0.09 : 0.05)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const p of wand.list) drawCursor(p, w, h, unit);
  drawWaiting(w, h, unit);
  drawGestures(now, w, h, unit);
  if (lastControl && now - lastControl.at < 2500) {
    ctx.globalAlpha = 1 - (now - lastControl.at) / 2500;
    ctx.fillStyle = lastControl.colour;
    ctx.font = `600 ${Math.round(unit * 0.03)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(lastControl.text, w / 2, unit * 0.03);
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(draw);
}

function drawGestures(now: number, w: number, h: number, unit: number): void {
  for (let i = gestures.length - 1; i >= 0; i--) {
    const g = gestures[i];
    const age = (now - g.at) / 1200;
    if (age > 1) {
      gestures.splice(i, 1);
      continue;
    }
    const cx = Math.min(Math.max(g.x, 0.1), 0.9) * w, cy = Math.min(Math.max(g.y, 0.1), 0.9) * h;
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = g.colour;
    ctx.fillStyle = g.colour;
    // Movements: an arrow the way the phone moved (right and up on screen; push and pull shown by size).
    const [r, u, f] = g.dir;
    const len = unit * (0.08 + 0.12 * g.strength);
    if (Math.abs(r) + Math.abs(u) > 0.3) {
      const ex = cx + r * len, ey = cy - u * len;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const a = Math.atan2(ey - cy, ex - cx);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 14, ey + Math.sin(a) * 14);
      ctx.lineTo(ex + Math.cos(a + 2.4) * 16, ey + Math.sin(a + 2.4) * 16);
      ctx.lineTo(ex + Math.cos(a - 2.4) * 16, ey + Math.sin(a - 2.4) * 16);
      ctx.fill();
    } else if (Math.abs(f) > 0.3) {
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, f > 0 ? len * (1 - age * 0.8) : len * (0.3 + age), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `800 ${Math.round(unit * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(g.name, cx, cy + unit * 0.05);
    ctx.globalAlpha = 1;
  }
}

// Players have no cursor until they have aimed once, so say what each one still needs to do.
function drawWaiting(w: number, h: number, unit: number): void {
  const waiting = wand.list.filter((p) => p.state === "waiting" || p.calibration === "none" || p.calibrating);
  if (!waiting.length) return;
  const size = Math.round(unit * 0.03);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  waiting.forEach((p, i) => {
    const what = p.calibrating
      ? "is calibrating: aim at the marked corner"
      : p.state === "waiting"
        ? "tap Tap to start on your phone"
        : "set up your aim on your phone";
    const y = h - unit * 0.04 - (waiting.length - 1 - i) * size * 1.5;
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(unit * 0.04 + size * 0.35, y - size * 0.5, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
    const who = p.name === `Player ${p.slot + 1}` ? p.name : `Player ${p.slot + 1}, ${p.name}`;
    ctx.fillText(`${who}: ${what}`, unit * 0.04 + size, y);
  });
}

function drawCursor(p: Player, w: number, h: number, unit: number): void {
  const s = p.pose?.screen;
  if (!s) return;
  const faded = p.state !== "active";
  const x = s[0] * w, y = s[1] * h;
  const onScreen = s[0] >= 0 && s[0] <= 1 && s[1] >= 0 && s[1] <= 1;
  const r = unit * 0.022;

  if (!onScreen) {
    // Arrow at the edge pointing towards the off-screen cursor.
    const cx = Math.min(Math.max(x, 24), w - 24), cy = Math.min(Math.max(y, 24), h - 24);
    const a = Math.atan2(y - cy, x - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = p.colour;
    ctx.globalAlpha = faded ? 0.4 : 0.9;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -11);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }

  const trail = trails.get(p.id) ?? [];
  ctx.strokeStyle = p.colour;
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    ctx.globalAlpha = (i / trail.length) * 0.35 * (faded ? 0.4 : 1);
    ctx.lineWidth = (r * i) / trail.length;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1][0] * w, trail[i - 1][1] * h);
    ctx.lineTo(trail[i][0] * w, trail[i][1] * h);
    ctx.stroke();
  }
  ctx.globalAlpha = faded ? 0.35 : 1;
  const pressed = p.buttons.has("primary");
  ctx.fillStyle = p.colour;
  ctx.beginPath();
  ctx.arc(x, y, pressed ? r * 0.75 : r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000";
  ctx.stroke();
  if (p.buttons.has("secondary")) {
    ctx.strokeStyle = p.colour;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = `700 ${Math.round(unit * 0.022)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.colour;
  ctx.fillText(faded ? `${p.name} (${p.state})` : p.name, x + r * 1.5, y);
  ctx.globalAlpha = 1;
}

requestAnimationFrame(draw);
