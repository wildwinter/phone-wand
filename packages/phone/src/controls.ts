// Draws a layout's controls on the phone and reports what the player does with them. Templates
// place the controls for a thumb holding the phone like a torch; see docs/layouts.md.

import type { Control, ControlValue, Layout, PhoneToRelay } from "@phone-wand/core";

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
  const setters = new Map<string, (v: ControlValue) => void>();
  const held = new Map<string, { el: HTMLElement; pointer: number }>();

  const release = (id: string) => {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    h.el.classList.remove("down");
    host.send({ type: "button", button: id, down: false });
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
          held.set(c.id, { el: b, pointer: e.pointerId });
          b.classList.add("down");
          vibrate(10);
          host.send({ type: "button", button: c.id, down: true });
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
    },
  };
}
