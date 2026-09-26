// Certificates for the phone page. Phones only give orientation to secure pages, so the relay
// serves HTTPS. By default it keeps a small local certificate authority in the data directory and
// issues itself a certificate for this machine's addresses. Phones either tap through a warning
// once, or install the CA (served at /ca.crt) to trust it with no warnings. A certificate and key
// from elsewhere (mkcert, or a real certificate for a local name) can be used instead.

import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

x509.cryptoProvider.set(crypto);

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const DAY = 864e5;

export interface TlsMaterial {
  cert: string;
  key: string;
  /** DER bytes of the local CA, when the relay made its own certificate. */
  caDer: Uint8Array | null;
  caPem: string | null;
  source: "local-ca" | "files";
}

function randomSerial(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  b[0] &= 0x7f; // keep it positive
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function exportKey(key: CryptoKey): Promise<string> {
  return x509.PemConverter.encode(await crypto.subtle.exportKey("pkcs8", key), "PRIVATE KEY");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const der = x509.PemConverter.decode(pem)[0];
  return crypto.subtle.importKey("pkcs8", der, ALG, true, ["sign"]);
}

async function loadOrCreateCa(dir: string) {
  const certPath = join(dir, "ca.crt.pem");
  const keyPath = join(dir, "ca.key.pem");
  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = new x509.X509Certificate(readFileSync(certPath, "utf8"));
    if (cert.notAfter.getTime() - Date.now() > 30 * DAY) {
      return { cert, key: await importKey(readFileSync(keyPath, "utf8")) };
    }
  }
  const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const host = (process.env.HOSTNAME || "").split(".")[0];
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: `CN=Phone Wand local CA${host ? ` (${host})` : ""}, O=Phone Wand`,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3650 * DAY),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  writeFileSync(certPath, cert.toString("pem"));
  writeFileSync(keyPath, await exportKey(keys.privateKey), { mode: 0o600 });
  return { cert, key: keys.privateKey };
}

/** Issue (or reuse) a server certificate covering `names` (IP addresses and DNS names). */
export async function localTls(dataDir: string, names: string[]): Promise<TlsMaterial> {
  mkdirSync(dataDir, { recursive: true });
  const ca = await loadOrCreateCa(dataDir);
  const leafCert = join(dataDir, "server.crt.pem");
  const leafKey = join(dataDir, "server.key.pem");
  const wanted = [...new Set(names)].sort();

  if (existsSync(leafCert) && existsSync(leafKey)) {
    const cert = new x509.X509Certificate(readFileSync(leafCert, "utf8"));
    const san = cert.getExtension(x509.SubjectAlternativeNameExtension);
    const have = (san?.names.items ?? []).map((n) => n.value).sort();
    const fresh = cert.notAfter.getTime() - Date.now() > 30 * DAY;
    const sameIssuer = cert.issuer === ca.cert.subject;
    if (fresh && sameIssuer && wanted.every((n) => have.includes(n))) {
      return material(readFileSync(leafCert, "utf8"), readFileSync(leafKey, "utf8"), ca.cert);
    }
  }

  const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const isIp = (n: string) => /^\d+\.\d+\.\d+\.\d+$/.test(n) || n.includes(":");
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerial(),
    subject: "CN=Phone Wand relay, O=Phone Wand",
    issuer: ca.cert.subject,
    // Apple rejects server certificates valid for more than 398 days.
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 397 * DAY),
    publicKey: keys.publicKey,
    signingKey: ca.key,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(wanted.map((n) => ({ type: (isIp(n) ? "ip" : "dns") as "ip" | "dns", value: n }))),
      await x509.AuthorityKeyIdentifierExtension.create(ca.cert),
    ],
  });
  const certPem = cert.toString("pem");
  const keyPem = await exportKey(keys.privateKey);
  writeFileSync(leafCert, certPem);
  writeFileSync(leafKey, keyPem, { mode: 0o600 });
  return material(certPem, keyPem, ca.cert);
}

function material(certPem: string, keyPem: string, ca: x509.X509Certificate): TlsMaterial {
  return {
    cert: `${certPem.trim()}\n${ca.toString("pem").trim()}\n`,
    key: keyPem,
    caDer: new Uint8Array(ca.rawData),
    caPem: ca.toString("pem"),
    source: "local-ca",
  };
}

export function fileTls(certPath: string, keyPath: string): TlsMaterial {
  return {
    cert: readFileSync(certPath, "utf8"),
    key: readFileSync(keyPath, "utf8"),
    caDer: null,
    caPem: null,
    source: "files",
  };
}
