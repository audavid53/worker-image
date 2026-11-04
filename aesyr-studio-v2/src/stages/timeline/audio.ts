// Client audio helpers: decode for duration + waveform peaks, then upload the original bytes.

const PEAKS = 600;

export async function decodeAudio(buf: ArrayBuffer): Promise<{ duration: number; peaks: number[] }> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / PEAKS));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < data.length; i += step) {
      let p = 0;
      for (let j = i; j < Math.min(i + step, data.length); j++) p = Math.max(p, Math.abs(data[j]));
      peaks.push(p);
      max = Math.max(max, p);
    }
    return { duration: audio.duration, peaks: peaks.map((p) => Math.round((p / (max || 1)) * 100) / 100) };
  } finally {
    void ctx.close();
  }
}

export async function uploadAudio(buf: ArrayBuffer): Promise<string> {
  const res = await fetch("/api/upload-audio", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: buf });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
  return json.url as string;
}
