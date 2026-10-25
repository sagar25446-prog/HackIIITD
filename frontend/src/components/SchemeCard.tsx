import { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  FileText,
  Gavel,
  RefreshCw,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { api, ago, inr } from "../api";
import { hi, useApp } from "../state";
import { AgentCard, SummaryBar, useJob } from "./AgentGrid";
import { ErrorNote, ModeBadge, Modal, ProofLine, Spinner, statusColor } from "./ui";
import { usePrepare } from "../pages/Home";

export default function SchemeCard({ m }: { m: any }) {
  const { lang, t, catalog, profile } = useApp();
  const rule = catalog?.schemes.find((s: any) => s.id === m.scheme_id);
  const [open, setOpen] = useState(false);
  if (!rule) return null;
  const d = m.decision;
  const isHi = lang === "hi";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="card card-hover flex h-full w-full flex-col p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold leading-snug">{hi(rule, "name", lang)}</div>
            <div className="mt-0.5 text-sm font-semibold text-teal-700">
              {money(rule, lang) || rule.benefit.display}
            </div>
          </div>
          <span className={`chip shrink-0 ${statusColor[d.status]}`}>
            {d.status === "eligible" ? t("eligible") : t("needsInfo")}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-ink-500">{rule.benefit.display}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-xs">
          {m.who !== "self" && (
            <span className="chip bg-ink-100 text-ink-700">
              {isHi ? `${m.who_name} ${t("forWho")}` : `${t("forWho")} ${m.who_name}`}
            </span>
          )}
          <span className="chip bg-ink-50 text-ink-600">
            {rule.level === "central" ? t("central") : t("delhi")}
          </span>
          {d.docs_missing?.length > 0 && (
            <span className="chip bg-amber-50 text-amber-800">{t("needsDoc")}</span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 font-semibold text-teal-700">
            {t("why")} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </button>
      {open && <SchemeModal m={m} rule={rule} onClose={() => setOpen(false)} profile={profile} />}
    </>
  );
}

function SchemeModal({
  m,
  rule,
  onClose,
  profile,
}: {
  m: any;
  rule: any;
  onClose: () => void;
  profile: any;
}) {
  const { lang, t, catalog } = useApp();
  const isHi = lang === "hi";
  const d = m.decision;
  const prepare = usePrepare();
  const workflow = Object.values<string>(catalog?.workflow_schemes || {}).includes(rule.id);
  const [check, setCheck] = useState<any>(catalog?.rule_checks?.[rule.id] || null);
  const [checking, setChecking] = useState(false);
  const [pack, setPack] = useState<any>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const docs = catalog?.documents || {};

  const recheck = async () => {
    setChecking(true);
    setErr(null);
    try {
      setCheck(await api.post(`/api/rules/${rule.id}/refresh`));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  };
  const loadPack = async () => {
    setPackBusy(true);
    setErr(null);
    try {
      setPack(await api.post(`/api/application-pack/${rule.id}`, { profile, who: m.who }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPackBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={hi(rule, "name", lang)} wide>
      <p className="text-ink-700">{rule.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="chip bg-teal-50 text-teal-800">{rule.benefit.display}</span>
        <span className={`chip ${statusColor[d.status]}`}>
          {d.status === "eligible" ? t("eligible") : t("needsInfo")}
        </span>
        {m.who !== "self" && (
          <span className="chip bg-ink-100 text-ink-700">
            {isHi ? `${m.who_name} के लिए` : `for ${m.who_name}`}
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="label mb-2 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-teal-700" />
            {isHi ? "प्रमाण — Z3 सॉल्वर से जाँचा गया" : "Proof — checked by the Z3 solver"}
          </div>
          <ul className="rounded-xl bg-ink-50 p-3">
            {d.reasons.map((r: any, i: number) => (
              <ProofLine key={i} state={r.state} label={r.label} value={r.value} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-500">
            {d.status === "eligible"
              ? isHi
                ? "समीक्षित शर्तें पूरी: जो जानकारी अभी अज्ञात है, उसके हर संभव मान पर भी ये शर्तें पूरी रहती हैं। अंतिम निर्णय विभाग का है।"
                : "Matches the reviewed conditions for every possible value of anything not yet known. The department makes the final decision."
              : d.status === "needs_info"
                ? `${isHi ? "निर्भर करता है" : "Depends on"}: ${d.missing_facts.join(", ")}. ${isHi ? "इसका जवाब दें, सॉल्वर तय करेगा।" : "Answer that and the solver decides."}`
                : ""}
          </p>
          {d.advisories?.map((a: string) => (
            <p key={a} className="mt-1 text-xs text-amber-700">
              {a}
            </p>
          ))}
          {d.docs_missing?.length > 0 && (
            <div className="mt-4">
              <div className="label mb-2">
                {isHi ? "अभी चाहिए दस्तावेज़" : "Documents you still need"}
              </div>
              {d.docs_missing.map((id: string) => (
                <div
                  key={id}
                  className="mb-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm"
                >
                  <b>{hi(docs[id] || { name: id }, "name", lang)}</b>
                  <div className="text-xs text-ink-700">
                    {docs[id]?.where} {docs[id]?.days ? `· about ${docs[id].days} days` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="label mb-2">{t("source")}</div>
          <a
            href={rule.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 rounded-xl border border-ink-100 p-3 text-sm hover:border-teal-300"
          >
            <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
            <span className="flex-1">
              {rule.source_title}
              <span className="block text-xs text-ink-500">
                {isHi ? "जाँचा गया" : "verified"} {rule.verified_on}
              </span>
            </span>
            <ExternalLink className="h-4 w-4 text-ink-300" />
          </a>
          <button className="btn-ghost mt-2 w-full" disabled={checking} onClick={recheck}>
            {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("verifyLive")} ·
            TinyFish Fetch
          </button>
          {check && <RuleCheck check={check} />}
          <div className="mt-2">
            <ErrorNote error={err} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={packBusy} onClick={loadPack}>
              {packBusy ? <Spinner /> : <FileText className="h-4 w-4" />} {t("apply")}
            </button>
            {workflow && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  onClose();
                  await prepare(rule.id, m.who, hi(rule, "name", lang));
                }}
              >
                {isHi ? "इस आवेदन की तैयारी करें" : "Prepare this application"}
              </button>
            )}
            {rule.myscheme_checker && (
              <button
                className="btn-ghost"
                disabled={!!jobId}
                onClick={async () => {
                  try {
                    const r = await api.post<any>(`/api/checker/${rule.id}`, {
                      profile,
                      who: m.who,
                    });
                    setJobId(r.job_id);
                  } catch (e: any) {
                    setErr(e.message);
                  }
                }}
              >
                <Gavel className="h-4 w-4" />{" "}
                {isHi ? "आधिकारिक जाँचकर्ता से पूछें" : "Ask the official checker"}
              </button>
            )}
          </div>
          {rule.myscheme_checker && !jobId && (
            <p className="mt-1 text-xs text-ink-500">
              {isHi
                ? "TinyFish एजेंट सरकार के myScheme जाँचकर्ता को आपकी जानकारी से भरता है (1–3 मिनट)। वह जवाब न दे तो JAAGRUK अनुमान नहीं लगाता।"
                : "A TinyFish agent answers the government's own myScheme checker with your facts (1–3 min, a few cents). If the checker gives no verdict, JAAGRUK says so instead of guessing."}
            </p>
          )}
        </div>
      </div>

      {jobId && (
        <div className="mt-5">
          <div className="label mb-2">
            {isHi
              ? "दूसरी राय — myScheme आधिकारिक जाँचकर्ता"
              : "Second opinion — myScheme official checker"}
          </div>
          <SummaryBar summary={null} running={job.running} />
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {job.tasks.map((t) => (
              <AgentCard key={t.task_id} t={t} />
            ))}
            {job.summary && (
              <div
                className={`card p-4 ${job.summary.agree ? "border-teal-400" : job.summary.agree === false ? "border-coral-400" : ""}`}
              >
                <div className="font-semibold">
                  {job.summary.agree === true
                    ? isHi
                      ? "✓ आधिकारिक जाँचकर्ता सहमत है"
                      : "✓ The official checker agrees"
                    : job.summary.agree === false
                      ? isHi
                        ? "⚠ आधिकारिक जाँचकर्ता असहमत है — समीक्षा के लिए चिह्नित"
                        : "⚠ The official checker disagrees — flagged for review"
                      : isHi
                        ? "आधिकारिक जाँचकर्ता ने स्पष्ट जवाब नहीं दिया"
                        : "Official checker gave no clear verdict"}
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  JAAGRUK: {job.summary.ours} · {isHi ? "आधिकारिक" : "Official"}:{" "}
                  {job.summary.official ?? "—"}
                </p>
                {job.summary.official_text && (
                  <p className="mt-1 text-xs italic text-ink-500">“{job.summary.official_text}”</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {pack && (
        <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50/60 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 font-semibold">
            <BadgeCheck className="h-5 w-5 text-teal-700" />
            {isHi ? "आवेदन पैक" : "Application pack"} ·{" "}
            <span className="font-normal text-ink-600">{pack.fee}</span>
          </div>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
            {pack.steps.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="label mb-1">
                {isHi ? "पहले से भरी जानकारी" : "Pre-filled details"}
              </div>
              {Object.entries(pack.prefill).map(([k, v]) => (
                <div key={k}>
                  <span className="text-ink-500">{k.replace(/_/g, " ")}:</span> {String(v)}
                </div>
              ))}
            </div>
            <div>
              <div className="label mb-1">{isHi ? "दस्तावेज़" : "Documents"}</div>
              {pack.documents_ready.map((x: any) => (
                <div key={x.id}>✓ {x.name}</div>
              ))}
              {pack.documents_missing.map((x: any) => (
                <div key={x.id} className="text-amber-700">
                  ○ {x.name}
                </div>
              ))}
            </div>
          </div>
          <a href={pack.apply_url} target="_blank" rel="noreferrer" className="btn-primary mt-3">
            <ExternalLink className="h-4 w-4" />{" "}
            {isHi ? "आधिकारिक साइट खोलें" : "Open official site"}
          </a>
        </div>
      )}
    </Modal>
  );
}

function RuleCheck({ check }: { check: any }) {
  const { lang } = useApp();
  const isHi = lang === "hi";
  if (check.ok === false)
    return (
      <div className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
        {isHi ? "स्रोत अभी दोबारा नहीं पढ़ा जा सका" : "Could not re-read the source right now"}:{" "}
        {check.error}
      </div>
    );
  const ok = check.status === "verified";
  return (
    <div
      className={`mt-2 rounded-xl p-3 text-xs ${ok ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-800"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <b>
          {ok
            ? isHi
              ? "आधिकारिक पेज से मेल खाता है"
              : "Matches the live official page"
            : check.status === "needs_review"
              ? isHi
                ? "आधिकारिक पेज अलग है — समीक्षा के लिए चिह्नित"
                : "The live page differs — flagged for review"
              : isHi
                ? "पेज पढ़ा; तुलना के लिए नियम का पाठ पर्याप्त नहीं"
                : "Page read; not enough rule text to compare"}
        </b>
        {check.replay !== undefined && <ModeBadge replay={check.replay} />}
      </div>
      {check.checked_at && (
        <div className="opacity-80">
          checked {ago(check.checked_at)}
          {check.method
            ? ` · rules extracted by ${check.method === "claude" ? "Claude" : "pattern extractor"}`
            : ""}
          {check.chars_read
            ? ` · ${check.chars_read.toLocaleString()} characters read by TinyFish Fetch`
            : ""}
        </div>
      )}
      {check.drift?.equivalent_fields?.length > 0 && (
        <div className="mt-1">Z3-proven identical: {check.drift.equivalent_fields.join(", ")}</div>
      )}
      {check.drift?.differences?.map((x: any) => (
        <div key={x.field} className="mt-1">
          ≠ {x.field}: {x.example}
        </div>
      ))}
      {check.drift?.new_in_notice?.length > 0 && (
        <div className="mt-1">New on page: {check.drift.new_in_notice.join("; ")}</div>
      )}
    </div>
  );
}

export function money(rule: any, lang = "en") {
  const b = rule?.benefit || {};
  const hindi = lang === "hi";
  const lakh = (v: number) => (hindi ? inr(v, true).replace("lakh", "लाख") : inr(v, true));
  return b.annual_value
    ? `${inr(b.annual_value)}${hindi ? " प्रति वर्ष" : "/yr"}`
    : b.one_time_value
      ? `${inr(b.one_time_value)}${hindi ? " एकमुश्त" : ""}`
      : b.cover_value
        ? `${lakh(b.cover_value)} ${hindi ? "बीमा कवर" : "cover"}`
        : b.loan_value
          ? `${lakh(b.loan_value)} ${hindi ? "तक ऋण" : "loan"}`
          : "";
}
