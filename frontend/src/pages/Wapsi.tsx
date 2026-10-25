import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileCheck2,
  Landmark,
  ListChecks,
  Lock,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { api, stream } from "../api";
import { Callout, Empty, ErrorNote, Modal, PageHeader, Spinner, fmtDate } from "../components/ui";
import { useApp } from "../state";
import { indiaToday } from "../workspace/calendarDates";
import { choiceLabel } from "../workspace/fields";
import { primaryPerson } from "../workspace/scope";
import { Case, newCase, Observation, Outcome, uid } from "../workspace/types";
import { useWorkspace } from "../workspace/WorkspaceProvider";

const ASSETS = ["insurance", "bank_deposits", "shares_dividends", "mutual_funds", "provident_fund"];
const CAPACITIES = ["holder", "nominee", "legal_heir", "joint_holder", "unknown"];
const RELATIONS = ["self", "spouse", "child", "parent", "sibling", "other"];

export const OUTCOME: Record<Outcome, [string, string, string]> = {
  possible_record: ["Possible record", "संभावित रिकॉर्ड", "bg-teal-100 text-teal-900"],
  no_match: [
    "No match for these submitted details",
    "दिए गए विवरण से कोई मिलान नहीं",
    "bg-ink-100 text-ink-800",
  ],
  citizen_step: ["Citizen step required", "आपका कदम ज़रूरी", "bg-amber-100 text-amber-900"],
  missing_input: ["Missing input", "जानकारी अधूरी", "bg-amber-100 text-amber-900"],
  unavailable: ["Unavailable", "उपलब्ध नहीं", "bg-coral-100 text-coral-700"],
  failed: ["Failed", "विफल", "bg-coral-100 text-coral-700"],
  uncertain: ["Uncertain", "अनिश्चित", "bg-amber-100 text-amber-900"],
  cancelled: ["Cancelled", "रद्द", "bg-ink-100 text-ink-800"],
  page_opened: ["Official page opened", "आधिकारिक पेज खोला", "bg-ink-50 text-ink-700"],
};
const PROVENANCE: Record<string, [string, string]> = {
  automated_live: ["Automated check (live)", "स्वचालित जाँच (लाइव)"],
  automated_replay: ["Automated check (recorded)", "स्वचालित जाँच (रिकॉर्डेड)"],
  user_reported: ["Reported by you", "आपके द्वारा दर्ज"],
};
const STAGES: [Case["stage"], string, string][] = [
  ["preparing", "Preparing", "तैयारी"],
  ["user_reported_submitted", "I submitted the claim", "मैंने दावा जमा किया"],
  ["needs_attention", "The institution asked for more", "संस्था ने और माँगा"],
  ["user_reported_resolved", "I received a decision or receipt", "निर्णय या रसीद मिली"],
];

const L = (hi: boolean, o?: { en: string; hi: string }) => (o ? (hi ? o.hi : o.en) : "");

