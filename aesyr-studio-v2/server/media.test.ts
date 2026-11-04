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
