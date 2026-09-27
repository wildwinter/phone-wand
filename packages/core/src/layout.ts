// Phone layouts: which controls a phone shows, and where. Apps choose a template and fill in its
// controls; the phone page places them for the player's thumb. See docs/layouts.md.

export type Template = "primary" | "primary-secondary" | "pair" | "primary-row" | "grid" | "rows" | "columns";

interface ControlBase {
  /** The app's name for this control. Button presses and value changes carry it. */
  id: string;
  /** Text on the control. */
  label?: string;
  /** #rrggbb; the player's colour when omitted. */
  colour?: string;
}

export interface ButtonControl extends ControlBase { type: "button" }
/** A big round button, like the default Primary. Presses arrive as button events, as for a button. */
export interface PadControl extends ControlBase { type: "pad" }
export interface ToggleControl extends ControlBase { type: "toggle"; value?: boolean }
export interface SliderControl extends ControlBase {
  type: "slider";
  /** 0 to 1. */
  value?: number;
  orientation?: "horizontal" | "vertical";
  /** Where the slider returns when released (0 to 1), or null to stay put. */
  spring?: number | null;
}
export interface ChoiceControl extends ControlBase {
  type: "choice";
  /** Two to four options. */
  options: string[];
  /** Index of the selected option. */
  value?: number;
}
export interface LabelControl extends ControlBase { type: "label"; text?: string }
/** Four arrows. Each direction is a button: a d-pad "move" presses "move.up", "move.left" and so on. */
export interface DpadControl extends ControlBase { type: "dpad" }
/** Dungeon-crawler movement: turn and step left and right, forward and back, each a button like the d-pad's. */
export interface CrawlControl extends ControlBase { type: "crawl" }

/** An empty cell: it takes up room and shows nothing. It needs no id. */
export interface SpaceControl { type: "space"; id?: string }

export type Control =
  | ButtonControl | PadControl | ToggleControl | SliderControl | ChoiceControl | LabelControl | DpadControl | CrawlControl
  | SpaceControl;
export type ControlValue = boolean | number | string;

export interface Layout {
  template: Template;
  controls: Control[];
  /** "rows" only: how many controls in each row, top (the pointing end) to bottom. */
  rows?: number[];
  /** "rows" only: relative heights of the rows. Equal when left out. */
  heights?: number[];
  /** "columns" only: how many controls in each column, left to right (mirrored for left hands). */
  columns?: number[];
  /** "columns" only: relative widths of the columns. Equal when left out. */
  widths?: number[];
}

/** Limits for the "rows" and "columns" templates, so every control stays big enough for a thumb. */
export const MAX_LINES = 4;
export const MAX_PER_LINE = 4;

/** The directions of a d-pad and a crawl pad. Each is pressed as the button "<control id>.<direction>". */
export const DPAD_DIRECTIONS = ["up", "down", "left", "right"] as const;
export const CRAWL_DIRECTIONS = ["forward", "back", "step-left", "step-right", "turn-left", "turn-right"] as const;
export type DpadDirection = (typeof DPAD_DIRECTIONS)[number];
export type CrawlDirection = (typeof CRAWL_DIRECTIONS)[number];

/** Every button a layout has: its buttons, and each direction of its d-pads and crawl pads. */
export function layoutButtons(layout: Layout): string[] {
  const out: string[] = [];
  for (const c of layout.controls) {
    if (c.type === "button" || c.type === "pad") out.push(c.id);
    else if (c.type === "dpad") for (const d of DPAD_DIRECTIONS) out.push(`${c.id}.${d}`);
    else if (c.type === "crawl") for (const d of CRAWL_DIRECTIONS) out.push(`${c.id}.${d}`);
  }
  return out;
}

/**
 * How many controls each template holds (at most). The first control of a primary template is the
 * big one. "rows" and "columns" hold exactly as many as their counts add up to.
 */
export const TEMPLATE_SLOTS: Record<Template, number> = {
  primary: 1,
  "primary-secondary": 2,
  pair: 2,
  "primary-row": 4,
  grid: 6,
  rows: 8,
  columns: 8,
};

/** What a phone shows until an app sends a layout. */
export const DEFAULT_LAYOUT: Layout = {
  template: "primary-secondary",
  controls: [
    { id: "primary", type: "button", label: "Primary" },
    { id: "secondary", type: "button", label: "Secondary" },
  ],
};

