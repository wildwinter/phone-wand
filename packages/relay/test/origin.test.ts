import { expect, test } from "bun:test";
import { originAllowed } from "../src/server.js";

test("apps without an origin, or from this computer, are allowed", () => {
  expect(originAllowed(null, [])).toBe(true);
  expect(originAllowed("null", [])).toBe(true);
  expect(originAllowed("http://localhost:5173", [])).toBe(true);
  expect(originAllowed("http://127.0.0.1:8480", [])).toBe(true);
  expect(originAllowed("http://game.localhost", [])).toBe(true);
});

test("other web origins need --allow-origin", () => {
  expect(originAllowed("https://example.com", [])).toBe(false);
  expect(originAllowed("https://example.com", ["https://example.com"])).toBe(true);
  expect(originAllowed("https://example.com", ["*"])).toBe(true);
  expect(originAllowed("https://localhost.example.com", [])).toBe(false);
});

test("an origin naming the host the client connected to is allowed", () => {
  expect(originAllowed("http://192.168.1.20", [], "192.168.1.20:8480")).toBe(true);
  expect(originAllowed("http://192.168.1.99", [], "192.168.1.20:8480")).toBe(false);
});
