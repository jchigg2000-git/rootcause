"use client";

/**
 * Client-local preferences.
 *
 * These are per-browser by nature — a default machine is a property of the
 * device sitting in a particular yard, not of the account — so they never reach
 * the server. Exposed through useSyncExternalStore with a `storage` listener so
 * a change in one tab is reflected in the others.
 */
import { useSyncExternalStore } from "react";

const KEY = "rootcause.defaultMachine";

export type DefaultMachine = {
  year: string;
  make: string;
  model: string;
  machineType: string;
  market: string;
};

export const EMPTY_MACHINE: DefaultMachine = {
  year: "",
  make: "",
  model: "",
  machineType: "",
  market: "",
};

const FIELDS = Object.keys(EMPTY_MACHINE) as Array<keyof DefaultMachine>;

/** Validate on read: unknown keys are dropped and every field is a string. */
function parse(raw: string | null): DefaultMachine {
  if (!raw) return EMPTY_MACHINE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_MACHINE;
    const record = parsed as Record<string, unknown>;
    const machine = { ...EMPTY_MACHINE };
    for (const field of FIELDS) {
      if (typeof record[field] === "string") machine[field] = record[field].slice(0, 120);
    }
    return machine;
  } catch {
    return EMPTY_MACHINE;
  }
}

const listeners = new Set<() => void>();
// Cached so getSnapshot returns a stable reference; React re-renders only when
// this is replaced, not on every read.
let snapshot: DefaultMachine = EMPTY_MACHINE;
let hydrated = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (!hydrated) {
    snapshot = parse(window.localStorage.getItem(KEY));
    hydrated = true;
  }
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    snapshot = parse(window.localStorage.getItem(KEY));
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => snapshot;
/** The server has no localStorage; render the empty default and hydrate after. */
const getServerSnapshot = () => EMPTY_MACHINE;

export function saveDefaultMachine(machine: DefaultMachine) {
  snapshot = { ...EMPTY_MACHINE, ...machine };
  window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  emit();
}

export function clearDefaultMachine() {
  snapshot = EMPTY_MACHINE;
  window.localStorage.removeItem(KEY);
  emit();
}

export function useDefaultMachine(): DefaultMachine {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Collapsible card open/closed state, one key per card.
 *
 * Also an external store rather than an effect that pushes localStorage into
 * state: reading during render would mismatch hydration, and syncing via
 * useEffect would set state on every mount for no reason.
 */
const collapseListeners = new Map<string, Set<() => void>>();
const collapseSnapshots = new Map<string, boolean>();

const collapseStorageKey = (key: string) => `rootcause.collapsed.${key}`;

function readCollapsed(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(collapseStorageKey(key));
  return raw === null ? fallback : raw === "1";
}

export function useCollapsed(key: string, fallback: boolean): [boolean, () => void] {
  const subscribe = (listener: () => void) => {
    if (!collapseSnapshots.has(key)) collapseSnapshots.set(key, readCollapsed(key, fallback));
    let set = collapseListeners.get(key);
    if (!set) {
      set = new Set();
      collapseListeners.set(key, set);
    }
    set.add(listener);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== collapseStorageKey(key)) return;
      collapseSnapshots.set(key, readCollapsed(key, fallback));
      for (const notify of collapseListeners.get(key) ?? []) notify();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      set.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  const collapsed = useSyncExternalStore(
    subscribe,
    () => collapseSnapshots.get(key) ?? fallback,
    () => fallback,
  );

  const toggle = () => {
    const next = !(collapseSnapshots.get(key) ?? fallback);
    collapseSnapshots.set(key, next);
    window.localStorage.setItem(collapseStorageKey(key), next ? "1" : "0");
    for (const notify of collapseListeners.get(key) ?? []) notify();
  };

  return [collapsed, toggle];
}
