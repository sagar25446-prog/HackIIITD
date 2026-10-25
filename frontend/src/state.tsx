import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, Profile, stream } from "./api";
import { Key, Lang, t as tr } from "./i18n";

export const PAGES = [
  "home",
  "explore",
  "life",
  "paperwork",
  "wapsi",
  "radar",
  "calendar",
  "ask",
  "ops",
] as const;
export type Page = (typeof PAGES)[number];

export type Toast = {
  title: string;
  body?: string;
  tone?: "info" | "success" | "alert";
  action?: { label: string; page: Page };
};

/** Something a page should open with, e.g. a paperwork service chosen on My plan. */
export type Intent = Record<string, any> | null;

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key, vars?: Record<string, string | number>) => string;
  profile: Profile | null;
  setProfile: (p: Profile | null, personaId?: string | null) => void;
  patchProfile: (patch: Profile, memberIndex?: number | null) => void;
  personaId: string | null;
  evaluation: any | null;
  evaluating: boolean;
  refresh: () => Promise<void>;
  wapsiFound: number;
  setWapsiFound: (n: number) => void;
  catalog: any | null;
  health: any | null;
  page: Page;
  go: (p: Page, intent?: Intent) => void;
  intent: Intent;
  takeIntent: (page: Page) => Intent;
  tracked: string[];
  toggleTrack: (id: string) => void;
  eligibleIds: string[];
  toast: Toast | null;
  showToast: (t: Toast | null) => void;
  updates: number;
  clearUpdates: () => void;
};

const C = createContext<Ctx | null>(null);

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function save(k: string, v: unknown) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable: state just won't persist */
  }
}
const pageFromHash = (): Page => {
  const h = location.hash.slice(1);
  return (PAGES as readonly string[]).includes(h) ? (h as Page) : "home";
};

