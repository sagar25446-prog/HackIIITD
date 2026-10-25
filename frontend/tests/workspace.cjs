const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const saved = new Map();
const localStorage = {
  getItem: (k) => saved.get(k) || null,
  setItem: (k, v) => saved.set(k, String(v)),
  removeItem: (k) => saved.delete(k),
};
const cache = new Map();
function load(name) {
  const file = path.resolve(".test-build", name + ".js");
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const box = {
    exports,
    require: (ref) =>
      load(
        path
          .relative(path.resolve(".test-build"), path.resolve(path.dirname(file), ref))
          .replaceAll("\\", "/"),
      ),
    Date,
    Intl,
    crypto: webcrypto,
    localStorage,
    console,
    URL,
    Blob,
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), box, { filename: file });
  return exports;
}
const { newCase } = load("types");
const scope = load("scope");
const store = load("storage");
const owner = {
  id: "me",
  name: "Me",
  relation: "self",
  deceased: false,
  facts: { state: "Delhi", age: 30, annual_family_income: 50000, monthly_income: 1000 },
};
const child = {
  id: "child",
  name: "Child",
  relation: "daughter",
  deceased: false,
  facts: { state: "Bihar" },
};
const mine = newCase("education", "me", "My case");
mine.id = "mine";
mine.notes = "Private owner note";
mine.events = [{ id: "private", at: "2026-10-24", actor: "owner", text: "Private history" }];
const theirs = { ...newCase("education", "child", "Child case"), id: "theirs" };
const ws = {
  version: 2,
  owner_id: "me",
  people: [owner, child],
  household: [
    { field: "annual_family_income", value: 50000, person_ids: ["me", "child"], confirmed: true },
  ],
  documents: [
    { id: "own", person_id: "me", kind: "doc_marksheet", state: "available" },
    { id: "other", person_id: "child", kind: "doc_bank_account", state: "available" },
  ],
  cases: [mine, theirs],
  journal: [
    {
      id: "family-event",
      text: "Family moved",
      person_ids: ["me", "child"],
      kind: "moving",
      at: "2026-10-24",
      occurred_on: null,
      changed_fields: [],
      scheduled: false,
    },
  ],
};
const own = scope.scopeWorkspace(ws, "personal");
assert.equal(own.people.length, 1);
assert.equal(own.cases.length, 1);
assert.equal(own.documents.length, 1);
assert.equal(own.household[0].person_ids.length, 1);
const merged = scope.mergeScopedWorkspace(
  ws,
  {
    ...own,
    journal: [
      ...own.journal,
      {
        id: "new",
        text: "Bonus",
        person_ids: ["me"],
        kind: "note",
        at: "2026-10-24",
        occurred_on: null,
        changed_fields: [],
        scheduled: false,
      },
    ],
  },
  "personal",
);
assert.equal(merged.journal[0].person_ids.length, 2);
assert.equal(merged.journal.length, 2);
assert.equal(merged.cases.find((c) => c.id === "theirs").applicant_id, "child");
assert.equal(merged.people.length, 2);
const renamed = { ...ws, people: [{ ...owner, relation: "changed" }, child] };
assert.equal(scope.primaryPerson(renamed), "me");
const req = { id: "marks", person_id: "me", options: ["doc_marksheet"] };
const snapshot = scope.shareSnapshot(ws, mine, [req], false);
assert.equal(snapshot.case.notes, "");
assert.equal(snapshot.case.events.length, 0);
assert.equal(snapshot.people.length, 1);
assert.equal(snapshot.documents.length, 1);
assert.equal(snapshot.people[0].facts.monthly_income, undefined);
assert.equal(ws.cases[0].notes, "Private owner note");
const record = {
  id: "share",
  owner_token: "owner",
  helper_token: "helper",
  revision: 1,
  expires_at: 0,
  shareNotes: false,
  lastSyncedCase: snapshot.case,
};
const remote = {
  ...snapshot.case,
  notes: "Helper checked it",
  answers: { marks_percent: 70 },
  events: [{ id: "helper", at: "2026-10-24", actor: "helper", text: "Updated note" }],
};
const synchronized = scope.mergeSharedCase(mine, remote, record);
assert.equal(synchronized.notes, "Private owner note");
assert.equal(synchronized.answers.marks_percent, 70);
assert.equal(synchronized.events[0].id, "private");
assert.equal(
  synchronized.events.some((e) => e.actor === "helper"),
  true,
);
assert.equal(scope.sharedCaseInput(mine, record).notes, "");
assert.equal(scope.sameValue({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
assert.equal(store.validWorkspace(ws), true);
assert.equal(store.validWorkspace({ ...ws, people: [null] }), false);
assert.equal(store.validWorkspace({ ...ws, cases: [{ id: "broken" }] }), false);
saved.set("jaagruk.workspace.v2", '{"version":2,"people":[null]}');
const recovery = store.loadWorkspace(null);
assert.equal(recovery.workspace.people.length, 0);
assert.equal(recovery.canPersist, true);
assert.equal(saved.get("jaagruk.workspace.recovery.v2"), '{"version":2,"people":[null]}');
const migrated = store.migrate({
  name: "Parent",
  doc_bank_account: true,
  family: [{ name: "Child", relation: "daughter" }],
});
assert.equal(migrated.documents.length, 1);
assert.equal(migrated.documents[0].person_id, migrated.owner_id);
assert.equal(migrated.people[1].facts.has_bank_account, undefined);
// A personal view must not send/export another person's event changes.
const familyJournal = {
  ...ws,
  journal: [
    {
      ...ws.journal[0],
      changed_fields: [
        { person_id: "me", field: "state", before: "Delhi", after: "Bihar" },
        { person_id: "child", field: "state", before: "Bihar", after: "Delhi" },
      ],
    },
  ],
};
const personalJournal = scope.scopeWorkspace(familyJournal, "personal");
assert.equal(personalJournal.journal[0].changed_fields.length, 1);
assert.equal(personalJournal.journal[0].changed_fields[0].person_id, "me");
assert.equal(
  scope.mergeScopedWorkspace(familyJournal, personalJournal, "personal").journal[0].changed_fields
    .length,
  2,
);
assert.equal(
  store.validWorkspace({ ...ws, journal: [{ ...ws.journal[0], changed_fields: [null] }] }),
  false,
);
// Late event results cannot overwrite a newer profile edit or helper change.
const result = {
  ...own,
  journal: [
    ...own.journal,
    {
      id: "event",
      text: "Moving",
      kind: "moving",
      person_ids: ["me"],
      at: "2026-10-24",
      occurred_on: null,
      changed_fields: [],
      scheduled: false,
    },
  ],
};
const newerProfile = {
  ...ws,
  people: [{ ...owner, facts: { ...owner.facts, state: "Bihar" } }, child],
};
assert.equal(scope.mergeWorkspaceResult(newerProfile, own, result, "personal"), null);
const newerHelper = {
  ...ws,
  cases: [{ ...mine, notes: "Updated while event was pending" }, theirs],
};
assert.equal(scope.mergeWorkspaceResult(newerHelper, own, result, "personal"), null);
const hiddenChange = { ...ws, people: [owner, { ...child, name: "Renamed during request" }] };
const safeResult = scope.mergeWorkspaceResult(hiddenChange, own, result, "personal");
assert.equal(safeResult.people.find((p) => p.id === "child").name, "Renamed during request");
assert.equal(safeResult.journal.length, 2);
assert.equal(
  scope.mergeWorkspaceResult(newerProfile, ws, { ...ws, journal: result.journal }, "family"),
  null,
);
console.log("Workspace scope, sharing, storage and stale-response regressions passed.");
