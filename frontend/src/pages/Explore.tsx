import { useEffect, useMemo, useRef, useState } from "react";
import {
  Baby,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home as HomeIcon,
  Landmark,
  Mic,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Store,
  X,
} from "lucide-react";
import { ago, api, stream } from "../api";
import { ErrorNote, ModeBadge, Modal, Spinner } from "../components/ui";
import { Key } from "../i18n";
import { useApp } from "../state";

type Filters = Record<string, string[]>;
type Facet = { value: string; count: number; label: string };

export const CAT_ICON: Record<string, any> = {
  education: GraduationCap,
  pension: HandCoins,
  health: HeartPulse,
  farming: Sprout,
  jobs: Briefcase,
  business: Store,
  housing: HomeIcon,
  women_children: Baby,
  insurance: ShieldCheck,
  other: Landmark,
};
const FACET_ORDER: { id: string; key: Key }[] = [
  { id: "where", key: "fWhere" },
  { id: "cat", key: "fCat" },
  { id: "group", key: "fGroup" },
  { id: "status", key: "fStatus" },
  { id: "btype", key: "fBtype" },
  { id: "tier", key: "fTier" },
];
const SORTS: { id: string; key: Key }[] = [
  { id: "best", key: "sortBest" },
  { id: "deadline", key: "sortDeadline" },
  { id: "benefit", key: "sortBenefit" },
  { id: "newest", key: "sortNewest" },
  { id: "name", key: "sortName" },
];
const EXAMPLES = {
  en: [
    "Scholarships open now",
    "Pension for widows in Delhi",
    "Loans for women entrepreneurs",
    "Help for farmers",
    "Scholarships for students with disabilities",
    "Closing this month",
  ],
  hi: [
    "अभी खुली छात्रवृत्तियाँ",
    "दिल्ली में विधवा पेंशन",
    "महिला उद्यमियों के लिए ऋण",
    "किसानों के लिए योजनाएँ",
    "दिव्यांग छात्रों के लिए छात्रवृत्ति",
    "इस महीने बंद होने वाली",
  ],
};
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

