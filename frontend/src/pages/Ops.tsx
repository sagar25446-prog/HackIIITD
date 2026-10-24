import { useEffect, useState } from "react";
import { Activity, Brain, Cpu, Fish, RefreshCw } from "lucide-react";
import { ago, api } from "../api";
import { Section, Spinner } from "../components/ui";
import { useApp } from "../state";

const API_LABEL: Record<string, string> = {
  search: "Search", fetch: "Fetch", agent: "Agent", batch: "Agent batch", browser: "Browser", playbook: "Playbook (Browser)", monitor: "Monitor", research: "Research", llm: "Claude",
};

export default function Ops() {
  const { health } = useApp();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setD(await api.get("/api/ops")); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  if (!d) return <div className="flex items-center justify-center gap-2 p-16 text-ink-500"><Spinner /> Loading…</div>;
  const nm = d.metrics.name_match || {};
  const sc = d.metrics.scam || {};
  const totals: Record<string, { live: number; replay: number; failed: number }> = {};
  for (const r of d.summary) {
    const k = r.api;
    totals[k] = totals[k] || { live: 0, replay: 0, failed: 0 };
    if (r.status === "failed") totals[k].failed += r.n;
    else totals[k][r.mode as "live" | "replay"] += r.n;
  }

  return (
    <div>
      <Section title={<span className="flex items-center gap-2"><Cpu className="h-5 w-5 text-teal-600" /> Under the hood</span>}
        sub="Every TinyFish call this server made, the models' measured accuracy, and what runs where."
        right={<button className="btn-ghost text-sm" onClick={load} disabled={busy}>{busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh</button>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<Fish className="h-5 w-5" />} label="TinyFish mode" value={health?.tinyfish?.mode || "?"} note={health?.tinyfish?.live ? "live API key loaded" : `${health?.tinyfish?.recordings ?? 0} recorded real runs available`} />
          <Stat icon={<Activity className="h-5 w-5" />} label="TinyFish calls" value={String(d.calls.length)} note={Object.entries(totals).map(([k, v]) => `${API_LABEL[k] || k} ${v.live + v.replay}`).join(" · ") || "none yet"} />
          <Stat icon={<Brain className="h-5 w-5" />} label="Name matcher F1" value={nm.f1 ?? "—"} note={`AUC ${nm.auc ?? "—"} · exact-match finds only ${Math.round((nm.exact_match_baseline_recall || 0) * 100)}% of true variants`} />
          <Stat icon={<Brain className="h-5 w-5" />} label="Scam model F1" value={sc.f1 ?? "—"} note={`${sc.cv || ""} on ${sc.examples || "?"} messages`} />
        </div>
        {d.wallet?.available_balance && <p className="mt-3 text-xs text-ink-500">TinyFish wallet: ${Number(d.wallet.available_balance).toFixed(2)} available · Search, Fetch and Research are free · Agent $0.016/step · Browser $0.002/min · Monitor $0.005/check</p>}
      </Section>

      <Section title="TinyFish call log" sub="live = real call now · replay = a recorded real response (shown when the network or key is unavailable)">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase text-ink-500">
              <tr><th className="p-3">When</th><th>API</th><th>Purpose</th><th>Target</th><th>Mode</th><th>Status</th><th>ms</th><th>Run</th></tr>
            </thead>
            <tbody>
              {d.calls.map((c: any) => (
                <tr key={c.id} className="border-t border-ink-100 align-top">
                  <td className="p-3 text-xs text-ink-500">{ago(c.ts)}</td>
                  <td className="font-semibold">{API_LABEL[c.api] || c.api}</td>
                  <td className="max-w-[220px] truncate text-xs" title={c.purpose}>{c.purpose}</td>
                  <td className="max-w-[240px] truncate text-xs text-ink-500" title={c.target}>{c.target}</td>
                  <td><span className={`chip ${c.mode === "live" ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-600"}`}>{c.mode}</span></td>
                  <td><span className={`chip ${c.status === "ok" ? "bg-teal-50 text-teal-700" : "bg-coral-100 text-coral-600"}`} title={c.detail}>{c.status}</span></td>
                  <td className="text-xs">{c.latency_ms ?? ""}</td>
                  <td className="text-xs">{c.streaming_url ? <a className="text-teal-600 underline" href={c.streaming_url} target="_blank" rel="noreferrer">stream</a> : c.run_id?.slice(0, 8)}{c.steps ? ` · ${c.steps} steps` : ""}</td>
                </tr>
              ))}
              {d.calls.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-ink-500">No calls yet — run Wapsi, Scam Shield, Change Radar or Ask.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Name matcher on real-world variants" sub="Records list names as initials, misspellings or in Devanagari — exact matching misses most of them">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {d.examples.name_match.map((e: any) => (
                <tr key={e.b} className="border-t border-ink-100">
                  <td className="p-3">{e.a}</td><td>{e.b}</td>
                  <td className="w-40"><div className="h-2 rounded-full bg-ink-100"><div className={`h-2 rounded-full ${e.probability >= 0.85 ? "bg-teal-500" : e.probability >= 0.5 ? "bg-amber-500" : "bg-coral-500"}`} style={{ width: `${e.probability * 100}%` }} /></div></td>
                  <td className="p-3 text-xs">{Math.round(e.probability * 100)}% · {e.band}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="How JAAGRUK uses TinyFish">
        <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
          {[
            ["Search (free)", "Scam Shield evidence from PIB Fact Check and official sites; discover new schemes and notices."],
            ["Fetch (free)", "Change Radar reads up to 10 notice pages in one call; re-verifies each scheme's official page before trusting a rule."],
            ["Agent + run-sse", "Wapsi searches LIC and IEPF in parallel with live browser views; the official myScheme checker gives a second opinion."],
            ["Browser API", "Assisted sessions for portals that need the citizen's own OTP (UDGAM, MF Central, EPFO, CPGRAMS) — driven over CDP."],
            ["Monitors", "Always-on watch of notice pages 3× a day plus a fake-scheme topic monitor, delivered to our webhook."],
            ["Research (free)", "“Read official sites live” in Ask JAAGRUK — cited answers from .gov.in sources."],
          ].map(([h, b]) => <div key={h} className="card p-4"><div className="font-semibold text-teal-700">{h}</div><div className="mt-1 text-ink-700">{b}</div></div>)}
        </div>
      </Section>
    </div>
  );
}

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-ink-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {note && <div className="mt-1 text-xs text-ink-500">{note}</div>}
    </div>
  );
}
