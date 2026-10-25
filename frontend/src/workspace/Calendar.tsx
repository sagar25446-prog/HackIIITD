import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Case, Deadline, Person } from "./types";
import { dateKey, displayDate, indiaToday, monthDays } from "./calendarDates";
export default function Calendar({
  deadlines,
  people,
  cases,
  lang,
  onOpen,
}: {
  deadlines: Deadline[];
  people: Person[];
  cases: Case[];
  lang: string;
  onOpen: (id: string) => void;
}) {
  const now = indiaToday();
  const [month, setMonth] = useState(now.slice(0, 7));
  const [person, setPerson] = useState("");
  const [caseId, setCase] = useState("");
  const [mode, setMode] = useState("month");
  const [selected, setSelected] = useState<string | null>(null);
  const [y, m] = month.split("-").map(Number);
  const visible = deadlines
    .filter((d) => (!person || d.person_id === person) && (!caseId || d.case_id === caseId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const change = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(dateKey(d.getFullYear(), d.getMonth(), 1).slice(0, 7));
    setSelected(null);
  };
  const list = visible.filter(
    (d) => mode === "agenda" || (selected ? d.date === selected : d.date.startsWith(month)),
  );
  const actor = (a: string) =>
    ({
      applicant: lang === "hi" ? "आवेदक" : "Applicant",
      institute: lang === "hi" ? "संस्थान" : "Institute",
      nodal: lang === "hi" ? "नोडल अधिकारी" : "Nodal officer",
    })[a] || a;
  return (
    <section
      aria-label={lang === "hi" ? "तिथि कैलेंडर" : "Deadline calendar"}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-bold">
          {lang === "hi" ? "नवीनीकरण और तिथियाँ" : "Renewals & dates"}
        </h2>
        <button
          className="btn-ghost"
          onClick={() => {
            setMode(mode === "month" ? "agenda" : "month");
            setSelected(null);
          }}
        >
          {mode === "month"
            ? lang === "hi"
              ? "सूची देखें"
              : "Agenda view"
            : lang === "hi"
              ? "महीना देखें"
              : "Month view"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          {lang === "hi" ? "व्यक्ति" : "Person"}
          <select className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{lang === "hi" ? "सभी" : "Everyone"}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {lang === "hi" ? "मामला" : "Case"}
          <select className="input" value={caseId} onChange={(e) => setCase(e.target.value)}>
            <option value="">{lang === "hi" ? "सभी मामले" : "All cases"}</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mode === "month" && (
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <button className="btn-ghost" aria-label="Previous month" onClick={() => change(-1)}>
              <ChevronLeft size={18} />
            </button>
            <h3 className="font-bold">
              {new Date(y, m - 1, 1).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
                month: "long",
                year: "numeric",
              })}
            </h3>
            <button className="btn-ghost" aria-label="Next month" onClick={() => change(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {(lang === "hi"
              ? ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"]
              : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            ).map((d) => (
              <div className="pb-2 text-center text-xs font-semibold" key={d}>
                {d}
              </div>
            ))}
            {monthDays(y, m - 1).map((d, i) => {
              const count = visible.filter((e) => e.date === d).length;
              return d ? (
                <button
                  key={d}
                  aria-label={`${displayDate(d, lang)}: ${count} ${lang === "hi" ? "तिथियाँ" : "dates"}`}
                  aria-pressed={selected === d}
                  className={`calendar-day ${d === now ? "ring-2 ring-teal-700" : ""} ${selected === d ? "bg-teal-100" : "bg-ink-50"}`}
                  onClick={() => setSelected(selected === d ? null : d)}
                >
                  <span>{Number(d.slice(-2))}</span>
                  {count > 0 && (
                    <span className="rounded bg-teal-700 px-1 text-xs text-white">{count}</span>
                  )}
                </button>
              ) : (
                <div key={i} />
              );
            })}
          </div>
        </div>
      )}
      <p className="text-sm text-ink-500">
        {lang === "hi"
          ? "आवेदक, संस्थान और विभाग की तिथियाँ अलग हैं। निजी अगली जाँच की तिथि आपके द्वारा बताई गई है।"
          : "Applicant, institute and department milestones are distinct. Personal follow-ups are user-reported."}
      </p>
      <div className="space-y-3">
        {list.length === 0 ? (
          <p className="card p-5">
            {lang === "hi"
              ? "चुने गए फ़िल्टर में कोई तिथि नहीं है। मामले में अगली जाँच की तिथि जोड़ सकते हैं।"
              : "No dates for this selection. You can add a follow-up date in a case."}
          </p>
        ) : (
          list.map((d) => (
            <div className="card p-4" key={d.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`chip ${d.date < now ? "bg-coral-50 text-coral-600" : "bg-teal-50 text-teal-700"}`}
                >
                  {displayDate(d.date, lang)}
                  {d.date < now ? (lang === "hi" ? " · बीती तिथि" : " · past date") : ""}
                </span>
                <span className="chip bg-ink-50">{actor(d.actor)}</span>
              </div>
              <button
                className="mt-2 block text-left font-bold text-teal-800 underline"
                onClick={() => onOpen(d.case_id)}
              >
                {lang === "hi" ? d.title_hi : d.title}
              </button>
              <p className="text-sm">{people.find((p) => p.id === d.person_id)?.name}</p>
              <p className="text-xs text-ink-500">{d.provenance}</p>
              {d.source_url && (
                <a
                  className="text-sm text-teal-700 underline"
                  href={d.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {lang === "hi" ? "आधिकारिक स्रोत" : "Official source"}
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
