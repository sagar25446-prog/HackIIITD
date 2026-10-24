import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, HandHelping, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { inr, stream } from "../api";
import { ModeBadge, Modal, Spinner, statusColor } from "./ui";

export type TaskState = {
  task_id: string;
  source_id: string;
  name: string;
  domain?: string;
  phase: string;
  log: string[];
  streaming_url?: string;
  replay?: boolean;
  verdict?: string;
  reason?: string;
  result?: any;
  found?: boolean;
  amount_inr?: number;
  name_match?: any;
  claim_kit?: any;
  attempt?: number;
  message?: string;
  frame?: string;
  engine?: string;
  needs_human?: boolean;
};

const PHASE_LABEL: Record<string, string> = {
  queued: "Queued", started: "Started", streaming: "Browsing", progress: "Working", verifying: "Verifying result",
  healing: "Self-healing", done: "Done", failed: "Failed", needs_human: "Needs you",
};

export function useJob(jobId: string | null) {
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    setTasks({});
    setOrder([]);
    setSummary(null);
    setRunning(true);
    return stream(
      `/api/jobs/${jobId}/events`,
      (ev) => {
        if (ev.phase === "plan") {
          setMeta(ev);
          const init: Record<string, TaskState> = {};
          for (const t of ev.tasks) init[t.task_id] = { ...t, phase: t.needs_human ? "needs_human" : "queued", log: [] };
          setTasks(init);
          setOrder(ev.tasks.map((t: any) => t.task_id));
          return;
        }
        if (ev.phase === "all_done") return setSummary(ev.summary);
        if (ev.phase === "error") return setSummary({ error: ev.message });
        if (!ev.task_id) return;
        setTasks((cur) => {
          const prev = cur[ev.task_id] || { task_id: ev.task_id, source_id: ev.source_id, name: ev.name, phase: "queued", log: [] };
          const line = ev.phase === "needs_human" || ev.phase === "failed" ? null
            : ev.message || (ev.phase === "started" && ev.attempt > 1 ? `Attempt ${ev.attempt}` : null);
          return {
            ...cur,
            [ev.task_id]: {
              ...prev, ...ev,
              streaming_url: ev.streaming_url || prev.streaming_url,
              frame: ev.frame || prev.frame,
              engine: ev.engine || prev.engine || (ev.phase === "started" ? "agent" : undefined),
              replay: prev.replay || ev.replay,
              log: line ? [...prev.log, line].slice(-6) : prev.log,
            },
          };
        });
        setOrder((o) => (o.includes(ev.task_id) ? o : [...o, ev.task_id]));
      },
      () => setRunning(false)
    );
  }, [jobId]);

  return { tasks: order.map((id) => tasks[id]).filter(Boolean), summary, meta, running };
}

