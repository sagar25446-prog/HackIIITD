import { useEffect, useState } from "react";
import Documents from "./Documents";
import CaseFields from "./CaseFields";
import { shareRequest } from "./sharing";
import { Case, Workspace } from "./types";
import { api } from "../api";
import { DiffTable, diffFields } from "./diff";
export default function Helper() {
  const [lang, setLang] = useState("en");
  const hi = lang === "hi";
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<Case | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [success, setSuccess] = useState("");
  const id = location.pathname.split("/")[2];
  const token = location.hash.slice(1);
  const load = async () => {
    try {
      const d = await shareRequest("/" + id, token);
      setData(d);
      setDraft(d.snapshot.case);
      setConflict(null);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const previewKey = JSON.stringify({
    draft,
    people: data?.snapshot.people,
    documents: data?.snapshot.documents,
  });
  useEffect(() => {
    let active = true;
    if (!draft || !data) return;
    setPlan(null);
    const timer = setTimeout(() => {
      const ws: Workspace = {
        version: 2,
        people: data.snapshot.people,
        household: [],
        documents: data.snapshot.documents,
        cases: [draft],
      };
      api
        .post("/api/workspace/plan", ws)
        .then((p) => {
          if (active) setPlan(p);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [previewKey, refresh]);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await shareRequest("/" + id, token, "PATCH", {
        revision: data.revision,
        case: draft,
      });
      setData({ ...data, ...r });
      setDraft(r.snapshot.case);
      setError("");
      setConflict(null);
      setSuccess(hi ? "बदलाव सहेजे गए" : "Changes saved");
    } catch (e: any) {
      setError(e.message);
      if (e.status === 409) setConflict(e.detail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl p-4 pb-16">
      <header className="mb-6 flex items-center justify-between gap-3 border-b border-ink-100 pb-4">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-extrabold leading-tight">JAAGRUK</h1>
            <p className="text-xs text-ink-500">
              {hi ? "साझा मामला · सहायक दृश्य" : "Shared case · helper view"}
            </p>
          </div>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setLang(hi ? "en" : "hi")}>
          {hi ? "English" : "हिंदी"}
        </button>
      </header>
      <p className="mb-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">
        {hi
          ? "यह निजी लिंक केवल चुने हुए मामले को बदल सकता है। आपके बदलाव सहायक की जानकारी के रूप में दर्ज होते हैं और मालिक को दिखते हैं।"
          : "This private link can edit only the selected case. Your edits are recorded as helper-reported information and shown to the owner."}
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-coral-50 p-3">
          {error}
        </p>
      )}
      {draft && data && (
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-bold">{draft.title}</h2>
          <p>
            {data.snapshot.people.find((p: any) => p.id === draft.applicant_id)?.name} ·{" "}
            {hi ? "लिंक समाप्ति" : "Link expires"}{" "}
            {new Date(data.expires_at * 1000).toLocaleString(hi ? "hi-IN" : "en-IN")}
          </p>
          <CaseFields value={draft} people={data.snapshot.people} lang={lang} onChange={setDraft} />
          <h3 className="font-bold">
            {hi ? "साझा दस्तावेज़ उपलब्धता" : "Shared document metadata"}
          </h3>
          {plan && (
            <Documents
              value={draft}
              requirements={plan.cases[0].requirements}
              people={data.snapshot.people}
              globalDocs={data.snapshot.documents}
              lang={lang}
              onChange={setDraft}
            />
          )}
          {conflict && (
            <div className="rounded-xl border border-amber-400 p-3">
              <h3 className="font-bold">
                {hi ? "दो संस्करण सुरक्षित हैं" : "Both versions are preserved"}
              </h3>
              <details>
                <summary>{hi ? "तुलना देखें" : "Compare versions"}</summary>
                <DiffTable
                  rows={diffFields(draft, conflict.snapshot.case)}
                  hi={hi}
                  left={hi ? "आपका ड्राफ्ट" : "Your draft"}
                  right={hi ? "नवीनतम संस्करण" : "Latest version"}
                />
              </details>
              <button
                className="btn-ghost"
                onClick={() => {
                  setData({ ...data, revision: conflict.revision, snapshot: conflict.snapshot });
                  setConflict(null);
                }}
              >
                {hi
                  ? "मेरे बदलाव रखें और नवीनतम संस्करण पर पुनः समीक्षा करें"
                  : "Keep my draft; review against latest revision"}
              </button>
              <button className="btn-ghost" onClick={load}>
                {hi ? "नवीनतम संस्करण लोड करें" : "Load latest version"}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !!conflict} className="btn-primary" onClick={save}>
              {hi ? "बदलाव सहेजें" : "Save changes"}
            </button>
            <button className="btn-ghost" onClick={() => setRefresh((v) => v + 1)}>
              {hi ? "योजना जाँचें" : "Check the plan"}
            </button>
          </div>
          {success && <p role="status">{success}</p>}
          {plan && (
            <div className="rounded-xl bg-teal-50 p-3">
              <p>{hi ? plan.cases[0].status_hi : plan.cases[0].status_label}</p>
              <ul>
                {plan.cases[0].requirements.map((r: any) => (
                  <li key={r.id}>
                    {hi ? r.label_hi : r.label} · {r.state.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
