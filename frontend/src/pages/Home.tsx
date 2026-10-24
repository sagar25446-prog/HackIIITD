import { useEffect, useState } from "react";
import { ArrowRight, BellRing, CalendarClock, GraduationCap, KeyRound, Landmark, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { api, inr } from "../api";
import SchemeCard from "../components/SchemeCard";
import { CountUp, Empty, Section, Spinner, statusColor } from "../components/ui";
import { hi, useApp } from "../state";

export default function Home() {
  const { evaluation: ev, evaluating, t, go, profile } = useApp();
  if (!ev) return <div className="flex items-center justify-center gap-2 p-16 text-ink-500"><Spinner /> Proving eligibility…</div>;
  const h = ev.haq_meter;
  const eligible = ev.matches.filter((m: any) => m.decision.status === "eligible");
  const pending = ev.matches.filter((m: any) => m.decision.status === "needs_info");
  const hasDeath = (profile?.life_events || []).includes("death_in_family");

  return (
    <div>
      <HaqMeter h={h} evaluating={evaluating} solverMs={ev.solver_ms} />

      {(hasDeath || h.possible_claims_inr > 0) && (
        <button onClick={() => go("wapsi")} className="card mb-6 flex w-full items-center gap-4 border-amber-200 bg-amber-50/60 p-4 text-left hover:border-amber-400">
          <Wallet className="h-8 w-8 shrink-0 text-amber-500" />
          <div className="flex-1">
            <div className="font-bold">{t("searchUnclaimed")}</div>
            <div className="text-sm text-ink-700">{t("searchUnclaimedSub")}{h.possible_claims_inr ? ` · ${inr(h.possible_claims_inr)} ${t("possibleClaims")}` : ""}</div>
          </div>
          <ArrowRight className="h-5 w-5 text-amber-600" />
        </button>
      )}

      <Deadlines />

      <div className="grid gap-4 lg:grid-cols-2">
        {ev.unlock_paths?.length > 0 && <UnlockPath plans={ev.unlock_paths} />}
        {ev.questions?.length > 0 && <Questions qs={ev.questions} />}
      </div>

      <Section title={t("matches")} sub={`${eligible.length} ${t("provenCount")} · ${pending.length} ${t("needAnswerCount")}`}>
        {ev.matches.length === 0 ? <Empty>No matches yet — answer a few more questions.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {ev.matches.map((m: any) => <SchemeCard key={m.scheme_id + m.who} m={m} />)}
          </div>
        )}
      </Section>

      {ev.exams?.length > 0 && <Exams exams={ev.exams} />}
      <p className="mt-6 flex items-center justify-center gap-1 text-center text-xs text-ink-500"><ShieldCheck className="h-3.5 w-3.5" /> {t("noFee")}</p>
    </div>
  );
}

function HaqMeter({ h, evaluating, solverMs }: { h: any; evaluating: boolean; solverMs: number }) {
  const { t, lang } = useApp();
  const parts = [
    { k: "perYear", v: h.yearly_inr, show: true, icon: <CalendarClock className="h-4 w-4" /> },
    { k: "oneTime", v: h.one_time_inr, show: h.one_time_inr > 0, icon: <Sparkles className="h-4 w-4" /> },
    { k: "unclaimed", v: h.unclaimed_inr, show: h.unclaimed_inr > 0, icon: <Wallet className="h-4 w-4" /> },
    { k: "cover", v: h.cover_inr, show: h.cover_inr > 0, icon: <ShieldCheck className="h-4 w-4" /> },
    { k: "credit", v: h.credit_inr, show: h.credit_inr > 0, icon: <Landmark className="h-4 w-4" /> },
  ] as const;
  return (
    <div className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-teal-800 p-6 text-white shadow-card fade-up">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-teal-100">{t("haqMeter")}</div>
          <div className="mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl"><CountUp value={h.total_inr} /></div>
          <div className="mt-1 text-teal-100">{t("haqSub")}</div>
        </div>
        {evaluating && <Spinner className="h-5 w-5 text-teal-100" />}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {parts.filter((p) => p.show).map((p) => (
          <div key={p.k} className="rounded-2xl bg-white/10 p-3">
            <div className="flex items-center gap-1 text-xs text-teal-100">{p.icon}{t(p.k)}</div>
            <div className="mt-0.5 text-lg font-bold">{inr(p.v, p.k === "cover" || p.k === "credit")}</div>
          </div>
        ))}
      </div>
      {h.choose_one?.length > 0 && (
        <p className="mt-3 text-xs text-teal-100">
          {lang === "hi" ? "कुछ योजनाओं में से एक ही चुनी जा सकती है — हमने केवल सबसे अच्छी गिनी है।" : "Some schemes can't be combined — we counted only the best of each group, so this number is real."}
        </p>
      )}
      <p className="mt-1 text-[11px] text-teal-200">{lang === "hi" ? `Z3 सॉल्वर ने ${Math.max(1, Math.round(solverMs))} ms में प्रमाणित किया · केवल “पात्र — प्रमाणित” योजनाएँ गिनी गईं` : `Proved by the Z3 solver in ${Math.max(1, Math.round(solverMs))} ms · counts only “eligible — proven” schemes`}</p>
    </div>
  );
}

