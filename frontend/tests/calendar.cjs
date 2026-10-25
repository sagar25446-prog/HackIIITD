const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
// The app is ESM; load this single compiled pure module without a browser or a test framework.
const box = { exports: {}, Intl, Date };
vm.runInNewContext(fs.readFileSync(".test-build/calendarDates.js", "utf8"), box);
const { monthDays, dateKey, displayDate, indiaToday } = box.exports;
assert.equal(monthDays(2024, 1).filter(Boolean).length, 29);
assert.equal(monthDays(2025, 1).filter(Boolean).length, 28);
assert.equal(monthDays(2026, 9).length, 42);
assert.equal(monthDays(2026, 9).filter(Boolean)[30], "2026-10-31");
assert.equal(dateKey(2027, 0, 1), "2027-01-01");
assert.match(displayDate("2026-10-31", "en"), /31.*Oct.*2026/);
assert.match(indiaToday(), /^\d{4}-\d{2}-\d{2}$/);
const RealDate = Date;
box.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : ["2026-10-23T20:00:00Z"]));
  }
};
assert.equal(box.exports.indiaToday(), "2026-10-24");
const sw = fs.readFileSync("public/sw.js", "utf8");
assert.match(sw, /url\.pathname\.startsWith\(["']\/api\/["']\)/);
assert.match(sw, /url\.pathname\.startsWith\(["']\/helper\/["']\)/);
assert.match(sw, /no-store/);
console.log("11 calendar/date and private-cache checks passed.");
