// The relay dashboard: status, QR code, players and a test screen with live cursors. It is an
// ordinary Phone Wand app built on the JavaScript client, so it doubles as the JS sample.

import { PhoneWand, type Player } from "phone-wand";

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

function renderPlayers(): void {
  const list = wand.list;
  $("count").textContent = String(list.length);
  $("no-players").classList.toggle("hidden", list.length > 0);
  $("no-players").style.display = list.length ? "none" : "";
  const root = $("players");
  root.replaceChildren(
    ...list.map((p) => {
      const el = document.createElement("div");
      el.className = "player";
      const s = p.stats;
      const meta = [
        p.device.platform,
        p.device.transport === "http" ? "HTTP fallback" : "WebSocket",
        p.calibration === "none" ? "not calibrated" : p.calibration === "ray" ? "recentred" : "screen calibrated",
        s ? `${s.rate} Hz` : "",
        s ? `${Math.round(s.rtt)} ms round trip` : "",
        s && s.dropped ? `${s.dropped} dropped` : "",
      ].filter(Boolean).join(" · ");
      el.innerHTML = `
        <span class="swatch" style="background:${p.colour}"></span>
        <span class="name"></span>
        <span class="state ${p.state}">${p.state}</span>
        <span class="meta">${meta}</span>
        <span class="tools">
          <button data-a="screen">Calibrate</button>
          <button data-a="buzz">Buzz</button>
          <button data-a="hello">Say hello</button>
        </span>`;
      el.querySelector(".name")!.textContent = `${p.slot + 1}. ${p.name}${p.label ? ` (${p.label})` : ""}`;
      el.querySelector(".tools")!.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).dataset.a;
        if (a === "screen") wand.calibrate("screen", { id: p.id });
        if (a === "buzz") wand.haptic([60, 60, 60], { id: p.id });
        if (a === "hello") wand.prompt(`Hello, ${p.name}!`, { id: p.id });
      });
      return el;
    }),
  );
}

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
  requestAnimationFrame(draw);
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