export default function Wapsi() {
  const { lang, takeIntent } = useApp();
  const hi = lang === "hi";
  const { workspace: ws } = useWorkspace();
  const [routes, setRoutes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const cases = ws.cases.filter((c) => c.kind === "wapsi");
  const [view, setView] = useState<"start" | "cases" | "routes">(cases.length ? "cases" : "start");
  const [openId, setOpenId] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const load = () =>
    api
      .get<any[]>("/api/recovery/routes")
      .then((r) => {
        setRoutes(r);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const intent = takeIntent("wapsi");
    if (intent?.caseId) {
      setView("cases");
      setOpenId(intent.caseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = openId ? cases.find((c) => c.id === openId) : null;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [openId, view]);

  return (
    <div>
      <PageHeader
        icon={<Wallet className="h-5 w-5" />}
        title={hi ? "वापसी — भूली हुई संपत्ति" : "Wapsi — forgotten money"}
        sub={
          hi
            ? "बीमा, बैंक जमा, शेयर-लाभांश, म्यूचुअल फंड और PF। पहले मामला बनाएँ, फिर स्वचालित जाँच या आधिकारिक साइट — और संस्था के साथ दावे की तैयारी। कोई रिकॉर्ड मिलना स्वामित्व या भुगतान नहीं है।"
            : "Insurance, bank deposits, dividends, mutual funds and PF. Create the case first, then an automated check or the official site — and prepare the claim with the right institution. A record is not ownership or payment."
        }
      />
      <div className="segmented mb-6 max-w-full overflow-x-auto scrollbar-none" role="tablist">
        {(
          [
            ["start", hi ? "मामला शुरू करें" : "Start a recovery"],
            ["cases", (hi ? "मेरे मामले" : "My recovery cases") + ` (${cases.length})`],
            ["routes", hi ? "आधिकारिक मार्ग" : "Official routes"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className="shrink-0 px-4"
            onClick={() => {
              setView(id);
              setOpenId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <Callout
          tone="danger"
          title={hi ? "मार्ग लोड नहीं हुए" : "Routes could not load"}
          action={
            <button className="btn-ghost btn-sm" onClick={load}>
              {hi ? "फिर कोशिश करें" : "Retry"}
            </button>
          }
        >
          {error}
        </Callout>
      )}
      {!routes.length && !error ? (
        <div className="skeleton h-64" />
      ) : view === "start" ? (
        <Intake
          routes={routes}
          preset={preset}
          onCreated={(id) => {
            setPreset(null);
            setView("cases");
            setOpenId(id);
          }}
        />
      ) : view === "routes" ? (
        <Routes
          routes={routes}
          onStart={(id) => {
            setPreset(id);
            setView("start");
          }}
        />
      ) : open ? (
        <RecoveryCase c={open} routes={routes} onBack={() => setOpenId(null)} />
      ) : cases.length === 0 ? (
        <Empty
          icon={<Landmark className="h-5 w-5" />}
          title={hi ? "अभी कोई वापसी मामला नहीं" : "No recovery case yet"}
          action={
            <button className="btn-primary" onClick={() => setView("start")}>
              <Plus className="h-4 w-4" /> {hi ? "मामला शुरू करें" : "Start a recovery"}
            </button>
          }
        >
          {hi
            ? "एक मामला एक संपत्ति धारक और एक आधिकारिक मार्ग के लिए होता है।"
            : "One case covers one asset holder and one official route."}
        </Empty>
      ) : (
        <CaseList cases={cases} routes={routes} onOpen={setOpenId} onNew={() => setView("start")} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list of cases
function CaseList({
  cases,
  routes,
  onOpen,
  onNew,
}: {
  cases: Case[];
  routes: any[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const { workspace: ws, plan } = useWorkspace();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-ghost btn-sm" onClick={onNew}>
          <Plus className="h-4 w-4" /> {hi ? "नया मामला" : "New recovery case"}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cases.map((c) => {
          const r = routes.find((x) => x.id === c.answers.institution);
          const holder = ws.people.find((p) => p.id === (c.subject_id || c.applicant_id));
          const claimant = ws.people.find((p) => p.id === c.applicant_id);
          const obs = [...(c.observations || [])].filter((o) => o.outcome !== "page_opened").pop();
          const p = plan?.cases.find((x) => x.case_id === c.id);
          const next = p?.tasks.find((t) => !t.done);
          return (
            <button
              key={c.id}
              className="card card-hover flex flex-col p-5 text-left"
              onClick={() => onOpen(c.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold leading-snug">
                  {r ? (hi ? r.name_hi : r.name) : c.title}
                </h3>
                {obs ? (
                  <span className={`chip shrink-0 ${OUTCOME[obs.outcome][2]}`}>
                    {OUTCOME[obs.outcome][hi ? 1 : 0]}
                  </span>
                ) : (
                  <span className="chip shrink-0 bg-ink-100 text-ink-700">
                    {hi ? "अभी जाँचा नहीं" : "Not checked yet"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-600">
                {hi ? "धारक" : "Holder"}: {holder?.name}
                {holder?.deceased ? (hi ? " (दिवंगत)" : " (passed away)") : ""} ·{" "}
                {hi ? "दावेदार" : "Claimant"}: {claimant?.name}
              </p>
              {next && (
                <p className="mt-2 text-sm font-semibold text-teal-800">
                  → {hi ? next.label_hi : next.label}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: any }) {
  return (
    <fieldset className="card p-5">
      <legend className="sr-only">{title}</legend>
      <h3 className="mb-3 flex items-center gap-2 font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-sm text-white">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </fieldset>
  );
}

// ------------------------------------------------------------------ guided intake
function Intake({
  routes,
  preset,
  onCreated,
}: {
  routes: any[];
  preset: string | null;
  onCreated: (id: string) => void;
}) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const { workspace: ws, fullWorkspace, saveCase, setWorkspace } = useWorkspace();
  const owner = primaryPerson(fullWorkspace) || ws.people[0]?.id || "";
  const presetRoute = routes.find((r) => r.id === preset);
  const [whose, setWhose] = useState<"self" | "living" | "deceased">("self");
  const [holderId, setHolderId] = useState("");
  const [newName, setNewName] = useState("");
  const [claimant, setClaimant] = useState(owner);
  const [relation, setRelation] = useState("self");
  const [capacity, setCapacity] = useState("holder");
  const [asset, setAsset] = useState(presetRoute?.asset || "insurance");
  const [route, setRoute] = useState(presetRoute?.id || "");
  const [seen, setSeen] = useState<"not_checked" | "found">("not_checked");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const living = ws.people.filter((p) => !p.deceased);
  const candidates = fullWorkspace.people.filter((p) =>
    whose === "deceased"
      ? p.deceased
      : whose === "living"
        ? !p.deceased && p.id !== claimant
        : false,
  );
  useEffect(() => {
    if (whose === "self") {
      setRelation("self");
      setCapacity("holder");
    } else {
      if (relation === "self") setRelation("spouse");
      if (capacity === "holder") setCapacity(whose === "deceased" ? "nominee" : "unknown");
    }
    setHolderId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whose]);
  const forAsset = routes.filter((r) => r.asset === asset);
  const chosen = routes.find((r) => r.id === route);
  const holderReady = whose === "self" || holderId || newName.trim().length >= 2;
  const ready = holderReady && claimant && route && relation && capacity;

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      let subject = whose === "self" ? claimant : holderId;
      if (whose !== "self" && !holderId) {
        // a related holder is attached to this case without managing a whole family profile
        subject = uid();
        setWorkspace((w) => ({
          ...w,
          people: [
            ...w.people,
            {
              id: subject,
              name: newName.trim().slice(0, 80),
              relation: "related person",
              deceased: whose === "deceased",
              facts: {},
            },
          ],
        }));
        await new Promise((r) => setTimeout(r, 0));
      }
      const holderName =
        fullWorkspace.people.find((p) => p.id === subject)?.name || newName.trim() || "";
      const c: Case = {
        ...newCase(
          "wapsi",
          claimant,
          `${hi ? chosen.name_hi : chosen.name} · ${holderName}`.slice(0, 150),
        ),
        subject_id: subject,
        answers: {
          asset_category: asset,
          institution: route,
          claimant_relation: relation,
          claimant_capacity: capacity,
        },
        notes:
          seen === "found"
            ? hi
              ? "रिकॉर्ड पहले ही देखा जा चुका है।"
              : "A record was already seen before this case."
            : "",
        observations: [],
      };
      await saveCase(c);
      onCreated(c.id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Step n={1} title={hi ? "संपत्ति किसकी है?" : "Whose asset is it?"}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["self", hi ? "मेरी" : "Mine"],
              ["living", hi ? "किसी दूसरे जीवित व्यक्ति की" : "Another living person's"],
              ["deceased", hi ? "जिनका देहांत हो गया" : "Someone who passed away"],
            ] as const
          ).map(([id, label]) => (
            <label
              key={id}
              className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border p-3 font-semibold ${whose === id ? "border-teal-500 bg-teal-50" : "border-ink-200"}`}
            >
              <input
                type="radio"
                name="whose"
                checked={whose === id}
                onChange={() => setWhose(id)}
              />
              {label}
            </label>
          ))}
        </div>
        {whose !== "self" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">{hi ? "सूची से चुनें" : "Choose from your list"}</span>
              <select
                className="input"
                value={holderId}
                onChange={(e) => setHolderId(e.target.value)}
              >
                <option value="">{hi ? "— या नीचे नाम लिखें —" : "— or type a name —"}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!holderId && (
              <label className="block">
                <span className="field-label">
                  {hi ? "धारक का नाम (कोई पहचान संख्या नहीं)" : "Holder's name (no ID numbers)"}
                </span>
                <input
                  className="input"
                  maxLength={80}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title={hi ? "दावा कौन करेगा?" : "Who will act?"}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="field-label">{hi ? "दावेदार (जीवित)" : "Claimant (living)"}</span>
            <select
              className="input"
              value={claimant}
              onChange={(e) => setClaimant(e.target.value)}
            >
              {living.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">
              {hi ? "धारक से संबंध" : "Relationship to the holder"}
            </span>
            <select
              className="input"
              value={relation}
              disabled={whose === "self"}
              onChange={(e) => setRelation(e.target.value)}
            >
              {RELATIONS.filter((r) => (whose === "self" ? r === "self" : r !== "self")).map(
                (r) => (
                  <option key={r} value={r}>
                    {choiceLabel(r, hi)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="block">
            <span className="field-label">{hi ? "किस हैसियत से दावा" : "Claims as"}</span>
            <select
              className="input"
              value={capacity}
              disabled={whose === "self"}
              onChange={(e) => setCapacity(e.target.value)}
            >
              {CAPACITIES.filter((x) => (whose === "self" ? x === "holder" : x !== "holder")).map(
                (x) => (
                  <option key={x} value={x}>
                    {choiceLabel(x, hi)}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <p className="mt-2 text-sm text-ink-600">
          {hi
            ? "संबंध (जैसे बेटी) और दावा-हैसियत (जैसे नामित व्यक्ति) अलग हैं — कोई भी अपने-आप हक़ साबित नहीं करता। पता न हो तो “अभी पता नहीं” चुनें।"
            : "Relationship (for example daughter) and claim capacity (for example nominee) are different — neither proves entitlement by itself. Choose “unknown” if you are not sure."}
        </p>
      </Step>

      <Step n={3} title={hi ? "कौन-सी संपत्ति, और क्या पता है?" : "What asset, and what is known?"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">{hi ? "संपत्ति का प्रकार" : "Asset type"}</span>
            <select
              className="input"
              value={asset}
              onChange={(e) => {
                setAsset(e.target.value);
                setRoute("");
              }}
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {choiceLabel(a, hi)}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="field-label">{hi ? "रिकॉर्ड" : "Record"}</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["not_checked", hi ? "अभी जाँचा नहीं" : "Not checked yet"],
                  ["found", hi ? "पहले देखा है" : "Already seen one"],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex min-h-[48px] items-center gap-2 rounded-xl border border-ink-200 px-3"
                >
                  <input
                    type="radio"
                    name="seen"
                    checked={seen === id}
                    onChange={() => setSeen(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-3">
          <span className="field-label">
            {hi
              ? "आधिकारिक मार्ग (संस्था पता न हो तो खोज सेवा चुनें)"
              : "Official route (choose a discovery service if the institution is unknown)"}
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {forAsset.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${route === r.id ? "border-teal-500 bg-teal-50" : "border-ink-200"}`}
              >
                <input
                  type="radio"
                  name="route"
                  checked={route === r.id}
                  onChange={() => setRoute(r.id)}
                />
                <span>
                  <b className="block">{hi ? r.name_hi : r.name}</b>
                  <span className="text-sm text-ink-600">
                    {r.role === "discovery"
                      ? hi
                        ? "खोज सेवा — भुगतान संस्था करती है"
                        : "Discovery service — the institution pays"
                      : hi
                        ? "संस्था स्वयं"
                        : "The institution itself"}{" "}
                    ·{" "}
                    {r.automated_ready
                      ? hi
                        ? "स्वचालित जाँच उपलब्ध"
                        : "Automated check available"
                      : hi
                        ? "आधिकारिक साइट पर आप खुद"
                        : "You check on the official site"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </Step>

      <Step n={4} title={hi ? "आगे कैसे बढ़ें" : "How we continue"}>
        {chosen ? (
          <div className="space-y-2 text-sm">
            <p>
              {chosen.automated_ready
                ? hi
                  ? "मामला बनने के बाद आप सहमति देकर स्वचालित जाँच चला सकते हैं, या आधिकारिक साइट खुद खोल सकते हैं।"
                  : "After the case is created you can give consent and run the automated check, or open the official site yourself."
                : hi
                  ? "यह मार्ग आपका अपना लॉगिन, OTP या CAPTCHA माँगता है। JAAGRUK साइट खोलता है; आप वहीं भरते हैं और लौटकर परिणाम दर्ज करते हैं।"
                  : "This route needs your own login, OTP or CAPTCHA. JAAGRUK opens the site; you complete it there and come back to record what it showed."}
            </p>
            <div className="rounded-xl bg-ink-50 p-3">
              <b>{hi ? "तैयार रखें" : "Have ready"}:</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {chosen.before_open.map((x: any) => (
                  <li key={x.en}>{L(hi, x)}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-600">
            {hi ? "ऊपर एक आधिकारिक मार्ग चुनें।" : "Choose an official route above."}
          </p>
        )}
        <ErrorNote error={err} />
        <button className="btn-primary mt-4" disabled={!ready || busy} onClick={create}>
          {busy ? <Spinner /> : <FileCheck2 className="h-4 w-4" />}{" "}
          {hi ? "वापसी मामला बनाएँ" : "Create the recovery case"}
        </button>
      </Step>
    </div>
  );
}

// ------------------------------------------------------------------ official routes
function Routes({ routes, onStart }: { routes: any[]; onStart: (id: string) => void }) {
  const { lang } = useApp();
  const hi = lang === "hi";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {routes.map((r) => (
        <div key={r.id} className="card flex flex-col p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold leading-snug">{hi ? r.name_hi : r.name}</h3>
            <span className="chip shrink-0 bg-ink-100 text-ink-800">
              {choiceLabel(r.asset, hi)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-700">
            <b>
              {r.role === "discovery"
                ? hi
                  ? "खोज सेवा"
                  : "Discovery service"
                : hi
                  ? "संस्था"
                  : "Institution"}
            </b>{" "}
            · {hi ? "भुगतान" : "Pays"}: {L(hi, r.responsible)}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm">
            {r.automated_ready ? (
              <>
                <Bot className="h-4 w-4 text-teal-700" />
                {hi ? "स्वचालित जाँच योग्य" : "Automated check qualified"}
                {r.qualification?.checked_at &&
                  ` · ${fmtDate(r.qualification.checked_at.slice(0, 10), lang)}`}
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 text-amber-700" />
                {r.protected === "captcha"
                  ? hi
                    ? "CAPTCHA — आप आधिकारिक साइट पर खुद भरें"
                    : "CAPTCHA — you complete it on the official site"
                  : hi
                    ? "आपका लॉगिन/OTP — आधिकारिक साइट पर"
                    : "Your own login/OTP — on the official site"}
              </>
            )}
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-700">
            {r.before_open.map((x: any) => (
              <li key={x.en}>{L(hi, x)}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-600">{L(hi, r.after)}</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <button className="btn-primary btn-sm" onClick={() => onStart(r.id)}>
              <Plus className="h-4 w-4" />{" "}
              {hi ? "इस मार्ग से मामला" : "Start a case with this route"}
            </button>
            <a className="btn-ghost btn-sm" href={r.guidance_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> {hi ? "आधिकारिक जानकारी" : "Official guidance"}
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ one recovery case
function RecoveryCase({ c, routes, onBack }: { c: Case; routes: any[]; onBack: () => void }) {
  const { lang, health } = useApp();
  const hi = lang === "hi";
  const { workspace: ws, fullWorkspace, plan, saveCase, openCase } = useWorkspace();
  const p: any = plan?.cases.find((x) => x.case_id === c.id);
  const rec = p?.recovery;
  const r = routes.find((x) => x.id === c.answers.institution);
  const holder = ws.people.find((x) => x.id === (c.subject_id || c.applicant_id));
  const claimant = ws.people.find((x) => x.id === c.applicant_id);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [record, setRecord] = useState(false);
  const [responsible, setResponsible] = useState(String(c.answers.responsible_institution || ""));
  useEffect(() => setResponsible(String(c.answers.responsible_institution || "")), [c.id]);

  /** Every observation is written into the case it was started for — looked up fresh by id. */
  const addObservation = async (caseId: string, o: Observation) => {
    const target = fullWorkspace.cases.find((x) => x.id === caseId);
    if (!target) throw new Error(hi ? "मामला अब मौजूद नहीं है" : "That case no longer exists");
    await saveCase({ ...target, observations: [...(target.observations || []), o].slice(-40) });
  };
  const save = async (next: Partial<Case>) => {
    setErr("");
    try {
      await saveCase({ ...c, ...next });
      setMsg(hi ? "सहेजा गया" : "Saved");
    } catch (e: any) {
      setErr(e.message);
    }
  };
  if (!r) return null;
  const obs = [...(c.observations || [])].sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const prep = rec?.preparation;

  return (
    <div className="case-pack space-y-5">
      <div className="flex flex-wrap items-center gap-2 print-hide">
        <button className="btn-quiet btn-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> {hi ? "सभी मामले" : "All recovery cases"}
        </button>
        <button className="btn-ghost btn-sm ml-auto" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {hi ? "तैयारी पैक प्रिंट करें" : "Print preparation pack"}
        </button>
        <button className="btn-ghost btn-sm" onClick={() => openCase(c.id)}>
          <ListChecks className="h-4 w-4" />{" "}
          {hi ? "दस्तावेज़, नोट्स, साझा करें" : "Documents, notes, share"}
        </button>
      </div>

      {/* 1. Summary */}
      <section className="card p-5" aria-labelledby="rc-summary">
        <h2 id="rc-summary" className="section-title">
          1 · {hi ? "सारांश" : "Summary"} — {hi ? r.name_hi : r.name}
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-600">{hi ? "संपत्ति धारक" : "Asset holder"}</dt>
            <dd className="font-semibold">
              {holder?.name}
              {holder?.deceased ? (hi ? " (दिवंगत)" : " (passed away)") : ""}
            </dd>
          </div>
          <div>
            <dt className="text-ink-600">{hi ? "दावेदार" : "Claimant"}</dt>
            <dd className="font-semibold">
              {claimant?.name} · {choiceLabel(String(c.answers.claimant_relation || "—"), hi)} ·{" "}
              {choiceLabel(String(c.answers.claimant_capacity || "unknown"), hi)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-600">{hi ? "मार्ग का प्रकार" : "Route type"}</dt>
            <dd className="font-semibold">
              {r.role === "discovery"
                ? hi
                  ? "खोज सेवा — भुगतान संस्था करती है"
                  : "Discovery service — the institution pays"
                : hi
                  ? "संस्था स्वयं"
                  : "The institution itself"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-600">{hi ? "ज़िम्मेदार संस्था" : "Responsible institution"}</dt>
            <dd className="font-semibold">
              {rec?.responsible_institution || L(hi, r.responsible)}
            </dd>
          </div>
        </dl>
        {p && (
          <div
            className={`mt-3 rounded-xl p-3 text-sm ${p.status === "review_needed" ? "bg-coral-50 text-coral-700" : p.status === "preparing" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"}`}
          >
            <b>{hi ? p.status_hi : p.status_label}</b>
            {(p.review || []).map((v: string) => (
              <p key={v}>• {v}</p>
            ))}
          </div>
        )}
      </section>

      {/* 2. Search evidence */}
      <section className="card p-5" aria-labelledby="rc-evidence">
        <h2 id="rc-evidence" className="section-title">
          2 · {hi ? "खोज के प्रमाण" : "Search evidence"}
        </h2>
        {obs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">
            {hi ? "अभी कोई जाँच दर्ज नहीं।" : "No check recorded yet."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {obs.map((o) => (
              <li key={o.id} className="rounded-xl border border-ink-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${OUTCOME[o.outcome][2]}`}>
                    {OUTCOME[o.outcome][hi ? 1 : 0]}
                  </span>
                  <span className="text-xs text-ink-600">
                    {new Date(o.checked_at).toLocaleString(hi ? "hi-IN" : "en-IN")} ·{" "}
                    {PROVENANCE[o.provenance]?.[hi ? 1 : 0]}
                    {o.engine ? ` · ${o.engine}` : ""}
                    {o.submitted ? ` · ${hi ? "भेजा" : "submitted"}: ${o.submitted}` : ""}
                  </span>
                </div>
                {o.message && <p className="mt-1 text-sm">{o.message}</p>}
                {o.candidates.map((x, i) => (
                  <div key={i} className="mt-2 rounded-lg bg-teal-50 p-2 text-sm">
                    <b>{x.display_name || (hi ? "नाम नहीं दिखा" : "No name shown")}</b>
                    {x.reference && ` · ${x.reference}`}
                    {x.amount_inr != null && ` · ₹${x.amount_inr.toLocaleString("en-IN")}`}
                  </div>
                ))}
                {o.name_note && <p className="mt-1 text-sm text-ink-700">{o.name_note}</p>}
                {o.responsible_institution && (
                  <p className="mt-1 text-sm">
                    {hi ? "संस्था" : "Institution"}: <b>{o.responsible_institution}</b>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-600">
          {hi
            ? "मिलता-जुलता नाम किसी और का भी हो सकता है। रिकॉर्ड स्वामित्व, स्वीकृत दावा या मिला हुआ पैसा नहीं है।"
            : "A similar name can belong to someone else. A record is not ownership, an approved claim or money received."}
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 print-hide">
          {r.automated_ready && holder && (
            <AutomatedCheck
              c={c}
              route={r}
              holder={holder}
              live={!!health?.tinyfish?.live}
              onObservation={addObservation}
            />
          )}
          <div className="rounded-xl border border-ink-100 p-4">
            <h3 className="font-bold">
              {hi ? "आधिकारिक साइट पर खुद जाँचें" : "Check on the official site yourself"}
            </h3>
            <p className="mt-1 text-sm text-ink-600">
              {hi ? "खोलने से पहले तैयार रखें:" : "Before you open, have ready:"}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
              {r.before_open.map((x: any) => (
                <li key={x.en}>{L(hi, x)}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="btn-primary btn-sm"
                href={r.official_url}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  addObservation(c.id, {
                    id: uid(),
                    source_id: r.id,
                    holder_id: holder?.id || null,
                    checked_at: new Date().toISOString(),
                    provenance: "user_reported",
                    outcome: "page_opened",
                    candidates: [],
                    message: "",
                  }).catch(() => null)
                }
              >
                <ExternalLink className="h-4 w-4" />{" "}
                {hi ? "आधिकारिक वेबसाइट खोलें" : "Open official website"}
              </a>
              <button className="btn-ghost btn-sm" onClick={() => setRecord(true)}>
                <CheckCircle2 className="h-4 w-4" />{" "}
                {hi ? "जो हुआ उसे दर्ज करें" : "Record what happened"}
              </button>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-600">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {hi
                ? "साइट सामान्य नए टैब में खुलती है। OTP, पासवर्ड या CAPTCHA आप वहीं भरते हैं — JAAGRUK से होकर कुछ नहीं जाता। साइट खोलने से खोज पूरी नहीं मानी जाती।"
                : "The site opens in a normal new tab. You type any OTP, password or CAPTCHA there — nothing passes through JAAGRUK. Opening the site does not count as a completed search."}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Claim preparation */}
      <section className="card p-5" aria-labelledby="rc-prep">
        <h2 id="rc-prep" className="section-title">
          3 · {hi ? "दावे की तैयारी" : "Claim preparation"}
        </h2>
        {!prep ? (
          <div className="skeleton mt-3 h-24" />
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="label mb-1">{hi ? "हर संस्था के लिए" : "Common preparation"}</h3>
              <ul className="space-y-1 text-sm">
                {prep.common.map((x: any) => (
                  <li key={x.id}>
                    ☐ {hi ? x.label_hi : x.label}
                    <span className="hidden print:inline"> / {hi ? x.label : x.label_hi}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 rounded-lg bg-ink-50 p-2 text-sm">
                <b>{choiceLabel(prep.capacity.key, hi)}:</b>{" "}
                {hi ? prep.capacity.hi : prep.capacity.en}
              </p>
            </div>
            <div>
              <h3 className="label mb-1">
                {hi ? r.name_hi : r.name} ·{" "}
                {prep.coverage === "reviewed"
                  ? hi
                    ? "आधिकारिक पेज से समीक्षित"
                    : "reviewed from the official page"
                  : prep.coverage === "partial"
                    ? hi
                      ? "आंशिक समीक्षा"
                      : "partly reviewed"
                    : hi
                      ? "समीक्षा नहीं हुई"
                      : "not reviewed"}
              </h3>
              {prep.institution.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {prep.institution.map((x: any) => (
                    <li key={x.id}>
                      ☐ {hi ? x.label_hi : x.label}
                      <span className="hidden print:inline"> / {hi ? x.label : x.label_hi}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-sm text-ink-700">{L(hi, prep.coverage_note)}</p>
            </div>
          </div>
        )}
      </section>

      {/* 4. Official next step */}
      <section className="card p-5" aria-labelledby="rc-next">
        <h2 id="rc-next" className="section-title">
          4 · {hi ? "अगला आधिकारिक कदम" : "Official next step"}
        </h2>
        <p className="mt-2 text-sm">{L(hi, r.after)}</p>
        {r.role === "discovery" && (
          <div className="mt-3 flex flex-wrap items-end gap-2 print-hide">
            <label className="block min-w-[220px] flex-1">
              <span className="field-label">
                {L(hi, r.institution_label) ||
                  (hi ? "ज़िम्मेदार संस्था" : "Responsible institution")}
              </span>
              <input
                className="input"
                maxLength={120}
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
              />
            </label>
            <button
              className="btn-secondary"
              disabled={!responsible.trim() || responsible === c.answers.responsible_institution}
              onClick={() =>
                save({ answers: { ...c.answers, responsible_institution: responsible.trim() } })
              }
            >
              {hi ? "सहेजें" : "Save"}
            </button>
          </div>
        )}
        <a
          className="link mt-2 inline-block text-sm"
          href={r.guidance_url}
          target="_blank"
          rel="noreferrer"
        >
          {hi ? "आधिकारिक जानकारी" : "Official guidance"} ↗
        </a>
      </section>

      {/* 5. Follow-up */}
      <section className="card p-5" aria-labelledby="rc-follow">
        <h2 id="rc-follow" className="section-title">
          5 · {hi ? "आगे की जाँच" : "Follow-up"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 print-hide">
          <label className="block">
            <span className="field-label">{hi ? "आपकी स्थिति" : "Where you are"}</span>
            <select
              className="input"
              value={c.stage}
              onChange={(e) => save({ stage: e.target.value as Case["stage"] })}
            >
              {STAGES.map(([id, en, h]) => (
                <option key={id} value={id}>
                  {hi ? h : en}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">
              {hi
                ? "अगली जाँच की तारीख (कैलेंडर में दिखेगी)"
                : "Follow-up date (shows in your calendar)"}
            </span>
            <input
              className="input"
              type="date"
              min={indiaToday()}
              value={c.follow_up || ""}
              onChange={(e) => save({ follow_up: e.target.value || null })}
            />
          </label>
        </div>
        <p className="mt-2 hidden text-sm print:block">
          {STAGES.find((s) => s[0] === c.stage)?.[hi ? 2 : 1]}
          {c.follow_up ? ` · ${fmtDate(c.follow_up, lang)}` : ""}
        </p>
        {msg && (
          <p className="mt-2 text-sm text-teal-800" role="status">
            {msg}
          </p>
        )}
        <ErrorNote error={err} />
      </section>

      <RecordModal
        open={record}
        onClose={() => setRecord(false)}
        route={r}
        onSave={async (o) => {
          await addObservation(c.id, { ...o, holder_id: holder?.id || null });
          setRecord(false);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ automated check bound to this case
function AutomatedCheck({
  c,
  route,
  holder,
  live,
  onObservation,
}: {
  c: Case;
  route: any;
  holder: { id: string; name: string };
  live: boolean;
  onObservation: (caseId: string, o: Observation) => Promise<void>;
}) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const [name, setName] = useState(holder.name);
  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<{ id: string; caseId: string; key: string } | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const progressed = useRef(false);
  const [watch, setWatch] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const stop = useRef<(() => void) | null>(null);
  // any change to who, what or where clears consent: consent covers exactly these details
  useEffect(() => setConsent(false), [name, dob, holder.id, route.id, c.id]);
  useEffect(() => () => stop.current?.(), []);

  const start = async () => {
    setErr("");
    setSteps([]);
    progressed.current = false;
    setWatch(null);
    const [y, m, d] = dob.split("-");
    const frozen = { caseId: c.id, holderId: holder.id, sourceId: route.id };
    const key = uid();
    try {
      const r = await api.start<any>(
        "/api/recovery/lookup",
        {
          case_id: frozen.caseId,
          holder_id: frozen.holderId,
          source_id: frozen.sourceId,
          category: route.asset,
          name: name.trim(),
          dob: `${d}/${m}/${y}`,
          consent: {
            granted: true,
            case_id: frozen.caseId,
            holder_id: frozen.holderId,
            source_ids: [frozen.sourceId],
            at: new Date().toISOString(),
          },
        },
        key,
      );
      setJob({ id: r.job_id, caseId: frozen.caseId, key });
      setConsent(false);
      stop.current = stream(
        `/api/jobs/${r.job_id}/events`,
        (ev) => {
          if (ev.streaming_url) setWatch(ev.streaming_url);
          if (ev.message) {
            progressed.current = true;
            setSteps((s) => [...s.slice(-5), ev.message]);
          }
        },
        async (res) => {
          const o: Observation | undefined = res?.observation;
          const target = res?.context?.case_id || frozen.caseId;
          try {
            await onObservation(
              target,
              o || {
                id: uid(),
                source_id: frozen.sourceId,
                holder_id: frozen.holderId,
                checked_at: new Date().toISOString(),
                provenance: "automated_live",
                outcome: res?.cancelled ? "cancelled" : progressed.current ? "uncertain" : "failed",
                candidates: [],
                message: res?.cancelled
                  ? hi
                    ? "आपने जाँच रद्द की। अधूरी जाँच दोबारा अपने-आप नहीं चलती।"
                    : "You cancelled the check. An interrupted check is never repeated automatically."
                  : hi
                    ? "जाँच बिना परिणाम के रुकी।"
                    : "The check stopped without a result.",
                job_id: r.job_id,
              },
            );
          } catch (e: any) {
            setErr(e.message);
          }
          setJob(null);
        },
      );
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const cancel = async () => {
    if (!job) return;
    try {
      await api.post(`/api/jobs/${job.id}/cancel`);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <h3 className="flex items-center gap-2 font-bold">
        <Bot className="h-5 w-5 text-teal-700" /> {hi ? "स्वचालित जाँच" : "Automated check"}
      </h3>
      <p className="mt-1 text-sm text-ink-600">
        {hi
          ? `TinyFish ${route.automated === "agent" ? "एजेंट" : "ब्राउज़र स्क्रिप्ट"} आधिकारिक फ़ॉर्म एक बार भरता है और केवल उसका परिणाम-क्षेत्र पढ़ता है।`
          : `A TinyFish ${route.automated === "agent" ? "agent" : "browser script"} fills the official form once and reads only its result area.`}
      </p>
      {!live && (
        <Callout tone="warn">
          {hi
            ? "TinyFish ऑफ़लाइन है: निजी खोजें रिकॉर्डिंग से कभी नहीं दिखाई जातीं, इसलिए परिणाम “उपलब्ध नहीं” आएगा।"
            : "TinyFish is offline: personal lookups are never replayed from recordings, so the result will be “Unavailable”."}
        </Callout>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">{hi ? "रिकॉर्ड में नाम" : "Name as on records"}</span>
          <input
            className="input"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="field-label">{hi ? "जन्म तिथि" : "Date of birth"}</span>
          <input
            className="input"
            type="date"
            max={indiaToday()}
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          {hi
            ? `मैं सहमत हूँ: JAAGRUK इस मामले के लिए ${holder.name} की संपत्ति ${route.name_hi} पर केवल ऊपर के नाम और जन्म तिथि से खोजे। नाम और जन्म तिथि सहेजे नहीं जाते।`
            : `I agree: JAAGRUK may check ${route.name} for ${holder.name}'s asset, for this case only, using just the name and date of birth above. They are not stored.`}
        </span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={!consent || !dob || name.trim().length < 2 || !!job}
          onClick={start}
        >
          {job ? <Spinner /> : <Search className="h-4 w-4" />} {hi ? "जाँच चलाएँ" : "Run the check"}
        </button>
        {job && (
          <button className="btn-ghost" onClick={cancel}>
            {hi ? "रद्द करें" : "Cancel"}
          </button>
        )}
        {watch && (
          <button className="btn-ghost" onClick={() => window.open(watch, "_blank", "noopener")}>
            <Eye className="h-4 w-4" /> {hi ? "लाइव देखें" : "Watch live"}
          </button>
        )}
      </div>
      {steps.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-700" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
      <ErrorNote error={err} />
    </div>
  );
}

// ------------------------------------------------------------------ record what happened on the official site
function RecordModal({
  open,
  onClose,
  route,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  route: any;
  onSave: (o: Observation) => Promise<void>;
}) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const [outcome, setOutcome] = useState<Outcome>("no_match");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [inst, setInst] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const choices: Outcome[] = [
    "possible_record",
    "no_match",
    "citizen_step",
    "unavailable",
    "uncertain",
  ];
  const label: Record<string, [string, string]> = {
    possible_record: ["It showed a record", "एक रिकॉर्ड दिखा"],
    no_match: ["It said nothing was found for my details", "मेरे विवरण पर कुछ नहीं मिला"],
    citizen_step: ["It needed a step I could not finish", "एक कदम पूरा नहीं कर पाए"],
    unavailable: ["The site did not work", "साइट नहीं चली"],
    uncertain: ["I am not sure", "पक्का नहीं"],
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hi ? "आधिकारिक साइट पर क्या हुआ?" : "What happened on the official site?"}
      footer={
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const amt = amount.trim() ? Number(amount.replace(/[^\d.]/g, "")) : null;
                await onSave({
                  id: uid(),
                  source_id: route.id,
                  holder_id: null,
                  checked_at: new Date().toISOString(),
                  provenance: "user_reported",
                  outcome,
                  candidates:
                    outcome === "possible_record"
                      ? [
                          {
                            display_name: name.trim().slice(0, 120),
                            reference: ref.trim().slice(0, 80),
                            amount_inr: amt != null && Number.isFinite(amt) ? amt : null,
                          },
                        ]
                      : [],
                  message: note.trim().slice(0, 600),
                  responsible_institution: inst.trim().slice(0, 120),
                });
                setName("");
                setRef("");
                setAmount("");
                setNote("");
              } catch (e: any) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}{" "}
            {hi ? "दर्ज करें" : "Record it"}
          </button>
          <button className="btn-quiet" onClick={onClose}>
            {hi ? "रद्द करें" : "Cancel"}
          </button>
        </div>
      }
    >
      <fieldset className="space-y-2">
        <legend className="field-label">{hi ? "परिणाम" : "Result"}</legend>
        {choices.map((o) => (
          <label
            key={o}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-ink-200 px-3"
          >
            <input
              type="radio"
              name="outcome"
              checked={outcome === o}
              onChange={() => setOutcome(o)}
            />
            {label[o][hi ? 1 : 0]}
          </label>
        ))}
      </fieldset>
      {outcome === "possible_record" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">
              {hi ? "रिकॉर्ड पर नाम" : "Name shown on the record"}
            </span>
            <input
              className="input"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">
              {hi ? "संदर्भ (UDRN, फोलियो, पॉलिसी)" : "Reference (UDRN, folio, policy)"}
            </span>
            <input
              className="input"
              maxLength={80}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">
              {hi ? "दिखाई गई राशि (वैकल्पिक)" : "Amount shown (optional)"}
            </span>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {route.role === "discovery" && (
            <label className="block">
              <span className="field-label">{L(hi, route.institution_label)}</span>
              <input
                className="input"
                maxLength={120}
                value={inst}
                onChange={(e) => setInst(e.target.value)}
              />
            </label>
          )}
        </div>
      )}
      <label className="mt-3 block">
        <span className="field-label">
          {hi ? "नोट (कोई OTP या पासवर्ड नहीं)" : "Note (never an OTP or password)"}
        </span>
        <textarea
          className="input min-h-[80px]"
          maxLength={600}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <ErrorNote error={err} />
    </Modal>
  );
}
