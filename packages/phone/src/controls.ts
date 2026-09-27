// Draws a layout's controls on the phone and reports what the player does with them. Templates
// place the controls for a thumb holding the phone like a torch; see docs/layouts.md.

import {
  type Control, type ControlValue, type CrawlDirection, type DpadDirection, type Layout, type PhoneToRelay,
  DPAD_DIRECTIONS,
} from "@phone-wand/core";

export interface ControlsHost {
  send(msg: PhoneToRelay): void;
  /** False just after an overlay closed, when a tap is the tail of the one that closed it. */
  tapAllowed(): boolean;
}

export interface RenderedLayout {
  /** Show a value the app set (or the relay remembered). */
  set(control: string, value: ControlValue): void;
  /** Let go of every held button, telling the relay. */
  releaseAll(): void;
}

const vibrate = (ms: number) => navigator.vibrate?.(ms);

// Icons for the d-pad and crawl pad, drawn pointing up in a 24 by 24 box. Text arrows would do, but
// some phones draw them as colour emoji.
const ARROW = "M12 3 21 13h-5.5v8h-7v-8H3z";
const TURN = "M3 9.5 9.5 3v4H14a7 7 0 0 1 7 7v7h-5v-7a2 2 0 0 0-2-2H9.5v4z";

function icon(path: string, turn = 0, flip = false): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "currentColor");
  const t = [turn ? `rotate(${turn} 12 12)` : "", flip ? "translate(24 0) scale(-1 1)" : ""].filter(Boolean).join(" ");
  if (t) p.setAttribute("transform", t);
  svg.append(p);
  return svg;
}

