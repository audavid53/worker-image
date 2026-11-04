// Word-timed transcript via OpenAI. Reads OPENAI_API_KEY from the given .env file (never printed).
// usage: node transcribe.mjs <env file> <audio.mp3> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [envPath, audioPath, out] = process.argv.slice(2);
const key = (readFileSync(envPath, "utf8").match(/^OPENAI_API_KEY=(.*)$/m)?.[1] ?? "").trim();
if (!key) throw new Error("no OPENAI_API_KEY in env file");

const form = new FormData();
form.append("file", new Blob([readFileSync(audioPath)], { type: "audio/mpeg" }), "audio.mp3");
form.append("model", "whisper-1");
form.append("response_format", "verbose_json");
form.append("timestamp_granularities[]", "word");
form.append("timestamp_granularities[]", "segment");

const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}` },
  body: form,
  signal: AbortSignal.timeout(180_000),
});
const json = await res.json();
if (!res.ok) throw new Error(`transcription failed (${res.status}): ${json.error?.message ?? "unknown"}`);
writeFileSync(out, JSON.stringify(json, null, 1));
console.log(`words: ${json.words?.length ?? 0}, segments: ${json.segments?.length ?? 0}, duration: ${json.duration}`);
for (const s of json.segments ?? []) console.log(`${s.start.toFixed(2).padStart(6)}–${s.end.toFixed(2).padEnd(6)} ${s.text.trim()}`);
