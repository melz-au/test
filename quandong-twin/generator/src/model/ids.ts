import { hash32 } from "./rng.ts";

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/**
 * Deterministic RFC 9562 version 8 ("custom") UUID derived from the given parts.
 * The same parts always give the same identifier, so regenerated events deduplicate cleanly.
 */
export function deterministicUuid(...parts: (string | number)[]): string {
  const key = parts.join("|");
  const h = [hash32(`${key}|0`), hash32(`${key}|1`), hash32(`${key}|2`), hash32(`${key}|3`)].map(hex8).join("");
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Short deterministic hex token, e.g. for logic checksums (8 hex characters). */
export function hexToken(...parts: (string | number)[]): string {
  return hex8(hash32(parts.join("|")));
}
