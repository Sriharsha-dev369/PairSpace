const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// getRandomValues, not randomUUID: browsers offer randomUUID only over https or on localhost
export const randomId = (length: number) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (b) => ALPHABET[b % ALPHABET.length],
  ).join("");
