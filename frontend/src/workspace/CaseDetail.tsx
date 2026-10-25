import { ReactNode, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Printer,
  RefreshCw,
  Save,
  ScrollText,
  Share2,
  Wallet,
} from "lucide-react";
import { api } from "../api";
import { Callout, caseTone, Modal, Spinner } from "../components/ui";
import { KIND_LABEL } from "../pages/Home";
import { useApp } from "../state";
import { useWorkspace } from "./WorkspaceProvider";
import { diffFields, fieldLabel } from "./diff";
import { Case, Plan, uid } from "./types";
import CaseFields from "./CaseFields";
import Documents from "./Documents";
import { mergeSharedCase, sameValue, shareSnapshot } from "./scope";
import { helperUrl } from "./sharing";

export default function CaseDetail() {
  const { lang, go } = useApp();
  const hi = lang === "hi";
  const {
    workspace: ws,
    selectedCase,
    openCase,
    saveCase,
    shares,
    createShare,
    syncShare,
    revokeShare,
    setWorkspace,
  } = useWorkspace();
  const c = ws.cases.find((c) => c.id === selectedCase);
  const [draft, setDraft] = useState<Case | null>(c || null);
  const [preview, setPreview] = useState<{ key: string; value: Plan } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [relatedName, setRelatedName] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const base = useRef(c);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const old = base.current,
      current = draftRef.current;
    if (!c || old?.id !== c.id) {
      setDraft(c || null);
      setPreview(null);
      setConflict(null);
      setSaved(false);
      setSharing(false);
      setError("");
      setRelatedName("");
    } else if (!sameValue(c, old)) {
      const editable = (v: Case) => ({ ...v, events: [] });
      if (
        current &&
        old &&
        !sameValue(editable(current), editable(old)) &&
        !sameValue(editable(current), editable(c))
      ) {
        setConflict({ snapshot: { case: c }, revision: shares[c.id]?.revision });
        setError(
          hi
            ? "सहायक के बदलाव आए हैं। आपका असहेजा ड्राफ्ट सुरक्षित है; तुलना करें।"
            : "A shared update arrived. Your unsaved draft is preserved; compare the versions.",
        );
      } else setDraft(c);
    }
    base.current = c;
  }, [c]);
  const previewKey = JSON.stringify({
    draft,
    people: ws.people,
    household: ws.household,
    documents: ws.documents,
  });
  useEffect(() => {
    let active = true;
    if (!draft) return;
    const timer = setTimeout(() => {
      api
        .post<Plan>("/api/workspace/plan", { ...ws, cases: [draft] })
        .then((value) => {
          if (active) {
            setPreview({ key: previewKey, value });
            setError("");
          }
        })
        .catch((e) => {
          if (active) {
            setPreview(null);
            setError(e.message);
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [previewKey]);
  if (!draft || !c || draft.id !== c.id) return null;
  const d = draft;
  const p =
    preview?.key === previewKey
      ? preview.value.cases.find((p) => p.case_id === draft.id)
      : undefined;
  const record = shares[c.id];
  const dirty = !sameValue({ ...d, events: [] }, { ...c, events: [] });
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/api/workspace/plan", { ...ws, cases: [d] });
      await saveCase(d);
      setSaved(true);
      setError("");
      setConflict(null);
    } catch (e: any) {
      setError(e.message);
      if (e.status === 409) setConflict(e.detail);
    } finally {
      setBusy(false);
    }
  };
  const applicant = ws.people.find((x) => x.id === d.applicant_id);
  const subject = ws.people.find((x) => x.id === d.subject_id);
  const handoffs = p?.tasks.filter((t) => t.kind === "handoff") || [];
  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-primary" disabled={busy || !!conflict} onClick={save}>
        {busy ? <Spinner /> : <Save className="h-4 w-4" />} {hi ? "मामला सहेजें" : "Save case"}
      </button>
      {p?.official_url && (
        <a className="btn-ghost" href={p.official_url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> {hi ? "आधिकारिक सेवा" : "Official service"}
        </a>
      )}
      <button className="btn-ghost" onClick={() => setSharing(!sharing)} aria-expanded={sharing}>
        <Share2 className="h-4 w-4" /> {hi ? "सहायक से साझा करें" : "Share with a helper"}
      </button>
      <button
        className="btn-quiet"
        onClick={() => window.print()}
        aria-label={hi ? "प्रिंट" : "Print"}
      >
        <Printer className="h-4 w-4" />
      </button>
      <span className="ml-auto text-xs text-ink-500" role="status">
        {saved && !dirty ? (
          <span className="inline-flex items-center gap-1 text-teal-700">
            <CheckCircle2 className="h-4 w-4" /> {hi ? "सहेजा गया" : "Saved"}
          </span>
        ) : dirty ? (
          hi ? (
            "असहेजे बदलाव"
          ) : (
            "Unsaved changes"
          )
        ) : null}
      </span>
    </div>
  );
  // closing with unsaved edits asks first: Save, Discard or Keep editing
  const requestClose = () => (dirty ? setConfirmClose(true) : openCase(null));
  const snapshot = p ? shareSnapshot(ws, d, p.requirements, includeNotes) : null;
  return (
    <Modal open title={d.title} onClose={requestClose} wide footer={footer}>
      {confirmClose && (
        <div
          role="alertdialog"
          aria-label="Unsaved changes"
          ref={(el) => el?.scrollIntoView({ block: "nearest" })}
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="font-semibold">
            {hi ? "इस मामले में बिना सहेजे बदलाव हैं।" : "This case has unsaved changes."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                await save();
                setConfirmClose(false);
                openCase(null);
              }}
            >
              {hi ? "सहेजें और बंद करें" : "Save and close"}
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setConfirmClose(false);
                openCase(null);
              }}
            >
              {hi ? "बदलाव छोड़ें" : "Discard changes"}
            </button>
            <button className="btn-quiet btn-sm" onClick={() => setConfirmClose(false)}>
              {hi ? "संपादन जारी रखें" : "Keep editing"}
            </button>
          </div>
        </div>
      )}
      <div className="case-pack space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="chip bg-ink-100 text-ink-700">
            {KIND_LABEL[d.kind]?.[hi ? 1 : 0] || d.kind}
          </span>
          <span className="font-semibold">{applicant?.name}</span>
          {subject && subject.id !== applicant?.id && (
            <span className="text-ink-500">
              · {hi ? "संबंधित व्यक्ति" : "related person"}: {subject.name}
              {subject.deceased ? (hi ? " (दिवंगत)" : " (deceased)") : ""}
            </span>
          )}
          <span className="ml-auto text-xs text-ink-500">
            {hi
              ? "तैयारी सहायता — सरकारी स्वीकृति नहीं"
              : "Preparation aid — not government approval"}
          </span>
        </div>

        {p ? (
          <div
            className={`rounded-xl border p-4 ${p.status === "not_supported" ? "border-coral-200 bg-coral-50" : p.status === "preparing" ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${caseTone[p.status] || "bg-ink-100"}`}>
                {hi ? p.status_hi : (p as any).status_label}
              </span>
              {p.missing.length > 0 && (
                <span className="text-sm text-ink-600">
                  {p.missing.length} {hi ? "जवाब बाकी" : "answer(s) still needed"}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm">{hi ? p.coverage_hi : p.coverage}</p>
            {(p as any).review?.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm font-medium">
                {(p as any).review.map((v: string) => (
                  <li key={v}>• {v}</li>
                ))}
              </ul>
            )}
            {(p as any).failed?.length > 0 && (
              <p className="mt-2 text-sm">
                {hi ? "ये शर्तें मेल नहीं खातीं" : "These conditions don't match"}:{" "}
                <b>{(p as any).failed.join(", ").replaceAll("_", " ")}</b>
              </p>
            )}
          </div>
        ) : (
          <div className="skeleton h-20" />
        )}

        {d.kind === "bereavement" && !record && (
          <Block n={1} title={hi ? "दिवंगत व्यक्ति" : "The person who passed away"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">
                  {hi ? "सूची से चुनें" : "Choose from your list"}
                </span>
                <select
                  className="input"
                  value={d.subject_id || ""}
                  onChange={(e) => setDraft({ ...d, subject_id: e.target.value || null })}
                >
                  <option value="">{hi ? "चुनें" : "Choose"}</option>
                  {ws.people
                    .filter((x) => x.deceased && x.id !== d.applicant_id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <form
                className="block"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = relatedName.trim().slice(0, 80);
                  if (!name) return;
                  const id = uid();
                  const updated = { ...d, subject_id: id };
                  setWorkspace({
                    ...ws,
                    people: [
                      ...ws.people,
                      { id, name, relation: "related person", deceased: true, facts: {} },
                    ],
                    cases: ws.cases.map((x) => (x.id === d.id ? updated : x)),
                  });
                  setDraft(updated);
                  setRelatedName("");
                }}
              >
                <span className="field-label">
                  {hi ? "या नाम जोड़ें (पहचान संख्या नहीं)" : "Or add their name (no ID numbers)"}
                </span>
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={relatedName}
                    maxLength={80}
                    onChange={(e) => setRelatedName(e.target.value)}
                  />
                  <button className="btn-secondary shrink-0" disabled={!relatedName.trim()}>
                    {hi ? "जोड़ें" : "Add"}
                  </button>
                </div>
              </form>
            </div>
          </Block>
        )}

        <Block
          n={d.kind === "bereavement" && !record ? 2 : 1}
          title={hi ? "आपके जवाब" : "Your answers"}
        >
          <CaseFields
            value={d}
            people={ws.people}
            lang={lang}
            onChange={(v) => {
              setDraft(v);
              setSaved(false);
            }}
          />
        </Block>

        {error && (
          <p role="alert" className="rounded-xl bg-coral-50 p-3 text-sm text-coral-700">
            {error}
          </p>
        )}

        {p && (
          <>
            <Block
              n={d.kind === "bereavement" && !record ? 3 : 2}
              title={hi ? "न्यूनतम कागज़ी तैयारी" : "Minimum paperwork"}
            >
              {p.requirements.length === 0 ? (
                <p className="text-sm text-ink-500">
                  {p.missing.length
                    ? hi
                      ? "ऊपर के जवाब देने पर इस मामले के दस्तावेज़ यहाँ दिखेंगे।"
                      : "Answer the questions above and this case's documents appear here."
                    : hi
                      ? "इस चरण के लिए कोई दस्तावेज़ सूची नहीं।"
                      : "No document list for this step."}
                </p>
              ) : (
                <Documents
                  value={d}
                  requirements={p.requirements}
                  people={ws.people}
                  globalDocs={ws.documents}
                  lang={lang}
                  onChange={setDraft}
                />
              )}
              {(hi ? p.removed_tasks_hi : p.removed_tasks).map((t) => (
                <p className="mt-2 rounded-xl bg-teal-50 p-3 text-sm" key={t}>
                  ✓ {t}
                </p>
              ))}
            </Block>

            {handoffs.length > 0 && (
              <Block
                n={d.kind === "bereavement" && !record ? 4 : 3}
                title={hi ? "अगले कदम" : "Next steps"}
              >
                <ul className="space-y-2">
                  {handoffs.map((t) => (
                    <li key={t.id}>
                      <label className="flex items-start gap-2 rounded-xl border border-ink-100 p-3">
                        <input
                          type="checkbox"
                          checked={d.completed_tasks.includes(t.id)}
                          onChange={(e) =>
                            setDraft({
                              ...d,
                              completed_tasks: e.target.checked
                                ? [...d.completed_tasks, t.id]
                                : d.completed_tasks.filter((x) => x !== t.id),
                            })
                          }
                        />
                        <span>{hi ? t.label_hi : t.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            <div className="flex flex-wrap items-start gap-3 rounded-xl bg-ink-50 p-3 text-sm">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
              <div className="min-w-0 flex-1">
                <a className="link" href={p.source_url} target="_blank" rel="noreferrer">
                  {p.source_title}
                </a>
                <p className="text-xs text-ink-500">
                  {hi ? "स्रोत जाँचा" : "Source checked"}: {p.source_checked} ·{" "}
                  {hi ? "नियम संस्करण" : "Rule version"}: {p.rule_version}
                </p>
              </div>
              {(d.kind === "bereavement" || d.kind === "wapsi") && (
                <button
                  className="btn-ghost btn-sm print-hide"
                  onClick={() => {
                    openCase(null);
                    go("wapsi", d.kind === "wapsi" ? { caseId: d.id } : null);
                  }}
                >
                  <Wallet className="h-4 w-4" />{" "}
                  {d.kind === "wapsi"
                    ? hi
                      ? "प्रमाण और अगले कदम"
                      : "Evidence and next steps"
                    : hi
                      ? "भूला हुआ पैसा खोजें"
                      : "Look for forgotten money"}
                </button>
              )}
            </div>

            {sharing && (
              <div className="space-y-3 rounded-xl border border-teal-200 p-4 print-hide">
                <h3 className="flex items-center gap-2 font-bold">
                  <Link2 className="h-4 w-4 text-teal-700" />
                  {hi ? "निजी सहायक लिंक · 24 घंटे" : "Private helper link · 24 hours"}
                </h3>
                <p className="text-sm text-ink-600">
                  {hi
                    ? "लिंक बनाने पर यह मामला सहेजा जाता है। लिंक वाला व्यक्ति केवल इस मामले के जवाब, दस्तावेज़ की उपलब्धता, साझा नोट्स और चरण बदल सकता है। परिवार के बाकी लोग साझा नहीं होते।"
                    : "Creating the link saves this case. Anyone with the link can edit only this case's answers, document availability, shared notes and stage. The rest of the family is never shared."}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeNotes}
                    onChange={(e) => setIncludeNotes(e.target.checked)}
                  />
                  {hi ? "मौजूदा नोट्स शामिल करें" : "Include existing notes"}
                </label>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-teal-700">
                    {hi ? "साझा होने वाली जानकारी देखें" : "Review the exact data to be shared"}
                  </summary>
                  {snapshot && (
                    <dl className="mt-2 space-y-1 rounded-lg bg-ink-50 p-3 text-sm">
                      <div>
                        <dt className="inline font-semibold">{hi ? "लोग" : "People"}: </dt>
                        <dd className="inline">
                          {snapshot.people.map((x: any) => x.name).join(", ")}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">{hi ? "जवाब" : "Answers"}: </dt>
                        <dd className="inline">
                          {Object.entries(snapshot.case.answers)
                            .filter(([, v]) => v !== null && v !== "")
                            .map(([k, v]) => `${fieldLabel(k, hi)}: ${String(v)}`)
                            .join(" · ") || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">{hi ? "दस्तावेज़" : "Documents"}: </dt>
                        <dd className="inline">
                          {snapshot.case.documents.length +
                            " " +
                            (hi ? "दस्तावेज़ की उपलब्धता" : "document availability entries")}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">{hi ? "नोट्स" : "Notes"}: </dt>
                        <dd className="inline">
                          {snapshot.case.notes
                            ? hi
                              ? "शामिल"
                              : "included"
                            : hi
                              ? "शामिल नहीं"
                              : "not included"}
                        </dd>
                      </div>
                      <div className="text-xs text-ink-600">
                        {hi
                          ? "खोज के परिणाम सहायक केवल देख सकते हैं, बदल नहीं सकते।"
                          : "Helpers can read search evidence but never change it."}
                      </div>
                    </dl>
                  )}
                </details>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await createShare(d, includeNotes, p.requirements);
                      setError("");
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {record
                    ? hi
                      ? "पुराना लिंक बंद करके नया बनाएँ"
                      : "Revoke old link and create a new one"
                    : hi
                      ? "निजी लिंक बनाएँ"
                      : "Create private link"}
                </button>
                {record && (
                  <div className="space-y-2">
                    <label className="block text-sm">
                      <span className="field-label">
                        {hi ? "सहायक लिंक (गोपनीय रखें)" : "Helper link (keep it private)"}
                      </span>
                      <input
                        className="input font-mono text-xs"
                        readOnly
                        value={helperUrl(record)}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(helperUrl(record))
                            .then(() => setCopied(true))
                            .catch(() =>
                              setError(
                                hi
                                  ? "ऊपर से लिंक चुनकर कॉपी करें।"
                                  : "Select and copy the link above.",
                              ),
                            )
                        }
                      >
                        <Copy className="h-4 w-4" />{" "}
                        {copied
                          ? hi
                            ? "कॉपी हुआ"
                            : "Copied"
                          : hi
                            ? "लिंक कॉपी करें"
                            : "Copy link"}
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() =>
                          syncShare(d.id).catch((e) => {
                            setError(e.message);
                            if (e.status === 409) setConflict(e.detail);
                          })
                        }
                      >
                        <RefreshCw className="h-4 w-4" />{" "}
                        {hi ? "सहायक के बदलाव लाएँ" : "Get helper changes"}
                      </button>
                      <button
                        className="btn-ghost btn-sm text-coral-700"
                        onClick={() => revokeShare(d.id).catch((e) => setError(e.message))}
                      >
                        {hi ? "लिंक बंद करें" : "Revoke link"}
                      </button>
                    </div>
                    <p className="text-xs text-ink-500">
                      {hi
                        ? "localhost लिंक केवल इसी कंप्यूटर पर खुलता है; दूसरे फ़ोन के लिए HTTPS पर तैनात करें।"
                        : "A localhost link opens only on this computer; deploy over HTTPS to use it on another phone."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {conflict && (
          <Callout
            tone="warn"
            title={hi ? "दो संस्करण सुरक्षित हैं" : "Both versions are preserved"}
            action={
              <>
                <button
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await saveCase(d, conflict.revision);
                      setConflict(null);
                      setError("");
                      setSaved(true);
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  {hi ? "तुलना के बाद मेरे बदलाव लागू करें" : "After comparing, apply my draft"}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setDraft(
                      record
                        ? mergeSharedCase(d, conflict.snapshot.case, record)
                        : conflict.snapshot.case,
                    );
                    setError(
                      hi
                        ? "साझा संस्करण आपके ड्राफ्ट में है। तुलना करके लागू करें।"
                        : "The shared version is now in your draft. Compare, then apply it.",
                    );
                  }}
                >
                  {hi ? "साझा संस्करण ड्राफ्ट में लें" : "Load shared version into draft"}
                </button>
              </>
            }
          >
            {hi
              ? "मेरे और सहायक के बदलाव दोनों सुरक्षित हैं। मिलान के बाद ही सहेजें।"
              : "Your draft and the shared version are both kept. Compare before saving."}
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">
                {hi ? "संस्करण तुलना" : "Compare versions"}
              </summary>
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-1">{hi ? "फ़ील्ड" : "Field"}</th>
                    <th className="p-1">{hi ? "आपका ड्राफ्ट" : "Your draft"}</th>
                    <th className="p-1">{hi ? "साझा संस्करण" : "Shared version"}</th>
                  </tr>
                </thead>
                <tbody>
                  {diffFields(d, conflict.snapshot.case).map(([k, a, b]) => (
                    <tr key={k} className="border-t border-amber-200 align-top">
                      <td className="p-1 font-semibold">{fieldLabel(k, hi)}</td>
                      <td className="p-1">{a}</td>
                      <td className="p-1">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Callout>
        )}
        {d.events.length > 0 && (
          <section>
            <h3 className="label mb-2">{hi ? "मामले का इतिहास" : "Case timeline"}</h3>
            <ol className="space-y-2 text-sm">
              {d.events
                .slice(-10)
                .reverse()
                .map((e) => (
                  <li className="border-l-2 border-teal-200 pl-3" key={e.id}>
                    <span className="text-xs text-ink-500">
                      {new Date(e.at).toLocaleString(hi ? "hi-IN" : "en-IN")} · {e.actor}
                    </span>
                    <p>{e.text}</p>
                  </li>
                ))}
            </ol>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Block({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 font-bold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}
