// Network side of the relay: an HTTPS server for phones (page, WebSocket and HTTP fallback) and a
// plain HTTP server on localhost for apps (WebSocket, dashboard, QR code, status).

import type { Server, ServerWebSocket } from "bun";
import QRCode from "qrcode";
import type { AppToRelay, PhoneToRelay, RelayToApp, RelayToPhone } from "@phone-wand/core";
import { type PhoneConnection, type PhoneLink, Session } from "./session.js";
import type { TlsMaterial } from "./certs.js";
import { CLIENT_JS, DASHBOARD_HTML, LANDING_HTML, PHONE_HTML } from "./generated/assets.js";

type WsData =
  | { kind: "phone"; conn?: PhoneConnection }
  | { kind: "app"; app?: ReturnType<Session["addApp"]> };

export interface ServerOptions {
  phonePort: number;
  appPort: number;
  appHost: string;
  httpPort: number; // plain HTTP for phones; 0 = off
  /** Ports to try, in order, for the plain HTTP welcome page the QR code opens. Empty = off. */
  landingPorts: number[];
  tls: TlsMaterial;
  /** Extra web origins allowed to connect to /app, or "*" for any. */
  allowOrigins: string[];
  /** Called when a newer relay on this computer asks this one to stop, so it can take over. */
  onShutdownRequest: () => void;
}

/**
 * Web pages carry an Origin header; native apps usually do not. Only let pages from this computer
 * (or origins the user allowed) connect as apps, so a random website open in a browser cannot.
 */
export function originAllowed(origin: string | null, allowed: string[], requestHost = ""): boolean {
  if (!origin || origin === "null") return true;
  if (allowed.includes("*") || allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    // Some native WebSocket clients (Unreal's among them) send an Origin naming the host they
    // connected to. A page from the relay's own address is local too.
    if (requestHost && host === requestHost.replace(/:\d+$/, "")) return true;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export interface RunningServers {
  stop(): void;
  /** The port the welcome page is served on, or 0 if none (off, or every port was taken). */
  landingPort: number;
}

function parse<T>(raw: string | Buffer): T | null {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString()) as T;
  } catch {
    return null;
  }
}

/** A phone on the HTTP fallback: POSTs up, Server-Sent Events down. */
class HttpPhoneLink implements PhoneLink {
  readonly transport = "http" as const;
  conn!: PhoneConnection;
  lastSeen = Date.now();
  closed = false;
  private queue: string[] = [];
  private stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();

  constructor(private readonly onClose: (link: HttpPhoneLink) => void) {}

  send(msg: RelayToPhone): void {
    if (this.closed) return;
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    if (this.stream) {
      try {
        this.stream.enqueue(this.encoder.encode(line));
        return;
      } catch {
        this.stream = null;
      }
    }
    this.queue.push(line);
    if (this.queue.length > 100) this.queue.shift();
  }

  attach(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.stream = controller;
    controller.enqueue(this.encoder.encode(": connected\n\n"));
    for (const line of this.queue.splice(0)) controller.enqueue(this.encoder.encode(line));
  }

  detach(controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (this.stream === controller) this.stream = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream?.close();
    } catch {
      // already closed
    }
    this.stream = null;
    this.onClose(this);
  }
}

