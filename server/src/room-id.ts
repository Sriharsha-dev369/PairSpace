const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// short, URL-friendly, and inside the sync server's room-name rules (36^10 possibilities)
export function newRoomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// a share link's secret: 16 random bytes (128 bits, unguessable), base64url so it fits a URL
export function newLinkCode(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}
