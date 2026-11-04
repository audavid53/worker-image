import { useCallback, useState } from "react";

const PREFIX = "aesyr.v2.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** useState mirrored to localStorage. Storage failures (private mode, blocked) fall back to memory only. */
export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(v));
        } catch {
          /* memory only */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set] as const;
}
