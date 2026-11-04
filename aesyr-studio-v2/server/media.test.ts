import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AUDIO_BYTES, saveAudio, sniffAudio } from "./media";

const bytes = (s: string, pad = 16) => new Uint8Array([...Buffer.from(s, "latin1"), ...new Array(pad).fill(0)]);

test("sniffs audio containers from their bytes", () => {
  assert.equal(sniffAudio(bytes("RIFF\0\0\0\0WAVE")), "wav");
  assert.equal(sniffAudio(bytes("OggS")), "ogg");
  assert.equal(sniffAudio(bytes("\0\0\0\x20ftypM4A ")), "m4a");
  assert.equal(sniffAudio(bytes("ID3\x04")), "mp3");
  assert.equal(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), "mp3");
  assert.equal(sniffAudio(bytes("<html>")), null);
  assert.equal(sniffAudio(bytes("\x89PNG")), null);
});

test("saves accepted audio under a random name; rejects others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aesyr-audio-"));
  try {
    const r = await saveAudio(bytes("RIFF\0\0\0\0WAVE"), { MEDIA_DIR: dir });
    assert.match(r.url, /^\/media\/[0-9a-f-]{36}\.wav$/);
    assert.ok((await readFile(join(dir, r.url.slice(7)))).length > 0);
    await assert.rejects(saveAudio(bytes("<script>"), { MEDIA_DIR: dir }), /Unsupported audio/);
    await assert.rejects(saveAudio(new Uint8Array(), { MEDIA_DIR: dir }), /Empty/);
    await assert.rejects(saveAudio(new Uint8Array(MAX_AUDIO_BYTES + 1), { MEDIA_DIR: dir }), /50 MB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renameGlbAnimations: renames clips and keeps a valid GLB", async () => {
  const { renameGlbAnimations, isGlb } = await import("./media");
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, animations: [{ name: "Reconstructed_Action", channels: [], samplers: [] }] }).padEnd(84, " "));
  const bin = new Uint8Array([8, 0, 0, 0, 0x42, 0x49, 0x4e, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
  const glb = new Uint8Array(20 + json.length + bin.length);
  const v = new DataView(glb.buffer);
  glb.set([0x67, 0x6c, 0x54, 0x46], 0);
  v.setUint32(4, 2, true);
  v.setUint32(8, glb.length, true);
  v.setUint32(12, json.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  glb.set(json, 20);
  glb.set(bin, 20 + json.length);
  const out = renameGlbAnimations(glb, ["waves its right hand 1"]);
  const ov = new DataView(out.buffer);
  assert.ok(isGlb(out));
  assert.equal(ov.getUint32(8, true), out.length);
  const len = ov.getUint32(12, true);
  assert.equal(len % 4, 0);
  assert.equal(JSON.parse(new TextDecoder().decode(out.subarray(20, 20 + len))).animations[0].name, "waves its right hand 1");
  assert.deepEqual([...out.subarray(20 + len)], [...bin]);
});
