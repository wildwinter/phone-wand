import { execFileSync } from "node:child_process";
import { hostname, networkInterfaces, platform } from "node:os";

export interface LanAddress {
  address: string;
  iface: string;
}

// Interfaces that are almost never the Wi-Fi or Ethernet the phones are on.
const VIRTUAL = /^(lo|utun|awdl|llw|bridge|vmnet|vboxnet|docker|br-|veth|virbr|tailscale|zt|anpi|ap\d|vEthernet|VirtualBox|VMware|Loopback)/i;

function isPrivate(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

let wifiCache: Set<string> | null = null;

/**
 * The computer's Wi-Fi interfaces. Phones are on Wi-Fi, so when a computer is also wired to another
 * network, its Wi-Fi address is the one phones can reach. On a Mac, ask which device is Wi-Fi;
 * elsewhere the interface names say.
 */
function wifiInterfaces(): Set<string> {
  if (wifiCache) return wifiCache;
  wifiCache = new Set();
  if (platform() === "darwin") {
    try {
      const ports = execFileSync("networksetup", ["-listallhardwareports"], { encoding: "utf8", timeout: 2000 });
      for (const m of ports.matchAll(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/g)) wifiCache.add(m[1]);
    } catch {
      // not available: fall back on names
    }
  }
  for (const iface of Object.keys(networkInterfaces())) {
    if (/^(wl|wlan|Wi-?Fi|WLAN|Wireless)/i.test(iface)) wifiCache.add(iface);
  }
  return wifiCache;
}

/** Non-internal IPv4 addresses, best guess for "the LAN" first: Wi-Fi before wired. */
export function lanAddresses(): LanAddress[] {
  const out: (LanAddress & { score: number })[] = [];
  const wifi = wifiInterfaces();
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      let score = 0;
      if (isPrivate(a.address)) score += 10;
      if (!VIRTUAL.test(iface)) score += 5;
      if (/^(en0|en1|eth0|wlan0|wlp|Wi-?Fi|Ethernet)/i.test(iface)) score += 3;
      if (wifi.has(iface)) score += 4;
      if (/^169\.254\./.test(a.address)) score -= 20;
      out.push({ address: a.address, iface, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.map(({ address, iface }) => ({ address, iface }));
}

/** Names the certificate should cover. */
export function certificateNames(host: string): string[] {
  const names = new Set<string>(["localhost", "127.0.0.1"]);
  for (const a of lanAddresses()) names.add(a.address);
  const h = hostname();
  if (h) {
    names.add(h);
    if (!h.includes(".")) names.add(`${h}.local`);
  }
  if (host) names.add(host);
  return [...names];
}