const ID = /^[A-Za-z0-9_.-]{1,32}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, max) : undefined;
const unit = (v: unknown): number | undefined =>
  typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;

/**
 * Check and tidy a layout from an app. Returns the clean layout, or a sentence saying what is wrong.
 * Unknown fields are dropped; text is trimmed to sensible lengths.
 */
export function validateLayout(raw: unknown): Layout | string {
  if (!raw || typeof raw !== "object") return "layout must be an object";
  const r = raw as { template?: unknown; controls?: unknown };
  const template = r.template as Template;
  if (!(template in TEMPLATE_SLOTS)) return `unknown template ${String(r.template)}; expected one of ${Object.keys(TEMPLATE_SLOTS).join(", ")}`;
  if (!Array.isArray(r.controls) || r.controls.length === 0) return "layout needs at least one control";
  if (r.controls.length > TEMPLATE_SLOTS[template]) return `template ${template} holds at most ${TEMPLATE_SLOTS[template]} controls`;
  const seen = new Set<string>();
  const controls: Control[] = [];
  for (const c of r.controls as Record<string, unknown>[]) {
    if (!c || typeof c !== "object") return "each control must be an object";
    if (c.type === "space") {
      // Space needs no id; one it has must still be a proper, unique id.
      if (c.id === undefined) {
        controls.push({ type: "space" });
        continue;
      }
      if (typeof c.id !== "string" || !ID.test(c.id) || seen.has(c.id)) return `space id ${String(c.id)} must be a unique id, or left out`;
      seen.add(c.id);
      controls.push({ type: "space", id: c.id });
      continue;
    }
    const id = c.id;
    if (typeof id !== "string" || !ID.test(id)) return `control id ${String(id)} must be 1 to 32 letters, digits, _ . or -`;
    if (seen.has(id)) return `control id ${id} is used twice`;
    seen.add(id);
    const base: ControlBase = { id };
    const label = text(c.label, 24);
    if (label) base.label = label;
    if (typeof c.colour === "string" && HEX.test(c.colour)) base.colour = c.colour.toLowerCase();
    switch (c.type) {
      case "button":
      case "pad":
        controls.push({ ...base, type: c.type });
        break;
      case "toggle":
        controls.push({ ...base, type: "toggle", value: c.value === true });
        break;
      case "slider": {
        const spring = c.spring === null || c.spring === undefined ? null : unit(c.spring) ?? null;
        controls.push({
          ...base, type: "slider",
          value: unit(c.value) ?? spring ?? 0,
          orientation: c.orientation === "vertical" ? "vertical" : "horizontal",
          spring,
        });
        break;
      }
      case "choice": {
        const options = Array.isArray(c.options) ? c.options.map((o) => text(o, 16) ?? "").filter(Boolean) : [];
        if (options.length < 2 || options.length > 4) return `choice ${id} needs 2 to 4 options`;
        const value = typeof c.value === "number" && Number.isInteger(c.value) && c.value >= 0 && c.value < options.length ? c.value : 0;
        controls.push({ ...base, type: "choice", options, value });
        break;
      }
      case "label":
        controls.push({ ...base, type: "label", text: text(c.text, 80) ?? "" });
        break;
      case "dpad":
      case "crawl":
        controls.push({ ...base, type: c.type });
        break;
      default:
        return `control ${id} has unknown type ${String(c.type)}; expected button, pad, toggle, slider, choice, label, dpad, crawl or space`;
    }
  }
  const first = controls[0].type;
  const shaped: Layout = { template, controls };
  if (template === "rows" || template === "columns") {
    const counts = template === "rows" ? "rows" : "columns";
    const sizes = template === "rows" ? "heights" : "widths";
    const n = (r as Record<string, unknown>)[counts];
    if (!Array.isArray(n) || n.length < 1 || n.length > MAX_LINES || !n.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_PER_LINE)) {
      return `template ${template} needs ${counts}: 1 to ${MAX_LINES} counts, each 1 to ${MAX_PER_LINE}`;
    }
    const total = (n as number[]).reduce((a, b) => a + b, 0);
    if (total !== controls.length) return `${counts} ${JSON.stringify(n)} holds ${total} controls, but the layout has ${controls.length}`;
    shaped[counts] = n as number[];
    const w = (r as Record<string, unknown>)[sizes];
    if (w !== undefined && w !== null) {
      if (!Array.isArray(w) || w.length !== n.length || !w.every((x) => typeof x === "number" && x > 0 && isFinite(x))) {
        return `${sizes} must be ${n.length} positive numbers, one for each of the ${counts}`;
      }
      // Relative sizes, as given; none may be under a tenth of the biggest, or it shrinks to nothing.
      const most = Math.max(...(w as number[]));
      shaped[sizes] = (w as number[]).map((x) => Math.round(Math.max(x, most / 10) * 1000) / 1000);
    }
  }
  if (template.startsWith("primary") && !["button", "pad", "dpad", "crawl"].includes(first)) {
    return `the first control of template ${template} is the big primary control, so it must be a button, pad, dpad or crawl`;
  }
  // Direction buttons are "<id>.<direction>": they must not clash with another control's id.
  for (const c of controls) {
    const dirs = c.type === "dpad" ? DPAD_DIRECTIONS : c.type === "crawl" ? CRAWL_DIRECTIONS : [];
    for (const d of dirs) {
      if (seen.has(`${c.id}.${d}`)) return `control id ${c.id}.${d} clashes with a direction of ${c.type} ${c.id}`;
    }
  }
  return shaped;
}