const fmtDate = (iso: string, lang: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const daysTo = (iso: string) =>
  Math.round((new Date(iso + "T23:59:59").getTime() - Date.now()) / 86400000);

export function StatusChip({ it, compact }: { it: any; compact?: boolean }) {
  const { t, lang } = useApp();
  if (!it.deadline || it.status === "unknown") return null;
  const d = daysTo(it.deadline);
  if (it.status === "date_passed")
    return (
      <span className="chip bg-ink-100 text-ink-500">
        {lang === "hi" ? "तिथि निकल गई" : "Date passed"} · {fmtDate(it.deadline, lang)}
      </span>
    );
  if (it.status === "upcoming")
    return (
      <span className="chip bg-amber-100 text-amber-600">
        {t("opens")} {fmtDate(it.deadline, lang)}
      </span>
    );
  const left = d <= 0 ? t("lastDay") : t("daysLeft").replace("{n}", String(d));
  return it.status === "closing_soon" ? (
    <span className="chip bg-coral-100 text-coral-600">
      {t("closes")} {fmtDate(it.deadline, lang)}
      {compact ? "" : ` · ${left}`}
    </span>
  ) : (
    <span className="chip bg-teal-100 text-teal-700">
      {t("closes")} {fmtDate(it.deadline, lang)}
    </span>
  );
}

export default function Explore() {
  const { t, lang, profile, eligibleIds, takeIntent } = useApp();
  const homeState = profile?.state && profile.state !== "Other" ? profile.state : null;
  const defaultWhere: string[] = homeState ? [homeState, "central"] : [];
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(
    () => (defaultWhere.length ? { where: defaultWhere } : {}) as Filters,
  );
  const [sort, setSort] = useState("best");
  const [res, setRes] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parsed, setParsed] = useState<any>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [liveFor, setLiveFor] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const skipNext = useRef(false);

  // every request gets a number: a slower, older answer can never replace a newer one
  const req = useRef(0);
  const run = async (page = 0, over?: { q?: string; filters?: Filters; sort?: string }) => {
    const id = ++req.current;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<any>("/api/explore/search", {
        q: over?.q ?? q,
        filters: over?.filters ?? filters,
        sort: over?.sort ?? sort,
        page,
        per_page: 20,
        profile,
        lang,
      });
      if (id !== req.current) return;
      setRes(r);
      setItems((cur) => (page === 0 ? r.items : [...cur, ...r.items]));
    } catch (e: any) {
      if (id === req.current) setErr(e.message);
    } finally {
      if (id === req.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    run(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, lang, eligibleIds.join(",")]);
  // Another page can open Explore with a sentence to search or a scheme to show.
  useEffect(() => {
    const intent = takeIntent("explore");
    if (intent?.text) command(intent.text);
    if (intent?.open) setOpenId(intent.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const command = async (sentence: string) => {
    const s = sentence.trim();
    if (!s) return;
    setText(s);
    const id = ++req.current;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<any>("/api/explore/command", {
        text: s,
        profile,
        lang,
        keep_where: defaultWhere,
      });
      if (id !== req.current) return;
      skipNext.current = true;
      setParsed(r.parsed);
      setQ(r.parsed.q || "");
      setFilters(r.parsed.filters || {});
      setSort(r.parsed.sort || "best");
      setRes(r);
      setItems(r.items);
      setLiveFor(r.parsed.live ? s : null);
    } catch (e: any) {
      if (id === req.current) setErr(e.message);
    } finally {
      if (id === req.current) setBusy(false);
    }
  };

  const toggle = (facet: string, value: string) => {
    setFilters((cur) => {
      const has = (cur[facet] || []).includes(value);
      const next = {
        ...cur,
        [facet]: has ? cur[facet].filter((v) => v !== value) : [...(cur[facet] || []), value],
      };
      if (!next[facet].length) delete next[facet];
      return next;
    });
  };
  const clearAll = () => {
    setQ("");
    setText("");
    setParsed(null);
    setLiveFor(null);
    setFilters({});
    setSort("best");
  };

  const voice = () => {
    if (!SR) return;
    const r = new SR();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.onresult = (e: any) => {
      const s = e.results[0][0].transcript;
      setText(s);
      command(s);
    };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [f, opts] of Object.entries<Facet[]>(res?.facets || {}))
      for (const o of opts) m[`${f}:${o.value}`] = o.label;
    m["status:live"] = t("openOnly");
    return m;
  }, [res, t]);
  const active = Object.entries(filters).flatMap(([f, vs]) => vs.map((v) => ({ f, v })));
  const nFilters = active.length;
  const browsing = !q && !filters.cat?.length && !parsed;
  const liveOn = (filters.status || []).includes("live");

  return (
    <div className="fade-up">
      <Header stats={res?.stats} />

      {/* command bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          command(text);
        }}
        className="card flex items-center gap-2 p-2 pl-4 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100"
      >
        <Search className="h-5 w-5 shrink-0 text-ink-300" />
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-ink-300"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("cmdPlaceholder")}
          aria-label={t("search")}
        />
        {text && (
          <button
            type="button"
            aria-label="Clear"
            className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-50"
            onClick={clearAll}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {SR && (
          <button
            type="button"
            onClick={voice}
            aria-label={t("speak")}
            className={`rounded-xl p-2.5 ${listening ? "pulse-ring bg-coral-500 text-white" : "text-teal-600 hover:bg-teal-50"}`}
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
        <button
          className="btn-primary px-3 sm:px-5"
          disabled={busy || !text.trim()}
          aria-label={t("search")}
        >
          {busy ? (
            <Spinner />
          ) : (
            <>
              <Search className="h-5 w-5 sm:hidden" />
              <span className="hidden sm:inline">{t("search")}</span>
            </>
          )}
        </button>
      </form>
      {!parsed && !q && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {EXAMPLES[lang].map((ex) => (
            <button
              key={ex}
              onClick={() => command(ex)}
              className="shrink-0 whitespace-nowrap rounded-full border border-ink-100 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-teal-300 hover:text-teal-700"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* what we understood */}
      {(nFilters > 0 || q) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-500">{t("showing")}:</span>
          {q && (
            <Pill
              onRemove={() => {
                setQ("");
                run(0, { q: "" });
              }}
            >
              “{q}”
            </Pill>
          )}
          {active.map(({ f, v }) => (
            <Pill key={f + v} onRemove={() => toggle(f, v)}>
              {labels[`${f}:${v}`] || v}
            </Pill>
          ))}
          <button
            className="text-sm font-semibold text-teal-700 hover:underline"
            onClick={clearAll}
          >
            {t("clearAll")}
          </button>
        </div>
      )}

      {browsing && res && (
        <CategoryTiles facets={res.facets.cat} onPick={(c) => toggle("cat", c)} />
      )}

      <div className="mt-5 gap-6 lg:grid lg:grid-cols-[250px_1fr]">
        <aside className="hidden lg:block">
          <FacetPanel facets={res?.facets} filters={filters} toggle={toggle} />
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="mr-auto text-sm text-ink-700">
              <b className="text-ink-900">{res?.total ?? "…"}</b> {t("schemesCount")}
              {busy && <Spinner className="ml-2 inline h-3.5 w-3.5" />}
            </div>
            <button
              onClick={() => toggle("status", "live")}
              className={`chip border px-3 py-1.5 text-sm ${liveOn ? "border-teal-600 bg-teal-600 text-white" : "border-ink-100 bg-white text-ink-700"}`}
            >
              {t("openOnly")}
            </button>
            <select
              className="rounded-xl border border-ink-100 bg-white px-3 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {t(s.key)}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost px-3 py-1.5 text-sm lg:hidden"
              onClick={() => setSheet(true)}
            >
              <SlidersHorizontal className="h-4 w-4" /> {t("filters")}
              {nFilters ? ` (${nFilters})` : ""}
            </button>
          </div>
          <ErrorNote error={err} />

          {liveFor && (
            <LivePanel key={liveFor} text={liveFor} onDone={() => run(0)} onOpen={setOpenId} />
          )}

          {res && items.length === 0 && !busy && (
            <div className="card p-6 text-center text-sm text-ink-700">
              <CircleAlert className="mx-auto mb-2 h-6 w-6 text-amber-500" />
              {t("noResults")}
            </div>
          )}
          <div className="space-y-2">
            {items.map((it) => (
              <Row key={it.id} it={it} onOpen={() => setOpenId(it.id)} />
            ))}
          </div>
          {res && items.length < res.total && (
            <button
              className="btn-ghost mt-3 w-full"
              disabled={busy}
              onClick={() => run(res.page + 1)}
            >
              {busy ? <Spinner /> : null} {t("loadMore")} ({res.total - items.length})
            </button>
          )}
          {!liveFor && (text || q || nFilters > 0) && (
            <button
              onClick={() => setLiveFor(text || q || Object.values(filters).flat().join(" "))}
              className="card mt-4 flex w-full items-center gap-3 border-dashed p-4 text-left hover:border-teal-400"
            >
              <Globe className="h-6 w-6 shrink-0 text-teal-600" />
              <div className="flex-1">
                <div className="font-semibold">{t("liveSearch")}</div>
                <div className="text-sm text-ink-500">{t("liveSearchSub")}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-ink-300" />
            </button>
          )}
        </div>
      </div>

      <Modal open={sheet} onClose={() => setSheet(false)} title={t("filters")}>
        <FacetPanel facets={res?.facets} filters={filters} toggle={toggle} />
        <button className="btn-primary mt-4 w-full" onClick={() => setSheet(false)}>
          {res?.total ?? 0} {t("schemesCount")}
        </button>
      </Modal>
      {openId && (
        <SchemeDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => run(0)} />
      )}
    </div>
  );
}

