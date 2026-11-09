const test = require("node:test");
const assert = require("node:assert");
const { pngWidth, VALID } = require("../src/logos");

test("legge la larghezza di un PNG", () => {
  const b = Buffer.alloc(30); Buffer.from("89504e470d0a1a0a", "hex").copy(b, 0); b.writeUInt32BE(128, 16);
  assert.equal(pngWidth(b), 128);
  assert.equal(pngWidth(Buffer.from("non un png")), 0);
});
test("accetta solo nomi di dominio", () => {
  assert.ok(VALID.test("caseificiovalle.ch")); assert.ok(VALID.test("chemlab-ticino.ch"));
  assert.ok(!VALID.test("../etc/passwd")); assert.ok(!VALID.test("localhost")); assert.ok(!VALID.test("a b.ch"));
});

test("scarica, salva in cache e scarta l'icona generica", async () => {
  const fs = require("fs"), path = require("path"), cfg = require("../src/config");
  const logos = require("../src/logos");
  const png = w => { const b = Buffer.alloc(40); Buffer.from("89504e470d0a1a0a", "hex").copy(b, 0); b.writeUInt32BE(w, 16); return b; };
  const real = global.fetch; let calls = 0;
  global.fetch = async url => { calls++; const w = url.includes("conlogo") ? 128 : 16;
    return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => png(w) }; };
  try {
    const a = await logos.get("conlogo-test.ch");
    assert.ok(a && a.buf.length === 40);
    assert.equal(await logos.get("senzalogo-test.ch"), null);
    await logos.get("conlogo-test.ch"); await logos.get("senzalogo-test.ch");
    assert.equal(calls, 2, "la seconda volta usa la cache");
  } finally {
    global.fetch = real;
    for (const f of ["conlogo-test.ch", "conlogo-test.ch.type", "senzalogo-test.ch.none"]) { try { fs.unlinkSync(path.join(cfg.dataDir, "logos", f)); } catch (e) {} }
  }
});