/** The current value of every control that has one. Buttons have none. */
export function layoutValues(layout: Layout): Record<string, ControlValue> {
  const values: Record<string, ControlValue> = {};
  for (const c of layout.controls) {
    if (c.type === "toggle") values[c.id] = c.value ?? false;
    else if (c.type === "slider") values[c.id] = c.value ?? 0;
    else if (c.type === "choice") values[c.id] = c.value ?? 0;
    else if (c.type === "label") values[c.id] = c.text ?? "";
  }
  return values;
}

/**
 * Tidy a value for a control, or return undefined if it doesn't fit (wrong type, or a button).
 * Labels take text; toggles booleans; sliders 0 to 1; choices an option index.
 */
export function controlValue(control: Control, value: unknown): ControlValue | undefined {
  switch (control.type) {
    case "toggle":
      return typeof value === "boolean" ? value : undefined;
    case "slider":
      return unit(value);
    case "choice":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < control.options.length ? value : undefined;
    case "label":
      return text(value, 80);
    default:
      return undefined;
  }
}

/** How a layout is drawn: rows (or columns) of controls, with their relative sizes. */
export interface Arrangement {
  columns: boolean;
  /** Controls in each row (or column), in order. */
  lines: Control[][];
  /** Relative size of each line. */
  sizes: number[];
}

/**
 * Every template is drawn as rows or columns. The fixed templates are presets: in the primary
 * templates the first button is drawn as a pad, and primary-secondary keeps a space on the thumb's
 * side of the smaller control, so it sits towards the palm.
 */
export function arrange(layout: Layout): Arrangement {
  const controls = [...layout.controls];
  const lines = (counts: number[]): Control[][] => {
    let next = 0;
    return counts.map((n) => controls.slice(next, (next += n)));
  };
  const sized = (counts: number[], sizes?: number[]) => ({ lines: lines(counts), sizes: sizes ?? counts.map(() => 1) });
  const n = controls.length;
  if (layout.template.startsWith("primary") && controls[0]?.type === "button") controls[0] = { ...controls[0], type: "pad" };
  switch (layout.template) {
    case "rows":
      return { columns: false, ...sized(layout.rows ?? [n], layout.heights) };
    case "columns":
      return { columns: true, ...sized(layout.columns ?? [n], layout.widths) };
    case "pair":
      return { columns: false, ...sized([n]) };
    case "grid": {
      if (n % 2) controls.push({ type: "space" });
      return { columns: false, ...sized(Array(Math.ceil(n / 2)).fill(2)) };
    }
    case "primary-secondary":
      if (n > 1) controls.splice(1, 0, { type: "space" });
      return { columns: false, ...sized(n > 1 ? [1, 2] : [1], n > 1 ? [3, 1] : undefined) };
    case "primary-row":
      return { columns: false, ...sized(n > 1 ? [1, n - 1] : [1], n > 1 ? [3, 1] : undefined) };
    default:
      return { columns: false, ...sized([n]) };
  }
}
