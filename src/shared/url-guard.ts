import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export type LookupFn = (hostname: string) => Promise<string[]>;

function ipv4ToBytes(ip: string): number[] {
  return ip.split(".").map(Number);
}

function inRange(bytes: number[], network: number[], bits: number): boolean {
  const value = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const netValue = (network[0]! << 24) | (network[1]! << 16) | (network[2]! << 8) | network[3]!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (netValue & mask);
}

function parseIpv6(ip: string): number[] | null {
  const clean = ip.includes("%") ? ip.slice(0, ip.indexOf("%")) : ip;
  const halves = clean.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return [];
    }
    const out: number[] = [];
    for (const part of side.split(":")) {
      if (part.includes(".")) {
        const v4 = part.split(".").map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
          return null;
        }
        out.push(Number.parseInt(part, 16));
      }
    }
    return out;
  };
  const head = parseSide(halves[0] ?? "");
  if (!head) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parseSide(halves[1] ?? "");
  if (!tail) {
    return null;
  }
  const zeros = 8 - head.length - tail.length;
  if (zeros < 0) {
    return null;
  }
  return [...head, ...new Array<number>(zeros).fill(0), ...tail];
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const bytes = ipv4ToBytes(ip);
    return (
      inRange(bytes, [0, 0, 0, 0], 8) ||
      inRange(bytes, [10, 0, 0, 0], 8) ||
      inRange(bytes, [100, 64, 0, 0], 10) ||
      inRange(bytes, [127, 0, 0, 0], 8) ||
      inRange(bytes, [169, 254, 0, 0], 16) ||
      inRange(bytes, [172, 16, 0, 0], 12) ||
      inRange(bytes, [192, 0, 0, 0], 24) ||
      inRange(bytes, [192, 168, 0, 0], 16) ||
      inRange(bytes, [198, 18, 0, 0], 15) ||
      inRange(bytes, [224, 0, 0, 0], 4) ||
      inRange(bytes, [240, 0, 0, 0], 4)
    );
  }
  if (isIP(ip) === 6) {
    const groups = parseIpv6(ip.toLowerCase());
    if (!groups) {
      return true;
    }
    if (groups.slice(0, 6).every((group) => group === 0)) {
      return true;
    }
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      return isPrivateAddress(`${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`);
    }
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
      return true;
    }
    if ((groups[0]! & 0xfe00) === 0xfc00) {
      return true;
    }
    if ((groups[0]! & 0xffc0) === 0xfe80 || (groups[0]! & 0xffc0) === 0xfec0) {
      return true;
    }
    if ((groups[0]! & 0xff00) === 0xff00) {
      return true;
    }
    if (groups[0] === 0x2002 || (groups[0] === 0x2001 && groups[1] === 0)) {
      return true;
    }
    return false;
  }
  return true;
}

export async function assertSafeUrl(rawUrl: string, options: { allowPrivate?: boolean; lookup?: LookupFn } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Apenas URLs http/https são permitidas");
  }
  if (options.allowPrivate) {
    return url;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [hostname] : await (options.lookup ?? defaultLookup)(hostname);
  if (addresses.length === 0) {
    throw new Error("Endereço não resolvido");
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Endereço privado não permitido: ${address}`);
    }
  }
  return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}
