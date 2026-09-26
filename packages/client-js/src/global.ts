// Entry for the plain <script> build: exposes window.PhoneWand (the client class, with the helpers
// attached), so `new PhoneWand()` works without a bundler.
import { DEFAULT_URL, PROTOCOL_VERSION, PhoneWand, quatToRightHanded, toPixels, toRightHanded } from "./index.js";

(globalThis as any).PhoneWand = Object.assign(PhoneWand, {
  PhoneWand, toPixels, toRightHanded, quatToRightHanded, DEFAULT_URL, PROTOCOL_VERSION,
});
