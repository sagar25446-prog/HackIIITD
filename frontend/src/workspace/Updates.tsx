import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import { useWorkspace } from "./WorkspaceProvider";
import { DiffTable, diffConfig } from "./diff";

const WORKFLOW: Record<string, [string, string]> = {
  bereavement: ["Widow pension", "विधवा पेंशन"],
  retirement: ["Old-age pension", "वृद्धावस्था पेंशन"],
  education: ["CSSS scholarship", "CSSS छात्रवृत्ति"],
  moving: ["Ration card (ONORC)", "राशन कार्ड (ONORC)"],
};

export default function Updates() {
  const { lang } = useApp();
  const hi = lang === "hi";
  const { workspace, openCase, refresh } = useWorkspace();
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<any>(null);
  const load = () =>
    api
      .post<any>("/api/workspace/changes/impacts", workspace)
      .then((r) => setData(r.impacts))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [workspace]);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">
          {hi ? "बदलाव का आपके परिवार पर असर" : "What changed for your family"}
        </h2>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<any>("/api/workspace/changes/scan");
              setScan(r);
              if (!r.ok) setError(r.error);
              await load();
              refresh();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? hi
              ? "जाँच रहे हैं…"
              : "Checking…"
            : hi
              ? "आधिकारिक स्रोत जाँचें"
              : "Check official sources"}
        </button>
      </div>
      <p className="text-sm text-ink-600">
        {hi
          ? "हम पेंशन, छात्रवृत्ति, सेवानिवृत्ति और राशन कार्ड के आधिकारिक स्रोत दोबारा पढ़ते हैं। स्रोत में बदलाव मिलना नियम बदलने का प्रमाण नहीं है — सक्रिय योजना टीम की समीक्षा के बाद ही बदलती है।"
          : "We re-read the official sources behind the pension, scholarship, retirement and ration-card plans. A changed source is not an activated rule change — your active plan changes only after team review."}
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm">
          {error}
        </p>
      )}
      {scan?.pages?.length > 0 && (
        <div className="card divide-y divide-ink-100">
          {scan.pages.map((p: any) => (
            <div className="flex flex-wrap items-center gap-2 p-3 text-sm" key={p.workflow}>
              <b className="min-w-[110px] capitalize">
                {WORKFLOW[p.workflow]?.[hi ? 1 : 0] || p.workflow}
              </b>
              <span
                className={`chip ${p.error ? "bg-amber-100 text-amber-800" : p.changed ? "bg-coral-100 text-coral-700" : "bg-teal-100 text-teal-800"}`}
              >
                {p.error
                  ? hi
                    ? "स्रोत अभी नहीं पढ़ा जा सका"
                    : "source not readable right now"
                  : p.changed
                    ? hi
                      ? "बदला — समीक्षा लंबित"
                      : "changed — review pending"
                    : hi
                      ? "कोई बदलाव नहीं"
                      : "no change"}
              </span>
              <span className="text-xs text-ink-500">
                {p.error
                  ? hi
                    ? "पिछला सत्यापित प्रमाण लागू रहता है"
                    : "the last verified evidence stays in use"
                  : p.mode}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.length === 0 && (
        <div className="card p-5">
          {hi
            ? "आपके सहेजे मामलों को प्रभावित करने वाला समीक्षित बदलाव अभी नहीं है।"
            : "No reviewed change currently affects your saved cases."}
        </div>
      )}
      {data.map((d) => (
        <div className="card space-y-3 p-4" key={d.change_id + d.case_id}>
          <span className="chip bg-amber-50">
            {d.status === "pending"
              ? hi
                ? "समीक्षा लंबित"
                : "Review pending"
              : hi
                ? "समीक्षित बदलाव"
                : "Reviewed change"}
          </span>
          <button
            className="block text-left font-bold text-teal-800 underline"
            onClick={() => openCase(d.case_id)}
          >
            {workspace.cases.find((c) => c.id === d.case_id)?.title} ·{" "}
            {workspace.people.find((p) => p.id === d.person_id)?.name}
          </button>
          <p>{hi ? d.summary_hi : d.summary}</p>
          {d.before && (
            <details>
              <summary>{hi ? "पहले और बाद का विवरण" : "Before and after"}</summary>
              <DiffTable
                rows={diffConfig(d.before, d.after)}
                hi={hi}
                left={hi ? "पहले" : "Before"}
                right={hi ? "बाद में" : "After"}
              />
              <p className="text-sm">{d.excerpt}</p>
            </details>
          )}
          <a
            className="text-sm text-teal-700 underline"
            href={d.source_url}
            target="_blank"
            rel="noreferrer"
          >
            {hi ? "आधिकारिक स्रोत" : "Official source"}
          </a>
          <p className="text-xs text-ink-500">
            {d.mode} · {d.checked_at}
          </p>
        </div>
      ))}
    </section>
  );
}
export function ReviewPanel() {
  const { refresh } = useWorkspace();
  const [rows, setRows] = useState<any[]>([]);
  const [key, setKey] = useState("");
  const [id, setId] = useState("");
  const [patch, setPatch] = useState("{}");
  const [excerpt, setExcerpt] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const load = () =>
    api
      .get<any>("/api/workspace/changes")
      .then((r) => setRows(r.changes.filter((c: any) => c.status === "pending")))
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card mt-6 space-y-3 p-5">
      <h2 className="text-xl font-bold">Team reviewer: public rule changes</h2>
      <p className="text-sm">
        Approval is disabled without JAAGRUK_REVIEW_KEY on the server. The key stays in this
        component’s memory. Review exact source wording, scope and effective dates before activating
        a field.
      </p>
      <label className="block">
        Reviewer key
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label className="block">
        Pending source change
        <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Select a change</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.workflow} · {r.retrieved_at}
            </option>
          ))}
        </select>
      </label>
      {id && (
        <details>
          <summary>Compare public captures</summary>
          <div className="grid gap-3 sm:grid-cols-2">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {rows.find((r) => r.id === id)?.old_text}
            </pre>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {rows.find((r) => r.id === id)?.new_text}
            </pre>
          </div>
        </details>
      )}
      <label className="block">
        Reviewed fields (JSON)
        <textarea
          className="input font-mono"
          value={patch}
          onChange={(e) => setPatch(e.target.value)}
        />
      </label>
      <label className="block">
        Exact supporting passage
        <textarea className="input" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
      </label>
      <label className="block">
        Review note
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex gap-2">
        {[true, false].map((approve) => (
          <button
            className={approve ? "btn-primary" : "btn-ghost"}
            key={String(approve)}
            disabled={!key || !id || note.length < 5}
            onClick={async () => {
              try {
                const r = await fetch("/api/workspace/changes/" + id + "/review", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Reviewer-Key": key },
                  body: JSON.stringify({ approve, changes: JSON.parse(patch), note, excerpt }),
                });
                const data = await r.json();
                if (!r.ok)
                  throw new Error(typeof data.detail === "string" ? data.detail : "Review failed");
                setMessage(data.status);
                setId("");
                await load();
                refresh();
              } catch (e: any) {
                setMessage(e.message);
              }
            }}
          >
            {approve ? "Activate reviewed change" : "Reject candidate"}
          </button>
        ))}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