/** Keep receiving a pointer's moves and release. Some browsers throw here; a press must still count. */
function capture(e: HTMLElement, pointer: number): void {
  try {
    e.setPointerCapture?.(pointer);
  } catch {
    // carry on without capture
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function renderLayout(
  root: HTMLElement,
  layout: Layout,
  values: Record<string, ControlValue>,
  host: ControlsHost,
): RenderedLayout {
  root.replaceChildren();
  root.className = `controls t-${layout.template}`;
  root.style.gridTemplateRows = root.style.gridTemplateColumns = "";
  const setters = new Map<string, (v: ControlValue) => void>();
  const held = new Map<string, { el: HTMLElement; pointer: number }>();
  const resets: (() => void)[] = [];

  const release = (id: string) => {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    h.el.classList.remove("down");
    host.send({ type: "button", button: id, down: false });
  };
  const press = (id: string, e: HTMLElement, pointer: number) => {
    held.set(id, { el: e, pointer });
    e.classList.add("down");
    vibrate(10);
    host.send({ type: "button", button: id, down: true });
  };

  layout.controls.forEach((c, i) => {
    const slot = el("div", `cell cell-${i}`);
    const big = i === 0 && layout.template.startsWith("primary");
    slot.append(control(c, big));
    root.append(slot);
  });
  // The row below a primary gets its own box, so up to three controls share it evenly.
  if (layout.template === "primary-row" && layout.controls.length > 1) {
    const row = el("div", "row");
    for (const s of [...root.querySelectorAll(".cell:not(.cell-0)")]) row.append(s);
    root.append(row);
  }
  // Rows and columns: each line gets its own box, sized by the layout's heights or widths.
  const counts = layout.template === "rows" ? layout.rows : layout.template === "columns" ? layout.columns : undefined;
  if (counts) {
    const cells = [...root.querySelectorAll<HTMLElement>(".cell")];
    let next = 0;
    for (const n of counts) {
      const line = el("div", "line");
      for (const cell of cells.slice(next, next + n)) line.append(cell);
      next += n;
      root.append(line);
    }
    const sizes = (layout.template === "rows" ? layout.heights : layout.widths) ?? counts.map(() => 1);
    const tracks = sizes.map((x) => `minmax(0, ${x}fr)`).join(" ");
    if (layout.template === "rows") root.style.gridTemplateRows = tracks;
    else root.style.gridTemplateColumns = tracks;
  }

  function styleColour(e: HTMLElement, c: Control) {
    if (c.colour) e.style.setProperty("--accent", c.colour);
  }

  function control(c: Control, big: boolean): HTMLElement {
    switch (c.type) {
      case "button": {
        const b = el("button", big ? "ctl pad" : "ctl btn");
        styleColour(b, c);
        if (big) b.append(el("span", "pad-ring"));
        b.append(el("span", big ? "pad-text" : "lbl", c.label ?? c.id));
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          if (held.has(c.id) || !host.tapAllowed()) return;
          capture(b, e.pointerId);
          press(c.id, b, e.pointerId);
        });
        const up = (e: PointerEvent) => {
          if (held.get(c.id)?.pointer === e.pointerId) release(c.id);
        };
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("contextmenu", (e) => e.preventDefault());
        return b;
      }

      case "toggle": {
        const b = el("button", "ctl toggle");
        styleColour(b, c);
        const state = el("span", "state");
        b.append(el("span", "lbl", c.label ?? c.id), state);
        let on = values[c.id] === true;
        const show = () => {
          b.classList.toggle("on", on);
          b.setAttribute("aria-pressed", String(on));
          state.textContent = on ? "On" : "Off";
        };
        show();
        b.addEventListener("click", () => {
          if (!host.tapAllowed()) return;
          on = !on;
          show();
          vibrate(15);
          host.send({ type: "control", control: c.id, value: on });
        });
        setters.set(c.id, (v) => {
          on = v === true;
          show();
        });
        return b;
      }

      case "slider": {
        const vertical = c.orientation === "vertical";
        const box = el("div", `ctl slider ${vertical ? "v" : "h"}`);
        styleColour(box, c);
        const track = el("div", "track");
        const fill = el("div", "fill");
        const knob = el("div", "knob");
        track.append(fill, knob);
        box.append(el("span", "lbl", c.label ?? c.id), track);
        let value = typeof values[c.id] === "number" ? (values[c.id] as number) : 0;
        const show = () => {
          const pct = `${(value * 100).toFixed(1)}%`;
          if (vertical) {
            fill.style.height = pct;
            knob.style.bottom = pct;
          } else {
            fill.style.width = pct;
            knob.style.left = pct;
          }
        };
        show();
        let lastSent = -1;
        let lastTime = 0;
        const sendValue = (force: boolean) => {
          const now = performance.now();
          if (!force && now - lastTime < 33) return; // about 30 updates a second is plenty
          if (value === lastSent) return;
          lastSent = value;
          lastTime = now;
          host.send({ type: "control", control: c.id, value: Math.round(value * 1000) / 1000 });
        };
        const fromPointer = (e: PointerEvent) => {
          const r = track.getBoundingClientRect();
          const v = vertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width;
          value = Math.min(1, Math.max(0, v));
          show();
          sendValue(false);
        };
        let dragging: number | null = null;
        track.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          if (!host.tapAllowed()) return;
          dragging = e.pointerId;
          capture(track, e.pointerId);
          box.classList.add("down");
          fromPointer(e);
        });
        track.addEventListener("pointermove", (e) => {
          if (dragging === e.pointerId) fromPointer(e);
        });
        const end = (e: PointerEvent) => {
          if (dragging !== e.pointerId) return;
          dragging = null;
          box.classList.remove("down");
          if (c.spring !== null && c.spring !== undefined) {
            value = c.spring;
            show();
          }
          sendValue(true);
        };
        track.addEventListener("pointerup", end);
        track.addEventListener("pointercancel", end);
        setters.set(c.id, (v) => {
          if (typeof v !== "number" || dragging !== null) return;
          value = v;
          lastSent = v;
          show();
        });
        return box;
      }

      case "choice": {
        const box = el("div", "ctl choice");
        styleColour(box, c);
        const seg = el("div", "seg");
        box.append(el("span", "lbl", c.label ?? ""), seg);
        let selected = typeof values[c.id] === "number" ? (values[c.id] as number) : 0;
        const buttons = c.options.map((o, i) => {
          const b = el("button", "opt", o);
          b.addEventListener("click", () => {
            if (!host.tapAllowed() || selected === i) return;
            selected = i;
            show();
            vibrate(15);
            host.send({ type: "control", control: c.id, value: i });
          });
          seg.append(b);
          return b;
        });
        const show = () => buttons.forEach((b, i) => b.classList.toggle("on", i === selected));
        show();
        setters.set(c.id, (v) => {
          if (typeof v !== "number") return;
          selected = v;
          show();
        });
        return box;
      }

      case "dpad": {
        // One thumb at a time, like a real d-pad: the direction follows the thumb as it slides.
        const box = el("div", "ctl dpad");
        styleColour(box, c);
        if (c.label) box.append(el("span", "lbl", c.label));
        const area = el("div", "area");
        const cross = el("div", "cross");
        const arms = new Map<DpadDirection, HTMLElement>();
        for (const d of DPAD_DIRECTIONS) {
          const arm = el("div", `arm a-${d}`);
          arm.append(icon(ARROW, { up: 0, right: 90, down: 180, left: 270 }[d]));
          cross.append(arm);
          arms.set(d, arm);
        }
        area.append(cross);
        box.append(area);
        let pointer: number | null = null;
        let current: DpadDirection | null = null;
        const aim = (e: PointerEvent): DpadDirection | null => {
          const r = cross.getBoundingClientRect();
          const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          if (Math.hypot(x, y) < 0.22) return null; // the middle is neutral
          return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
        };
        const go = (d: DpadDirection | null) => {
          if (d === current) return;
          if (current) release(`${c.id}.${current}`);
          current = d;
          if (d && pointer !== null) press(`${c.id}.${d}`, arms.get(d)!, pointer);
        };
        cross.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          if (pointer !== null || !host.tapAllowed()) return;
          pointer = e.pointerId;
          capture(cross, e.pointerId);
          go(aim(e));
        });
        cross.addEventListener("pointermove", (e) => {
          if (e.pointerId === pointer) go(aim(e));
        });
        const up = (e: PointerEvent) => {
          if (e.pointerId !== pointer) return;
          go(null);
          pointer = null;
        };
        cross.addEventListener("pointerup", up);
        cross.addEventListener("pointercancel", up);
        cross.addEventListener("contextmenu", (e) => e.preventDefault());
        // releaseAll (the page hiding, say) lets go through release(); forget the thumb too.
        resets.push(() => {
          current = null;
          pointer = null;
        });
        return box;
      }

      case "crawl": {
        // The classic dungeon-crawler keys: turn left, forward, turn right over step left, back, step right.
        const box = el("div", "ctl crawl");
        styleColour(box, c);
        if (c.label) box.append(el("span", "lbl", c.label));
        const area = el("div", "area");
        const keys = el("div", "keys");
        const order: [CrawlDirection, string, number, boolean][] = [
          ["turn-left", TURN, 0, false], ["forward", ARROW, 0, false], ["turn-right", TURN, 0, true],
          ["step-left", ARROW, 270, false], ["back", ARROW, 180, false], ["step-right", ARROW, 90, false],
        ];
        for (const [d, path, turn, flip] of order) {
          const k = el("button", `key k-${d}`);
          k.setAttribute("aria-label", d.replace("-", " "));
          k.append(icon(path, turn, flip));
          const id = `${c.id}.${d}`;
          k.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            if (held.has(id) || !host.tapAllowed()) return;
            capture(k, e.pointerId);
            press(id, k, e.pointerId);
          });
          const up = (e: PointerEvent) => {
            if (held.get(id)?.pointer === e.pointerId) release(id);
          };
          k.addEventListener("pointerup", up);
          k.addEventListener("pointercancel", up);
          k.addEventListener("contextmenu", (e) => e.preventDefault());
          keys.append(k);
        }
        area.append(keys);
        box.append(area);
        return box;
      }

      case "label": {
        const box = el("div", "ctl info");
        styleColour(box, c);
        const text = el("span", "text", String(values[c.id] ?? c.text ?? ""));
        if (c.label) box.append(el("span", "lbl", c.label));
        box.append(text);
        setters.set(c.id, (v) => {
          text.textContent = String(v);
        });
        return box;
      }
    }
  }

  return {
    set(control, value) {
      setters.get(control)?.(value);
    },
    releaseAll() {
      for (const id of [...held.keys()]) release(id);
      for (const reset of resets) reset();
    },
  };
}
