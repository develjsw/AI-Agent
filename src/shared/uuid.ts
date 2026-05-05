import { createHash } from "node:crypto";

export function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(name).digest();
  const uuidBytes = Buffer.from(hash.subarray(0, 16));
  uuidBytes.writeUInt8((uuidBytes.readUInt8(6) & 0x0f) | 0x50, 6);
  uuidBytes.writeUInt8((uuidBytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = uuidBytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
