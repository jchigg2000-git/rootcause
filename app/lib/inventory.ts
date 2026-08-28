/**
 * Machine inventory — storage for the user's own record of the machines they
 * look after.
 *
 * The substance is three fields: PIN, current hours, and maintenance done.
 * Year / make / model / type ride along as identity, because a machine record
 * the app cannot match to a machine is not usable by intake or spec lookup.
 * Nothing beyond those is stored.
 *
 * **Every statement filters on `user_id`.** Ownership is enforced in the query
 * and never in the UI — and never by a prior `SELECT` that a concurrent write
 * could invalidate, so the update and delete carry the owner in their own
 * `WHERE` and a mismatched caller changes zero rows rather than someone else's
 * machine. Route handlers do not re-check role — the app has one global gate
 * ahead of the router, decided 2026-08-04 — which makes this the only place it
 * can live.
 *
 * The request contract — coercion, bounds, and the operator-facing messages —
 * lives in `app/api/inventory/contract.ts`, kept apart from the `?raw` import
 * below so it stays unit-testable.
 */
import machineSchema from "../../migrations/0006_machine_inventory.sql?raw";
import machineServiceSchema from "../../migrations/0007_machine_service.sql?raw";
import {
  coerceHours,
  validateMachineInput,
  type MachineInput,
  type MachineRecord,
  type ServiceEntry,
  type ServiceEntryInput,
} from "../api/inventory/contract.ts";
import type { Database } from "./db.ts";
import { ensureDiagnosticCaseSchema } from "./cases.ts";
import { createColumnGuard, createSchemaRunner } from "./sql.ts";

const runMachineSchema = createSchemaRunner(machineSchema);
// Grown databases predate label in 0006's CREATE; see that file's comment.
const labelGuard = createColumnGuard("machine", "label", "TEXT");

export async function ensureMachineSchema(db: Database): Promise<void> {
  await runMachineSchema(db);
  await labelGuard(db);
}

const runMachineServiceSchema = createSchemaRunner(machineServiceSchema);

/**
 * 0007 indexes diagnostic_case.machine_id, which on a grown database exists
 * only after the case schema's column guard has run — so that schema goes
 * first, always.
 */
export async function ensureMachineServiceSchema(db: Database): Promise<void> {
  await ensureDiagnosticCaseSchema(db);
  await ensureMachineSchema(db);
  await runMachineServiceSchema(db);
}

/** Bounds the list; a household fleet is nowhere near this. */
export const MAX_MACHINES_RETURNED = 200;
/** Bounds a machine's history; decades of monthly services is still < 500. */
export const MAX_SERVICE_ENTRIES_RETURNED = 500;

type MachineRow = {
  id: string;
  created_at: string;
  updated_at: string;
  equipment_year: string | null;
  equipment_make: string;
  equipment_model: string | null;
  machine_type: string | null;
  serial_pin: string | null;
  current_hours: number | null;
  maintenance: string | null;
  label: string | null;
};

const toRecord = (row: MachineRow): MachineRecord => ({
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  year: row.equipment_year ?? "",
  make: row.equipment_make,
  model: row.equipment_model ?? "",
  machineType: row.machine_type ?? "",
  serialPin: row.serial_pin ?? "",
  currentHours: row.current_hours,
  maintenance: row.maintenance ?? "",
  label: row.label ?? "",
});

const SELECT_COLUMNS = `id, created_at, updated_at, equipment_year, equipment_make,
  equipment_model, machine_type, serial_pin, current_hours, maintenance, label`;

export async function listMachines(db: Database, userId: string): Promise<MachineRecord[]> {
  await ensureMachineSchema(db);
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM machine WHERE user_id = ?
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(userId, MAX_MACHINES_RETURNED)
    .all<MachineRow>();
  return results.map(toRecord);
}

