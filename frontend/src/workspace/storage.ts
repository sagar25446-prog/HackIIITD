import { Case, Facts, uid, Workspace } from "./types";
const KEY = "jaagruk.workspace.v2";
const RECOVERY = "jaagruk.workspace.recovery.v2";
const ALLOWED = new Set([
  "state",
  "years_in_state",
  "annual_family_income",
  "annual_personal_income",
  "category",
  "bpl",
  "govt_employee_in_family",
  "has_lpg_connection",
  "owns_cultivable_land",
  "age",
  "gender",
  "occupation",
  "education",
  "marital_status",
  "disability",
  "has_bank_account",
  "income_tax_payer",
  "epfo_esic_member",
  "receives_other_pension",
  "breadwinner_died_18_59",
  "girl_child_under_10",
  "pregnant_or_new_mother",
  "in_full_time_education",
  "employed_full_time",
  "class12_percentile",
  "aicte_technical_course",
  "qhei_admission",
  "new_enterprise",
  "trade",
  "monthly_income",
  "previous_award",
  "marks_percent",
  "attendance_percent",
  "course_year",
  "degree_course",
  "took_gap_year",
  "other_scholarship",
  "nfsa_beneficiary",
  "same_household",
  "from_state",
  "to_state",
  "existing_policy",
  "nominee_known",
  "claimant_relation",
  "asset_category",
  "institution",
  "service",
  "application_stage",
  "vehicle_type",
  "learner_issued_on",
  "already_has_pan",
  "aadhaar_ready",
  "linked_mobile",
  "representative_assessee",
]);
const object = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: any) => typeof v === "string";
const factMap = (v: any) =>
  object(v) &&
  Object.values(v).every((x) => x === null || ["string", "number", "boolean"].includes(typeof x));
const doc = (v: any) =>
  object(v) &&
  text(v.id) &&
  text(v.person_id) &&
  text(v.kind) &&
  ["available", "missing", "unknown"].includes(v.state);
export function validWorkspace(v: any): v is Workspace {
  if (
    !object(v) ||
    v.version !== 2 ||
    !Array.isArray(v.people) ||
    v.people.length > 20 ||
    !Array.isArray(v.cases) ||
    v.cases.length > 100 ||
    !Array.isArray(v.documents) ||
    v.documents.length > 200 ||
    !Array.isArray(v.household)
  )
    return false;
  if (
    !v.people.every(
      (p: any) =>
        object(p) &&
        text(p.id) &&
        text(p.name) &&
        text(p.relation) &&
        typeof p.deceased === "boolean" &&
        factMap(p.facts),
    )
  )
    return false;
  const ids = new Set(v.people.map((p: any) => p.id));
  if (ids.size !== v.people.length || (v.owner_id && !ids.has(v.owner_id))) return false;
  if (!v.documents.every((d: any) => doc(d) && ids.has(d.person_id))) return false;
  if (
    !v.household.every(
      (f: any) =>
        object(f) &&
        text(f.field) &&
        Array.isArray(f.person_ids) &&
        f.person_ids.every((id: any) => ids.has(id)) &&
        typeof f.confirmed === "boolean",
    )
  )
    return false;
  if (
    !v.cases.every(
      (c: any) =>
        object(c) &&
        text(c.id) &&
        text(c.title) &&
        ids.has(c.applicant_id) &&
        (!c.subject_id || ids.has(c.subject_id)) &&
        ["bereavement", "retirement", "education", "moving", "wapsi", "paperwork"].includes(
          c.kind,
        ) &&
        factMap(c.answers) &&
        Array.isArray(c.documents) &&
        c.documents.every(doc) &&
        Array.isArray(c.completed_tasks) &&
        c.completed_tasks.every(text) &&
        text(c.notes) &&
        Array.isArray(c.events) &&
        c.events.every((e: any) => object(e) && text(e.id) && text(e.at) && text(e.text)),
    )
  )
    return false;
  if (new Set(v.cases.map((c: any) => c.id)).size !== v.cases.length) return false;
  return (
    v.journal === undefined ||
    (Array.isArray(v.journal) &&
      v.journal.every(
        (e: any) =>
          object(e) &&
          text(e.id) &&
          text(e.text) &&
          text(e.at) &&
          Array.isArray(e.person_ids) &&
          e.person_ids.every((id: any) => ids.has(id)) &&
          Array.isArray(e.changed_fields) &&
          e.changed_fields.every((f: any) => object(f) && ids.has(f.person_id) && text(f.field)),
      ))
  );
}
export function migrate(profile: Record<string, any> | null): Workspace {
  const ws: Workspace = {
    version: 2,
    people: [],
    household: [],
    documents: [],
    cases: [],
    journal: [],
  };
  if (!profile || !object(profile)) return ws;
  const family = Array.isArray(profile.family) ? profile.family.filter(object) : [];
  for (const [i, p] of [profile, ...family].slice(0, 20).entries()) {
    const id = uid(),
      facts: Facts = {};
    for (const [k, v] of Object.entries(p))
      if (ALLOWED.has(k) && ["string", "number", "boolean"].includes(typeof v))
        facts[k] = v as string | number | boolean;
    ws.people.push({
      id,
      name: p.name || `Member ${i + 1}`,
      relation: i === 0 ? "self" : p.relation || "member",
      deceased: !!p.deceased,
      facts,
    });
    for (const [kind, value] of Object.entries(p))
      if (/^doc_[a-z_]+$/.test(kind) && value === true)
        ws.documents.push({ id: uid(), person_id: id, kind, state: "available" });
  }
  ws.owner_id = ws.people[0]?.id;
  return ws;
}
export function loadWorkspace(profile: Record<string, any> | null): {
  workspace: Workspace;
  error: string;
  canPersist: boolean;
} {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (validWorkspace(data))
        return {
          workspace: {
            ...data,
            owner_id:
              data.owner_id ||
              data.people.find((p) => p.relation === "self")?.id ||
              data.people[0]?.id,
          },
          error: "",
          canPersist: true,
        };
      throw new Error("Invalid workspace");
    }
  } catch {
    if (raw) {
      try {
        localStorage.setItem(RECOVERY, raw);
        return {
          workspace: migrate(profile),
          error:
            "Saved data could not be read. Its original contents are preserved in the recovery export in Profile.",
          canPersist: true,
        };
      } catch {
        return {
          workspace: migrate(profile),
          error:
            "Saved data could not be read. Original storage is preserved; changes are only in memory until storage is repaired.",
          canPersist: false,
        };
      }
    }
    return {
      workspace: migrate(profile),
      error: "Browser storage is unavailable. Export your plan before closing.",
      canPersist: false,
    };
  }
  return { workspace: migrate(profile), error: "", canPersist: true };
}
export const readWorkspace = (p: Record<string, any> | null) => loadWorkspace(p).workspace;
export function persistWorkspace(ws: Workspace): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
    return null;
  } catch {
    return "Your changes are only in memory. Browser storage is unavailable; export before closing.";
  }
}
export function addEvent(
  c: Case,
  text: string,
  actor: "owner" | "helper" | "system" = "owner",
): Case {
  return {
    ...c,
    events: [...c.events, { id: uid(), at: new Date().toISOString(), actor, text }].slice(-100),
  };
}
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function downloadWorkspace(ws: Workspace) {
  download(JSON.stringify(ws, null, 2), "jaagruk-plan.json");
}
export function downloadRecovery() {
  try {
    const raw = localStorage.getItem(RECOVERY);
    if (raw) download(raw, "jaagruk-recovery.json");
    return !!raw;
  } catch {
    return false;
  }
}