export function startServers(session: Session, opts: ServerOptions): RunningServers {
  const httpLinks = new Map<string, HttpPhoneLink>();

  const dropHttp = (link: HttpPhoneLink) => {
    for (const [sid, l] of httpLinks) if (l === link) httpLinks.delete(sid);
    session.phoneClosed(link.conn);
  };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const link of httpLinks.values()) if (now - link.lastSeen > 15_000) link.close();
  }, 2000);

  // ------------------------------------------------------------ phone routes

  async function phoneFetch(req: Request, server: Server<WsData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/":
      case "/index.html":
        return new Response(PHONE_HTML, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      case "/app": {
        // A secure app endpoint, for web builds served over HTTPS that cannot open a plain ws://
        // connection. Only from this computer: phones and other machines never get it.
        const ip = server.requestIP(req)?.address ?? "";
        const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
        if (!local) return new Response("Not found", { status: 404 });
        if (!originAllowed(req.headers.get("origin"), opts.allowOrigins, req.headers.get("host") ?? "")) {
          console.warn(`Refused an app connection from a web page at ${req.headers.get("origin")}. Use --allow-origin to permit it.`);
          return new Response("Origin not allowed. Start the relay with --allow-origin to permit it.", { status: 403 });
        }
        if (server.upgrade(req, { data: { kind: "app" } })) return undefined;
        return new Response("WebSocket expected", { status: 400 });
      }
      case "/phone":
        if (server.upgrade(req, { data: { kind: "phone" } })) return undefined;
        return new Response("WebSocket expected", { status: 400 });
      case "/phone/send": {
        if (req.method !== "POST") return new Response(null, { status: 405 });
        const sid = url.searchParams.get("sid") ?? "";
        const msgs = parse<PhoneToRelay[]>(await req.text());
        if (!sid || !Array.isArray(msgs)) return new Response(null, { status: 400 });
        let link = httpLinks.get(sid);
        if (!link) {
          if (msgs[0]?.type !== "hello") return new Response(null, { status: 410 });
          link = new HttpPhoneLink(dropHttp);
          link.conn = session.addPhone(link);
          httpLinks.set(sid, link);
        }
        link.lastSeen = Date.now();
        for (const m of msgs) session.phoneMessage(link.conn, m);
        return new Response(null, { status: link.closed ? 410 : 204 });
      }
      case "/phone/events": {
        const link = httpLinks.get(url.searchParams.get("sid") ?? "");
        if (!link) return new Response(null, { status: 410 });
        let ctl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctl = c;
            link.attach(c);
          },
          cancel() {
            link.detach(ctl);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      }
      case "/ping":
        // Lets the welcome page check whether this phone already trusts the certificate.
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      case "/ca.crt":
        if (!opts.tls.caDer) return new Response("Not using the local certificate authority", { status: 404 });
        return new Response(opts.tls.caDer as Uint8Array<ArrayBuffer>, {
          headers: {
            "content-type": "application/x-x509-ca-cert",
            "content-disposition": 'attachment; filename="phone-wand-ca.crt"',
          },
        });
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  const websocket = {
    idleTimeout: 60,
    open(ws: ServerWebSocket<WsData>) {
      if (ws.data.kind === "phone") {
        ws.data.conn = session.addPhone({
          transport: "ws",
          send: (m: RelayToPhone) => ws.send(JSON.stringify(m)),
          close: () => ws.close(),
        });
      } else {
        ws.data.app = session.addApp({ send: (m: RelayToApp) => ws.send(JSON.stringify(m)) });
      }
    },
    message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
      if (ws.data.kind === "phone") {
        const msg = parse<PhoneToRelay>(raw);
        if (msg && ws.data.conn) session.phoneMessage(ws.data.conn, msg);
      } else {
        const msg = parse<AppToRelay>(raw);
        if (msg && ws.data.app) session.appMessage(ws.data.app, msg);
      }
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.kind === "phone") {
        if (ws.data.conn) session.phoneClosed(ws.data.conn);
      } else if (ws.data.app) {
        session.removeApp(ws.data.app);
      }
    },
  };

  const phoneServer = Bun.serve<WsData>({
    port: opts.phonePort,
    hostname: "0.0.0.0",
    tls: { cert: opts.tls.cert, key: opts.tls.key },
    idleTimeout: 30,
    fetch: phoneFetch,
    websocket,
  });

  const plainPhoneServer = opts.httpPort
    ? Bun.serve<WsData>({ port: opts.httpPort, hostname: "0.0.0.0", idleTimeout: 30, fetch: phoneFetch, websocket })
    : null;

  // ------------------------------------------------------------ welcome page

  // The QR code opens this plain-HTTP page, which shows no warning. It explains the certificate
  // warning before the phone shows it, or goes straight on if the phone already trusts the relay.
  let landingServer: ReturnType<typeof Bun.serve> | null = null;
  const landing = LANDING_HTML.replace("__PHONE_PORT__", String(opts.phonePort));
  for (const port of opts.landingPorts) {
    try {
      landingServer = Bun.serve({
        port,
        hostname: "0.0.0.0",
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(landing, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
          }
          if (url.pathname === "/ca.crt") return phoneFetch(req, phoneServer as never) as Promise<Response>;
          return new Response("Not found", { status: 404 });
        },
      });
      break;
    } catch {
      // taken by another program: try the next one
    }
  }

  // ------------------------------------------------------------ app routes

  const appServer = Bun.serve<WsData>({
    port: opts.appPort,
    hostname: opts.appHost,
    idleTimeout: 30,
    async fetch(req, server) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/":
        case "/index.html":
          return new Response(DASHBOARD_HTML, {
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          });
        case "/app":
          if (!originAllowed(req.headers.get("origin"), opts.allowOrigins, req.headers.get("host") ?? "")) {
            console.warn(`Refused an app connection from a web page at ${req.headers.get("origin")}. Use --allow-origin to permit it.`);
            return new Response("Origin not allowed. Start the relay with --allow-origin to permit it.", { status: 403 });
          }
          if (server.upgrade(req, { data: { kind: "app" } })) return undefined;
          return new Response("WebSocket expected", { status: 400 });
        case "/phone-wand.js":
          return new Response(CLIENT_JS, {
            headers: { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*" },
          });
        case "/qr.png": {
          const size = Math.min(2048, Math.max(64, Number(url.searchParams.get("size")) || 400));
          const png = await QRCode.toBuffer(session.options.joinUrl, { type: "png", width: size, margin: 2 });
          return new Response(new Uint8Array(png), {
            headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" },
          });
        }
        case "/qr.svg": {
          const svg = await QRCode.toString(session.options.joinUrl, { type: "svg", margin: 2 });
          return new Response(svg, {
            headers: { "content-type": "image/svg+xml", "access-control-allow-origin": "*", "cache-control": "no-store" },
          });
        }
        case "/status.json":
          return Response.json(session.status(), { headers: { "access-control-allow-origin": "*" } });
        case "/shutdown": {
          // A new relay starting on this computer asks the old one to make way. Only from this
          // computer, and only with a custom header, which a web page cannot send without a CORS
          // preflight that the relay never approves.
          const ip = server.requestIP(req)?.address ?? "";
          const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
          if (req.method !== "POST" || !local || req.headers.get("x-phone-wand") !== "shutdown") {
            return new Response(null, { status: 403 });
          }
          setTimeout(opts.onShutdownRequest, 50);
          return new Response(null, { status: 202 });
        }
        case "/ca.crt":
          return phoneFetch(req, server);
        default:
          return new Response("Not found", { status: 404 });
      }
    },
    websocket,
  });

  return {
    landingPort: landingServer?.port ?? 0,
    stop() {
      clearInterval(sweep);
      phoneServer.stop(true);
      plainPhoneServer?.stop(true);
      landingServer?.stop(true);
      appServer.stop(true);
    },
  };
}
