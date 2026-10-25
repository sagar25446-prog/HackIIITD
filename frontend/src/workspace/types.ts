export type Facts = Record<string, string | number | boolean | null>;
export type Person = {
  id: string;
  name: string;
  relation: string;
  deceased: boolean;
  facts: Facts;
};
export type HouseholdFact = {
  field: string;
  value: string | number | boolean | null;
  person_ids: string[];
  confirmed: boolean;
};
export type DocumentAssertion = {
  id: string;
  person_id: string;
  kind: string;
  state: "available" | "missing" | "unknown";
  issued_state?: string | null;
  expires_on?: string | null;
  covers_from?: string | null;
  covers_to?: string | null;
};
export type CaseEvent = {
  id: string;
  at: string;
  actor: "owner" | "helper" | "system";
  text: string;
};
export type Case = {
  id: string;
  kind: "bereavement" | "retirement" | "education" | "moving" | "wapsi" | "paperwork";
  title: string;
  applicant_id: string;
  subject_id: string | null;
  occurred_on: string | null;
  stage: "preparing" | "user_reported_submitted" | "needs_attention" | "user_reported_resolved";
  mode: "fresh" | "renewal";
  answers: Facts;
  documents: DocumentAssertion[];
  completed_tasks: string[];
  notes: string;
  follow_up: string | null;
  events: CaseEvent[];
  observations?: Observation[];
};
export type Candidate = {
  display_name: string;
  amount_inr: number | null;
  reference: string;
  fields?: Record<string, string>;
};
export type Outcome =
  | "possible_record"
  | "no_match"
  | "citizen_step"
  | "missing_input"
  | "unavailable"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "page_opened";
export type Observation = {
  id: string;
  source_id: string;
  holder_id: string | null;
  checked_at: string;
  provenance: "automated_live" | "automated_replay" | "user_reported";
  outcome: Outcome;
  engine?: string;
  submitted?: string;
  candidates: Candidate[];
  name_note?: string;
  message?: string;
  responsible_institution?: string;
  job_id?: string | null;
};
export type PersonalEvent = {
  id: string;
  text: string;
  kind: string;
  person_ids: string[];
  at: string;
  occurred_on: string | null;
  changed_fields: any[];
  scheduled: boolean;
  case_ids?: string[];
};
export type Workspace = {
  version: 2;
  owner_id?: string | null;
  people: Person[];
  household: HouseholdFact[];
  documents: DocumentAssertion[];
  cases: Case[];
  journal?: PersonalEvent[];
};
export type Task = {
  id: string;
  label: string;
  label_hi: string;
  done: boolean;
  person_id: string;
  kind: string;
};
export type Requirement = {
  id: string;
  label: string;
  label_hi: string;
  person_id: string;
  state: string;
  selected: string;
  options: string[];
  explanation: string;
  explanation_hi: string;
};
export type Deadline = {
  id: string;
  case_id: string;
  person_id: string;
  title: string;
  title_hi: string;
  date: string;
  actor: string;
  kind: string;
  source_url?: string;
  provenance: string;
};
export type CasePlan = {
  case_id: string;
  person_id: string;
  status: string;
  status_hi: string;
  missing: string[];
  questions: { field: string; label: string; label_hi: string; type: string }[];
  requirements: Requirement[];
  tasks: Task[];
  deadlines: Deadline[];
  source_url: string;
  source_title: string;
  source_checked: string;
  coverage: string;
  coverage_hi: string;
  official_url: string;
  rule_version: string;
  removed_tasks: string[];
  removed_tasks_hi: string[];
};
export type Plan = {
  cases: CasePlan[];
  next_actions: (Task & { case_id: string })[];
  deadlines: Deadline[];
  rules_version: string;
};
export const uid = () => crypto.randomUUID();
export const newCase = (kind: Case["kind"], applicant_id: string, title: string): Case => ({
  id: uid(),
  kind,
  title,
  applicant_id,
  subject_id: null,
  occurred_on: null,
  stage: "preparing",
  mode: "fresh",
  answers: {},
  documents: [],
  completed_tasks: [],
  notes: "",
  follow_up: null,
  events: [],
});
