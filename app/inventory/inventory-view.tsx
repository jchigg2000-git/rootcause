"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogoMark } from "../components/logo.tsx";
import {
  MANUFACTURERS,
  MACHINE_TYPES,
  modelsForMake,
  parseModelYear,
} from "../lib/equipment-catalog.ts";
import { ComboField } from "../components/combobox.tsx";
import type { MachineRecord, ServiceEntry } from "../api/inventory/contract.ts";

/**
 * Machine Inventory — a page of its own, reached from the intake stage and
 * never from the header, which is reserved for account details.
 *
 * Full-width expandable cards: the header row is year/make/model, then the
 * operator's label, with Edit pinned far right; expanding shows dated
 * maintenance history, the machine's diagnostics, and the actions. Machines
 * also arrive here automatically — running a diagnostic auto-saves its intake
 * machine.
 *
 * Every field is free text, exactly as intake is: the catalog suggests through
 * the shared combobox, it never constrains, so an unlisted machine still goes in.
 */

type MachineForm = {
  year: string;
  make: string;
  model: string;
  machineType: string;
  serialPin: string;
  currentHours: string;
  maintenance: string;
  label: string;
};

/** Mirrors `MachineCase` in app/lib/library.ts, re-declared locally because
 *  that module carries a `?raw` migration import a client bundle cannot. */
type MachineCase = {
  id: string;
  createdAt: string;
  problem: string;
  status: string;
  hasReport: boolean;
  outcome: { rank: number; problem: string } | null;
};

type MachineDetail = {
  service: ServiceEntry[];
  cases: MachineCase[];
};

const STATUS_COPY: Record<string, string> = {
  interviewing: "Interview open",
  ready: "Ready for report",
  reported: "Report generated",
};

const emptyForm: MachineForm = {
  year: "",
  make: "",
  model: "",
  machineType: "",
  serialPin: "",
  currentHours: "",
  maintenance: "",
  label: "",
};

const toForm = (machine: MachineRecord): MachineForm => ({
  year: machine.year,
  make: machine.make,
  model: machine.model,
  machineType: machine.machineType,
  serialPin: machine.serialPin,
  currentHours: machine.currentHours === null ? "" : String(machine.currentHours),
  maintenance: machine.maintenance,
  label: machine.label,
});

const machineLabel = (machine: MachineRecord) =>
  [machine.year, machine.make, machine.model].filter(Boolean).join(" ") || machine.make;

const formatHours = (hours: number | null) =>
  hours === null ? null : `${hours.toLocaleString()} h`;

const today = () => new Date().toISOString().slice(0, 10);

