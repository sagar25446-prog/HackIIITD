import { useState } from "react";
import { BadgeCheck, ExternalLink, FileText, Gavel, RefreshCw, ScrollText } from "lucide-react";
import { api, ago, inr } from "../api";
import { hi, useApp } from "../state";
import { AgentCard, SummaryBar, useJob } from "./AgentGrid";
import { ErrorNote, ModeBadge, Modal, ProofLine, Spinner, statusColor } from "./ui";

export default function SchemeCard({ m }: { m: any }) {
  const { lang, t, catalog, profile } = useApp();
  const rule = catalog?.schemes.find((s: any) => s.id === m.scheme_id);
  const [open, setOpen] = useState(false);
  if (!rule) return null;
  const d = m.decision;
  return (
    <>
      <button onClick={() => setOpen(true)} className="card w-full p-4 text-left transition hover:border-teal-300">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold leading-snug">{hi(rule, "name", lang)}</div>
            <div className="mt-0.5 text-sm text-ink-500">{rule.benefit.display}</div>
          </div>
          <span className={`chip shrink-0 ${statusColor[d.status]}`}>{d.status === "eligible" ? t("eligible") : t("needsInfo")}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
          {m.who !== "self" && <span className="chip bg-ink-100 text-ink-700">{lang === "hi" ? `${m.who_name} ${t("forWho")}` : `${t("forWho")} ${m.who_name}`}</span>}
          <span className="chip bg-ink-50 text-ink-500">{rule.level === "central" ? t("central") : t("delhi")}</span>
          {d.docs_missing?.length > 0 && <span className="chip bg-amber-50 text-amber-600">{t("needsDoc")}</span>}
          <span className="ml-auto text-teal-600">{t("why")} →</span>
        </div>
      </button>
      {open && <SchemeModal m={m} rule={rule} onClose={() => setOpen(false)} profile={profile} />}
    </>
  );
}

