import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, Profile } from "./api";
import { Key, Lang, t as tr } from "./i18n";

export type Page = "home" | "life" | "wapsi" | "scam" | "radar" | "ask" | "ops";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
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
  go: (p: Page) => void;
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

export function Provider({ children }: { children: ReactNode }) {
  const [lang, setLangS] = useState<Lang>(() => load("jk.lang", "en"));
  const [profile, setProfileS] = useState<Profile | null>(() => load("jk.profile", null));
  const [personaId, setPersonaId] = useState<string | null>(() => load("jk.persona", null));
  const [wapsiFound, setWapsiFoundS] = useState<number>(() => load("jk.wapsi", 0));
  const [evaluation, setEvaluation] = useState<any | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [catalog, setCatalog] = useState<any | null>(null);
  const [health, setHealth] = useState<any | null>(null);
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || "home");

  const setLang = (l: Lang) => {
    setLangS(l);
    save("jk.lang", l);
    document.documentElement.lang = l === "hi" ? "hi" : "en";
  };
  const setProfile = (p: Profile | null, pid: string | null = null) => {
    setProfileS(p);
    setPersonaId(pid);
    save("jk.profile", p);
    save("jk.persona", pid);
    setWapsiFound(0);
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
  const go = (p: Page) => {
    setPage(p);
    location.hash = p;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const refresh = useCallback(async () => {
    if (!profile) return setEvaluation(null);
    setEvaluating(true);
    try {
      setEvaluation(await api.post("/api/evaluate", { profile, wapsi_found_inr: wapsiFound }));
    } finally {
      setEvaluating(false);
    }
  }, [profile, wapsiFound]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    api.get("/api/catalog").then(setCatalog).catch(() => null);
    api.get("/api/health").then(setHealth).catch(() => null);
    const onHash = () => setPage((location.hash.slice(1) as Page) || "home");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t: (k) => tr(k, lang), profile, setProfile, patchProfile, personaId, evaluation, evaluating, refresh,
      wapsiFound, setWapsiFound, catalog, health, page, go }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, profile, personaId, evaluation, evaluating, refresh, wapsiFound, catalog, health, page]
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error("useApp outside Provider");
  return c;
};

/** Pick the Hindi variant of a field when available (e.g. name / name_hi). */
export const hi = (o: any, field: string, lang: Lang) => (lang === "hi" && o?.[field + "_hi"]) || o?.[field];
