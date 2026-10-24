import { useEffect, useState } from "react";
import { Lock, Search, Workflow } from "lucide-react";
import { api, inr } from "../api";
import AssistedSession from "../components/AssistedSession";
import { AgentCard, SummaryBar, TaskState, useJob } from "../components/AgentGrid";
import { ErrorNote, Section } from "../components/ui";
import { useApp } from "../state";

export default function Wapsi() {
  const { profile, t, lang, setWapsiFound } = useApp();
  const late = (profile?.family || []).find((m: any) => m.deceased);
  const [person, setPerson] = useState({ name: late?.name || profile?.name || "", dob: late?.dob || "", pan: "", policy_no: "", deceased: !!late });
  const [consent, setConsent] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [assist, setAssist] = useState<TaskState | null>(null);
  const job = useJob(jobId);

  useEffect(() => {
    if (job.summary?.found_inr !== undefined) setWapsiFound(job.summary.found_inr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.summary]);

  const start = async () => {
    setErr(null);
    try {
      const r = await api.post<any>("/api/wapsi/start", { profile, person, consent });
      setJobId(r.job_id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div>
      <Section title={lang === "hi" ? "वापसी — लावारिस पैसा खोजें" : "Wapsi — find unclaimed money"}
        sub={<>
          {lang === "hi" ? "भारत में लगभग ₹1 लाख करोड़ लावारिस पड़ा है — बैंक जमा ₹78,000 करोड़, बीमा ₹14,000 करोड़, डिविडेंड ₹9,000 करोड़, म्यूचुअल फंड ₹3,000 करोड़। JAAGRUK सरकारी पोर्टलों पर एक साथ खोजता है।"
            : "About ₹1 lakh crore sits unclaimed in India — ₹78,000 cr in bank deposits, ₹14,000 cr insurance, ₹9,000 cr dividends, ₹3,000 cr mutual funds. JAAGRUK searches the official portals in parallel, each with a live agent you can watch."}{" "}
          <a className="text-teal-600 underline" href="https://www.pib.gov.in/PressReleasePage.aspx?PRID=2208730" target="_blank" rel="noreferrer">PIB, Dec 2025</a>
        </>}>
        <div className="card p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">{t("nameRecords")}</span>
              <input className="input mt-1" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></label>
            <label className="block"><span className="label">{t("dob")}</span>
              <input className="input mt-1" value={person.dob} placeholder="12/03/1971" onChange={(e) => setPerson({ ...person, dob: e.target.value })} /></label>
            <label className="block"><span className="label">{t("panOpt")}</span>
              <input className="input mt-1" value={person.pan} maxLength={10} onChange={(e) => setPerson({ ...person, pan: e.target.value.toUpperCase() })} /></label>
            <label className="block"><span className="label">{t("policyOpt")}</span>
              <input className="input mt-1" value={person.policy_no} onChange={(e) => setPerson({ ...person, policy_no: e.target.value })} /></label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={person.deceased} onChange={(e) => setPerson({ ...person, deceased: e.target.checked })} /> {t("deceasedCheck")}
          </label>
          <label className="mt-3 flex items-start gap-2 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {t("consent")}
          </label>
          <ErrorNote error={err} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={!consent || !person.name || job.running} onClick={start}><Search className="h-4 w-4" /> {t("searchPortals")}</button>
            <span className="flex items-center gap-1 text-xs text-ink-500"><Lock className="h-3.5 w-3.5" /> {t("noOtpNote")}</span>
          </div>
        </div>
      </Section>

      {jobId && (
        <Section title={<span className="flex items-center gap-2"><Workflow className="h-5 w-5 text-teal-600" /> {t("liveGrid")}</span>}
          sub="Planner → TinyFish agents in parallel → verifier (COMPLETED ≠ success) → self-heal → name matcher"
          right={<SummaryBar summary={job.summary} running={job.running} />}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {job.tasks.map((tk) => <AgentCard key={tk.task_id} t={tk} onAssist={setAssist} />)}
          </div>
          {job.summary && (
            <div className="card mt-4 p-4 text-sm">
              {job.summary.found > 0
                ? <><b className="text-teal-700">{inr(job.summary.found_inr)}</b> found and added to your Haq Meter. Each result shows how to claim it — always free.</>
                : <>No unclaimed money was listed on the portals that could be searched automatically. {job.summary.needs_human > 0 && <>Open the {job.summary.needs_human} assisted session(s) above to check the portals that need your own OTP.</>}</>}
            </div>
          )}
        </Section>
      )}
      {assist && (
        <AssistedSession open title={`${assist.name} — assisted session`} sourceId={assist.source_id} onClose={() => setAssist(null)}
          prefill={{ Name: person.name, "Date of Birth": person.dob }} />
      )}
    </div>
  );
}
