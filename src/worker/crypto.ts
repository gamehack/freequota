const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(material: string): Promise<CryptoKey> {
  const bytes = unb64(material);
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes in base64");
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
