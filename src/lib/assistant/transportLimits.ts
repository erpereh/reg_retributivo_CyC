export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;
export const MAX_PRIVACY_BLOCKED_TERMS = 5_000;

export function serializedRequestBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