export function AgentCard({ t, onAssist }: { t: TaskState; onAssist?: (t: TaskState) => void }) {
  const [watch, setWatch] = useState(false);
  const busy = ["queued", "started", "streaming", "progress", "verifying", "healing"].includes(t.phase);
  const icon = t.phase === "done" ? (t.found ? <CheckCircle2 className="h-5 w-5 text-teal-500" /> : <CheckCircle2 className="h-5 w-5 text-ink-300" />)
    : t.phase === "failed" ? <XCircle className="h-5 w-5 text-coral-500" />
    : t.phase === "needs_human" ? <HandHelping className="h-5 w-5 text-amber-500" />
    : t.phase === "healing" ? <RefreshCw className="h-5 w-5 animate-spin text-amber-500" /> : <Spinner className="h-5 w-5 text-teal-500" />;
  return (
    <div className={`card flex flex-col p-4 ${t.found ? "border-teal-400 ring-2 ring-teal-100" : ""}`}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{t.name}</div>
          <div className="truncate text-xs text-ink-500">{t.domain}</div>
        </div>
        {t.replay !== undefined && t.phase !== "needs_human" && <ModeBadge replay={t.replay} />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`chip ${busy ? "bg-teal-50 text-teal-700" : statusColor[t.verdict || t.phase] || "bg-ink-100 text-ink-700"}`}>
          {PHASE_LABEL[t.phase] || t.phase}{t.verdict && t.phase === "done" ? ` · ${t.verdict}` : ""}
        </span>
        {t.attempt && t.attempt > 1 && <span className="chip bg-amber-50 text-amber-600">attempt {t.attempt}</span>}
        {t.engine && t.phase !== "needs_human" && (
          <span className="chip bg-ink-50 text-ink-500" title={t.engine === "playbook" ? "Compiled script on a TinyFish Browser session (Indian IP)" : "Natural-language TinyFish Agent (run-sse)"}>
            {t.engine === "playbook" ? "Playbook · TinyFish Browser" : "TinyFish Agent"}
          </span>
        )}
      </div>
      {t.frame && <img src={t.frame} alt="Portal screenshot" className="mt-3 max-h-36 w-full cursor-pointer rounded-lg border border-ink-100 object-cover object-top" onClick={() => setWatch(true)} />}
      {t.log.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
          {t.log.slice(-3).map((l, i) => <li key={i} className="truncate">› {l}</li>)}
        </ul>
      )}
      {t.phase === "done" && t.result && (
        <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm">
          {t.found ? (
            <div className="font-semibold text-teal-700">Found {t.amount_inr ? inr(t.amount_inr) : "a record"}</div>
          ) : (
            <div className="text-ink-700">{t.result.message || "Nothing listed for this name."}</div>
          )}
          {t.name_match && (
            <div className="mt-1 text-xs text-ink-500">
              Name on record: <b>{t.result.holder_name}</b> · match {Math.round(t.name_match.probability * 100)}% ({t.name_match.band})
            </div>
          )}
          {t.verdict === "suspicious" && <div className="mt-1 flex items-center gap-1 text-xs text-amber-600"><ShieldAlert className="h-3.5 w-3.5" /> {t.reason}</div>}
        </div>
      )}
      {t.claim_kit && (
        <div className="mt-2 rounded-xl border border-teal-100 bg-teal-50 p-3 text-xs text-teal-800">
          <b>How to claim:</b> {t.claim_kit.how} <br /><b>Fee:</b> {t.claim_kit.fee}
        </div>
      )}
      {(t.phase === "failed" || t.phase === "needs_human") && t.message && <p className="mt-2 text-xs text-ink-500">{t.message}</p>}
      <div className="mt-auto flex gap-2 pt-3">
        {(t.streaming_url || t.frame) && (
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setWatch(true)}><Eye className="h-4 w-4" /> {t.streaming_url ? "Watch" : "Evidence"}</button>
        )}
        {t.phase === "needs_human" && onAssist && (
          <button className="btn-amber px-3 py-1.5 text-sm" onClick={() => onAssist(t)}><HandHelping className="h-4 w-4" /> Open assisted session</button>
        )}
      </div>
      <Modal open={watch} onClose={() => setWatch(false)} title={`${t.name} — live browser`} wide>
        {!t.streaming_url && t.frame ? (
          <img src={t.frame} alt="Screenshot of the official portal" className="w-full rounded-xl border border-ink-100" />
        ) : t.replay ? (
          <p className="text-sm text-ink-500">This is a replay of a recorded real run; the live browser view is only available while an agent is running.</p>
        ) : (
          <>
            <iframe title="live" src={t.streaming_url} className="h-[60vh] w-full rounded-xl border border-ink-100" />
            <a className="mt-2 inline-block text-sm text-teal-600 underline" href={t.streaming_url} target="_blank" rel="noreferrer">Open in a new tab</a>
          </>
        )}
      </Modal>
    </div>
  );
}

export function SummaryBar({ summary, running }: { summary: any; running: boolean }) {
  const items = useMemo(() => summary ? [
    ["verified", summary.verified], ["needs you", summary.needs_human], ["failed", summary.failed], ["found", summary.found],
  ] : [], [summary]);
  if (summary?.error) return <div className="rounded-xl bg-coral-50 p-3 text-sm text-coral-600">{summary.error}</div>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {running && <span className="flex items-center gap-2 text-teal-700"><Spinner /> Agents running in parallel…</span>}
      {items.filter(([, v]) => v !== undefined).map(([k, v]) => (
        <span key={k as string} className="chip bg-ink-100 text-ink-700">{v} {k}</span>
      ))}
      {summary?.found_inr > 0 && <span className="chip bg-teal-500 text-white">{inr(summary.found_inr)} found</span>}
    </div>
  );
}
