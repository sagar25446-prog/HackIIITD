import { useEffect, useState } from "react";
import {
  BellRing,
  Bookmark,
  CalendarClock,
  ExternalLink,
  RefreshCw,
  Satellite,
  Search,
} from "lucide-react";
import { ago, api, stream } from "../api";
import {
  Empty,
  ErrorNote,
  fmtDate,
  ModeBadge,
  PageHeader,
  Section,
  Spinner,
} from "../components/ui";
import { useApp } from "../state";
import { indiaToday } from "../workspace/calendarDates";
import { SchemeDrawer, StatusChip } from "./Explore";

const KIND: Record<string, string> = {
  deadline: "bg-coral-100 text-coral-700",
  new_notification: "bg-teal-100 text-teal-800",
  eligibility: "bg-amber-100 text-amber-800",
  vacancy: "bg-teal-50 text-teal-800",
  result: "bg-ink-100 text-ink-700",
  admit_card: "bg-ink-100 text-ink-700",
  schedule: "bg-ink-100 text-ink-700",
  cancellation: "bg-coral-50 text-coral-700",
  answer_key: "bg-ink-100 text-ink-700",
};

export default function Radar({ embedded = false }: { embedded?: boolean }) {
  const { profile, t, lang, health, tracked, clearUpdates } = useApp();
  const hi = lang === "hi";
  const [data, setData] = useState<any>(null);
  const [scan, setScan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mon, setMon] = useState<any>(null);
  const [monBusy, setMonBusy] = useState(false);
  const [opKey, setOpKey] = useState("");
  const [disc, setDisc] = useState<any>(null);
  const [discBusy, setDiscBusy] = useState(false);

  useEffect(() => {
    clearUpdates();
  }, []);
  useEffect(() => {
    api
      .post("/api/radar/alerts", { profile, tracked })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [profile, tracked.join(",")]);

  const doScan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<any>("/api/radar/scan", { profile, tracked });
      if (!r.ok) setErr(r.error);
      setScan(r);
      setData((d: any) => ({ ...d, alerts: r.alerts, board: r.board }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loadDiscover = async () => {
    setDiscBusy(true);
    try {
      setDisc(await api.get("/api/discover"));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDiscBusy(false);
    }
  };

  const alerts = data?.alerts || [];
  const mine = alerts.filter((a: any) => a.for_you);
  return (
    <div>
      {embedded ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="section-title flex items-center gap-2">
              <BellRing className="h-5 w-5 text-teal-700" />
              {hi ? "आपके लिए अपडेट" : "Updates for you"}
            </h2>
            <p className="text-sm text-ink-600">
              {hi
                ? "सरकारी नोटिस, छात्रवृत्ति की तिथियाँ, आपकी चुनी योजनाएँ और समीक्षित नियम बदलाव — एक जगह।"
                : "Official notices, scholarship dates, schemes you track and reviewed rule changes — in one inbox."}
            </p>
          </div>
          <button className="btn-primary" disabled={busy} onClick={doScan}>
            {busy ? <Spinner /> : <Satellite className="h-4 w-4" />} {t("scanNow")}
          </button>
        </div>
      ) : (
        <PageHeader
          icon={<BellRing className="h-5 w-5" />}
          title={hi ? "अलर्ट" : "Alerts"}
          sub={
            hi
              ? "हम सरकारी नोटिस बोर्ड, छात्रवृत्ति की समय-सीमा और आपकी चुनी योजनाओं पर नज़र रखते हैं — और सिर्फ़ वही बताते हैं जो आपको प्रभावित करे।"
              : "We watch official notice boards, scholarship deadlines and the schemes you track — and tell you only what affects you."
          }
          right={
            <button className="btn-primary" disabled={busy} onClick={doScan}>
              {busy ? <Spinner /> : <Satellite className="h-4 w-4" />} {t("scanNow")}
            </button>
          }
        />
      )}
      <ErrorNote error={err} />
      {scan?.ok && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-white p-3 text-sm shadow-card">
          <ModeBadge replay={scan.replay} recordedAt={scan.recorded_at} />
          {hi
            ? `${scan.pages.length} आधिकारिक पेज एक TinyFish Fetch कॉल में पढ़े`
            : `Read ${scan.pages.length} official pages in one TinyFish Fetch call`}{" "}
          · <b>{scan.new_alerts}</b> {hi ? "नए ज़रूरी बदलाव" : "new important change(s)"}
          {scan.deadlines_refresh?.changes?.length > 0 && (
            <span className="chip bg-coral-100 text-coral-700">
              {scan.deadlines_refresh.changes.length} {hi ? "समय-सीमा बदली" : "deadline change(s)"}
            </span>
          )}
          {scan.pages
            .filter((p: any) => p.error)
            .map((p: any) => (
              <span key={p.source_id} className="chip bg-coral-50 text-coral-700">
                {p.name}: {p.error}
              </span>
            ))}
        </div>
      )}

      <Tracked />

      <Section
        title={hi ? "आपके लिए बदलाव" : "Changes that affect you"}
        sub={
          hi
            ? "नया नोटिस, बढ़ी समय-सीमा या नियम बदलाव — आधिकारिक पेज से।"
            : "New notices, extended deadlines and rule changes — straight from the official page."
        }
      >
        {alerts.length === 0 ? (
          <Empty
            icon={<BellRing className="h-5 w-5" />}
            title={hi ? "अभी कोई बदलाव नहीं" : "No changes detected yet"}
            action={
              <button className="btn-primary btn-sm" disabled={busy} onClick={doScan}>
                {t("scanNow")}
              </button>
            }
          >
            {hi
              ? "आधिकारिक पेजों की आधार-प्रति सहेजी है। अभी स्कैन करके लाइव पेज से तुलना करें।"
              : "Baselines of the official pages are saved. Scan now to compare them with the live pages."}
          </Empty>
        ) : (
          <div className="space-y-2">
            {mine.length === 0 && (
              <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
                {hi
                  ? "आपकी प्रोफ़ाइल से मेल खाता कोई बदलाव नहीं। नीचे हाल के सभी आधिकारिक बदलाव हैं।"
                  : "No change matches your profile. Here are the latest official changes for reference."}
              </p>
            )}
            {(mine.length ? mine : alerts).map((a: any) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className={`card card-hover flex items-start gap-3 p-4 ${a.specific.length ? "border-teal-300" : ""}`}
              >
                <BellRing
                  className={`mt-0.5 h-5 w-5 shrink-0 ${a.for_you ? "text-teal-600" : "text-ink-300"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${KIND[a.kind] || "bg-ink-100"}`}>
                      {a.kind.replace("_", " ")}
                    </span>
                    {a.for_you && (
                      <span className="chip bg-teal-600 text-white">
                        {t("forYou")}
                        {a.specific.length ? ` · ${a.specific.join(", ")}` : ""}
                      </span>
                    )}
                    <span className="text-xs text-ink-500">
                      {a.source_id.replace(/_/g, " ")} · {ago(a.ts)} · via {a.evidence.via}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{a.title}</div>
                  {a.evidence.dates?.length > 0 && (
                    <div className="mt-1 text-xs font-semibold text-coral-700">
                      {hi ? "उल्लिखित तिथियाँ" : "Dates mentioned"}: {a.evidence.dates.join(", ")}
                    </div>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-ink-300" />
              </a>
            ))}
            {mine.length > 0 && mine.length < alerts.length && (
              <p className="text-xs text-ink-500">
                {alerts.length - mine.length}{" "}
                {hi
                  ? "अन्य बदलाव छिपे — आपके लिए प्रासंगिक नहीं।"
                  : "other change(s) hidden — not relevant to you."}
              </p>
            )}
          </div>
        )}
      </Section>

      <NspDeadlines />

      <Section
        title={hi ? "अभी बोर्ड पर" : "On the notice boards right now"}
        sub={
          hi
            ? "हर देखे गए पेज के ताज़ा स्नैपशॉट से ज़रूरी सूचनाएँ (अपने-आप वर्गीकृत)"
            : "Important items from the latest snapshot of each watched page (classified automatically)"
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.board || []).map((b: any) => (
            <div key={b.source_id} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold hover:underline"
                >
                  {b.name}
                </a>
                <span className="text-xs text-ink-500">
                  {hi ? "स्नैपशॉट" : "snapshot"} {ago(b.snapshot_at)}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {b.items.slice(0, 5).map((i: any, k: number) => (
                  <li
                    key={k}
                    className={`text-sm ${i.for_you ? "rounded-lg bg-teal-50 p-2 ring-1 ring-teal-200" : ""}`}
                  >
                    {i.for_you && (
                      <span className="chip mr-1 bg-teal-600 text-white">{t("forYou")}</span>
                    )}
                    <span className={`chip mr-1 ${KIND[i.kind] || "bg-ink-100"}`}>
                      {i.kind.replace("_", " ")}
                    </span>
                    {i.posted && <span className="mr-1 text-xs text-ink-500">{i.posted}</span>}
                    {i.text.slice(0, 140)}
                    {i.for_you && i.dates_in_text?.length > 0 && (
                      <div className="mt-1 text-xs font-semibold text-coral-700">
                        {hi ? "तिथियाँ" : "Dates"}: {i.dates_in_text.join(" · ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 font-bold">{hi ? "हमेशा चालू निगरानी" : "Always-on monitoring"}</div>
          <p className="text-sm text-ink-600">
            {hi
              ? "हर पेज पर एक TinyFish Monitor दिन में 3 बार जाँचकर हमारे निजी वेबहुक को बताता है; JAAGRUK पेज खुद दोबारा पढ़कर बदलाव जाँचता है। यह संचालक नियंत्रण है।"
              : "One TinyFish Monitor per page checks 3× a day and calls our private webhook; JAAGRUK re-reads the page itself before raising an alert. Operator control."}
          </p>
          <p className="mt-2 text-xs text-ink-500">
            {(data?.monitors || []).length} {hi ? "मॉनिटर पंजीकृत" : "monitor(s) registered"} ·
            webhook{" "}
            {health?.webhook_ready
              ? hi
                ? "तैयार"
                : "ready"
              : hi
                ? "PUBLIC_BASE_URL चाहिए"
                : "needs PUBLIC_BASE_URL"}
          </p>
          <label className="mt-3 block">
            <span className="field-label">{hi ? "संचालक कुंजी" : "Operator key"}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={opKey}
              onChange={(e) => setOpKey(e.target.value)}
            />
          </label>
          <button
            className="btn-ghost btn-sm mt-2"
            disabled={monBusy || !health?.tinyfish?.live || !opKey}
            onClick={async () => {
              setMonBusy(true);
              try {
                const r = await fetch("/api/radar/monitors", {
                  method: "POST",
                  headers: { "X-Reviewer-Key": opKey },
                });
                const j = await r.json().catch(() => ({}));
                setMon(r.ok ? j : { ok: false, error: j.detail || `${r.status}` });
              } catch (e: any) {
                setMon({ ok: false, error: e.message });
              } finally {
                setMonBusy(false);
              }
            }}
          >
            {monBusy ? <Spinner /> : null}{" "}
            {hi ? "मॉनिटर पंजीकृत करें (≈ $0.06/दिन)" : "Register monitors (≈ $0.06/day)"}
          </button>
          {!health?.tinyfish?.live && (
            <p className="mt-2 text-xs text-ink-500">
              {hi ? "इसके लिए TinyFish कुंजी चाहिए।" : "Needs a live TinyFish key."}
            </p>
          )}
          {mon && (
            <p className={`mt-2 text-xs ${mon.ok ? "text-teal-700" : "text-coral-700"}`}>
              {mon.ok
                ? `Created ${mon.created.length} monitor(s) · ${mon.cost_per_day_usd} USD/day`
                : mon.error}
            </p>
          )}
        </div>
        <div className="card p-5">
          <div className="mb-1 flex items-center justify-between gap-2 font-bold">
            {hi ? "सरकारी साइटों पर नया" : "New on official sites"}
            <button className="btn-ghost btn-sm" disabled={discBusy} onClick={loadDiscover}>
              {discBusy ? <Spinner /> : <Search className="h-4 w-4" />} {hi ? "खोजें" : "Discover"}
            </button>
          </div>
          <p className="text-sm text-ink-600">
            {hi
              ? "पिछले 30 दिनों के लिए PIB, myScheme, NSP, SSC और UPSC पर TinyFish Search। जो JAAGRUK में नहीं है, उसे सत्यापन के लिए चिह्नित किया जाता है।"
              : "TinyFish Search over PIB, myScheme, NSP, SSC and UPSC for the last 30 days. Anything not in JAAGRUK yet is marked for verification."}
          </p>
          {disc?.items?.slice(0, 8).map((i: any) => (
            <a
              key={i.url}
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block rounded-xl border border-ink-100 p-2.5 text-sm hover:border-teal-300"
            >
              <span
                className={`chip mr-1 ${i.known_scheme ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}
              >
                {i.status}
              </span>
              {i.title}
              {i.date && <span className="ml-1 text-xs text-ink-500">· {i.date}</span>}
            </a>
          ))}
          {disc && disc.items?.length === 0 && (
            <p className="mt-2 text-xs text-ink-500">
              {disc.errors?.[0] || (hi ? "कुछ नया नहीं मिला।" : "Nothing new found.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Tracked() {
  const { t, lang, tracked, health, go } = useApp();
  const hi = lang === "hi";
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, any>>({});
  const load = () =>
    Promise.all(
      tracked.map((id) =>
        api
          .get<any>(`/api/explore/scheme/${encodeURIComponent(id)}?lang=${lang}`)
          .catch(() => null),
      ),
    ).then((r) => setRows(r.filter(Boolean)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked.join(","), lang]);
  const checkAll = async () => {
    setBusy(hi ? "आधिकारिक पेज जाँच रहे हैं…" : "Checking official pages…");
    try {
      const { job_id } = await api.post<any>("/api/explore/recheck", { ids: tracked.slice(0, 8) });
      stream(
        `/api/jobs/${job_id}/events`,
        (ev) => ev.message && setBusy(ev.message),
        (r) => {
          setBusy(null);
          setChecked(Object.fromEntries((r?.results || []).map((x: any) => [x.id, x])));
          load();
        },
      );
    } catch {
      setBusy(null);
    }
  };
  const mark = (o: any) =>
    !o ? null : o.outcome === "changed" ? (
      <span className="chip bg-coral-100 text-coral-700">{hi ? "बदला" : "changed"}</span>
    ) : o.outcome === "unreachable" ? (
      <span className="chip bg-amber-100 text-amber-800">
        {hi ? "साइट नहीं खुली" : "site unreachable"}
      </span>
    ) : (
      <span className="chip bg-teal-100 text-teal-800">
        ✓ {hi ? "कोई बदलाव नहीं" : "no change"}
      </span>
    );
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Bookmark className="h-5 w-5 text-teal-700" /> {t("trackedTitle")}
        </span>
      }
      right={
        tracked.length > 0 && health?.tinyfish?.live ? (
          <button className="btn-ghost btn-sm" disabled={!!busy} onClick={checkAll}>
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("checkNow")}
          </button>
        ) : undefined
      }
    >
      {busy && (
        <p className="mb-2 flex items-center gap-2 text-sm text-ink-500">
          <Spinner className="h-3.5 w-3.5" /> {busy}
        </p>
      )}
      {tracked.length === 0 ? (
        <Empty
          icon={<Bookmark className="h-5 w-5" />}
          action={
            <button className="btn-primary btn-sm" onClick={() => go("explore")}>
              {t("explore")}
            </button>
          }
        >
          {t("trackedEmpty")}
        </Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpen(r.id)}
              className="card card-hover p-3 text-left"
            >
              <div className="font-semibold leading-snug">{(hi && r.name_hi) || r.name}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                <StatusChip it={r} />
                {mark(checked[r.id] || r.check)}
                <span>
                  {r.checked_at
                    ? `${hi ? "जाँचा" : "checked"} ${ago(r.checked_at)}`
                    : hi
                      ? "अभी जाँचा नहीं"
                      : "not checked yet"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <SchemeDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </Section>
  );
}

function NspDeadlines() {
  const { t, lang, go } = useApp();
  const hi = lang === "hi";
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api
      .get("/api/explore/deadlines")
      .then(setInfo)
      .catch(() => null);
  }, []);
  const today = indiaToday();
  const items = (info?.items || []).filter((s: any) => s.apply_till >= today);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-teal-700" /> {t("deadlinesFrom")}
        </span>
      }
      sub={
        info?.fetched_at
          ? `${hi ? "पढ़ा गया" : "Read"} ${ago(info.fetched_at)} · TinyFish Fetch`
          : undefined
      }
      right={
        <button
          className="btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post("/api/explore/deadlines/refresh");
              setInfo(await api.get("/api/explore/deadlines"));
            } catch {
              /* the last saved list stays on screen */
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("refresh")}
        </button>
      }
    >
      {items.length === 0 ? (
        <Empty>{hi ? "अभी कोई खुली समय-सीमा नहीं।" : "No open deadlines right now."}</Empty>
      ) : (
        <div className="card divide-y divide-ink-100">
          {(all ? items : items.slice(0, 6)).map((s: any) => {
            const days = Math.round(
              (new Date(s.apply_till).getTime() - new Date(today).getTime()) / 86400000,
            );
            return (
              <button
                key={s.name}
                className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-ink-50 sm:flex-nowrap"
                onClick={() => go("explore", { text: s.name.slice(0, 80) })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug">{s.name}</span>
                  <span className="text-xs text-ink-500">
                    {s.renewal ? (hi ? "नवीनीकरण · " : "Renewal · ") : ""}
                    {hi ? "खुला" : "Opened"} {fmtDate(s.open_from, lang)}
                  </span>
                </span>
                <span
                  className={`chip shrink-0 ${days <= 7 ? "bg-coral-100 text-coral-700" : "bg-teal-50 text-teal-800"}`}
                >
                  {fmtDate(s.apply_till, lang)} ·{" "}
                  {days === 0 ? t("lastDay") : t("daysLeft", { n: days })}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {items.length > 6 && (
        <button className="btn-quiet btn-sm mt-2" onClick={() => setAll(!all)}>
          {all ? t("showLess") : `${t("showAll")} (${items.length})`}
        </button>
      )}
      {info?.url && (
        <a
          className="link mt-2 inline-flex items-center gap-1 text-sm"
          href={info.url}
          target="_blank"
          rel="noreferrer"
        >
          scholarships.gov.in <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </Section>
  );
}