function UnlockPath({ plans }: { plans: any[] }) {
  const { t, catalog, lang } = useApp();
  const docs = catalog?.documents || {};
  const names = (ids: string[]) => ids.map((id) => hi(catalog?.schemes.find((s: any) => s.id === id) || { name: id }, "name", lang));
  const p = plans[0];
  return (
    <div className="card mb-6 p-5 fade-up">
      <div className="mb-2 flex items-center gap-2 font-bold"><KeyRound className="h-5 w-5 text-amber-500" /> {t("unlock")}</div>
      <p className="text-sm text-ink-700">
        <b>{p.documents.map((d: string) => hi(docs[d] || { name: d }, "name", lang)).join(" + ")}</b> →{" "}
        {p.value_inr > 0 && <b className="text-teal-700">{inr(p.value_inr)} </b>}
        {t("unlockSub")}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink-700">{names(p.unlocks).map((n) => <li key={n}>• {n}</li>)}</ul>
      {p.documents.map((d: string) => docs[d] && (
        <p key={d} className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-ink-700">Where: {docs[d].where} {docs[d].days ? `· about ${docs[d].days} days` : ""}</p>
      ))}
      <p className="mt-2 text-[11px] text-ink-500">Chosen by z3.Optimize (weighted set cover over every scheme still waiting on a document).</p>
    </div>
  );
}

function Questions({ qs }: { qs: any[] }) {
  const { t, lang, patchProfile, profile } = useApp();
  const [num, setNum] = useState<Record<string, string>>({});
  const answer = (q: any, v: any) => {
    const idx = q.who === "self" ? null : (profile?.family || []).findIndex((m: any) => m.relation === q.who && !m.deceased);
    patchProfile({ [q.field]: v }, idx === -1 ? null : idx);
  };
  return (
    <div className="card mb-6 p-5 fade-up">
      <div className="mb-3 font-bold">{t("questions")}</div>
      <div className="space-y-3">
        {qs.map((q) => (
          <div key={q.field + q.who} className="rounded-xl bg-ink-50 p-3">
            <div className="text-sm font-medium">{lang === "hi" ? q.q_hi : q.q}{q.who !== "self" && <span className="text-ink-500"> ({q.who})</span>}</div>
            <div className="mt-2 flex gap-2">
              {q.type === "bool" ? (
                <>
                  <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => answer(q, true)}>{lang === "hi" ? "हाँ" : "Yes"}</button>
                  <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => answer(q, false)}>{lang === "hi" ? "नहीं" : "No"}</button>
                </>
              ) : (
                <>
                  <input className="input py-1.5" inputMode="numeric" value={num[q.field] || ""} onChange={(e) => setNum({ ...num, [q.field]: e.target.value })} />
                  <button className="btn-primary px-3 py-1.5 text-sm" disabled={!num[q.field]} onClick={() => answer(q, Number(num[q.field]))}>OK</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Exams({ exams }: { exams: any[] }) {
  const { t, catalog, lang } = useApp();
  return (
    <Section title={t("exams")} sub="Age limits with category relaxation, proved per person · next notice forecast from past notices">
      <div className="grid gap-3 md:grid-cols-3">
        {exams.map((e) => {
          const x = catalog?.exams.find((k: any) => k.id === e.id);
          return (
            <div key={e.id + e.who} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold"><GraduationCap className="h-4 w-4 text-teal-600" /> {hi(x || { name: e.id }, "name", lang)}</div>
                <span className={`chip ${statusColor[e.status]}`}>{e.status === "eligible" ? "eligible" : "not yet"}</span>
              </div>
              <div className="mt-1 text-xs text-ink-500">for {e.who_name}{e.relaxation_years ? ` · +${e.relaxation_years} yrs relaxation` : ""}</div>
              {e.status === "eligible" && e.years_left != null && <div className="mt-2 text-sm">{t("canApplyYears").replace("{n}", String(e.years_left))} (≤ {e.upper_age})</div>}
              {e.why && <div className="mt-2 text-sm text-ink-700">{e.why}</div>}
              {e.forecast && (
                <div className="mt-2 rounded-xl bg-ink-50 p-2 text-xs">
                  {t("nextNotice")} <b>{e.forecast.expected}</b> ({e.forecast.window})
                  <div className="text-ink-500">{e.forecast.history_hits}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Deadlines() {
  const { profile, lang, go, catalog } = useApp();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api.post<any>("/api/radar/alerts", { profile }).then((r) => setItems(r.deadlines || [])).catch(() => setItems([]));
  }, [profile]);
  if (!items.length) return null;
  const nameOf = (id: string) => hi(catalog?.schemes.find((s: any) => s.id === id) || catalog?.exams.find((e: any) => e.id === id) || { name: id }, "name", lang);
  return (
    <div className="card mb-6 border-coral-100 p-5 fade-up">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold"><BellRing className="h-5 w-5 text-coral-500" /> {lang === "hi" ? "आपके परिवार के लिए समय-सीमा" : "Deadlines for your family"}</div>
        <button className="text-sm text-teal-600" onClick={() => go("radar")}>{lang === "hi" ? "सभी अलर्ट" : "All alerts"} →</button>
      </div>
      {items.slice(0, 3).map((d, k) => (
        <a key={k} href={d.url} target="_blank" rel="noreferrer" className="mt-2 block rounded-xl bg-coral-50/60 p-3 text-sm hover:bg-coral-50">
          <div className="font-semibold">{d.specific.map(nameOf).join(", ")}</div>
          <div className="text-ink-700">{d.text.slice(0, 220)}</div>
          {d.dates_in_text?.length > 0 && <div className="mt-1 text-xs font-bold text-coral-600">{d.dates_in_text.join(" · ")}</div>}
          <div className="mt-1 text-[11px] text-ink-500">{d.source} · read from the official page by TinyFish Fetch</div>
        </a>
      ))}
    </div>
  );
}
