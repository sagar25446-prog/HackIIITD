const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const box = { exports: {} };
vm.runInNewContext(fs.readFileSync(".test-build/eventDraft.js", "utf8"), box);
const { createEventDraft, eventDraftReducer: step } = box.exports;

let draft = createEventDraft();
draft = step(draft, { type: "text", text: "My annual income changed" });
draft = step(draft, { type: "interpret", kind: "income_review" });
draft = step(draft, { type: "date", date: "2026-10-24" });
draft = step(draft, { type: "income", income: 120000 });
draft = step(draft, { type: "confirmIncome", confirmed: true });
assert.equal(draft.confirmIncome, true);
assert.equal(draft.income, 120000);

// Editing the text itself starts a new review, even before the previous draft was saved.
draft = step(draft, { type: "text", text: "I got a bonus at work" });
assert.equal(draft.confirmIncome, false);
assert.equal(draft.income, null);
assert.equal(draft.date, "");
draft = step(draft, { type: "interpret", kind: "income_review" });
assert.equal(draft.kind, "income_review");
assert.equal(draft.confirmIncome, false, "a later bonus remains a note until separately confirmed");
assert.equal(draft.income, null);

// Success clears the same state used by the component, including old factual consent.
draft = step(draft, { type: "income", income: 150000 });
draft = step(draft, { type: "confirmIncome", confirmed: true });
draft = step(draft, { type: "reset" });
assert.equal(draft.text, "");
assert.equal(draft.confirmIncome, false);
assert.equal(draft.income, null);
draft = step(draft, { type: "text", text: "Another bonus" });
draft = step(draft, { type: "interpret", kind: "income_review" });
assert.equal(draft.confirmIncome, false);

draft = step(draft, { type: "text", text: "I moved to Delhi" });
draft = step(draft, { type: "interpret", kind: "moving", destination: "Delhi" });
draft = step(draft, { type: "date", date: "2026-10-24" });
draft = step(draft, { type: "confirmMove", confirmed: true });
assert.equal(draft.confirmMove, true);
assert.equal(draft.destination, "Delhi");
draft = step(draft, { type: "reset" });
draft = step(draft, { type: "text", text: "I am moving to Maharashtra" });
draft = step(draft, { type: "interpret", kind: "moving", destination: "Maharashtra" });
assert.equal(draft.destination, "Maharashtra");
assert.equal(draft.confirmMove, false, "each move needs its own residence-change confirmation");
assert.equal(draft.date, "", "a later move cannot inherit the previous move date");

// Reinterpretation and manual kind changes also invalidate consent for the current draft.
draft = step(draft, { type: "date", date: "2026-10-25" });
draft = step(draft, { type: "confirmMove", confirmed: true });
draft = step(draft, { type: "interpret", kind: "moving", destination: "Bihar" });
assert.equal(draft.confirmMove, false);
assert.equal(draft.date, "");
assert.equal(draft.destination, "Bihar");
draft = step(draft, { type: "confirmMove", confirmed: true });
draft = step(draft, { type: "kind", kind: "note" });
assert.equal(draft.confirmMove, false);
assert.equal(draft.confirmIncome, false);
assert.equal(draft.destination, "");
assert.equal(draft.text, "I am moving to Maharashtra");

// Details the reader found are suggestions; a death is only recorded with its own confirmation.
draft = step(draft, { type: "text", text: "My husband passed away last month" });
draft = step(draft, {
  type: "interpret",
  kind: "bereavement",
  date: "2026-09-24",
  subjectId: "ramesh",
});
assert.equal(draft.date, "2026-09-24");
assert.equal(draft.subjectId, "ramesh");
assert.equal(draft.confirmDeceased, false);
draft = step(draft, { type: "confirmDeceased", confirmed: true });
draft = step(draft, { type: "subject", subjectId: "other" });
assert.equal(draft.confirmDeceased, false, "changing the person withdraws the confirmation");
draft = step(draft, { type: "text", text: "Riya second year renewal" });
draft = step(draft, { type: "interpret", kind: "education", mode: "renewal", courseYear: 2 });
assert.equal(draft.mode, "renewal");
assert.equal(draft.courseYear, 2);
assert.equal(draft.subjectId, "", "a new update does not keep the previous related person");
draft = step(draft, { type: "text", text: "salary now 3 lakh" });
draft = step(draft, { type: "interpret", kind: "income_review", income: 300000 });
assert.equal(draft.income, 300000);
assert.equal(draft.confirmIncome, false, "a suggested amount still needs confirmation");
console.log("35 life-event draft and per-event consent assertions passed.");
