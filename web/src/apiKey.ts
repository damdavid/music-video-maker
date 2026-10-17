import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mvm.anthropicApiKey";
const listeners = new Set<() => void>();

// Storage can throw (blocked site data, private mode); the app then just asks for the key again.
export function getApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // not persisted; nothing else to do
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Keeps other tabs of the app in step when the key changes in one of them.
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const useApiKey = (): string => useSyncExternalStore(subscribe, getApiKey);
