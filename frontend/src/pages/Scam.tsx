import { useState } from "react";
import { ExternalLink, Phone, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { api } from "../api";
import { ErrorNote, Section, Spinner } from "../components/ui";
import { useApp } from "../state";

const EXAMPLES = [
  "PM Viksit Bharat Rozgar Yojana 2026: ghar baithe ₹15,000/month. Registration fee ₹499 pay karo — apply at viksitbharatrozgaryojana.org. Last date today!",
  "आपका PM किसान का पैसा रुका है। KYC के लिए नीचे दिए लिंक पर OTP भेजें: bit.ly/pmkisan-kyc",
  "Dear student, NSP renewal for the Central Sector Scholarship is open on scholarships.gov.in. Last date 31 October 2026.",
  "Your SBI account will be blocked tonight. Update PAN now: sbi-kyc-update.online",
];

export default function Scam() {
  const { t, lang } = useApp();
  const [text, setText] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = async (s = text) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try { setRes(await api.post("/api/scam/check", { text: s, deep: true, lang })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const tone = res?.verdict === "likely_fake" ? "coral" : res?.verdict === "suspicious" ? "amber" : "teal";
  const cls = {
    coral: { border: "border-coral-400", icon: "text-coral-500", text: "text-coral-600", bar: "bg-coral-500" },
    amber: { border: "border-amber-400", icon: "text-amber-500", text: "text-amber-600", bar: "bg-amber-500" },
    teal: { border: "border-teal-400", icon: "text-teal-500", text: "text-teal-600", bar: "bg-teal-500" },
  }[tone];
  const Icon = res?.verdict === "likely_fake" ? ShieldAlert : res?.verdict === "suspicious" ? ShieldQuestion : ShieldCheck;

  return (
    <div>
      <Section title={t("scam")} sub={lang === "hi" ? "कोई संदेश, लिंक या 'योजना' चिपकाएँ — हम बताएँगे असली है या नकली" : "Paste a WhatsApp message, SMS, link or 'scheme' — JAAGRUK checks it with an ML model and live evidence from official sources."}>
        <div className="card p-5">
          <textarea className="input min-h-[110px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === "hi" ? "संदेश यहाँ चिपकाएँ…" : "Paste the message here…"} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!text.trim() || busy} onClick={() => check()}>{busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} {t("checkMsg")}</button>
          </div>
          <div className="mt-4">
            <div className="label mb-2">Try an example</div>
            <div className="grid gap-2 md:grid-cols-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => { setText(e); check(e); }} className="rounded-xl border border-ink-100 bg-ink-50 p-2.5 text-left text-xs text-ink-700 hover:border-teal-300">{e}</button>
              ))}
            </div>
          </div>
        </div>
      </Section>
      <ErrorNote error={err} />
      {busy && <div className="flex items-center gap-2 p-4 text-sm text-ink-500"><Spinner /> Checking the message and searching PIB Fact Check and official sites with TinyFish…</div>}
      {res && (
        <div className="grid gap-4 lg:grid-cols-3 fade-up">
          <div className={`card p-5 lg:col-span-1 ${cls.border}`}>
            <Icon className={`h-10 w-10 ${cls.icon}`} />
            <div className={`mt-2 text-2xl font-extrabold ${cls.text}`}>
              {res.verdict === "likely_fake" ? (lang === "hi" ? "संभवतः फर्जी" : "Likely fake") : res.verdict === "suspicious" ? (lang === "hi" ? "संदिग्ध" : "Suspicious") : (lang === "hi" ? "असली लगता है" : "Looks genuine")}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100"><div className={`h-full ${cls.bar}`} style={{ width: `${res.risk}%` }} /></div>
            <div className="mt-1 text-xs text-ink-500">risk {res.risk}/100 · text model {Math.round(res.text_model_probability * 100)}%</div>
            <ul className="mt-4 space-y-1.5 text-sm">{res.safe_steps.map((s: string) => <li key={s}>• {s}</li>)}</ul>
            <a href="tel:1930" className="btn-coral mt-4 w-full text-sm"><Phone className="h-4 w-4" /> Cyber helpline 1930</a>
          </div>
          <div className="card p-5 lg:col-span-2">
            <div className="label mb-2">Why</div>
            <ul className="space-y-1.5 text-sm">{res.reasons.map((r: string) => <li key={r} className="flex gap-2"><span className="text-coral-500">●</span>{r}</li>)}</ul>
            {res.domains?.length > 0 && (
              <>
                <div className="label mb-2 mt-4">Links in the message</div>
                <div className="flex flex-wrap gap-2">
                  {res.domains.map((d: any) => (
                    <span key={d.domain} className={`chip ${d.status === "official" ? "bg-teal-100 text-teal-700" : d.status === "unknown" ? "bg-ink-100 text-ink-700" : "bg-coral-100 text-coral-600"}`}>{d.domain} · {d.status.replace("_", " ")}</span>
                  ))}
                </div>
              </>
            )}
            <div className="label mb-2 mt-4">Live evidence (TinyFish Search)</div>
            {!res.evidence?.searched ? <p className="text-sm text-ink-500">No scheme name or unknown link to look up.</p>
              : res.evidence.items.length === 0 ? <p className="text-sm text-ink-500">Searched PIB Fact Check and official sites for “{res.evidence.scheme_name}” — {res.evidence.exists_officially ? "found on an official site" : "no official page found"}.</p>
              : (
                <div className="space-y-2">
                  {res.evidence.items.map((i: any) => (
                    <a key={i.url} href={i.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-xl border border-ink-100 p-3 text-sm hover:border-teal-300">
                      <span className={`chip shrink-0 ${i.kind === "official_page" ? "bg-teal-100 text-teal-700" : "bg-coral-100 text-coral-600"}`}>{i.kind.replace(/_/g, " ")}</span>
                      <span className="flex-1"><b>{i.title}</b><span className="block text-xs text-ink-500">{i.snippet?.slice(0, 180)}</span></span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-ink-300" />
                    </a>
                  ))}
                </div>
              )}
            <p className="mt-4 text-[11px] text-ink-500">Model: {res.model_metrics.model} · {res.model_metrics.cv} F1 {res.model_metrics.f1} on {res.model_metrics.examples} labelled Hindi/English/Hinglish messages.</p>
          </div>
        </div>
      )}
    </div>
  );
}