function SchemeModal({ m, rule, onClose, profile }: { m: any; rule: any; onClose: () => void; profile: any }) {
  const { lang, t, catalog } = useApp();
  const d = m.decision;
  const [check, setCheck] = useState<any>(catalog?.rule_checks?.[rule.id] || null);
  const [checking, setChecking] = useState(false);
  const [pack, setPack] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const docs = catalog?.documents || {};

  const recheck = async () => {
    setChecking(true);
    setErr(null);
    try { setCheck(await api.post(`/api/rules/${rule.id}/refresh`)); } catch (e: any) { setErr(e.message); } finally { setChecking(false); }
  };

  return (
    <Modal open onClose={onClose} title={hi(rule, "name", lang)} wide>
      <p className="text-ink-700">{rule.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="chip bg-teal-50 text-teal-700">{rule.benefit.display}</span>
        {m.who !== "self" && <span className="chip bg-ink-100 text-ink-700">for {m.who_name}</span>}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="label mb-2">Proof — checked by the Z3 solver</div>
          <ul className="rounded-xl bg-ink-50 p-3">
            {d.reasons.map((r: any, i: number) => <ProofLine key={i} state={r.state} label={r.label} value={r.value} />)}
          </ul>
          <p className="mt-2 text-xs text-ink-500">
            {d.status === "eligible" ? "Proven: these rules hold for every possible value of anything we don't know yet."
              : d.status === "needs_info" ? `Depends on: ${d.missing_facts.join(", ")}. Answer that and the solver decides.` : ""}
          </p>
          {d.advisories?.map((a: string) => <p key={a} className="mt-1 text-xs text-amber-600">{a}</p>)}
          {d.docs_missing?.length > 0 && (
            <div className="mt-4">
              <div className="label mb-2">Documents you still need</div>
              {d.docs_missing.map((id: string) => (
                <div key={id} className="mb-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm">
                  <b>{hi(docs[id] || { name: id }, "name", lang)}</b>
                  <div className="text-xs text-ink-700">{docs[id]?.where} {docs[id]?.days ? `· about ${docs[id].days} days` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="label mb-2">{t("source")}</div>
          <a href={rule.source_url} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-xl border border-ink-100 p-3 text-sm hover:border-teal-300">
            <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
            <span className="flex-1">{rule.source_title}<span className="block text-xs text-ink-500">verified {rule.verified_on}</span></span>
            <ExternalLink className="h-4 w-4 text-ink-300" />
          </a>
          <button className="btn-ghost mt-2 w-full text-sm" disabled={checking} onClick={recheck}>
            {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("verifyLive")} · TinyFish Fetch
          </button>
          {check && <RuleCheck check={check} />}
          <ErrorNote error={err} />

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary text-sm" onClick={async () => setPack(await api.post(`/api/application-pack/${rule.id}`, { profile, who: m.who }))}>
              <FileText className="h-4 w-4" /> {t("apply")}
            </button>
            {rule.myscheme_checker && (
              <button className="btn-ghost text-sm" disabled={!!jobId} onClick={async () => {
                const r = await api.post<any>(`/api/checker/${rule.id}`, { profile, who: m.who });
                setJobId(r.job_id);
              }}>
                <Gavel className="h-4 w-4" /> Ask the official checker (beta)
              </button>
            )}
          </div>
          {rule.myscheme_checker && !jobId && <p className="mt-1 text-xs text-ink-500">Beta: a TinyFish agent answers the government's own myScheme checker with your facts (1–3 min, a few cents). On 19 Oct the checker itself returned "Something went wrong" after the last question — JAAGRUK reports that honestly instead of guessing.</p>}
        </div>
      </div>

      {jobId && (
        <div className="mt-5">
          <div className="label mb-2">Second opinion — myScheme official checker</div>
          <SummaryBar summary={null} running={job.running} />
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {job.tasks.map((t) => <AgentCard key={t.task_id} t={t} />)}
            {job.summary && (
              <div className={`card p-4 ${job.summary.agree ? "border-teal-400" : job.summary.agree === false ? "border-coral-400" : ""}`}>
                <div className="font-semibold">{job.summary.agree === true ? "✓ The official checker agrees" : job.summary.agree === false ? "⚠ The official checker disagrees — flagged for review" : "Official checker gave no clear verdict"}</div>
                <p className="mt-1 text-sm text-ink-500">JAAGRUK: {job.summary.ours} · Official: {job.summary.official ?? "—"}</p>
                {job.summary.official_text && <p className="mt-1 text-xs italic text-ink-500">“{job.summary.official_text}”</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {pack && (
        <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold"><BadgeCheck className="h-5 w-5 text-teal-600" /> Application pack · {pack.fee}</div>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">{pack.steps.map((s: string) => <li key={s}>{s}</li>)}</ol>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><div className="label mb-1">Pre-filled details</div>{Object.entries(pack.prefill).map(([k, v]) => <div key={k}><span className="text-ink-500">{k.replace(/_/g, " ")}:</span> {String(v)}</div>)}</div>
            <div>
              <div className="label mb-1">Documents</div>
              {pack.documents_ready.map((x: any) => <div key={x.id}>✓ {x.name}</div>)}
              {pack.documents_missing.map((x: any) => <div key={x.id} className="text-amber-600">○ {x.name}</div>)}
            </div>
          </div>
          <a href={pack.apply_url} target="_blank" rel="noreferrer" className="btn-primary mt-3 text-sm"><ExternalLink className="h-4 w-4" /> Open official site</a>
        </div>
      )}
    </Modal>
  );
}

function RuleCheck({ check }: { check: any }) {
  if (check.ok === false) return <div className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">Could not re-read the source right now: {check.error}</div>;
  const ok = check.status === "verified";
  return (
    <div className={`mt-2 rounded-xl p-3 text-xs ${ok ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
      <div className="flex items-center justify-between gap-2">
        <b>{ok ? "Matches the live official page" : check.status === "needs_review" ? "The live page differs — flagged for review" : "Page read; not enough rule text to compare"}</b>
        {check.replay !== undefined && <ModeBadge replay={check.replay} />}
      </div>
      {check.checked_at && <div className="opacity-70">checked {ago(check.checked_at)}{check.method ? ` · rules extracted by ${check.method === "claude" ? "Claude" : "pattern extractor"}` : ""}{check.chars_read ? ` · ${check.chars_read.toLocaleString()} characters read by TinyFish Fetch` : ""}</div>}
      {check.drift?.equivalent_fields?.length > 0 && <div className="mt-1">Z3-proven identical: {check.drift.equivalent_fields.join(", ")}</div>}
      {check.drift?.differences?.map((x: any) => <div key={x.field} className="mt-1">≠ {x.field}: {x.example}</div>)}
      {check.drift?.new_in_notice?.length > 0 && <div className="mt-1">New on page: {check.drift.new_in_notice.join("; ")}</div>}
    </div>
  );
}

export function money(rule: any) {
  const b = rule?.benefit || {};
  return b.annual_value ? `${inr(b.annual_value)}/yr` : b.one_time_value ? inr(b.one_time_value) : b.cover_value ? `${inr(b.cover_value, true)} cover` : "";
}
