import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Baby,
  Car,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Fingerprint,
  Globe,
  Home,
  IndianRupee,
  Plane,
  Search,
  Users,
} from "lucide-react";
import { api } from "../api";
import { Callout, Empty, ErrorNote, ModeBadge, PageHeader, Spinner } from "../components/ui";
import { useApp } from "../state";
import { useWorkspace } from "./WorkspaceProvider";
import { newCase } from "./types";
import { stageLabel, STATES } from "./states";

const ICON: Record<string, any> = {
  aadhaar: Fingerprint,
  pan: CreditCard,
  driving_licence: Car,
  income_certificate: IndianRupee,
  caste_certificate: Users,
  domicile_certificate: Home,
  passport: Plane,
  birth_death_certificate: Baby,
  other: Globe,
};

export default function ServicePlanner() {
  const { lang, takeIntent } = useApp();
  const hi = lang === "hi";
  const { workspace: ws, saveCase, openCase } = useWorkspace();
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const [query, setQuery] = useState("");
  // My plan can open this page with a service, or a document to look up official guidance for.
  const [initial] = useState(() => takeIntent("paperwork"));
  const [service, setService] = useState<string>(initial?.service || "aadhaar");
  const [stage, setStage] = useState("new");
  const [person, setPerson] = useState(ws.people.find((p) => !p.deceased)?.id || "");
  const stateOf = (id: string) => {
    const p = ws.people.find((p) => p.id === id);
    const shared = ws.household.find(
      (f) => f.field === "state" && f.confirmed && f.person_ids.includes(id),
    );
    return String(p?.facts.state || shared?.value || "");
  };
  const [state, setState] = useState(() => stateOf(person));
  const [guidance, setGuidance] = useState<string>(initial?.query || "");
  const [resultState, setResult] = useState<{ key: string; value: any } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const contextKey = JSON.stringify({ person, state, service, stage, guidance });
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const requestId = useRef(0);
  const result = resultState?.key === contextKey ? resultState.value : null;
  useEffect(() => {
    let active = true;
    api
      .get<any>("/api/workspace/services")
      .then((r) => {
        if (active) setCatalog(r.services);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const item = catalog[service];
  useEffect(() => {
    if (item && !item.stages.includes(stage)) setStage(item.stages[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  // Results from a previous person, state or service never appear under a new selection.
  useEffect(() => {
    setResult(null);
    setError("");
    setBusy(false);
    ++requestId.current;
    return () => {
      ++requestId.current;
    };
  }, [contextKey]);

  const coverage =
    item?.states === "national"
      ? hi
        ? "पूरे भारत के लिए समीक्षित"
        : "Reviewed for all of India"
      : item?.states === "official-guidance"
        ? hi
          ? "आधिकारिक मार्गदर्शन — राज्य से पुष्टि करें"
          : "Official guidance — confirm with your state"
        : hi
          ? `${item?.states} के लिए समीक्षित`
          : `Reviewed for ${item?.states}`;
  const reviewedHere =
    item && (item.states === "national" || item.states.toLowerCase() === state.toLowerCase());
  const services = Object.entries(catalog).filter(([key, v]) =>
    (key + " " + v.name + " " + v.name_hi).toLowerCase().includes(query.toLowerCase()),
  );
  const findGuidance = async () => {
    const key = contextKey,
      id = ++requestId.current;
    const active = () => id === requestId.current && key === currentContext.current;
    setBusy(true);
    setResult(null);
    try {
      const value = await api.post("/api/workspace/paperwork-guidance", {
        service: guidance || item?.name,
        state,
      });
      if (active()) {
        setResult({ key, value });
        setError("");
      }
    } catch (e: any) {
      if (active()) setError(e.message);
    } finally {
      if (active()) setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title={hi ? "किस काम के लिए कौन से दस्तावेज़?" : "What paperwork do I need?"}
        sub={
          hi
            ? "आधार, पैन, लाइसेंस, प्रमाण पत्र — सेवा, व्यक्ति और राज्य चुनें। आपकी स्थिति के हिसाब से न्यूनतम सूची बनेगी। पहचान संख्या या फ़ाइल नहीं चाहिए।"
            : "Aadhaar, PAN, licences, certificates — pick the service, the person and the state. You get the minimum checklist for your situation. No ID numbers or files needed."
        }
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-5 w-5 text-ink-400" />
            <input
              className="input pl-11"
              placeholder={
                hi ? "सेवा खोजें: आधार, पैन, लाइसेंस…" : "Search: Aadhaar, PAN, licence…"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setGuidance(e.target.value);
              }}
              aria-label={hi ? "सेवा खोजें" : "Search services"}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {services.map(([key, v]) => {
              const Icon = ICON[key] || ClipboardList;
              return (
                <button
                  key={key}
                  aria-pressed={service === key}
                  className={`flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm font-semibold transition ${service === key ? "border-teal-600 bg-teal-50 text-teal-900 ring-2 ring-teal-100" : "border-ink-200 bg-white hover:border-teal-200"}`}
                  onClick={() => setService(key)}
                >
                  <Icon className="h-5 w-5 shrink-0 text-teal-700" />
                  <span className="leading-snug">{hi ? v.name_hi : v.name}</span>
                </button>
              );
            })}
          </div>
          {Object.keys(catalog).length > 0 && services.length === 0 && (
            <p className="mt-3 text-sm text-ink-500">
              {hi
                ? "यह सेवा सूची में नहीं है — दाईं ओर आधिकारिक मार्गदर्शन खोजें।"
                : "That service isn't in the list — search official guidance on the right."}
            </p>
          )}
        </section>

        <section className="space-y-4 lg:col-span-3">
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">{hi ? item?.name_hi : item?.name}</h2>
              {item && (
                <span
                  className={`chip ${reviewedHere ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> {coverage}
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="field-label">{hi ? "किसके लिए" : "For whom"}</span>
                <select
                  className="input"
                  value={person}
                  onChange={(e) => {
                    setPerson(e.target.value);
                    setState(stateOf(e.target.value));
                  }}
                >
                  {ws.people
                    .filter((p) => !p.deceased)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span className="field-label">{hi ? "राज्य" : "State"}</span>
                <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">{hi ? "चुनें" : "Choose"}</option>
                  {[...STATES, ...(state && !STATES.includes(state) ? [state] : [])].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {item?.stages?.length > 1 && (
              <div>
                <span className="field-label">{hi ? "आवेदन चरण" : "What do you need?"}</span>
                <div className="flex flex-wrap gap-2">
                  {item.stages.map((s: string) => (
                    <button
                      key={s}
                      aria-pressed={stage === s}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${stage === s ? "border-teal-600 bg-teal-600 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-teal-200"}`}
                      onClick={() => setStage(s)}
                    >
                      {stageLabel(s, hi)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {item && !reviewedHere && state && (
              <Callout tone="warn">
                {hi
                  ? `${state} के लिए समीक्षित सूची नहीं है। चेकलिस्ट सामान्य श्रेणियाँ दिखाएगी — नीचे आधिकारिक मार्गदर्शन भी खोजें।`
                  : `There is no reviewed checklist for ${state}. The checklist shows general categories — also search the official guidance below.`}
              </Callout>
            )}
            <button
              className="btn-primary w-full sm:w-auto"
              disabled={!person || !state || !item}
              onClick={async () => {
                const c = newCase(
                  "paperwork",
                  person,
                  `${hi ? item?.name_hi : item?.name} · ${stageLabel(stage, hi)}`,
                );
                c.answers = { service, application_stage: stage, state };
                try {
                  await saveCase(c);
                  openCase(c.id);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              <ClipboardList className="h-4 w-4" />
              {hi ? "मेरी दस्तावेज़ सूची बनाएँ" : "Build my document checklist"}
            </button>
          </div>

          <div className="card space-y-3 p-5">
            <h3 className="font-bold">
              {hi ? "कोई और सेवा या स्थानीय नियम?" : "Another service, or a local rule?"}
            </h3>
            <p className="text-sm text-ink-600">
              {hi
                ? "काम का नाम लिखें। TinyFish केवल .gov.in / .nic.in पर आधिकारिक मार्गदर्शन खोजता है; परिणाम सुझाव हैं, अनिवार्य सूची नहीं।"
                : "Describe the service. TinyFish searches only .gov.in / .nic.in for official guidance; results are leads, not a mandatory checklist."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input"
                maxLength={100}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder={
                  hi
                    ? "जैसे उत्तर प्रदेश निवास प्रमाण पत्र"
                    : "For example: Uttar Pradesh domicile certificate"
                }
                aria-label={hi ? "सेवा का नाम" : "Service name"}
              />
              <button
                className="btn-ghost shrink-0"
                disabled={busy || !state || !(guidance || item?.name)}
                onClick={findGuidance}
              >
                {busy ? <Spinner /> : <Globe className="h-4 w-4" />}
                {hi ? "आधिकारिक मार्गदर्शन खोजें" : "Find official guidance"}
              </button>
            </div>
            {!state && (
              <p className="text-xs text-ink-500">
                {hi ? "पहले राज्य चुनें।" : "Choose a state first."}
              </p>
            )}
            <ErrorNote error={error} />
            {result && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  {result.status !== "unavailable" && (
                    <ModeBadge replay={result.status === "saved_recording"} />
                  )}
                  {result.note}
                </div>
                {result.items.length === 0 ? (
                  <Callout tone="warn">
                    {hi
                      ? "कोई आधिकारिक पेज नहीं मिला। कोई आवश्यकता गढ़ी नहीं गई — राज्य के ई-डिस्ट्रिक्ट या संबंधित विभाग से पुष्टि करें।"
                      : "No official page was found. No requirements were invented — confirm with your state's e-District portal or the department."}
                  </Callout>
                ) : (
                  result.items.map((r: any) => (
                    <a
                      key={r.url}
                      className="block rounded-xl border border-ink-100 p-3 hover:border-teal-300"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <b className="flex items-center gap-1.5 text-sm text-teal-800">
                        {r.title} <ExternalLink className="h-3.5 w-3.5" />
                      </b>
                      <p className="mt-1 line-clamp-3 text-xs text-ink-600">{r.snippet}</p>
                      <p className="mt-1 text-[11px] text-ink-400">{new URL(r.url).hostname}</p>
                    </a>
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="section-title mb-2">
              {hi ? "आपकी कागज़ी तैयारी" : "Your paperwork cases"}
            </h3>
            {ws.cases.filter((c) => c.kind === "paperwork").length === 0 ? (
              <Empty>
                {hi
                  ? "बनाई गई दस्तावेज़ सूचियाँ यहाँ रहेंगी।"
                  : "Checklists you build are kept here."}
              </Empty>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ws.cases
                  .filter((c) => c.kind === "paperwork")
                  .map((c) => {
                    const Icon = ICON[String(c.answers.service)] || ClipboardList;
                    return (
                      <button
                        className="card card-hover flex items-center gap-3 p-4 text-left"
                        key={c.id}
                        onClick={() => openCase(c.id)}
                      >
                        <Icon className="h-5 w-5 shrink-0 text-teal-700" />
                        <span className="min-w-0">
                          <b className="block truncate">{c.title}</b>
                          <span className="block text-xs text-ink-500">
                            {ws.people.find((p) => p.id === c.applicant_id)?.name} ·{" "}
                            {String(c.answers.state || "")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
