const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// short, URL-friendly, and inside the server's room-name rules
export function newRoomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