export function Provider({ children }: { children: ReactNode }) {
  const [lang, setLangS] = useState<Lang>(() => load("jk.lang", "en"));
  const [profile, setProfileS] = useState<Profile | null>(() => load("jk.profile", null));
  const [personaId, setPersonaId] = useState<string | null>(() => load("jk.persona", null));
  const [wapsiFound, setWapsiFoundS] = useState<number>(() => load("jk.wapsi", 0));
  const [evaluation, setEvaluation] = useState<any | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [catalog, setCatalog] = useState<any | null>(null);
  const [health, setHealth] = useState<any | null>(null);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [intent, setIntent] = useState<Intent>(null);
  const [tracked, setTracked] = useState<string[]>(() => load("jk.tracked", []));
  const [toast, showToast] = useState<Toast | null>(null);
  const [updates, setUpdates] = useState<number>(() => load("jk.updates", 0));
  const evalRequest = useRef(0);

  useEffect(() => {
    document.documentElement.lang = lang === "hi" ? "hi" : "en";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangS(l);
    save("jk.lang", l);
  };
  const setProfile = (p: Profile | null, pid: string | null = null) => {
    setProfileS(p);
    if (pid !== undefined && (pid !== null || p === null)) setPersonaId(pid);
    save("jk.profile", p);
    if (pid !== null || p === null) save("jk.persona", pid);
    if (p?.language === "hi" || p?.language === "en") setLang(p.language);
  };
  const patchProfile = (patch: Profile, memberIndex: number | null = null) => {
    setProfileS((cur) => {
      if (!cur) return cur;
      let next: Profile;
      if (memberIndex === null || memberIndex === undefined) next = { ...cur, ...patch };
      else {
        const fam = [...(cur.family || [])];
        fam[memberIndex] = { ...fam[memberIndex], ...patch };
        next = { ...cur, family: fam };
      }
      save("jk.profile", next);
      return next;
    });
  };
  const setWapsiFound = (n: number) => {
    setWapsiFoundS(n);
    save("jk.wapsi", n);
  };
  const toggleTrack = (id: string) => {
    setTracked((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      save("jk.tracked", next);
      return next;
    });
  };
  const addUpdates = (n: number) =>
    setUpdates((cur) => {
      save("jk.updates", cur + n);
      return cur + n;
    });
  const clearUpdates = () => {
    setUpdates(0);
    save("jk.updates", 0);
  };
  const go = (p: Page, next: Intent = null) => {
    setIntent(next ? { ...next, page: p } : null);
    setPage(p);
    if (location.hash.slice(1) !== p) location.hash = p;
  };
  const takeIntent = (p: Page) => {
    if (!intent || intent.page !== p) return null;
    const value = intent;
    // pages read their intent while rendering; clear it after this render, not during it
    setTimeout(() => setIntent((cur) => (cur === value ? null : cur)), 0);
    return value;
  };

  const refresh = useCallback(async () => {
    if (!profile) return setEvaluation(null);
    const id = ++evalRequest.current;
    setEvaluating(true);
    try {
      const r = await api.post("/api/evaluate", { profile, wapsi_found_inr: 0 });
      if (id === evalRequest.current) setEvaluation(r);
    } catch {
      if (id === evalRequest.current) setEvaluation(null);
    } finally {
      if (id === evalRequest.current) setEvaluating(false);
    }
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    api
      .get("/api/catalog")
      .then(setCatalog)
      .catch(() => null);
    api
      .get("/api/health")
      .then(setHealth)
      .catch(() => null);
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keep official deadlines and tracked schemes fresh: re-read the NSP list when it is older than
  // 6 h (free) and re-check tracked official pages not checked for 24 h. Only with a live key.
  useEffect(() => {
    if (!health?.tinyfish?.live) return;
    let stop: (() => void) | undefined;
    (async () => {
      try {
        const info = await api.get<any>("/api/explore/deadlines");
        if (!info.fetched_at || Date.now() / 1000 - info.fetched_at > 6 * 3600) {
          const r = await api.post<any>("/api/explore/deadlines/refresh");
          if (r.changes?.length) {
            addUpdates(r.changes.length);
            showToast({
              tone: "alert",
              title:
                lang === "hi"
                  ? `${r.changes.length} आधिकारिक समय-सीमा बदली`
                  : `${r.changes.length} official deadline change(s)`,
              body: r.changes[0].name,
              action: { label: lang === "hi" ? "अलर्ट" : "Alerts", page: "radar" },
            });
          }
        }
        if (!tracked.length) return;
        const { due } = await api.post<any>("/api/explore/due", { ids: tracked });
        if (!due.length) return;
        const { job_id } = await api.post<any>("/api/explore/recheck", { ids: due.slice(0, 4) });
        stop = stream(
          `/api/jobs/${job_id}/events`,
          () => null,
          (res) => {
            const changed = (res?.results || []).filter((x: any) => x.outcome === "changed");
            if (changed.length) {
              addUpdates(changed.length);
              showToast({
                tone: "alert",
                title:
                  lang === "hi"
                    ? `${changed.length} ट्रैक की गई योजना बदली`
                    : `${changed.length} tracked scheme(s) changed`,
                body:
                  lang === "hi"
                    ? "आधिकारिक पेज पर समय-सीमा या नियम बदले"
                    : "Deadline or rules updated on the official page",
                action: { label: lang === "hi" ? "अलर्ट" : "Alerts", page: "radar" },
              });
            }
          },
        );
      } catch {
        /* offline: tracked schemes keep their last checked state */
      }
    })();
    return () => stop?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.tinyfish?.live]);

  const eligibleIds = useMemo<string[]>(
    () =>
      Array.from(
        new Set(
          (evaluation?.matches || [])
            .filter((m: any) => m.decision.status === "eligible")
            .map((m: any) => m.scheme_id),
        ),
      ),
    [evaluation],
  );
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (k, vars) => {
        let s = tr(k, lang);
        for (const [name, v] of Object.entries(vars || {})) s = s.replace(`{${name}}`, String(v));
        return s;
      },
      profile,
      setProfile,
      patchProfile,
      personaId,
      evaluation,
      evaluating,
      refresh,
      wapsiFound,
      setWapsiFound,
      catalog,
      health,
      page,
      go,
      intent,
      takeIntent,
      tracked,
      toggleTrack,
      eligibleIds,
      toast,
      showToast,
      updates,
      clearUpdates,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lang,
      profile,
      personaId,
      evaluation,
      evaluating,
      refresh,
      wapsiFound,
      catalog,
      health,
      page,
      intent,
      tracked,
      eligibleIds,
      toast,
      updates,
    ],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error("useApp outside Provider");
  return c;
};

/** Pick the Hindi variant of a field when available (e.g. name / name_hi). */
export const hi = (o: any, field: string, lang: Lang) =>
  (lang === "hi" && o?.[field + "_hi"]) || o?.[field];
