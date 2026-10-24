import { useEffect, useState } from "react";
import { BellRing, ExternalLink, Radar as RadarIcon, Satellite, Search } from "lucide-react";
import { ago, api } from "../api";
import { Empty, ErrorNote, ModeBadge, Section, Spinner } from "../components/ui";
import { useApp } from "../state";

const KIND: Record<string, string> = {
  deadline: "bg-coral-100 text-coral-600", new_notification: "bg-teal-100 text-teal-700", eligibility: "bg-amber-100 text-amber-600",
  vacancy: "bg-teal-50 text-teal-700", result: "bg-ink-100 text-ink-700", admit_card: "bg-ink-100 text-ink-700",
  schedule: "bg-ink-100 text-ink-700", cancellation: "bg-coral-50 text-coral-600", answer_key: "bg-ink-100 text-ink-700",
};

export default function Radar() {
  const { profile, t, lang, health } = useApp();
  const [data, setData] = useState<any>(null);
  const [scan, setScan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mon, setMon] = useState<any>(null);
  const [disc, setDisc] = useState<any>(null);
  const [discBusy, setDiscBusy] = useState(false);

  useEffect(() => {
    api.post("/api/radar/alerts", { profile }).then(setData).catch((e) => setErr(e.message));
  }, [profile]);

  const doScan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<any>("/api/radar/scan", { profile });
      if (!r.ok) setErr(r.error);
      setScan(r);
      setData((d: any) => ({ ...d, alerts: r.alerts, board: r.board }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const loadDiscover = async () => {
    setDiscBusy(true);
    try { setDisc(await api.get("/api/discover")); } catch (e: any) { setErr(e.message); } finally { setDiscBusy(false); }
  };

  const alerts = data?.alerts || [];
  const mine = alerts.filter((a: any) => a.for_you);
  return (
    <div>
      <Section title={<span className="flex items-center gap-2"><RadarIcon className="h-5 w-5 text-teal-600" /> {lang === "hi" ? "बदलाव रडार" : "Change Radar"}</span>}
        sub={lang === "hi" ? "सरकारी नोटिस बोर्ड पर नज़र — सिर्फ़ वही बताते हैं जो आपको प्रभावित करे" : "We watch official notice boards and tell you only what affects your family — new notices, extended deadlines, rule changes."}
        right={<button className="btn-primary" disabled={busy} onClick={doScan}>{busy ? <Spinner /> : <Satellite className="h-4 w-4" />} {t("scanNow")}</button>}>
        <ErrorNote error={err} />
        {scan?.ok && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-card">
            <ModeBadge replay={scan.replay} recordedAt={scan.recorded_at} />
            Read {scan.pages.length} official pages in one TinyFish Fetch call · <b>{scan.new_alerts}</b> new important change(s)
            {scan.pages.filter((p: any) => p.error).map((p: any) => <span key={p.source_id} className="chip bg-coral-50 text-coral-600">{p.name}: {p.error}</span>)}
          </div>
        )}
        {alerts.length === 0 ? (
          <Empty>No changes detected yet. Baselines were captured from the official pages; press <b>Scan</b> to compare with the live pages now.</Empty>
        ) : (
          <div className="space-y-2">
            {(mine.length ? mine : alerts).map((a: any) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className={`card flex items-start gap-3 p-4 hover:border-teal-300 ${a.specific.length ? "border-teal-400" : ""}`}>
                <BellRing className={`mt-0.5 h-5 w-5 shrink-0 ${a.for_you ? "text-teal-500" : "text-ink-300"}`} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${KIND[a.kind] || "bg-ink-100"}`}>{a.kind.replace("_", " ")}</span>
                    {a.for_you && <span className="chip bg-teal-500 text-white">{t("forYou")}{a.specific.length ? ` · ${a.specific.join(", ")}` : ""}</span>}
                    <span className="text-xs text-ink-500">{a.source_id.replace(/_/g, " ")} · {ago(a.ts)} · via {a.evidence.via}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{a.title}</div>
                  {a.evidence.dates?.length > 0 && <div className="mt-1 text-xs text-coral-600">Dates mentioned: {a.evidence.dates.join(", ")}</div>}
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-ink-300" />
              </a>
            ))}
            {mine.length > 0 && mine.length < alerts.length && <p className="text-xs text-ink-500">{alerts.length - mine.length} other change(s) hidden — not relevant to your family.</p>}
          </div>
        )}
      </Section>

      <Section title={lang === "hi" ? "अभी बोर्ड पर" : "On the boards right now"} sub="Important items from the latest snapshot of each watched page (classified automatically)">
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.board || []).map((b: any) => (
            <div key={b.source_id} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <a href={b.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{b.name}</a>
                <span className="text-xs text-ink-500">snapshot {ago(b.snapshot_at)}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {b.items.slice(0, 5).map((i: any, k: number) => (
                  <li key={k} className={`text-sm ${i.for_you ? "rounded-lg bg-teal-50 p-2 ring-1 ring-teal-200" : ""}`}>
                    {i.for_you && <span className="chip mr-1 bg-teal-500 text-white">{t("forYou")}</span>}
                    <span className={`chip mr-1 ${KIND[i.kind] || "bg-ink-100"}`}>{i.kind.replace("_", " ")}</span>
                    {i.posted && <span className="mr-1 text-xs text-ink-500">{i.posted}</span>}
                    {i.text.slice(0, 140)}
                    {i.for_you && i.dates_in_text?.length > 0 && <div className="mt-1 text-xs font-semibold text-coral-600">Dates: {i.dates_in_text.join(" · ")}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 font-bold">Always-on monitoring</div>
          <p className="text-sm text-ink-500">One TinyFish Monitor per page checks 3× a day and calls our webhook; a search monitor watches for new fake-scheme fact-checks for Scam Shield.</p>
          <p className="mt-2 text-xs text-ink-500">{(data?.monitors || []).length} monitor(s) registered · webhook {health?.webhook_ready ? "ready" : "needs PUBLIC_BASE_URL"}</p>
          <button className="btn-ghost mt-3 text-sm" onClick={async () => setMon(await api.post("/api/radar/monitors"))}>Register monitors (≈ $0.07/day)</button>
          {mon && <p className={`mt-2 text-xs ${mon.ok ? "text-teal-700" : "text-coral-600"}`}>{mon.ok ? `Created ${mon.created.length} monitor(s) · ${mon.cost_per_day_usd} USD/day` : mon.error}</p>}
        </div>
        <div className="card p-5">
          <div className="mb-1 flex items-center justify-between font-bold">New on official sites <button className="btn-ghost px-3 py-1.5 text-sm" disabled={discBusy} onClick={loadDiscover}>{discBusy ? <Spinner /> : <Search className="h-4 w-4" />} Discover</button></div>
          <p className="text-sm text-ink-500">TinyFish Search over PIB, myScheme, NSP, SSC and UPSC for the last 30 days. Anything not in JAAGRUK yet is marked for verification.</p>
          {disc?.items?.slice(0, 8).map((i: any) => (
            <a key={i.url} href={i.url} target="_blank" rel="noreferrer" className="mt-2 block rounded-xl border border-ink-100 p-2.5 text-sm hover:border-teal-300">
              <span className={`chip mr-1 ${i.known_scheme ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-600"}`}>{i.status}</span>{i.title}
              {i.date && <span className="ml-1 text-xs text-ink-500">· {i.date}</span>}
            </a>
          ))}
          {disc && disc.items?.length === 0 && <p className="mt-2 text-xs text-ink-500">{disc.errors?.[0] || "Nothing new found."}</p>}
        </div>
      </div>
    </div>
  );
}