export async function createMachine(
  db: Database,
  userId: string,
  input: MachineInput,
): Promise<MachineRecord> {
  await ensureMachineSchema(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO machine
         (id, user_id, created_at, updated_at, equipment_year, equipment_make,
          equipment_model, machine_type, serial_pin, current_hours, maintenance, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      now,
      now,
      input.year || null,
      input.make,
      input.model || null,
      input.machineType || null,
      input.serialPin || null,
      input.currentHours,
      input.maintenance || null,
      input.label || null,
    )
    .run();
  return { ...input, id, createdAt: now, updatedAt: now };
}

/**
 * Returns null when the row does not exist *or* is not the caller's — the two
 * are deliberately indistinguishable, so a probe cannot enumerate other users'
 * machine ids.
 */
export async function updateMachine(
  db: Database,
  userId: string,
  id: string,
  input: MachineInput,
): Promise<MachineRecord | null> {
  await ensureMachineSchema(db);
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE machine SET updated_at = ?, equipment_year = ?, equipment_make = ?,
         equipment_model = ?, machine_type = ?, serial_pin = ?, current_hours = ?,
         maintenance = ?, label = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      now,
      input.year || null,
      input.make,
      input.model || null,
      input.machineType || null,
      input.serialPin || null,
      input.currentHours,
      input.maintenance || null,
      input.label || null,
      id,
      userId,
    )
    .run();
  if ((result.meta?.changes ?? 0) === 0) return null;

  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM machine WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<MachineRow>();
  return row ? toRecord(row) : null;
}

export async function deleteMachine(db: Database, userId: string, id: string): Promise<boolean> {
  await ensureMachineSchema(db);
  const result = await db
    .prepare("DELETE FROM machine WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function getMachine(
  db: Database,
  userId: string,
  id: string,
): Promise<MachineRecord | null> {
  await ensureMachineSchema(db);
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM machine WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<MachineRow>();
  return row ? toRecord(row) : null;
}

type ServiceRow = {
  id: string;
  performed_on: string;
  note: string;
  created_at: string;
};

const toServiceEntry = (row: ServiceRow): ServiceEntry => ({
  id: row.id,
  performedOn: row.performed_on,
  note: row.note,
  createdAt: row.created_at,
});

export async function listServiceEntries(
  db: Database,
  userId: string,
  machineId: string,
): Promise<ServiceEntry[]> {
  await ensureMachineServiceSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, performed_on, note, created_at FROM machine_service
       WHERE machine_id = ? AND user_id = ?
       ORDER BY performed_on DESC, created_at DESC LIMIT ?`,
    )
    .bind(machineId, userId, MAX_SERVICE_ENTRIES_RETURNED)
    .all<ServiceRow>();
  return results.map(toServiceEntry);
}

/**
 * INSERT … SELECT against the machine row proves ownership inside the write's
 * own statement — a machine that is not the caller's inserts zero rows, which
 * answers with the same null a nonexistent one does.
 */
export async function addServiceEntry(
  db: Database,
  userId: string,
  machineId: string,
  input: ServiceEntryInput,
): Promise<ServiceEntry | null> {
  await ensureMachineServiceSchema(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO machine_service (id, machine_id, user_id, performed_on, note, created_at)
         SELECT ?, m.id, m.user_id, ?, ?, ? FROM machine m WHERE m.id = ? AND m.user_id = ?`,
      )
      .bind(id, input.performedOn, input.note, now, machineId, userId),
    db
      .prepare("UPDATE machine SET updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(now, machineId, userId),
  ]);
  if ((inserted.meta?.changes ?? 0) === 0) return null;
  return { ...input, id, createdAt: now };
}

/**
 * `machineId` is part of the key, not decoration: the route's path carries both
 * ids, and without it an entry could be deleted through any of the caller's
 * other machines. Same owner either way, so this is scope confusion rather than
 * a cross-user hole — but the URL should mean what it says.
 */