const formatDate = (iso: string) => {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export function InventoryView() {
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  // Starts true: the page mounts straight into its first load.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<MachineForm>(emptyForm);
  /** null = the add form; a string = editing that machine. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);

  /** Expanded card bodies, and their lazily-fetched detail. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, MachineDetail>>({});
  /** The add-entry mini-form, one draft per machine. */
  const [serviceDrafts, setServiceDrafts] = useState<
    Record<string, { performedOn: string; note: string }>
  >({});

  // parseModelYear, not Number(): a half-typed "201" used to narrow the list
  // to nothing mid-keystroke.
  const modelOptions = modelsForMake(form.make, parseModelYear(form.year));

  // No state is touched before the first await, so the mount effect below
  // never sets state synchronously (react-hooks/set-state-in-effect). Reloads
  // after a write deliberately do not re-raise `loading` — `busy` already has
  // the buttons disabled, and flashing the list back to "Loading…" would lose
  // the operator's place.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/inventory");
      const payload = (await response.json()) as { machines?: MachineRecord[]; error?: string };
      if (!response.ok) {
        setError(payload.error || "Your machines could not be loaded.");
        return;
      }
      setMachines(payload.machines ?? []);
      setError("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const loadDetail = useCallback(async (machineId: string) => {
    try {
      const response = await fetch(`/api/inventory/${machineId}`);
      const payload = (await response.json()) as {
        service?: ServiceEntry[];
        cases?: MachineCase[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error || "That machine's details could not be loaded.");
        return;
      }
      setDetails((current) => ({
        ...current,
        [machineId]: { service: payload.service ?? [], cases: payload.cases ?? [] },
      }));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  function toggleExpand(machineId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(machineId)) {
        next.delete(machineId);
      } else {
        next.add(machineId);
      }
      return next;
    });
    if (!details[machineId]) void loadDetail(machineId);
    setServiceDrafts((current) =>
      current[machineId] ? current : { ...current, [machineId]: { performedOn: today(), note: "" } },
    );
  }

  // The form is one element that both adds and edits, so opening it for an
  // edit moves focus to its heading — otherwise a keyboard user activates
  // "Edit" on a card far down the page and lands nowhere.
  function startEdit(machine: MachineRecord) {
    setEditingId(machine.id);
    setForm(toForm(machine));
    setFormOpen(true);
    setError("");
    window.requestAnimationFrame(() => formHeadingRef.current?.focus());
  }

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError("");
    window.requestAnimationFrame(() => formHeadingRef.current?.focus());
  }

  function cancelForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(false);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.make.trim()) {
      setError("Enter the machine's make.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        editingId ? `/api/inventory/${editingId}` : "/api/inventory",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const payload = (await response.json()) as { machine?: MachineRecord; error?: string };
      if (!response.ok) {
        setError(payload.error || "That machine could not be saved.");
        return;
      }
      cancelForm();
      await load();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(machine: MachineRecord) {
    if (!window.confirm(`Remove ${machineLabel(machine)} from your inventory?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/inventory/${machine.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error || "That machine could not be removed.");
        return;
      }
      if (editingId === machine.id) cancelForm();
      await load();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addService(machineId: string, event: FormEvent) {
    event.preventDefault();
    const draft = serviceDrafts[machineId];
    if (!draft?.note.trim()) {
      setError("Describe the work that was done.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/inventory/${machineId}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as { entry?: ServiceEntry; error?: string };
      if (!response.ok) {
        setError(payload.error || "That entry could not be saved.");
        return;
      }
      setError("");
      setServiceDrafts((current) => ({
        ...current,
        [machineId]: { performedOn: today(), note: "" },
      }));
      await loadDetail(machineId);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeService(machineId: string, entry: ServiceEntry) {
    setBusy(true);
    try {
      const response = await fetch(`/api/inventory/${machineId}/service/${entry.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error || "That entry could not be removed.");
        return;
      }
      await loadDetail(machineId);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="settings-shell inventory-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Machine inventory</h1>
          <p>The machines you look after</p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      <p className="page-lede">
        Your own machines. Running a diagnosis files its machine here automatically;
        expand a card for its maintenance history and past diagnostics.
      </p>

      {error && <p className="form-error" role="alert">{error}</p>}

      {!formOpen && (
        <button className="primary-button" type="button" onClick={startAdd}>
          Add a machine <span aria-hidden="true">+</span>
        </button>
      )}

      {formOpen && (
        <form className="inventory-form" onSubmit={submit}>
          <h2 ref={formHeadingRef} tabIndex={-1}>
            {editingId ? "Edit machine" : "Add a machine"}
          </h2>

          <div className="field-grid inventory-identity">
            <label className="field">
              <span>Year</span>
              <input
                value={form.year}
                onChange={(event) => setForm({ ...form, year: event.target.value })}
                inputMode="numeric"
                maxLength={4}
                placeholder="2014"
              />
            </label>
            {/* The model list is derived from the make, so committing a make
                from the list invalidates a typed model. Typing one character
                of a make no longer does — that wiped the model on every
                keystroke, including a backspace. */}
            <ComboField
              label="Make"
              required
              options={MANUFACTURERS}
              value={form.make}
              onChange={(next) => setForm({ ...form, make: next })}
              onSelect={(next) => setForm({ ...form, make: next, model: "" })}
              placeholder="John Deere"
            />
            <ComboField
              label="Model"
              options={modelOptions}
              value={form.model}
              onChange={(next) => setForm({ ...form, model: next })}
              placeholder="344K"
            />
            <ComboField
              label="Machine type"
              options={MACHINE_TYPES}
              value={form.machineType}
              onChange={(next) => setForm({ ...form, machineType: next })}
              placeholder="Wheel loader"
            />
          </div>

          <div className="field-grid inventory-service">
            <label className="field">
              <span>Serial / PIN</span>
              <input
                value={form.serialPin}
                onChange={(event) => setForm({ ...form, serialPin: event.target.value })}
                maxLength={40}
                placeholder="1FF344KXKFF123456"
              />
            </label>
            <label className="field">
              <span>Current hours</span>
              <input
                value={form.currentHours}
                onChange={(event) => setForm({ ...form, currentHours: event.target.value })}
                inputMode="decimal"
                placeholder="4512"
              />
            </label>
            <label className="field">
              <span>Label</span>
              <input
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                maxLength={80}
                placeholder="North pit loader"
              />
              <small>Shown after the year, make and model on the machine&rsquo;s card.</small>
            </label>
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea
              rows={4}
              value={form.maintenance}
              onChange={(event) => setForm({ ...form, maintenance: event.target.value })}
              placeholder="Anything worth keeping alongside the machine. Dated maintenance entries live on the card itself."
            />
          </label>

          <div className="inventory-form-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add machine"}
            </button>
            <button className="ghost-button" type="button" onClick={cancelForm} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="small">Loading your machines…</p>
      ) : machines.length === 0 ? (
        <p className="empty-state">
          No machines yet. Run a diagnosis and its machine files itself here, or add
          one by hand.
        </p>
      ) : (
        <ul className="machine-list">
          {machines.map((machine) => {
            const hours = formatHours(machine.currentHours);
            const isOpen = expanded.has(machine.id);
            const detail = details[machine.id];
            const draft = serviceDrafts[machine.id] ?? { performedOn: today(), note: "" };
            return (
              <li className="machine-card" key={machine.id}>
                <div className="machine-card-head">
                  <button
                    type="button"
                    className="machine-card-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggleExpand(machine.id)}
                  >
                    <span className="machine-chevron" aria-hidden="true">
                      {isOpen ? "−" : "+"}
                    </span>
                    <h3>
                      {machineLabel(machine)}
                      {machine.label && (
                        <span className="machine-nickname"> — {machine.label}</span>
                      )}
                    </h3>
                  </button>
                  <button
                    className="ghost-button machine-card-edit"
                    type="button"
                    onClick={() => startEdit(machine)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                </div>

                {isOpen && (
                  <div className="machine-card-body">
                    <dl className="machine-facts">
                      {machine.machineType && (
                        <div>
                          <dt>Type</dt>
                          <dd>{machine.machineType}</dd>
                        </div>
                      )}
                      {machine.serialPin && (
                        <div>
                          <dt>Serial / PIN</dt>
                          <dd className="mono">{machine.serialPin}</dd>
                        </div>
                      )}
                      {hours && (
                        <div>
                          <dt>Current hours</dt>
                          <dd>{hours}</dd>
                        </div>
                      )}
                    </dl>

                    <section className="machine-section" aria-label="Maintenance history">
                      <p className="eyebrow">Maintenance history</p>
                      {!detail ? (
                        <p className="small">Loading…</p>
                      ) : detail.service.length === 0 ? (
                        <p className="small">No dated entries yet.</p>
                      ) : (
                        <ul className="service-list">
                          {detail.service.map((entry) => (
                            <li key={entry.id}>
                              <span className="service-date mono">{formatDate(entry.performedOn)}</span>
                              <span className="service-note">{entry.note}</span>
                              <button
                                type="button"
                                className="service-remove"
                                aria-label={`Remove the ${formatDate(entry.performedOn)} entry`}
                                onClick={() => void removeService(machine.id, entry)}
                                disabled={busy}
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <form className="service-form" onSubmit={(event) => void addService(machine.id, event)}>
                        <input
                          type="date"
                          value={draft.performedOn}
                          max={today()}
                          onChange={(event) =>
                            setServiceDrafts((current) => ({
                              ...current,
                              [machine.id]: { ...draft, performedOn: event.target.value },
                            }))
                          }
                          aria-label="Service date"
                          required
                        />
                        <input
                          value={draft.note}
                          maxLength={500}
                          onChange={(event) =>
                            setServiceDrafts((current) => ({
                              ...current,
                              [machine.id]: { ...draft, note: event.target.value },
                            }))
                          }
                          placeholder="Hydraulic filter and oil"
                          aria-label="Work done"
                          required
                        />
                        <button className="ghost-button" type="submit" disabled={busy}>
                          Add entry
                        </button>
                      </form>
                      {machine.maintenance && (
                        <div className="machine-maintenance">
                          <p className="eyebrow">Notes</p>
                          <p>{machine.maintenance}</p>
                        </div>
                      )}
                    </section>

                    <section className="machine-section" aria-label="Diagnostics">
                      <p className="eyebrow">Diagnostics</p>
                      {!detail ? (
                        <p className="small">Loading…</p>
                      ) : detail.cases.length === 0 ? (
                        <p className="small">
                          No diagnostics yet. Running one on this machine files it here.
                        </p>
                      ) : (
                        <ul className="machine-case-list">
                          {detail.cases.map((machineCase) => (
                            <li key={machineCase.id}>
                              <span className="service-date mono">{formatDate(machineCase.createdAt)}</span>
                              <span className="machine-case-problem">
                                {machineCase.hasReport ? (
                                  <Link href={`/library?open=${machineCase.id}`}>
                                    {machineCase.problem}
                                  </Link>
                                ) : (
                                  machineCase.problem
                                )}
                              </span>
                              {machineCase.outcome ? (
                                <span className="machine-case-outcome">
                                  Fix confirmed: {machineCase.outcome.problem}
                                </span>
                              ) : (
                                <span className="machine-case-status">
                                  {STATUS_COPY[machineCase.status] ?? machineCase.status}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <div className="machine-card-actions">
                      {/* Intake reads ?machine= against the caller's own list,
                          the same way /parts-lookup and /library read theirs. */}
                      <Link className="ghost-button" href={`/?machine=${machine.id}`}>
                        Run a diagnostic
                      </Link>
                      <Link className="ghost-button" href={`/parts-lookup?machine=${machine.id}`}>
                        Find parts
                      </Link>
                      <button
                        className="ghost-button danger"
                        type="button"
                        onClick={() => void remove(machine)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
