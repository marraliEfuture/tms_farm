/* Codici a tempo per la verifica in due passaggi (TOTP, RFC 6238: 6 cifre, 30 secondi, SHA-1),
   compatibili con Google Authenticator, Microsoft Authenticator, 1Password e simili. */
const crypto = require("crypto");
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; }
function b32decode(s) { let bits = ""; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += A.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function hotp(key, counter, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(c).digest(), o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}
const newSecret = () => b32encode(crypto.randomBytes(20));
const code = (secret, t = Date.now()) => hotp(b32decode(secret), Math.floor(t / 30000));
/* accetta il codice di adesso e quelli dei 30 secondi prima e dopo (orologi un po' diversi) */
function verify(secret, input, t = Date.now()) {
  const c = String(input || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const w of [-1, 0, 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(b32decode(secret), Math.floor(t / 30000) + w)), Buffer.from(c))) return true;
  return false;
}
const uri = (secret, user, issuer = "Ticket Farm") => "otpauth://totp/" + encodeURIComponent(issuer + ":" + user) + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&digits=6&period=30";
module.exports = { b32encode, b32decode, hotp, newSecret, code, verify, uri };