export async function deleteServiceEntry(
  db: Database,
  userId: string,
  machineId: string,
  entryId: string,
): Promise<boolean> {
  await ensureMachineServiceSchema(db);
  const result = await db
    .prepare("DELETE FROM machine_service WHERE id = ? AND machine_id = ? AND user_id = ?")
    .bind(entryId, machineId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** The intake fields auto-save reads. `hours` arrives as the form's string. */
export type IntakeEquipment = {
  year: string;
  make: string;
  model: string;
  machineType?: string;
  serialPin?: string;
  hours?: string;
};

/**
 * Refresh one machine from the intake fields, scoped to its owner.
 *
 * Conservative on purpose: hours take the new value when the intake supplies
 * one (the operator just read the meter, and it is the most perishable field
 * on the record), while a blank serial/type is filled in but a recorded one is
 * never overwritten by an intake shortcut. Identity — year/make/model — is not
 * touched at all.
 *
 * Ownership is proven inside the statement rather than by a preceding SELECT a
 * concurrent write could invalidate, so the boolean doubles as the ownership
 * answer: a foreign, deleted, or nonexistent id all change zero rows and are
 * indistinguishable to the caller.
 */
export async function refreshMachineFromIntake(
  db: Database,
  userId: string,
  machineId: string,
  equipment: IntakeEquipment,
): Promise<boolean> {
  // Self-sufficient: the diagnose route calls this directly, outside
  // autosaveMachineFromIntake's own ensure. The runner memoizes, so the
  // second caller pays nothing.
  await ensureMachineSchema(db);
  const hours = coerceHours(equipment.hours);
  const result = await db
    .prepare(
      `UPDATE machine SET updated_at = ?,
         current_hours = COALESCE(?, current_hours),
         serial_pin    = COALESCE(serial_pin, ?),
         machine_type  = COALESCE(machine_type, ?)
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      new Date().toISOString(),
      hours.ok ? hours.value : null,
      equipment.serialPin?.trim() || null,
      equipment.machineType?.trim() || null,
      machineId,
      userId,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Save the intake machine into the caller's inventory as a by-product of
 * running a diagnostic — the machine is saved to "my machines" automatically.
 *
 * Matching: serial/PIN when the intake has one (case-insensitive — PINs are
 * transcribed off a plate), else exact year+make+model. On a match the row is
 * refreshed conservatively: hours update when the intake provides them, and
 * blank serial/type are filled in — a value the operator already recorded is
 * never overwritten by an intake shortcut. No match creates the machine.
 *
 * Returns the machine id, or null when nothing could be saved. Throws only on
 * database failure; the caller wraps — persistence never blocks a diagnosis.
 */
export async function autosaveMachineFromIntake(
  db: Database,
  userId: string,
  equipment: IntakeEquipment,
): Promise<string | null> {
  await ensureMachineSchema(db);

  const serial = equipment.serialPin?.trim() ?? "";
  let matchId: string | null = null;

  if (serial) {
    const row = await db
      .prepare(
        `SELECT id FROM machine
         WHERE user_id = ? AND serial_pin IS NOT NULL AND LOWER(serial_pin) = LOWER(?)
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId, serial)
      .first<{ id: string }>();
    matchId = row?.id ?? null;
  }
  if (!matchId) {
    const row = await db
      .prepare(
        `SELECT id FROM machine
         WHERE user_id = ?
           AND LOWER(equipment_make) = LOWER(?)
           AND LOWER(COALESCE(equipment_model, '')) = LOWER(?)
           AND COALESCE(equipment_year, '') = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId, equipment.make.trim(), equipment.model.trim(), equipment.year.trim())
      .first<{ id: string }>();
    matchId = row?.id ?? null;
  }

  if (matchId) {
    await refreshMachineFromIntake(db, userId, matchId, equipment);
    return matchId;
  }

  // The diagnose contract has already required year/make/model, but the
  // inventory's own validation stays the single authority on what a machine
  // row may contain.
  const validated = validateMachineInput({
    year: equipment.year,
    make: equipment.make,
    model: equipment.model,
    machineType: equipment.machineType ?? "",
    serialPin: serial,
    currentHours: equipment.hours ?? "",
    maintenance: "",
    label: "",
  });
  if (!validated.ok) return null;
  const created = await createMachine(db, userId, validated.value);
  return created.id;
}
