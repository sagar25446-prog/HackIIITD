import { Suspense, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileCheck2,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Landmark,
  PenLine,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { inr } from "../api";
import SchemeCard from "../components/SchemeCard";
import { lazyPage } from "../components/Safe";
import { caseTone, Empty, fmtDate } from "../components/ui";
import { hi as pick, Page, useApp } from "../state";
import Calendar from "../workspace/Calendar";
import { indiaToday } from "../workspace/calendarDates";
import { primaryPerson } from "../workspace/scope";
import { Case, newCase, uid } from "../workspace/types";
import Updates from "../workspace/Updates";
import { useWorkspace } from "../workspace/WorkspaceProvider";

const Explore = lazyPage(() => import("./Explore"));
const Radar = lazyPage(() => import("./Radar"));

/** Documents the paperwork planner has a route for. */
export const DOC_SERVICE: Record<string, string> = {
  doc_income_certificate: "income_certificate",
  doc_caste_certificate: "caste_certificate",
  doc_domicile_certificate: "domicile_certificate",
  doc_birth_certificate: "birth_death_certificate",
  doc_death_certificate: "birth_death_certificate",
  doc_aadhaar: "aadhaar",
  doc_pan: "pan",
  doc_driving_licence: "driving_licence",
};

/**
 * "Prepare this application": opens the person's existing case for a supported workflow, or creates it.
 * Returns false for schemes JAAGRUK has no reviewed preparation workflow for.
 */
export function usePrepare() {
  const { catalog, lang } = useApp();
  const { fullWorkspace, saveCase, openCase } = useWorkspace();
  return async (schemeId: string, who: string, name?: string) => {
    const kind = Object.entries<string>(catalog?.workflow_schemes || {}).find(
      ([, v]) => v === schemeId,
    )?.[0] as Case["kind"] | undefined;
    if (!kind) return false;
    const owner = primaryPerson(fullWorkspace);
    const pid = who === "self" || !who ? owner : who;
    if (!pid) return false;
    const existing = fullWorkspace.cases.find((c) => c.kind === kind && c.applicant_id === pid);
    if (existing) {
      openCase(existing.id);
      return true;
    }
    const title = (lang === "hi" ? "आवेदन की तैयारी: " : "Prepare: ") + (name || schemeId);
    const c = newCase(kind, pid, title.slice(0, 150));
    if (kind === "bereavement")
      c.subject_id = fullWorkspace.people.find((p) => p.deceased && p.id !== pid)?.id || null;
    await saveCase(c);
    openCase(c.id);
    return true;
  };
}

const TABS: [Page, string, string][] = [
  ["home", "Actions", "काम"],
  ["explore", "Discover", "खोजें"],
  ["calendar", "Calendar", "कैलेंडर"],
  ["radar", "Updates", "अपडेट"],
];

export default function Home() {
  const { lang, go, page, evaluation, evaluating, updates } = useApp();
  const hi = lang === "hi";
  const { mode, fullWorkspace, plan, workspace, openCase } = useWorkspace();
  const owner = fullWorkspace.people.find((p) => p.id === primaryPerson(fullWorkspace));
  const firstName = (owner?.name || "").split(" ")[0];
  const tab = (["explore", "calendar", "radar"] as Page[]).includes(page) ? page : "home";
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 fade-up">
        <div>
          <p className="text-sm font-semibold text-teal-700">
            {hi ? "नमस्ते" : "Namaste"}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="page-title">
            {mode === "personal"
              ? hi
                ? "मेरी योजना"
                : "My plan"
              : hi
                ? "मेरे परिवार की योजना"
                : "My family's plan"}
          </h1>
        </div>
        <button className="btn-primary" onClick={() => go("life")}>
          <PenLine className="h-4 w-4" /> {hi ? "जीवन का अपडेट लिखें" : "Write a life update"}
        </button>
      </header>
      <div
        className="segmented max-w-full overflow-x-auto scrollbar-none"
        role="tablist"
        aria-label={hi ? "योजना के भाग" : "Plan views"}
      >
        {TABS.map(([id, en, h]) => (
          <button
            role="tab"
            key={id}
            aria-selected={tab === id}
            onClick={() => go(id)}
            className="relative shrink-0 px-4"
          >
            {hi ? h : en}
            {id === "radar" && updates > 0 && (
              <span className="ml-1.5 rounded-full bg-coral-600 px-1.5 text-[11px] font-bold text-white">
                {updates}
              </span>
            )}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="skeleton h-64" />}>
        {tab === "calendar" ? (
          <Calendar
            deadlines={plan?.deadlines || []}
            people={workspace.people}
            cases={workspace.cases}
            lang={lang}
            onOpen={openCase}
          />
        ) : tab === "radar" ? (
          <div className="space-y-10">
            <Radar embedded />
            <Updates />
          </div>
        ) : tab === "explore" ? (
          <Explore />
        ) : (
          <Overview evaluation={evaluation} evaluating={evaluating} />
        )}
      </Suspense>
    </div>
  );
}

type Action = {
  key: string;
  title: string;
  person: string;
  reason: string;
  date?: string;
  run: () => void;
};

function NextActions({ evaluation }: { evaluation: any }) {
  const { lang, go, catalog } = useApp();
  const hi = lang === "hi";
  const { workspace, plan, openCase, busy, fullWorkspace } = useWorkspace();
  const prepare = usePrepare();
  const owner = primaryPerson(fullWorkspace);
  const nameOf = (id: string) =>
    workspace.people.find((p) => p.id === (id === "self" ? owner : id))?.name || "";
  const schemes = catalog?.schemes || [];
  const workflows: Record<string, string> = catalog?.workflow_schemes || {};
  const kindOf = (id: string) => Object.entries(workflows).find(([, v]) => v === id)?.[0];
  const caseDate = (caseId: string) =>
    (plan?.deadlines || [])
      .filter((d) => d.case_id === caseId && d.date >= indiaToday())
      .map((d) => d.date)
      .sort()[0];
  const caseActions: Action[] = (plan?.next_actions || []).map((a) => ({
    key: "c" + a.case_id + a.id,
    title: hi ? a.label_hi : a.label,
    person: nameOf(a.person_id),
    reason: workspace.cases.find((x) => x.id === a.case_id)?.title || "",
    date: caseDate(a.case_id),
    run: () => openCase(a.case_id),
  }));
  caseActions.sort((x, y) => (x.date || "9999").localeCompare(y.date || "9999"));
  const schemeActions: Action[] = [];
  for (const m of (evaluation?.matches || []) as any[]) {
    if (m.decision.status !== "eligible") continue;
    const rule = schemes.find((s: any) => s.id === m.scheme_id);
    const name = pick(rule || { name: m.scheme_id }, "name", lang);
    const pid = m.who === "self" ? owner : m.who;
    const kind = kindOf(m.scheme_id);
    if (kind && workspace.cases.some((c) => c.kind === kind && c.applicant_id === pid)) continue;
    schemeActions.push({
      key: "s" + m.scheme_id + m.who,
      title: kind
        ? (hi ? "आवेदन की तैयारी करें: " : "Prepare the application: ") + name
        : (hi ? "आवेदन का तरीका देखें: " : "See how to apply: ") + name,
      person: m.who_name,
      reason: hi ? "समीक्षित शर्तें पूरी करता है" : "Matches the reviewed conditions",
      run: async () => {
        if (!(await prepare(m.scheme_id, m.who, name))) go("explore", { open: m.scheme_id });
      },
    });
  }
  // supported workflows first: they lead to a real preparation case
  schemeActions.sort(
    (a, b) =>
      Number(!a.title.includes(hi ? "तैयारी" : "Prepare")) -
      Number(!b.title.includes(hi ? "तैयारी" : "Prepare")),
  );
  const questionActions: Action[] = (evaluation?.questions || []).map((q: any) => ({
    key: "q" + q.who + q.field,
    title: (hi ? "जवाब दें: " : "Answer: ") + (hi ? q.q_hi || q.q : q.q),
    person: nameOf(q.who),
    reason: hi ? "इससे और योजनाएँ खुल सकती हैं" : "Can unlock more schemes",
    run: () => document.getElementById("quick-questions")?.scrollIntoView({ behavior: "smooth" }),
  }));
  const top = [...caseActions, ...schemeActions, ...questionActions].slice(0, 3);
  return (
    <section className="card p-5 fade-up" aria-labelledby="next-actions">
      <h2 id="next-actions" className="section-title flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-teal-700" />
        {hi ? "अगले तीन काम" : "Your next three actions"}
      </h2>
      {(busy && !plan) || (!evaluation && !plan) ? (
        <div className="skeleton mt-3 h-24" />
      ) : top.length === 0 ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-ink-600">
            {hi
              ? "अभी कोई तय काम नहीं। शुरू करने के लिए एक चुनें:"
              : "No action is due yet. Start with one of these:"}
          </p>
          <Suggest icon={<PenLine className="h-4 w-4" />} onClick={() => go("life")}>
            {hi ? "जीवन का अपडेट लिखें" : "Write a life update"}
          </Suggest>
          <Suggest icon={<ClipboardList className="h-4 w-4" />} onClick={() => go("paperwork")}>
            {hi ? "किसी सेवा के दस्तावेज़ जानें" : "Find paperwork for a service"}
          </Suggest>
          <Suggest icon={<Wallet className="h-4 w-4" />} onClick={() => go("wapsi")}>
            {hi ? "भूली हुई संपत्ति खोजें" : "Look for forgotten money"}
          </Suggest>
        </div>
      ) : (
        <ol className="mt-3 grid gap-2 md:grid-cols-3">
          {top.map((a, i) => (
            <li key={a.key}>
              <button
                className="flex h-full w-full items-start gap-3 rounded-xl bg-teal-50 p-3 text-left transition hover:bg-teal-100"
                onClick={a.run}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <b className="block leading-snug">{a.title}</b>
                  <span className="mt-1 block text-sm text-ink-600">
                    {[a.person, a.reason].filter(Boolean).join(" · ")}
                  </span>
                  {a.date && (
                    <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-teal-800">
                      <CalendarClock className="h-4 w-4" /> {fmtDate(a.date, lang)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function BenefitEstimates({ h, loading }: { h: any; loading: boolean }) {
  const { lang, go } = useApp();
  const hi = lang === "hi";
  const { workspace } = useWorkspace();
  const possible = workspace.cases
    .filter((c) => c.kind === "wapsi")
    .flatMap((c) => c.observations || [])
    .filter((o) => o.outcome === "possible_record").length;
  const pending = (h?.pending_documents || []).length > 0;
  const status = pending
    ? hi
      ? "शर्तें पूरी · दस्तावेज़ बाकी"
      : "Matches · documents pending"
    : hi
      ? "समीक्षित शर्तें पूरी"
      : "Matches the reviewed conditions";
  const tiles = [
    {
      label: hi ? "नियमित सहायता" : "Recurring assistance",
      value: h?.recurring_inr,
      period: hi ? "प्रति वर्ष" : "per year",
      status,
    },
    {
      label: hi ? "शैक्षणिक-वर्ष छात्रवृत्ति" : "Academic-year awards",
      value: h?.academic_inr,
      period: hi ? "प्रति शैक्षणिक वर्ष" : "per academic year",
      status,
    },
    {
      label: hi ? "एकमुश्त सहायता" : "One-time assistance",
      value: h?.one_time_inr,
      period: hi ? "एक बार" : "once",
      status,
    },
    {
      label: hi ? "बीमा कवर" : "Insurance cover",
      value: h?.cover_inr,
      period: hi ? "नकद नहीं, सुरक्षा" : "protection, not cash",
      status: hi ? "नामांकन के बाद" : "after enrolment",
    },
    {
      label: hi ? "ऋण" : "Credit",
      value: h?.credit_inr,
      period: hi ? "तक, लौटाना होगा" : "up to, to be repaid",
      status: hi ? "बैंक तय करता है" : "the lender decides",
    },
  ].filter((x) => (x.value || 0) > 0);
  return (
    <section className="fade-up" aria-labelledby="benefits">
      <h2 id="benefits" className="section-title">
        {hi ? "लाभ के अनुमान" : "Benefit estimates"}
      </h2>
      <p className="mb-3 text-sm text-ink-600">
        {hi
          ? "हर राशि की अलग अवधि है, इसलिए इन्हें जोड़ा नहीं गया। यह स्वीकृति या हाथ में पैसा नहीं है।"
          : "Each amount has its own period, so they are not added together. None of this is approval or cash in hand."}
      </p>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((x) => (
            <div key={x.label} className="card p-4">
              <div className="text-sm font-semibold text-ink-600">{x.label}</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-teal-800">
                {inr(x.value)}
              </div>
              <div className="text-sm text-ink-600">{x.period}</div>
              <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-800">
                <CheckCircle2 className="h-3.5 w-3.5" /> {x.status}
              </div>
            </div>
          ))}
          <button className="card card-hover p-4 text-left" onClick={() => go("wapsi")}>
            <div className="text-sm font-semibold text-ink-600">
              {hi ? "संभावित वापसी" : "Possible recovery"}
            </div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-ink-800">
              {possible} {hi ? "रिकॉर्ड" : possible === 1 ? "record" : "records"}
            </div>
            <div className="text-sm text-ink-600">
              {hi ? "स्वामित्व संस्था तय करती है" : "the institution decides ownership"}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-800">
              <Landmark className="h-3.5 w-3.5" /> Wapsi <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>
          {tiles.length === 0 && (
            <div className="card p-4 text-sm text-ink-600 sm:col-span-2">
              {hi
                ? "अभी कोई नकद लाभ समीक्षित शर्तों से मेल नहीं खाता। नीचे के सवालों के जवाब दें या दस्तावेज़ जोड़ें।"
                : "No cash benefit matches the reviewed conditions yet. Answer the questions below or add a document."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Overview({ evaluation, evaluating }: { evaluation: any; evaluating: boolean }) {
  const { lang, go, catalog } = useApp();
  const hi = lang === "hi";
  const { workspace, plan, openCase, mode } = useWorkspace();
  const matches = (evaluation?.matches || []) as any[];
  const proven = matches.filter((m) => m.decision.status === "eligible");
  const oneAway = matches.filter((m) => m.decision.status === "needs_info");
  const upcoming = (plan?.deadlines || [])
    .filter((d) => d.date >= indiaToday())
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-8">
      <NextActions evaluation={evaluation} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 fade-up">
          <h2 className="section-title mb-3">{hi ? "चल रहे मामले" : "Active cases"}</h2>
          {workspace.cases.length === 0 ? (
            <Empty
              icon={<FileCheck2 className="h-5 w-5" />}
              title={hi ? "अभी कोई मामला नहीं" : "No cases yet"}
            >
              {hi
                ? "ऊपर का कोई काम शुरू करें, या जीवन का अपडेट, कागज़ी काम या वापसी से मामला बनाएँ।"
                : "Start one of the actions above, or create a case from a life update, paperwork or Wapsi."}
            </Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {workspace.cases.map((c) => {
                const p = plan?.cases.find((p) => p.case_id === c.id);
                const nextTask = p?.tasks.find((t) => !t.done);
                return (
                  <button
                    className="card card-hover p-4 text-left"
                    key={c.id}
                    onClick={() => openCase(c.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 font-bold leading-snug">{c.title}</h3>
                      {p && (
                        <span className={`chip shrink-0 ${caseTone[p.status] || "bg-ink-100"}`}>
                          {hi ? p.status_hi : (p as any).status_label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-600">
                      {workspace.people.find((x) => x.id === c.applicant_id)?.name} ·{" "}
                      {KIND_LABEL[c.kind]?.[hi ? 1 : 0] || c.kind}
                    </p>
                    {nextTask && (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-700">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                        {hi ? nextTask.label_hi : nextTask.label}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="card p-5 fade-up">
          <h2 className="section-title flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-teal-700" />
            {hi ? "आने वाली तिथियाँ" : "Coming up"}
          </h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-ink-600">
              {hi
                ? "कोई आने वाली तिथि नहीं। किसी मामले में अगली जाँच की तिथि जोड़ें।"
                : "No dates ahead. Add a follow-up date in a case."}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.slice(0, 4).map((d) => (
                <li key={d.id}>
                  <button
                    className="w-full rounded-xl border border-ink-100 p-3 text-left hover:border-teal-200"
                    onClick={() => openCase(d.case_id)}
                  >
                    <span className="chip bg-teal-50 text-teal-800">{fmtDate(d.date, lang)}</span>
                    <span className="mt-1 block text-sm font-semibold leading-snug">
                      {hi ? d.title_hi : d.title}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {workspace.people.find((p) => p.id === d.person_id)?.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2">
            <button className="btn-ghost btn-sm w-full" onClick={() => go("calendar")}>
              {hi ? "पूरा कैलेंडर" : "Open calendar"} <ArrowRight className="h-4 w-4" />
            </button>
            <button className="btn-quiet btn-sm w-full" onClick={() => go("radar")}>
              <ShieldCheck className="h-4 w-4" />{" "}
              {hi ? "समीक्षित बदलाव और अपडेट" : "Reviewed changes and updates"}
            </button>
          </div>
        </section>
      </div>

      <BenefitEstimates h={evaluation?.haq_meter} loading={evaluating && !evaluation} />

      <section className="fade-up">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="section-title">
              {mode === "personal"
                ? hi
                  ? "आपके लिए योजनाएँ"
                  : "Schemes for you"
                : hi
                  ? "आपके परिवार के लिए योजनाएँ"
                  : "Schemes for your family"}
            </h2>
            <p className="text-sm text-ink-600">
              {hi
                ? "Z3 सॉल्वर हर योजना को समीक्षित नियमों पर जाँचता है। कारण और अभी तय न हुई शर्तें देखने के लिए खोलें।"
                : "The Z3 solver checks each scheme against the reviewed rules. Open a card to see why, and which conditions are still unresolved."}
            </p>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => go("explore")}>
            <Compass className="h-4 w-4" /> {hi ? "सभी योजनाएँ खोजें" : "Discover every scheme"}
          </button>
        </div>
        {evaluating && !evaluation ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : proven.length + oneAway.length === 0 ? (
          <Empty
            icon={<HelpCircle className="h-5 w-5" />}
            title={hi ? "अभी कोई योजना मेल नहीं खाती" : "No scheme matches yet"}
            action={
              <button className="btn-primary" onClick={() => go("explore")}>
                <BookOpen className="h-4 w-4" /> {hi ? "योजनाएँ खोजें" : "Discover schemes"}
              </button>
            }
          >
            {hi
              ? "नीचे के सवालों के जवाब दें या प्रोफ़ाइल में जानकारी जोड़ें।"
              : "Answer the questions below or add details in your profile to see matches."}
          </Empty>
        ) : (
          <SchemeGroups proven={proven} oneAway={oneAway} />
        )}
      </section>

      {(evaluation?.questions?.length > 0 || evaluation?.unlock_paths?.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {evaluation?.questions?.length > 0 && <QuickQuestions questions={evaluation.questions} />}
          {evaluation?.unlock_paths?.length > 0 && (
            <UnlockPaths paths={evaluation.unlock_paths} catalog={catalog} />
          )}
        </div>
      )}

      {evaluation?.exams?.length > 0 && <Exams exams={evaluation.exams} catalog={catalog} />}
    </div>
  );
}

export const KIND_LABEL: Record<string, [string, string]> = {
  bereavement: ["Bereavement support", "शोक सहायता"],
  retirement: ["Retirement / old-age", "सेवानिवृत्ति / वृद्धावस्था"],
  education: ["Education / scholarship", "पढ़ाई / छात्रवृत्ति"],
  moving: ["Moving / ration card", "स्थानांतरण / राशन कार्ड"],
  wapsi: ["Unclaimed money", "लावारिस पैसा"],
  paperwork: ["Paperwork", "कागज़ी काम"],
};

function Suggest({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-xl border border-ink-100 p-2.5 text-left font-semibold hover:border-teal-200 hover:bg-teal-50"
      onClick={onClick}
    >
      <span className="text-teal-700">{icon}</span>
      <span className="flex-1">{children}</span>
      <ArrowRight className="h-4 w-4 text-ink-400" />
    </button>
  );
}

function SchemeGroups({ proven, oneAway }: { proven: any[]; oneAway: any[] }) {
  const { lang, t } = useApp();
  const hi = lang === "hi";
  const { mode } = useWorkspace();
  const [who, setWho] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of [...proven, ...oneAway]) seen.set(m.who, m.who_name);
    return [...seen.entries()];
  }, [proven, oneAway]);
  const filter = (list: any[]) => (who === "all" ? list : list.filter((m) => m.who === who));
  const p = filter(proven);
  const o = filter(oneAway);
  return (
    <div id="schemes-for-you" className="space-y-5 scroll-mt-24">
      {mode === "family" && people.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[["all", hi ? "सभी" : "Everyone"], ...people].map(([id, name]) => (
            <button
              key={id}
              aria-pressed={who === id}
              className={`chip px-3 py-1.5 text-sm ${who === id ? "bg-teal-600 text-white" : "bg-white text-ink-700 ring-1 ring-ink-200"}`}
              onClick={() => setWho(id)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {p.length > 0 && (
        <div>
          <div className="label mb-2 flex items-center gap-1.5 text-teal-700">
            <CheckCircle2 className="h-4 w-4" /> {t("provenForYou")} · {p.length}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(showAll ? p : p.slice(0, 6)).map((m) => (
              <SchemeCard key={m.scheme_id + m.who} m={m} />
            ))}
          </div>
          {p.length > 6 && (
            <button className="btn-quiet btn-sm mt-2" onClick={() => setShowAll(!showAll)}>
              {showAll ? t("showLess") : `${t("showAll")} (${p.length})`}
            </button>
          )}
        </div>
      )}
      {o.length > 0 && (
        <details className="group" open={p.length === 0}>
          <summary className="label flex cursor-pointer list-none items-center gap-1.5 text-amber-700">
            <HelpCircle className="h-4 w-4" /> {t("oneAnswerAway")} · {o.length}
            <span className="ml-1 normal-case tracking-normal text-ink-500 group-open:hidden">
              ({hi ? "दिखाएँ" : "show"})
            </span>
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {o.map((m) => (
              <SchemeCard key={m.scheme_id + m.who} m={m} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function QuickQuestions({ questions }: { questions: any[] }) {
  const { lang, catalog } = useApp();
  const hi = lang === "hi";
  const { fullWorkspace, setWorkspace, workspace } = useWorkspace();
  const owner = primaryPerson(fullWorkspace);
  const answer = (q: any, value: any) => {
    const id = q.who === "self" ? owner : q.who;
    setWorkspace((w) => ({
      ...w,
      people: w.people.map((p) =>
        p.id === id ? { ...p, facts: { ...p.facts, [q.field]: value } } : p,
      ),
    }));
  };
  const name = (who: string) =>
    who === "self" ? (hi ? "आप" : "You") : workspace.people.find((p) => p.id === who)?.name || who;
  return (
    <section id="quick-questions" className="card scroll-mt-24 p-5 fade-up">
      <h2 className="section-title flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-amber-600" />
        {hi ? "जवाब दें, और योजनाएँ खुलेंगी" : "Answer to unlock more schemes"}
      </h2>
      <p className="text-sm text-ink-500">
        {hi
          ? "हर जवाब तुरंत सॉल्वर से दोबारा जाँचा जाता है। अनजान हो तो छोड़ दें।"
          : "Each answer is re-checked by the solver instantly. Skip what you don't know."}
      </p>
      <ul className="mt-3 space-y-3">
        {questions.map((q) => (
          <li key={q.who + q.field} className="rounded-xl border border-ink-100 p-3">
            <div className="text-xs font-semibold text-ink-500">{name(q.who)}</div>
            <div className="font-semibold leading-snug">{hi ? q.q_hi || q.q : q.q}</div>
            <div className="mt-2">
              <AnswerInput q={q} enums={catalog?.enums?.[q.field]} onAnswer={(v) => answer(q, v)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AnswerInput({
  q,
  enums,
  onAnswer,
}: {
  q: any;
  enums?: string[];
  onAnswer: (v: any) => void;
}) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const [value, setValue] = useState("");
  if (q.type === "bool")
    return (
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm px-5" onClick={() => onAnswer(true)}>
          {hi ? "हाँ" : "Yes"}
        </button>
        <button className="btn-ghost btn-sm px-5" onClick={() => onAnswer(false)}>
          {hi ? "नहीं" : "No"}
        </button>
      </div>
    );
  if (q.type === "enum" && enums?.length)
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => e.target.value && onAnswer(e.target.value)}
      >
        <option value="">{hi ? "चुनें" : "Choose"}</option>
        {enums.map((v) => (
          <option key={v} value={v}>
            {v.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    );
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() !== "" && !Number.isNaN(Number(value))) onAnswer(Number(value));
      }}
    >
      <input
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
        aria-label={q.q}
      />
      <button className="btn-secondary" disabled={!value}>
        {hi ? "सहेजें" : "Save"}
      </button>
    </form>
  );
}

function UnlockPaths({ paths, catalog }: { paths: any[]; catalog: any }) {
  const { lang, go } = useApp();
  const hi = lang === "hi";
  const { fullWorkspace, setWorkspace } = useWorkspace();
  const owner = primaryPerson(fullWorkspace);
  const docs = catalog?.documents || {};
  const schemes = catalog?.schemes || [];
  const have = (kind: string) =>
    setWorkspace((w) => ({
      ...w,
      documents: [
        ...w.documents.filter((d) => !(d.person_id === owner && d.kind === kind)),
        { id: uid(), person_id: owner!, kind, state: "available" as const },
      ],
    }));
  return (
    <section className="card p-5 fade-up">
      <h2 className="section-title flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-teal-700" />
        {hi ? "दावा करने लायक बनाएँ" : "Make it claimable"}
      </h2>
      <p className="text-sm text-ink-500">
        {hi
          ? "एक दस्तावेज़ जो कई योजनाएँ खोल देता है।"
          : "One document that unlocks several schemes at once."}
      </p>
      <ul className="mt-3 space-y-3">
        {paths.map((p) => (
          <li
            key={p.documents.join("+")}
            className="rounded-xl border border-teal-100 bg-teal-50/50 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b>
                {p.documents
                  .map((d: string) => pick(docs[d] || { name: d }, "name", lang))
                  .join(" + ")}
              </b>
              {p.value_inr > 0 && (
                <span className="chip bg-teal-600 text-white">+{inr(p.value_inr)}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {hi ? "खुलेंगी:" : "Unlocks:"}{" "}
              {p.unlocks
                .map((id: string) =>
                  pick(schemes.find((s: any) => s.id === id) || { name: id }, "name", lang),
                )
                .join(", ")}
            </p>
            {p.documents.map((d: string) =>
              docs[d]?.where ? (
                <p key={d} className="mt-1 text-xs text-ink-500">
                  {docs[d].where}
                  {docs[d].days
                    ? ` · ${hi ? "लगभग" : "about"} ${docs[d].days} ${hi ? "दिन" : "days"}`
                    : ""}
                </p>
              ) : null,
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn-primary btn-sm"
                onClick={() => {
                  const mapped = p.documents.find((d: string) => DOC_SERVICE[d]);
                  // documents without a reviewed route open the official-guidance search instead
                  go(
                    "paperwork",
                    mapped
                      ? { service: DOC_SERVICE[mapped] }
                      : {
                          service: "other",
                          query: (docs[p.documents[0]]?.name || p.documents[0]).slice(0, 90),
                        },
                  );
                }}
              >
                {hi ? "कैसे बनवाएँ" : "How to get it"}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => p.documents.forEach(have)}>
                {hi ? "मेरे पास पहले से है" : "I already have it"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Exams({ exams, catalog }: { exams: any[]; catalog: any }) {
  const { lang } = useApp();
  const hi = lang === "hi";
  return (
    <section className="fade-up">
      <h2 className="section-title mb-3 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-teal-700" />
        {hi ? "परीक्षाएँ" : "Government exams"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {exams.slice(0, 8).map((e) => {
          const ex = catalog?.exams?.find((x: any) => x.id === e.id) || {};
          return (
            <div key={e.id + e.who} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <b className="leading-snug">{pick(ex, "name", lang) || e.id}</b>
                <span
                  className={`chip shrink-0 ${e.status === "eligible" ? "bg-teal-100 text-teal-800" : "bg-ink-100 text-ink-700"}`}
                >
                  {e.status === "eligible"
                    ? hi
                      ? "पात्र"
                      : "Eligible"
                    : hi
                      ? "अभी नहीं"
                      : "Not yet"}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-500">{e.who_name}</p>
              <p className="mt-2 text-sm text-ink-700">{e.why}</p>
              {e.forecast?.window && (
                <p className="mt-1 text-xs text-ink-500" title={e.forecast.history_hits}>
                  {hi ? "अगली अधिसूचना संभावित" : "Next notice expected"}: {e.forecast.window}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
