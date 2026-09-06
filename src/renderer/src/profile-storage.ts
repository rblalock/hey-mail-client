import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

let storageError: string | undefined;
function scopedKey(key: string): string {
  const profile = typeof window !== "undefined" ? window.heyAgent?.profiles?.current.active?.key : undefined;
  return `hey-agent:profile:v1:${profile ?? "unavailable"}:${key}`;
}
export function readProfileValue<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(scopedKey(key)); return raw === null ? fallback : JSON.parse(raw) as T; }
  catch { return fallback; }
}
export function assertProfileStorageReady() {
  if (storageError) throw new Error(storageError);
}
export function useProfileValue<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [stored, setStored] = useState(() => ({ key, value: readProfileValue(key, fallback) }));
  const current = useRef(stored);
  if (stored.key !== key) {
    const next = { key, value: readProfileValue(key, fallback) };
    current.current = next; setStored(next);
  } else current.current = stored;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    const value = typeof update === "function" ? (update as (value: T) => T)(current.current.value) : update;
    const next = { key, value };
    try {
      if (value === undefined) localStorage.removeItem(scopedKey(key));
      else localStorage.setItem(scopedKey(key), JSON.stringify(value));
    } catch { storageError = "Your draft could not be saved locally. Keep this account open and save the draft in HEY before switching."; }
    current.current = next; setStored(next);
  }, [key]);
  return [current.current.value, setValue];
}