function Header({ stats }: { stats: any }) {
  const { t, lang } = useApp();
  const [dl, setDl] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get("/api/explore/deadlines")
      .then(setDl)
      .catch(() => null);
  }, []);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>("/api/explore/deadlines/refresh");
      setDl({ ...dl, ...r });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-5">
      <h1 className="page-title flex items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Compass className="h-5 w-5" />
        </span>
        {t("exploreTitle")}
      </h1>
      <p className="page-sub">{t("exploreSub")}</p>
      {stats && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          <span>
            <b className="text-ink-700">{stats.total}</b> {t("schemesCount")}
          </span>
          <span>·</span>
          <span>
            <b className="text-teal-700">{stats.tiers.proven || 0}</b>{" "}
            {lang === "hi" ? "समीक्षित नियम" : "reviewed rules"}
          </span>
          <span>·</span>
          <span>
            <b className="text-ink-700">{stats.tiers.verified || 0}</b>{" "}
            {lang === "hi" ? "आधिकारिक पेज से पढ़ी गई" : "read from official pages"}
          </span>
          {dl?.fetched_at && (
            <>
              <span>·</span>
              <span>
                {lang === "hi" ? "NSP की समय-सीमा" : "NSP deadlines"} {ago(dl.fetched_at)}
              </span>
              <button
                className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"
                disabled={busy}
                onClick={refresh}
              >
                {busy ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}{" "}
                {t("refresh")}
              </button>
              {dl.changes?.length > 0 && (
                <span className="chip bg-coral-100 text-coral-600">
                  {dl.changes.length} changed
                </span>
              )}
              {dl.replay && <ModeBadge replay />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-3 pr-1.5 text-sm font-medium text-teal-800 ring-1 ring-teal-200">
      {children}
      <button
        aria-label="Remove"
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-teal-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function CategoryTiles({ facets, onPick }: { facets: Facet[]; onPick: (c: string) => void }) {
  const { t } = useApp();
  if (!facets?.length) return null;
  return (
    <div className="mt-6">
      <div className="label mb-2">{t("browseByNeed")}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {facets
          .filter((f) => f.value !== "other")
          .map((f) => {
            const I = CAT_ICON[f.value] || Landmark;
            return (
              <button
                key={f.value}
                onClick={() => onPick(f.value)}
                className="card flex items-center gap-3 p-3 text-left transition hover:border-teal-300 hover:shadow-md"
              >
                <span className="rounded-xl bg-teal-50 p-2 text-teal-700">
                  <I className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{f.label}</span>
                  <span className="text-xs text-ink-500">{f.count}</span>
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function FacetPanel({
  facets,
  filters,
  toggle,
}: {
  facets: any;
  filters: Filters;
  toggle: (f: string, v: string) => void;
}) {
  const { t } = useApp();
  if (!facets)
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  return (
    <div className="space-y-5">
      {FACET_ORDER.map(
        ({ id, key }) =>
          facets[id]?.length > 0 && (
            <FacetGroup
              key={id}
              title={t(key)}
              id={id}
              options={facets[id]}
              selected={filters[id] || []}
              toggle={toggle}
            />
          ),
      )}
    </div>
  );
}

function FacetGroup({
  title,
  id,
  options,
  selected,
  toggle,
}: {
  title: string;
  id: string;
  options: Facet[];
  selected: string[];
  toggle: (f: string, v: string) => void;
}) {
  const { t } = useApp();
  const [all, setAll] = useState(false);
  const sel = options.filter((o) => selected.includes(o.value));
  const rest = options.filter((o) => !selected.includes(o.value));
  const shown = [...sel, ...(all ? rest : rest.slice(0, Math.max(0, 6 - sel.length)))];
  return (
    <div>
      <div className="label mb-1.5">{title}</div>
      <ul className="space-y-0.5">
        {shown.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-white">
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-600"
                checked={selected.includes(o.value)}
                onChange={() => toggle(id, o.value)}
              />
              <span className="flex-1 leading-tight">{o.label}</span>
              <span className="text-xs text-ink-500">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
      {rest.length > 6 - sel.length && (
        <button
          className="mt-1 px-1.5 text-xs font-semibold text-teal-700 hover:underline"
          onClick={() => setAll(!all)}
        >
          {all ? t("showLess") : `${t("showAll")} (${options.length})`}
        </button>
      )}
    </div>
  );
}

function Row({ it, onOpen }: { it: any; onOpen: () => void }) {
  const { t, lang, tracked, toggleTrack } = useApp();
  const I = CAT_ICON[it.cats?.[0]] || Landmark;
  const on = tracked.includes(it.id);
  return (
    <div className="card flex items-stretch transition hover:border-teal-300">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left">
        <span className="mt-0.5 hidden rounded-xl bg-ink-50 p-2 text-teal-700 sm:block">
          <I className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">
            {(lang === "hi" && it.name_hi) || it.name}
          </span>
          {it.benefit && (
            <span className="mt-0.5 block truncate text-sm text-ink-500">{it.benefit}</span>
          )}
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {it.you_qualify && (
              <span className="chip bg-teal-600 text-white">
                <CheckCircle2 className="h-3 w-3" /> {t("youQualify")}
              </span>
            )}
            <StatusChip it={it} />
            <span className="chip bg-ink-50 text-ink-500">
              {it.state ? (lang === "hi" ? it.state : it.state) : t("central")}
            </span>
            {it.tier === "proven" && !it.you_qualify && (
              <span className="chip bg-teal-50 text-teal-700">
                <ShieldCheck className="h-3 w-3" />{" "}
                {lang === "hi" ? "समीक्षित नियम" : "Reviewed rule"}
              </span>
            )}
            {it.tier === "listed" && (
              <span className="chip bg-amber-50 text-amber-600">
                {it.found_live ? t("foundLive") : lang === "hi" ? "केवल सूची" : "Listing only"}
              </span>
            )}
          </span>
        </span>
      </button>
      <button
        onClick={() => toggleTrack(it.id)}
        aria-label={on ? t("tracking") : t("track")}
        title={on ? t("tracking") : t("track")}
        className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-ink-100 text-[10px] font-semibold ${on ? "text-teal-700" : "text-ink-300 hover:text-teal-600"}`}
      >
        {on ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
        {on ? t("tracking") : t("track")}
      </button>
    </div>
  );
}

function LivePanel({
  text,
  onDone,
  onOpen,
}: {
  text: string;
  onDone: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useApp();
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    api
      .post<any>("/api/explore/live", { text, lang })
      .then(({ job_id }) => {
        stop = stream(
          `/api/jobs/${job_id}/events`,
          (ev) => {
            if (ev.message) setSteps((s) => [...s, ev.message]);
            if (ev.phase === "error") setErr(ev.message);
          },
          (r) => {
            setResult(r);
            setRunning(false);
            onDone();
          },
        );
      })
      .catch((e) => {
        setErr(e.message);
        setRunning(false);
      });
    return () => stop?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="card mb-4 border-teal-200 bg-gradient-to-br from-white to-teal-50/60 p-4">
      <div className="flex items-center gap-2 font-bold">
        {running ? (
          <Spinner className="h-4 w-4 text-teal-600" />
        ) : (
          <Globe className="h-4 w-4 text-teal-600" />
        )}
        {t("liveSearch")} <span className="font-normal text-ink-500">· TinyFish</span>
        {result?.replay && <ModeBadge replay />}
      </div>
      <ul className="mt-2 space-y-1 text-sm text-ink-700">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {i === steps.length - 1 && running ? (
              <Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500" />
            )}
            {s}
          </li>
        ))}
      </ul>
      <ErrorNote error={err} />
      {result?.new?.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">{t("foundLive")}</div>
          <div className="space-y-1.5">
            {result.new.map((it: any) => (
              <button
                key={it.id}
                onClick={() => onOpen(it.id)}
                className="flex w-full items-center gap-2 rounded-xl bg-white p-2.5 text-left text-sm ring-1 ring-ink-100 hover:ring-teal-300"
              >
                <span className="chip bg-teal-600 text-white">{t("newBadge")}</span>
                <span className="flex-1 font-medium">{it.name}</span>
                <span className="text-xs text-ink-500">
                  {it.tier === "verified"
                    ? lang === "hi"
                      ? "पूरा विवरण"
                      : "full details"
                    : lang === "hi"
                      ? "सूची"
                      : "listing"}
                </span>
                <ChevronRight className="h-4 w-4 text-ink-300" />
              </button>
            ))}
          </div>
        </div>
      )}
      {result?.already_items?.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">
            {lang === "hi" ? "JAAGRUK में पहले से मौजूद मिलान" : "Matches already in JAAGRUK"}
          </div>
          <div className="space-y-1.5">
            {result.already_items.map((it: any) => (
              <button
                key={it.id}
                onClick={() => onOpen(it.id)}
                className="flex w-full items-center gap-2 rounded-xl bg-white p-2.5 text-left text-sm ring-1 ring-ink-100 hover:ring-teal-300"
              >
                <span className="min-w-0 flex-1 font-medium">{it.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
              </button>
            ))}
          </div>
        </div>
      )}
      {result?.official?.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">{lang === "hi" ? "सरकारी पेज" : "Official pages"}</div>
          <div className="space-y-1.5">
            {result.official.slice(0, 5).map((o: any) => (
              <a
                key={o.url}
                href={o.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl bg-white p-2.5 text-sm ring-1 ring-ink-100 hover:ring-teal-300"
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                </div>
                <div className="truncate text-xs text-ink-500">
                  {new URL(o.url).hostname}
                  {o.deadline
                    ? ` · ${o.status === "date_passed" ? "date passed" : "last date"} ${o.deadline}`
                    : ""}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      {result && !result.new?.length && !result.official?.length && (
        <p className="mt-2 text-sm text-ink-500">
          {lang === "hi"
            ? "कोई नया पेज नहीं मिला — ऊपर दी गई योजनाएँ पहले से JAAGRUK में हैं।"
            : "Nothing new found — the schemes above are already in JAAGRUK."}
        </p>
      )}
      {result?.ignored > 0 && (
        <p className="mt-2 text-xs text-ink-500">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          {result.ignored}{" "}
          {lang === "hi"
            ? "गैर-सरकारी नतीजे सुरक्षा के लिए छोड़े गए"
            : "non-official results ignored for your safety"}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detail panel
export function SchemeDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t, lang, tracked, toggleTrack, go, health } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<any>(null);
  // the drawer only shows the scheme it was opened for, even if an older request answers late
  const current = useRef(`${id}|${lang}`);
  current.current = `${id}|${lang}`;
  const load = () => {
    const key = `${id}|${lang}`;
    return api
      .get<any>(`/api/explore/scheme/${encodeURIComponent(id)}?lang=${lang}`)
      .then((v) => current.current === key && setD(v))
      .catch((e) => current.current === key && setErr(e.message));
  };
  useEffect(() => {
    setD(null);
    setErr(null);
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [id, lang]);

  const recheck = async () => {
    setChecking(lang === "hi" ? "आधिकारिक पेज खोल रहे हैं…" : "Opening the official page…");
    setOutcome(null);
    try {
      const { job_id } = await api.post<any>("/api/explore/recheck", { ids: [id] });
      stream(
        `/api/jobs/${job_id}/events`,
        (ev) => ev.message && setChecking(ev.message),
        (r) => {
          setChecking(null);
          setOutcome((r?.results || [])[0] || { outcome: "unreachable" });
          load();
          onChanged?.();
        },
      );
    } catch (e: any) {
      setChecking(null);
      setErr(e.message);
    }
  };

  const on = tracked.includes(id);
  const S = d?.sections || {};
  const canCheck = d && (d.tier === "proven" || d.source_url?.includes("myscheme.gov.in"));
  return (
    <Modal open onClose={onClose} title={d ? (lang === "hi" && d.name_hi) || d.name : "…"} wide>
      {!d ? (
        err ? (
          <ErrorNote error={err} />
        ) : (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {d.you_qualify && (
              <span className="chip bg-teal-600 text-white">
                <CheckCircle2 className="h-3 w-3" /> {t("youQualify")}
              </span>
            )}
            <StatusChip it={d} />
            <span className="chip bg-ink-50 text-ink-700">
              {d.state || d.ministry || t("central")}
            </span>
            {(d.cat_labels || []).map((c: string) => (
              <span key={c} className="chip bg-ink-50 text-ink-500">
                {c}
              </span>
            ))}
            {(d.group_labels || []).slice(0, 4).map((g: string) => (
              <span key={g} className="chip bg-ink-50 text-ink-500">
                {g}
              </span>
            ))}
          </div>

          {d.benefit && (
            <div className="rounded-2xl bg-teal-50 p-4">
              <div className="label text-teal-700">{t("benefit")}</div>
              <div className="mt-1 text-lg font-bold text-teal-900">{d.benefit}</div>
              {d.summary && d.summary !== d.benefit && (
                <p className="mt-1 text-sm text-ink-700">{d.summary}</p>
              )}
            </div>
          )}

          {d.tier === "proven" && (
            <button
              className="btn-ghost w-full justify-between"
              onClick={() => {
                onClose();
                go("home");
              }}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-teal-600" /> {t("seeProof")}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {d.deadline_source && (
            <div className="rounded-2xl border border-coral-100 bg-coral-50/50 p-4 text-sm">
              <div className="label text-coral-600">{t("officialDates")}</div>
              <div className="mt-1 text-ink-900">{d.deadline_text}</div>
              <a
                href={d.deadline_source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500 hover:underline"
              >
                {d.deadline_source.name} ·{" "}
                {lang === "hi" ? "TinyFish Fetch से पढ़ा" : "read by TinyFish Fetch"}{" "}
                {d.deadline_source.read_at ? ago(d.deadline_source.read_at) : ""}{" "}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {!d.deadline && d.tier !== "listed" && (
            <p className="text-xs text-ink-500">
              {lang === "hi"
                ? "आधिकारिक पेज पर कोई अंतिम तिथि नहीं दी गई है — आवेदन से पहले आधिकारिक पेज देखें।"
                : "The official page lists no closing date — many schemes accept applications all year. Check the official page before applying."}
            </p>
          )}

          {d.tier === "listed" && (
            <div className="rounded-2xl border border-dashed border-amber-400 bg-amber-50/50 p-4 text-sm">
              <p className="text-ink-700">
                {lang === "hi"
                  ? "यह योजना लाइव खोज में मिली; इसका पूरा विवरण अभी नहीं पढ़ा गया।"
                  : "This scheme was found by a live search; its full details haven't been read yet."}
              </p>
              {health?.tinyfish?.live && canCheck && (
                <button className="btn-amber mt-3" disabled={!!checking} onClick={recheck}>
                  {checking ? <Spinner /> : <Globe className="h-4 w-4" />} {t("readFull")}
                </button>
              )}
            </div>
          )}

          <Block title={t("whoCan")} text={S.eligibility} bullets />
          <Block title={t("about")} text={S.details} />
          <Block
            title={t("benefit")}
            text={S.benefits && S.benefits !== d.benefit ? S.benefits : ""}
            bullets
          />
          <Block
            title={t("documents")}
            text={S.documents}
            bullets
            icon={<FileText className="h-3.5 w-3.5 text-ink-300" />}
          />
          <Block title={t("howApply")} text={S.application} numbered />
          <Block title={t("notFor")} text={S.exclusions} bullets collapsed />

          {/* re-check & outcome */}
          {(checking || outcome) && (
            <div
              className={`rounded-xl p-3 text-sm ${outcome?.outcome === "changed" ? "bg-coral-50 text-coral-600" : outcome?.outcome === "unreachable" ? "bg-amber-50 text-amber-600" : "bg-teal-50 text-teal-800"}`}
            >
              {checking ? (
                <span className="flex items-center gap-2">
                  <Spinner /> {checking}
                </span>
              ) : outcome.outcome === "changed" ? (
                <>
                  <b>{t("changedNote")}:</b>{" "}
                  {(outcome.changes || []).map((c: any) => c.what).join(", ")}
                </>
              ) : outcome.outcome === "unreachable" ? (
                t("unreachable")
              ) : outcome.outcome === "read" ? (
                lang === "hi" ? (
                  "पूरा विवरण पढ़ लिया गया"
                ) : (
                  "Full details read from the official page"
                )
              ) : (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> {t("unchanged")}
                </span>
              )}
              {outcome?.replay && (
                <span className="ml-2">
                  <ModeBadge replay />
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
            <button className={on ? "btn-primary" : "btn-ghost"} onClick={() => toggleTrack(id)}>
              {on ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}{" "}
              {on ? t("tracking") : t("track")}
            </button>
            {canCheck && d.tier !== "listed" && health?.tinyfish?.live && (
              <button className="btn-ghost" disabled={!!checking} onClick={recheck}>
                {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("recheck")}
              </button>
            )}
            {(d.apply_url || d.source_url) && (
              <a
                className="btn-ghost"
                href={d.apply_url || d.source_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" />{" "}
                {d.apply_url ? t("applyNow") : t("openOfficial")}
              </a>
            )}
          </div>

          <div className="space-y-1 text-xs text-ink-500">
            <div>
              {t("readBy")}{" "}
              <a className="underline" href={d.source_url} target="_blank" rel="noreferrer">
                {d.source_name}
              </a>
              {d.tier === "verified" && (
                <>
                  {" "}
                  · {lang === "hi" ? "TinyFish Browser से पढ़ा" : "read by TinyFish Browser"}{" "}
                  {d.read_at}
                </>
              )}
              {d.tier === "proven" && d.read_at && (
                <>
                  {" "}
                  · {lang === "hi" ? "सत्यापित" : "verified"} {d.read_at}
                </>
              )}
              {d.checked_at && (
                <>
                  {" "}
                  · {lang === "hi" ? "अंतिम जाँच" : "last checked"} {ago(d.checked_at)}
                </>
              )}
            </div>
            {d.myscheme_url && (
              <div>
                <a className="underline" href={d.myscheme_url} target="_blank" rel="noreferrer">
                  myScheme page
                </a>
              </div>
            )}
            {d.official_links?.length > 0 && (
              <div className="flex flex-wrap gap-x-3">
                {d.official_links.map((l: any) => (
                  <a
                    key={l.url}
                    className="underline"
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l.text || new URL(l.url).hostname}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Block({
  title,
  text,
  bullets,
  numbered,
  collapsed,
  icon,
}: {
  title: string;
  text?: string;
  bullets?: boolean;
  numbered?: boolean;
  collapsed?: boolean;
  icon?: React.ReactNode;
}) {
  const { t } = useApp();
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const [open, setOpen] = useState(!collapsed);
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const limit = numbered ? 6 : 5;
  const shown = all ? lines : lines.slice(0, limit);
  const isHead = (l: string) =>
    l.length < 60 &&
    (/:$/.test(l) ||
      /^(online|offline|online - via cscs|registration|application|conditions|other benefits|note|indicative documents|mandatory documents|for (fresh|renewal).*)$/i.test(
        l,
      ));
  return (
    <div>
      <button className="label mb-1.5 flex items-center gap-1" onClick={() => setOpen(!open)}>
        {title}
        {collapsed && <ChevronRight className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`} />}
      </button>
      {open && (
        <>
          {bullets || numbered ? (
            <ul className="space-y-1.5 text-sm text-ink-700">
              {shown.map((l, i) =>
                isHead(l) && lines.length > 2 && i < shown.length - 1 ? (
                  <li key={i} className="pt-1 font-semibold text-ink-900">
                    {l}
                  </li>
                ) : (
                  <li key={i} className="flex gap-2">
                    {icon || (
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                    )}
                    <span>{l}</span>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-ink-700">{shown.join(" ")}</p>
          )}
          {lines.length > limit && (
            <button
              className="mt-1 text-xs font-semibold text-teal-700 hover:underline"
              onClick={() => setAll(!all)}
            >
              {all ? t("showLess") : `${t("showAll")} (${lines.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
