import { Case, Requirement, Workspace } from "./types";
import { caseFields } from "./fields";
import { ShareRecord, Snapshot } from "./sharing";

export type ViewMode = "personal" | "family";
export const primaryPerson = (w: Workspace) =>
  w.people.find((p) => p.id === w.owner_id)?.id ||
  w.people.find((p) => p.relation === "self")?.id ||
  w.people[0]?.id;
export function scopeWorkspace(w: Workspace, mode: ViewMode): Workspace {
  if (mode === "family") return w;
  const id = primaryPerson(w),
    cases = w.cases.filter((c) => c.applicant_id === id);
  const visible = new Set([id, ...cases.map((c) => c.subject_id).filter(Boolean)]);
  return {
    ...w,
    people: w.people.filter((p) => visible.has(p.id)),
    cases,
    documents: w.documents.filter((d) => visible.has(d.person_id)),
    household: w.household
      .map((f) => ({ ...f, person_ids: f.person_ids.filter((p) => visible.has(p)) }))
      .filter((f) => f.person_ids.length),
    journal: (w.journal || [])
      .filter((e) => e.person_ids.includes(id || ""))
      .map((e) => ({
        ...e,
        person_ids: e.person_ids.filter((p) => visible.has(p)),
        changed_fields: e.changed_fields.filter((f) => f && visible.has(f.person_id)),
      })),
  };
}
export function mergeScopedWorkspace(base: Workspace, next: Workspace, mode: ViewMode): Workspace {
  if (mode === "family") return { ...next, owner_id: primaryPerson(base) || primaryPerson(next) };
  const owner = primaryPerson(base),
    oldView = scopeWorkspace(base, "personal");
  const visible = new Set(oldView.people.map((p) => p.id));
  const byId = new Map(next.people.map((p) => [p.id, p]));
  const people = [
    ...base.people
      .filter((p) => !visible.has(p.id) || byId.has(p.id))
      .map((p) => byId.get(p.id) || p),
    ...next.people.filter((p) => !base.people.some((old) => old.id === p.id)),
  ];
  const cases = [...base.cases.filter((c) => c.applicant_id !== owner), ...next.cases];
  if (people.length > 20 || cases.length > 100)
    throw new Error(
      "Workspace limit reached; export and finish existing cases before adding more.",
    );
  const ids = new Set((base.journal || []).map((e) => e.id));
  // An existing multi-person event keeps its complete family associations.
  const journal = [
    ...(base.journal || []),
    ...(next.journal || []).filter((e) => !ids.has(e.id)),
  ].slice(-200);
  return {
    ...base,
    owner_id: owner,
    people,
    cases,
    journal,
    documents: [...base.documents.filter((d) => !visible.has(d.person_id)), ...next.documents],
  };
}
const stable = (v: any): any =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(stable(a)) === JSON.stringify(stable(b));
// Async event results may replace only the exact view used to prepare them.
export function mergeWorkspaceResult(
  current: Workspace,
  expected: Workspace,
  next: Workspace,
  mode: ViewMode,
): Workspace | null {
  return sameValue(scopeWorkspace(current, mode), expected)
    ? mergeScopedWorkspace(current, next, mode)
    : null;
}
export function shareSnapshot(
  w: Workspace,
  c: Case,
  requirements: Requirement[],
  includeNotes: boolean,
): Snapshot {
  const ids = new Set([c.applicant_id, c.subject_id]);
  const allowed = new Set([...caseFields(c.kind, c.mode), "state", "age"]);
  const people = w.people
    .filter((p) => ids.has(p.id))
    .map((p) => {
      const shared = Object.fromEntries(
        w.household
          .filter((f) => f.confirmed && f.person_ids.includes(p.id))
          .map((f) => [f.field, f.value]),
      );
      return {
        ...p,
        facts:
          p.id === c.applicant_id
            ? Object.fromEntries(
                Object.entries({ ...shared, ...p.facts }).filter(([key]) => allowed.has(key)),
              )
            : {},
      };
    });
  const keys = new Set(requirements.flatMap((r) => r.options.map((k) => r.person_id + ":" + k)));
  return {
    case: { ...c, notes: includeNotes ? c.notes : "", events: [] },
    people,
    documents: w.documents.filter((d) => keys.has(d.person_id + ":" + d.kind)),
  };
}
export function sharedCaseInput(c: Case, r: ShareRecord): Case {
  return {
    ...c,
    notes: r.shareNotes ? c.notes : r.lastSyncedCase?.notes || "",
    events: r.lastSyncedCase?.events || [],
  };
}
export function mergeSharedCase(local: Case, remote: Case, r: ShareRecord): Case {
  const ids = new Set(local.events.map((e) => e.id));
  const events = [...local.events, ...remote.events.filter((e) => !ids.has(e.id))];
  if (!r.shareNotes && remote.notes && remote.notes !== r.lastSyncedCase?.notes)
    events.push({
      id: "helper-note:" + r.id + ":" + remote.events.at(-1)?.id,
      at: new Date().toISOString(),
      actor: "helper",
      text: "Helper preparation note: " + remote.notes.slice(0, 450),
    });
  return {
    ...remote,
    notes: r.shareNotes ? remote.notes : local.notes,
    events: events.slice(-100),
  };
}
