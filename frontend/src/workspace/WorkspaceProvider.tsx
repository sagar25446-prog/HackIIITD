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
import { api } from "../api";
import { useApp } from "../state";
import { Case, Plan, Requirement, Workspace } from "./types";
import { indiaToday } from "./calendarDates";
import { addEvent, migrate, persistWorkspace, loadWorkspace } from "./storage";
import { ShareError, ShareRecord, shareRequest } from "./sharing";
import {
  mergeScopedWorkspace,
  mergeSharedCase,
  mergeWorkspaceResult,
  primaryPerson,
  sameValue,
  scopeWorkspace,
  sharedCaseInput,
  shareSnapshot,
  ViewMode,
} from "./scope";

type Context = {
  mode: ViewMode;
  setMode: (value: ViewMode) => void;
  fullWorkspace: Workspace;
  workspace: Workspace;
  setWorkspace: (value: Workspace | ((ws: Workspace) => Workspace)) => void;
  replaceIfCurrent: (expected: Workspace, next: Workspace) => boolean;
  plan: Plan | null;
  error: string;
  storageError: string;
  busy: boolean;
  refresh: () => void;
  selectedCase: string | null;
  openCase: (id: string | null) => void;
  saveCase: (c: Case, revisionOverride?: number) => Promise<void>;
  shares: Record<string, ShareRecord>;
  createShare: (c: Case, notes: boolean, requirements: Requirement[]) => Promise<ShareRecord>;
  syncShare: (caseId: string) => Promise<void>;
  revokeShare: (caseId: string) => Promise<void>;
  reset: () => Promise<void>;
};
const C = createContext<Context | null>(null);
const loadShares = (): Record<string, ShareRecord> => {
  try {
    const value = JSON.parse(localStorage.getItem("jaagruk.shares.v1") || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (Object.fromEntries(
          Object.entries(value).filter(
            ([, r]: [string, any]) =>
              r &&
              typeof r.id === "string" &&
              typeof r.owner_token === "string" &&
              typeof r.helper_token === "string" &&
              Number.isInteger(r.revision),
          ),
        ) as Record<string, ShareRecord>)
      : {};
  } catch {
    return {};
  }
};
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { profile, setProfile } = useApp();
  const [loaded] = useState(() => loadWorkspace(profile));
  const [workspace, setWorkspaceState] = useState<Workspace>(loaded.workspace);
  const [planState, setPlanState] = useState<{ key: string; plan: Plan } | null>(null);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(loaded.error);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [selectedCase, openCase] = useState<string | null>(null);
  const [shares, setShares] = useState(loadShares);
  const [mode, setModeState] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem("jaagruk.mode") === "family" ? "family" : "personal";
    } catch {
      return "personal";
    }
  });
  const current = useRef(workspace);
  current.current = workspace;
  const shared = useRef(shares);
  shared.current = shares;
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const setWorkspace = (update: Workspace | ((ws: Workspace) => Workspace)) => {
    const next = typeof update === "function" ? update(current.current) : update;
    current.current = next;
    setWorkspaceState(next);
  };
  const ownerId = primaryPerson(workspace);
  const scoped = useMemo(() => scopeWorkspace(workspace, mode), [workspace, mode]);
  const serialized = JSON.stringify(scoped);
  const planKey = serialized + ":" + version;
  const plan = planState?.key === planKey ? planState.plan : null;
  const setMode = (value: ViewMode) => {
    currentMode.current = value;
    setModeState(value);
    openCase(null);
    setError("");
    try {
      localStorage.setItem("jaagruk.mode", value);
    } catch {
      setStorageError("Mode preference is only saved in memory.");
    }
  };
  const publicSet = (update: Workspace | ((ws: Workspace) => Workspace)) => {
    const base = current.current,
      view = scopeWorkspace(base, mode);
    const next = typeof update === "function" ? update(view) : update;
    const merged = mergeScopedWorkspace(base, next, mode);
    current.current = merged;
    setWorkspace(merged);
  };
  const replaceIfCurrent = (expected: Workspace, next: Workspace) => {
    if (currentMode.current !== mode) return false;
    const merged = mergeWorkspaceResult(current.current, expected, next, mode);
    if (!merged) return false;
    setWorkspace(merged);
    return true;
  };
  useEffect(() => {
    if (profile && workspace.people.length === 0) setWorkspace(migrate(profile));
  }, [profile]);
  useEffect(() => {
    if (loaded.canPersist) setStorageError(persistWorkspace(workspace) || loaded.error);
  }, [workspace]);
  const storeShares = (value: Record<string, ShareRecord>) => {
    setShares(value);
    shared.current = value;
    try {
      localStorage.setItem("jaagruk.shares.v1", JSON.stringify(value));
    } catch {
      setStorageError(
        "Link management is only in memory. Keep this page open to revoke your links.",
      );
    }
  };
  useEffect(() => {
    if (!workspace.people.length) return;
    const head = workspace.people.find((p) => p.id === ownerId);
    if (!head) return;
    const others = mode === "family" ? workspace.people.filter((p) => p.id !== ownerId) : [];
    const person = (p: typeof head) => {
      const household = Object.fromEntries(
        workspace.household
          .filter((f) => f.confirmed && f.person_ids.includes(p.id))
          .map((f) => [f.field, f.value]),
      );
      const docs = Object.fromEntries(
        workspace.documents
          .filter(
            (d) =>
              d.person_id === p.id &&
              d.state === "available" &&
              (!d.expires_on || d.expires_on >= indiaToday()) &&
              (!["doc_domicile_certificate", "doc_voter_id", "doc_address_proof"].includes(
                d.kind,
              ) ||
                !d.issued_state ||
                d.issued_state === p.facts.state),
          )
          .map((d) => [d.kind, true]),
      );
      return {
        ...household,
        ...p.facts,
        ...docs,
        id: p.id,
        name: p.name,
        relation: p.relation,
        deceased: p.deceased,
      };
    };
    const next = {
      ...person(head),
      family: others.map(person),
      life_events: scoped.cases
        .map(
          (c) =>
            (
              ({
                bereavement: "death_in_family",
                retirement: "turned_60",
                education: "passed_class_12",
                moving: "moving",
              }) as Record<string, string>
            )[c.kind],
        )
        .filter(Boolean),
    };
    if (!sameValue(next, profile)) setProfile(next);
  }, [workspace.people, workspace.household, workspace.documents, workspace.cases, mode, ownerId]);
  useEffect(() => {
    let active = true;
    setError("");
    setBusy(true);
    const timer = setTimeout(() => {
      api
        .post<Plan>("/api/workspace/plan", scoped)
        .then((p) => {
          if (active) setPlanState({ key: planKey, plan: p });
        })
        .catch((e) => {
          if (active) {
            setPlanState(null);
            setError(e.message);
          }
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [planKey]);
  const refresh = () => setVersion((v) => v + 1);
  const saveCase = async (c: Case, revisionOverride?: number) => {
    const record = shared.current[c.id];
    let next = addEvent(c, "Updated preparation details");
    if (record) {
      const input = sharedCaseInput(c, record);
      const r = await shareRequest("/" + record.id, record.owner_token, "PATCH", {
        revision: revisionOverride ?? record.revision,
        case: input,
      });
      next = mergeSharedCase(c, r.snapshot.case, record);
      storeShares({
        ...shared.current,
        [c.id]: { ...record, revision: r.revision, lastSyncedCase: r.snapshot.case },
      });
    }
    setWorkspace((w) => ({
      ...w,
      cases: w.cases.some((x) => x.id === c.id)
        ? w.cases.map((x) => (x.id === c.id ? next : x))
        : [...w.cases, next],
    }));
  };
  const syncShare = useCallback(async (caseId: string) => {
    const record = shared.current[caseId];
    if (!record) return;
    const r = await shareRequest("/" + record.id, record.owner_token);
    if (r.revision === record.revision) return;
    const local = current.current.cases.find((c) => c.id === caseId);
    if (!local) return;
    if (record.lastSyncedCase && !sameValue(sharedCaseInput(local, record), record.lastSyncedCase))
      throw new ShareError(
        "Local and helper edits both exist. Open the case and compare before saving.",
        409,
        r,
      );
    const merged = mergeSharedCase(local, r.snapshot.case, record);
    setWorkspace((w) => ({ ...w, cases: w.cases.map((c) => (c.id === caseId ? merged : c)) }));
    storeShares({
      ...shared.current,
      [caseId]: { ...record, revision: r.revision, lastSyncedCase: r.snapshot.case },
    });
  }, []);
  useEffect(() => {
    const focus = () => {
      for (const id of Object.keys(shared.current)) syncShare(id).catch((e) => setError(e.message));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [syncShare]);
  const revokeShare = async (caseId: string) => {
    const record = shared.current[caseId];
    if (!record) return;
    try {
      await shareRequest("/" + record.id, record.owner_token, "DELETE");
    } catch (e: any) {
      if (e.status !== 410) throw e;
    }
    const next = { ...shared.current };
    delete next[caseId];
    storeShares(next);
  };
  const createShare = async (c: Case, notes: boolean, requirements: Requirement[]) => {
    const snapshot = shareSnapshot(current.current, c, requirements, notes);
    if (shared.current[c.id]) await revokeShare(c.id);
    const r = await shareRequest("", "", "POST", { snapshot });
    const record = { ...r, shareNotes: notes, lastSyncedCase: snapshot.case };
    setWorkspace((w) => ({
      ...w,
      cases: w.cases.map((existing) =>
        existing.id === c.id ? addEvent(c, "Shared the selected case with a helper") : existing,
      ),
    }));
    storeShares({ ...shared.current, [c.id]: record });
    // Sharing never redacts or rewrites the owner's private local case.
    return record;
  };
  const reset = async () => {
    for (const id of Object.keys(shared.current)) await revokeShare(id);
    const empty: Workspace = {
      version: 2,
      people: [],
      household: [],
      documents: [],
      cases: [],
      journal: [],
    };
    setWorkspace(empty);
    openCase(null);
    setProfile(null);
    setModeState("personal");
    try {
      for (const k of ["jaagruk.mode", "jk.persona", "jk.profile", "jk.wapsi"])
        localStorage.removeItem(k);
    } catch {
      setStorageError("Could not remove all old browser data; clear it manually if needed.");
    }
  };
  return (
    <C.Provider
      value={{
        mode,
        setMode,
        fullWorkspace: workspace,
        workspace: scoped,
        setWorkspace: publicSet,
        replaceIfCurrent,
        plan,
        error,
        storageError,
        busy,
        refresh,
        selectedCase,
        openCase,
        saveCase,
        shares,
        createShare,
        syncShare,
        revokeShare,
        reset,
      }}
    >
      {children}
    </C.Provider>
  );
}
export function useWorkspace() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("WorkspaceProvider required");
  return ctx;
}
