export function nanoid(size = 16): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, size);
  }
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < size; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
