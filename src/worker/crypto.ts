const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// Never include the secret itself in exceptions or logs.
export class EncryptionConfigurationError extends Error {
  constructor() { super("TOKEN_ENCRYPTION_KEY is not a 32-byte Base64-encoded key"); this.name = "EncryptionConfigurationError"; }
}
async function key(material: string | undefined): Promise<CryptoKey> {
  if (!material || typeof material !== "string") throw new EncryptionConfigurationError();
  // Accept standard Base64 and URL-safe Base64, with or without trailing padding.
  const normalized = material.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(normalized)) throw new EncryptionConfigurationError();
  let bytes: Uint8Array;
  try { bytes = unb64(normalized.padEnd(44, "=")); }
  catch { throw new EncryptionConfigurationError(); }
  if (bytes.length !== 32) throw new EncryptionConfigurationError();
  return crypto.subtle.importKey("raw", bytes as BufferSource, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}
export async function encryptToken(text: string, material: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    {name:"AES-GCM",iv}, await key(material), encoder.encode(text)));
  return {ciphertext: b64(encrypted), iv: b64(iv)};
}
export async function decryptToken(ciphertext: string, iv: string, material: string): Promise<string> {
  return decoder.decode(await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:unb64(iv) as BufferSource},
    await key(material), unb64(ciphertext) as BufferSource));
}
export function newSessionToken() {return b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
export async function sha256(s: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  return [...hash].map(v=>v.toString(16).padStart(2,"0")).join("");
}
