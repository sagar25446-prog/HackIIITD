import { useEffect, useReducer, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  CalendarHeart,
  CheckCircle2,
  Eye,
  GraduationCap,
  HeartCrack,
  Home,
  Mic,
  NotebookPen,
  Sparkles,
  Sunset,
  UserPlus,
  Users,
} from "lucide-react";
import { api, inr } from "../api";
import { Callout, Empty, fmtDate, PageHeader, Spinner } from "../components/ui";
import { useApp } from "../state";
import { useWorkspace } from "./WorkspaceProvider";
import { FactInput } from "./CaseFields";
import { createEventDraft, eventDraftReducer, EventKind } from "./eventDraft";
import { primaryPerson } from "./scope";
import { uid } from "./types";

const DRAFT_KEY = "jaagruk.lifeDraft";
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const KINDS: [EventKind, string, string, any][] = [
  ["education", "Education / scholarship", "पढ़ाई / छात्रवृत्ति", GraduationCap],
  ["moving", "Moving home", "घर बदलना", Home],
  ["income_review", "Income or job", "आय या नौकरी", Briefcase],
  ["bereavement", "Someone passed away", "किसी का निधन", HeartCrack],
  ["retirement", "Retirement / turning 60", "सेवानिवृत्ति / 60 वर्ष", Sunset],
  ["note", "Just a note", "केवल नोट", NotebookPen],
];
const EXAMPLES = {
  en: [
    "My daughter Riya got into second year and needs her scholarship renewed",
    "My husband passed away last month",
    "We moved to Maharashtra on 3 October",
    "My salary is now ₹25,000 per month",
    "I got a bonus at work",
    "My mother turned 60 and retired",
  ],
  hi: [
    "मेरी बेटी रिया दूसरे साल में है, छात्रवृत्ति का नवीनीकरण करना है",
    "मेरे पति का पिछले महीने देहांत हो गया",
    "हम अगले महीने महाराष्ट्र जा रहे हैं",
    "मुझे ऑफिस में बोनस मिला",
  ],
};
const RELATION_HI: Record<string, string> = {
  mother: "माँ",
  father: "पिता",
  daughter: "बेटी",
  son: "बेटा",
  wife: "पत्नी",
  husband: "पति",
  sister: "बहन",
  brother: "भाई",
  grandmother: "दादी/नानी",
  grandfather: "दादा/नाना",
};

export default function PersonalEvents() {
  const { lang } = useApp();
  const hi = lang === "hi";
  const {
    workspace: ws,
    fullWorkspace,
    replaceIfCurrent,
    openCase,
    mode,
    setMode,
    setWorkspace,
  } = useWorkspace();
  const [draft, dispatch] = useReducer(eventDraftReducer, undefined, createEventDraft);
  const { text, kind, date, destination, confirmMove, confirmIncome, income } = draft;
  const [proposal, setProposal] = useState<any>(null);
  const owner = primaryPerson(ws) || "";
  const [people, setPeople] = useState<string[]>([owner]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const living = ws.people.filter((p) => !p.deceased);

  const understand = async (value = text) => {
    if (value.trim().length < 2) return;
    setBusy(true);
    setResult(null);
    try {
      const p = await api.post<any>("/api/workspace/events/interpret", {
        text: value,
        people: fullWorkspace.people.map((x) => ({
          id: x.id,
          name: x.name,
          relation: x.id === primaryPerson(fullWorkspace) ? "self" : x.relation,
          deceased: x.deceased,
        })),
      });
      setProposal(p);
      dispatch({
        type: "interpret",
        kind: p.kind,
        destination: p.suggested_destination,
        date: p.occurred_on,
        income: p.income,
        mode: p.mode,
        courseYear: p.answers?.course_year ?? null,
        subjectId: fullWorkspace.people.some((x) => x.id === p.subject_id) ? p.subject_id : null,
      });
      const visible = (p.person_ids as string[]).filter((id) => living.some((x) => x.id === id));
      setPeople(visible.length ? visible : [owner]);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  // A draft carried over from Personal mode (after "Switch to Family mode") is read again here.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved) {
        sessionStorage.removeItem(DRAFT_KEY);
        dispatch({ type: "text", text: saved });
        understand(saved);
      }
    } catch {
      /* nothing carried over */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToFamily = (addRelation?: string) => {
    try {
      sessionStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* the user can paste the text again */
    }
    if (addRelation) addPerson(addRelation);
    setMode("family");
  };
  const addPerson = (relation: string) => {
    const name = relation.charAt(0).toUpperCase() + relation.slice(1);
    setWorkspace((w) => ({
      ...w,
      people: [...w.people, { id: uid(), name, relation, deceased: false, facts: {} }],
    }));
  };
  const listen = () => {
    if (!SR) return;
    const r = new SR();
    r.lang = hi ? "hi-IN" : "en-IN";
    r.onresult = (e: any) => {
      const said = e.results[0][0].transcript as string;
      const next = text ? `${text} ${said}` : said;
      dispatch({ type: "text", text: next });
      setProposal(null);
    };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  const mentionedHidden =
    proposal && mode === "personal"
      ? (proposal.mentioned as any[]).filter(
          (m) => !ws.people.some((p) => p.id === m.id) && !(kind === "bereavement"),
        )
      : [];
  // The person who passed away is a related person of the case, even in Personal mode.
  const subject = fullWorkspace.people.find((p) => p.id === draft.subjectId);
  const subjectPool = fullWorkspace.people.filter((p) => !people.includes(p.id));
  const canSave =
    !busy &&
    people.length > 0 &&
    !(kind === "moving" && confirmMove && (!date || !destination)) &&
    !(kind === "income_review" && confirmIncome && income === null);

  const payload = () => {
    const related =
      kind === "bereavement" && subject && !ws.people.some((p) => p.id === subject.id)
        ? [subject]
        : [];
    return {
      workspace: { ...ws, people: [...ws.people, ...related] },
      text,
      person_ids: kind === "bereavement" ? people.filter((id) => id !== draft.subjectId) : people,
      kind,
      occurred_on: date || null,
      destination: destination || null,
      confirm_move: confirmMove,
      confirm_income: confirmIncome,
      income,
      mode: kind === "education" ? draft.mode || "fresh" : null,
      answers: kind === "education" && draft.courseYear ? { course_year: draft.courseYear } : {},
      subject_id: kind === "bereavement" && draft.subjectId ? draft.subjectId : null,
      confirm_deceased: kind === "bereavement" && draft.confirmDeceased,
    };
  };
  // A preview belongs to exactly one draft: any edit makes it stale and it disappears.
  const [preview, setPreview] = useState<{ key: string; data: any } | null>(null);
  const draftKey = JSON.stringify([draft, people, ws]);
  const current = preview && preview.key === draftKey ? preview.data : null;
  const showPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api.post<any>("/api/workspace/events/preview", payload());
      setPreview({ key: draftKey, data });
      setTimeout(
        () => document.getElementById("change-preview")?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (e: any) {
      setPreview(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.post<any>("/api/workspace/events/apply", {
        ...payload(),
        expect_base_hash: current.base_hash,
        expect_rules_version: current.rules_version,
      });
      if (!replaceIfCurrent(ws, r.workspace))
        throw new Error(
          hi
            ? "यह अपडेट तैयार होते समय आपकी योजना बदल गई। घटना की समीक्षा करके फिर सहेजें।"
            : "Your plan changed while this update was being prepared. Review and save the event again.",
        );
      setResult(r);
      setProposal(null);
      setPreview(null);
      dispatch({ type: "reset" });
      setError("");
    } catch (e: any) {
      setPreview(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div aria-busy={busy}>
      <PageHeader
        icon={<CalendarHeart className="h-5 w-5" />}
        title={hi ? "आपकी ज़िंदगी में क्या बदला?" : "What changed in your life?"}
        sub={
          hi
            ? "अपनी भाषा में कुछ भी लिखें या बोलें। हम बताएँगे इसका आपकी योजना पर क्या असर हो सकता है — आपकी पुष्टि के बाद ही कुछ बदलेगा।"
            : "Write or say anything in your own words. We show what it could change in your plan — nothing changes until you confirm."
        }
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <section className="card p-5">
            <Step n={1} title={hi ? "अपना अपडेट लिखें" : "Write your update"} />
            <div className="relative mt-3">
              <textarea
                className="input min-h-[120px] pr-14"
                maxLength={1000}
                disabled={busy}
                value={text}
                aria-label={hi ? "अपना अपडेट" : "Your update"}
                onChange={(e) => {
                  dispatch({ type: "text", text: e.target.value });
                  setProposal(null);
                  setResult(null);
                }}
                placeholder={
                  hi
                    ? "जैसे: मेरी बेटी दूसरे साल में है / हम महाराष्ट्र जा रहे हैं…"
                    : "For example: my daughter is in second year / we are moving to Maharashtra…"
                }
              />
              {SR && (
                <button
                  type="button"
                  onClick={listen}
                  aria-label={hi ? "बोलकर लिखें" : "Dictate"}
                  className={`absolute bottom-3 right-3 rounded-xl p-2.5 ${listening ? "pulse-ring bg-coral-600 text-white" : "bg-teal-50 text-teal-700 hover:bg-teal-100"}`}
                >
                  <Mic className="h-5 w-5" />
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {hi
                ? "पहचान संख्या, खाता विवरण या पासवर्ड न लिखें।"
                : "Don't include identity numbers, account details or passwords."}
            </p>
            {!proposal && !text && (
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES[lang].map((ex) => (
                  <button
                    key={ex}
                    className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-left text-sm text-ink-700 hover:border-teal-300 hover:text-teal-800"
                    onClick={() => {
                      dispatch({ type: "text", text: ex });
                      understand(ex);
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn-primary mt-4"
              disabled={text.trim().length < 2 || busy}
              onClick={() => understand()}
            >
              {busy && !proposal ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {hi ? "देखें इसका क्या असर है" : "See what this could change"}
            </button>
          </section>

          {proposal && (
            <section className="card space-y-5 p-5 fade-up">
              <Step n={2} title={hi ? "जाँचें हमने क्या समझा" : "Check what we understood"} />
              <Callout tone="info">{hi ? proposal.explanation_hi : proposal.explanation}</Callout>

              {mentionedHidden.length > 0 && (
                <Callout
                  tone="warn"
                  title={
                    hi
                      ? `यह अपडेट ${mentionedHidden.map((m) => m.name).join(", ")} के बारे में लगता है`
                      : `This update seems to be about ${mentionedHidden.map((m) => m.name).join(", ")}`
                  }
                  action={
                    <button className="btn-primary btn-sm" onClick={() => switchToFamily()}>
                      <Users className="h-4 w-4" />
                      {hi ? "परिवार मोड में दर्ज करें" : "File it in Family mode"}
                    </button>
                  }
                >
                  {hi
                    ? "व्यक्तिगत मोड में मामले सिर्फ़ आपके नाम पर बनते हैं। परिवार मोड में हर व्यक्ति की जानकारी अलग रहती है।"
                    : "Personal mode files cases only under you. Family mode keeps each person's facts and documents separate."}
                </Callout>
              )}
              {proposal.unknown_relations?.length > 0 && (
                <Callout
                  tone="warn"
                  title={
                    hi
                      ? `आपकी सूची में ${proposal.unknown_relations.map((r: string) => RELATION_HI[r] || r).join(", ")} नहीं हैं`
                      : `Your ${proposal.unknown_relations.join(", ")} isn't in your family list yet`
                  }
                  action={proposal.unknown_relations.map((r: string) => (
                    <button
                      key={r}
                      className="btn-secondary btn-sm"
                      onClick={() =>
                        mode === "family"
                          ? (addPerson(r), setTimeout(() => understand(), 50))
                          : switchToFamily(r)
                      }
                    >
                      <UserPlus className="h-4 w-4" />
                      {hi ? `${RELATION_HI[r] || r} को जोड़ें` : `Add ${r}`}
                    </button>
                  ))}
                >
                  {hi
                    ? "जोड़ने पर यह अपडेट सही व्यक्ति के नाम पर दर्ज होगा। नाम और जानकारी बाद में प्रोफ़ाइल में बदलें।"
                    : "Add them so the update is filed under the right person. Edit their name and details later in Family & profile."}
                </Callout>
              )}

              <fieldset disabled={busy}>
                <legend className="field-label">
                  {hi ? "यह किस बारे में है?" : "What is this about?"}
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {KINDS.map(([v, en, h, Icon]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={kind === v}
                      onClick={() => dispatch({ type: "kind", kind: v })}
                      className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-semibold transition ${kind === v ? "border-teal-600 bg-teal-50 text-teal-900 ring-2 ring-teal-100" : "border-ink-200 hover:border-teal-200"}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-teal-700" />
                      {hi ? h : en}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset disabled={busy}>
                <legend className="field-label">
                  {kind === "bereavement"
                    ? hi
                      ? "आवेदक (जो सहायता के लिए आवेदन करेगा)"
                      : "Applicant (who will apply for support)"
                    : hi
                      ? "यह किन लोगों पर लागू है?"
                      : "Who does this apply to?"}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {living.map((p) => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${people.includes(p.id) ? "border-teal-600 bg-teal-50 text-teal-900" : "border-ink-200"}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={people.includes(p.id)}
                        onChange={(e) =>
                          setPeople(
                            kind === "bereavement" || kind === "education"
                              ? e.target.checked
                                ? [p.id]
                                : []
                              : e.target.checked
                                ? [...people, p.id]
                                : people.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
                {mode === "personal" && fullWorkspace.people.length > 1 && (
                  <p className="mt-2 text-xs text-ink-500">
                    {hi ? "दूसरे सदस्य के लिए " : "For another family member, "}
                    <button type="button" className="link" onClick={() => switchToFamily()}>
                      {hi ? "परिवार मोड" : "use Family mode"}
                    </button>
                    .
                  </p>
                )}
              </fieldset>

              {kind === "education" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="field-label">{hi ? "आवेदन प्रकार" : "Application type"}</span>
                    <div className="segmented w-full">
                      {(["fresh", "renewal"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="flex-1"
                          aria-pressed={(draft.mode || "fresh") === m}
                          onClick={() => dispatch({ type: "mode", mode: m })}
                        >
                          {m === "fresh" ? (hi ? "नया" : "Fresh") : hi ? "नवीनीकरण" : "Renewal"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span className="field-label">{hi ? "पढ़ाई का वर्ष" : "Year of study"}</span>
                    <select
                      className="input"
                      value={draft.courseYear ?? ""}
                      onChange={(e) =>
                        dispatch({
                          type: "courseYear",
                          courseYear: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">{hi ? "अज्ञात" : "Not sure"}</option>
                      {[1, 2, 3, 4, 5].map((y) => (
                        <option key={y} value={y}>
                          {hi ? `${y} वर्ष` : `Year ${y}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {kind === "bereavement" && (
                <div className="space-y-2 rounded-xl bg-ink-50 p-3">
                  <label className="block">
                    <span className="field-label">
                      {hi ? "किनका निधन हुआ?" : "Who passed away?"}
                    </span>
                    <select
                      className="input"
                      value={draft.subjectId}
                      onChange={(e) => dispatch({ type: "subject", subjectId: e.target.value })}
                    >
                      <option value="">
                        {hi ? "बाद में मामले में चुनें" : "Choose later in the case"}
                      </option>
                      {subjectPool.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.deceased ? (hi ? " (दिवंगत)" : " (deceased)") : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {subject && !subject.deceased && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.confirmDeceased}
                        onChange={(e) =>
                          dispatch({ type: "confirmDeceased", confirmed: e.target.checked })
                        }
                      />
                      <span>
                        {hi
                          ? `परिवार के रिकॉर्ड में ${subject.name} को दिवंगत दर्ज करें`
                          : `Record ${subject.name} as passed away in my family records`}
                      </span>
                    </label>
                  )}
                </div>
              )}

              {kind === "moving" && (
                <div className="space-y-3 rounded-xl bg-ink-50 p-3">
                  <label className="block">
                    <span className="field-label">
                      {hi ? "नया राज्य / केंद्र शासित प्रदेश" : "Destination state / territory"}
                    </span>
                    <select
                      className="input"
                      value={destination}
                      onChange={(e) =>
                        dispatch({ type: "destination", destination: e.target.value })
                      }
                    >
                      <option value="">{hi ? "चुनें" : "Choose"}</option>
                      {proposal.states.map((s: string) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmMove}
                      onChange={(e) =>
                        dispatch({ type: "confirmMove", confirmed: e.target.checked })
                      }
                    />
                    <span>
                      {hi
                        ? "मैं पुष्टि करता/करती हूँ कि चुने लोगों का निवास बदला है। आज या पहले की तिथि पर निवास और संबंधित योजनाएँ फिर जाँची जाएँगी।"
                        : "I confirm the selected people moved. If the date is today or earlier, their residence is updated and affected plans are re-checked."}
                    </span>
                  </label>
                  <p className="text-xs text-ink-500">
                    {hi
                      ? "भविष्य की तिथि वाला स्थानांतरण योजना के रूप में दर्ज होगा; आज का निवास नहीं बदलेगा।"
                      : "A move with a future date is recorded as planned; today's residence does not change."}
                  </p>
                </div>
              )}

              {kind === "income_review" && (
                <div className="space-y-3 rounded-xl bg-ink-50 p-3">
                  {proposal.income != null && (
                    <p className="text-sm">
                      {hi ? "हमने पढ़ा" : "We read"}: <b>{inr(proposal.income)}</b>{" "}
                      {hi ? "प्रति वर्ष" : "a year"}
                      {proposal.income_period === "monthly"
                        ? hi
                          ? " (मासिक × 12)"
                          : " (monthly × 12)"
                        : ""}
                    </p>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmIncome}
                      onChange={(e) =>
                        dispatch({ type: "confirmIncome", confirmed: e.target.checked })
                      }
                    />
                    <span>
                      {hi
                        ? "केवल नोट रखने के बजाय मेरी पुष्ट वार्षिक आय अपडेट करें"
                        : "Update my confirmed annual income, instead of only keeping a note"}
                    </span>
                  </label>
                  {confirmIncome && (
                    <FactInput
                      field="annual_personal_income"
                      value={income}
                      lang={lang}
                      onChange={(v) => dispatch({ type: "income", income: v })}
                    />
                  )}
                </div>
              )}

              <label className="block">
                <span className="field-label">
                  {hi ? "घटना की तिथि (वास्तविक या प्रस्तावित)" : "Date (actual or planned)"}
                </span>
                <input
                  className="input sm:max-w-xs"
                  type="date"
                  value={date}
                  onChange={(e) => dispatch({ type: "date", date: e.target.value })}
                />
                {proposal.date_text && date === proposal.occurred_on && (
                  <span className="mt-1 block text-xs text-ink-500">
                    {hi ? "आपके शब्दों से" : "From your words"}: “{proposal.date_text}”
                  </span>
                )}
              </label>

              <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                <button className="btn-primary" disabled={!canSave} onClick={showPreview}>
                  {busy ? <Spinner /> : <Eye className="h-4 w-4" />}
                  {hi ? "देखें क्या बदलेगा" : "Preview what changes"}
                </button>
                <button
                  className="btn-quiet"
                  onClick={() => {
                    setProposal(null);
                    dispatch({ type: "reset" });
                  }}
                >
                  {hi ? "रद्द करें" : "Cancel"}
                </button>
              </div>
            </section>
          )}
          {current && proposal && (
            <ChangePreview
              data={current}
              hi={hi}
              busy={busy}
              onApply={save}
              onCancel={() => setPreview(null)}
            />
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-coral-50 p-3 text-sm text-coral-700">
              {error}
            </p>
          )}

          {result && (
            <section role="status" className="card border-teal-200 p-5 fade-up">
              <Step n={3} title={hi ? "अपडेट सहेजा गया" : "Update saved"} done />
              <ul className="mt-3 space-y-1.5 text-sm">
                {result.changes.map((c: any) => (
                  <li key={c.person_id + c.field}>
                    ✓ {ws.people.find((p) => p.id === c.person_id)?.name}: {fieldName(c.field, hi)}{" "}
                    {String(c.before ?? "—")} → <b>{String(c.after)}</b>
                  </li>
                ))}
                {result.new_case_ids.length > 0 && (
                  <li>
                    ✓ {hi ? "तैयारी का मामला बना" : "A preparation case was created for"}{" "}
                    <b>
                      {result.workspace.cases
                        .filter((c: any) => result.new_case_ids.includes(c.id))
                        .map(
                          (c: any) =>
                            result.workspace.people.find((p: any) => p.id === c.applicant_id)?.name,
                        )
                        .join(", ")}
                    </b>
                    {hi ? " के लिए" : ""} —{" "}
                    {hi
                      ? "जवाब और दस्तावेज़ उसमें भरें।"
                      : "fill in its answers and documents next."}
                  </li>
                )}
                {result.scheduled && (
                  <li>
                    •{" "}
                    {hi
                      ? "भविष्य की घटना: आज का निवास नहीं बदला।"
                      : "Planned event: today's residence is unchanged."}
                  </li>
                )}
                {!result.changes.length && !result.new_case_ids.length && (
                  <li>
                    •{" "}
                    {hi
                      ? "कोई तथ्य नहीं बदला; आपका अपडेट नोट के रूप में सुरक्षित है।"
                      : "No facts changed; your update is saved as a note."}
                  </li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.new_case_ids.map((id: string) => (
                  <button key={id} className="btn-primary btn-sm" onClick={() => openCase(id)}>
                    {hi ? "तैयारी का मामला खोलें" : "Open the new preparation case"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ))}
                {result.affected_cases.map((c: any) => (
                  <button
                    key={c.case_id}
                    className="btn-ghost btn-sm"
                    onClick={() => openCase(c.case_id)}
                  >
                    {ws.cases.find((x) => x.id === c.case_id)?.title} · {c.before} → {c.after}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="lg:col-span-2">
          <h2 className="section-title mb-3">{hi ? "आपके अपडेट" : "Your updates"}</h2>
          {(ws.journal || []).length === 0 ? (
            <Empty icon={<NotebookPen className="h-5 w-5" />}>
              {hi
                ? "आपके सहेजे अपडेट यहाँ समय-क्रम में दिखेंगे।"
                : "Your saved updates appear here as a timeline."}
            </Empty>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-teal-100 pl-4">
              {[...(ws.journal || [])].reverse().map((e: any) => {
                const status = e.scheduled
                  ? [hi ? "प्रस्तावित" : "Planned", "bg-ink-100 text-ink-700"]
                  : e.case_ids?.length
                    ? [hi ? "मामला बना" : "Case created", "bg-teal-100 text-teal-800"]
                    : e.changed_fields.length
                      ? [hi ? "तथ्य अपडेट" : "Facts updated", "bg-teal-100 text-teal-800"]
                      : [hi ? "नोट" : "Note", "bg-ink-100 text-ink-600"];
                return (
                  <li key={e.id} className="card relative p-4">
                    <span className="absolute -left-[23px] top-5 h-3 w-3 rounded-full border-2 border-white bg-teal-600" />
                    <p className="font-semibold leading-snug">{e.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span className={`chip ${status[1]}`}>{status[0]}</span>
                      <span>{fmtDate(e.occurred_on || e.at, lang)}</span>
                      <span>
                        ·{" "}
                        {e.person_ids
                          .map((id: string) => ws.people.find((p) => p.id === id)?.name)
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </div>
                    {(e.case_ids || [])
                      .filter((id: string) => ws.cases.some((c) => c.id === id))
                      .map((id: string) => (
                        <button key={id} className="link mt-2 text-sm" onClick={() => openCase(id)}>
                          {hi ? "मामला खोलें" : "Open case"} →
                        </button>
                      ))}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Step({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h2 className="flex items-center gap-2.5 text-lg font-bold">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${done ? "bg-teal-600 text-white" : "bg-teal-50 text-teal-800"}`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      {title}
    </h2>
  );
}

const FIELD_NAMES: Record<string, [string, string]> = {
  state: ["state", "राज्य"],
  annual_personal_income: ["annual income", "वार्षिक आय"],
  deceased: ["recorded as passed away", "दिवंगत दर्ज"],
};
const fieldName = (f: string, hi: boolean) =>
  FIELD_NAMES[f]?.[hi ? 1 : 0] || f.replaceAll("_", " ");

function List({ items, mark = "•" }: { items: string[]; mark?: string }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {items.map((x) => (
        <li key={x}>
          {mark} {x}
        </li>
      ))}
    </ul>
  );
}

/** "Preview what changes": every consequence and its reason, before anything is saved. */
function ChangePreview({
  data,
  hi,
  busy,
  onApply,
  onCancel,
}: {
  data: any;
  hi: boolean;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const val = (v: any) =>
    v === true ? (hi ? "हाँ" : "yes") : v === false ? (hi ? "नहीं" : "no") : String(v ?? "—");
  const nothing = !data.facts.length && !data.new_cases.length && !data.affected_cases.length;
  return (
    <section
      id="change-preview"
      className="card scroll-mt-24 border-teal-300 p-5 fade-up"
      aria-labelledby="pv-title"
    >
      <h2 id="pv-title" className="section-title flex items-center gap-2">
        <Eye className="h-5 w-5 text-teal-700" />{" "}
        {hi ? "क्या बदलेगा — अभी कुछ सहेजा नहीं गया" : "What would change — nothing is saved yet"}
      </h2>
      {data.facts.length > 0 && (
        <div className="mt-3">
          <h3 className="label">{hi ? "जानकारी जो बदलेगी" : "Facts that change"}</h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {data.facts.map((f: any, i: number) => (
              <li key={i}>
                • {f.person}: {hi ? f.field_hi : f.field} {val(f.before)} → <b>{val(f.after)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.new_cases.map((c: any, i: number) => (
        <div key={i} className="mt-3 rounded-xl bg-teal-50 p-3">
          <h3 className="font-bold">
            {hi ? "नया मामला" : "New case"}: {c.person}
            {c.subject ? ` · ${hi ? "संबंधित" : "about"} ${c.subject}` : ""}
          </h3>
          <p className="mt-1 text-sm">
            <b>{hi ? "क्यों" : "Why"}:</b> {hi ? c.why_hi : c.why}
          </p>
          <p className="text-sm">
            <b>{hi ? "स्थिति" : "Status"}:</b> {hi ? c.status_hi : c.status_label}
          </p>
          {c.questions.length > 0 && (
            <>
              <p className="mt-1 text-sm font-semibold">
                {hi ? "पूछे जाएँगे" : "Questions it will ask"}
              </p>
              <List items={hi ? c.questions_hi : c.questions} />
            </>
          )}
          {c.documents.length > 0 && (
            <>
              <p className="mt-1 text-sm font-semibold">{hi ? "दस्तावेज़" : "Documents"}</p>
              <List items={hi ? c.documents_hi : c.documents} mark="☐" />
            </>
          )}
          {c.dates.length > 0 && (
            <>
              <p className="mt-1 text-sm font-semibold">{hi ? "तिथियाँ" : "Dates"}</p>
              <List items={c.dates.map((d: any) => `${d.date} · ${hi ? d.title_hi : d.title}`)} />
            </>
          )}
        </div>
      ))}
      {data.affected_cases.map((c: any, i: number) => (
        <div key={i} className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          <h3 className="font-bold">
            {hi ? "बदलता मामला" : "Changed case"}: {c.title} · {c.person}
          </h3>
          <p>
            {hi ? c.before.status_hi : c.before.status_label} →{" "}
            <b>{hi ? c.after.status_hi : c.after.status_label}</b>
          </p>
          {c.added_questions.length > 0 && <List items={c.added_questions} mark="+" />}
          {c.removed_questions.length > 0 && <List items={c.removed_questions} mark="−" />}
          {c.added_documents.length > 0 && <List items={c.added_documents} mark="+☐" />}
          {c.removed_documents.length > 0 && <List items={c.removed_documents} mark="−☐" />}
        </div>
      ))}
      {(data.unchanged.length > 0 || nothing) && (
        <div className="mt-3">
          <h3 className="label">{hi ? "जो नहीं बदलता" : "What stays the same"}</h3>
          <List
            items={
              data.unchanged.length
                ? hi
                  ? data.unchanged_hi
                  : data.unchanged
                : [
                    hi
                      ? "कोई जानकारी या मामला नहीं बदलता; यह डायरी में दर्ज होगा।"
                      : "No fact or case changes; this is kept in your journal.",
                  ]
            }
          />
        </div>
      )}
      {data.still_unknown.length > 0 && (
        <div className="mt-3">
          <h3 className="label">{hi ? "अभी अज्ञात" : "Still unknown"}</h3>
          <List items={hi ? data.still_unknown_hi : data.still_unknown} mark="?" />
        </div>
      )}
      <p className="mt-3 text-xs text-ink-600">
        {hi ? "नियम संस्करण" : "Rules version"}: {data.rules_version}.{" "}
        {hi
          ? "लागू करते समय फिर जाँचा जाता है कि इस झलक के बाद आपकी योजना और नियम नहीं बदले।"
          : "When you apply, JAAGRUK checks again that your plan and the rules have not changed since this preview."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={onApply}>
          {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}{" "}
          {hi ? "ये बदलाव लागू करें" : "Apply these changes"}
        </button>
        <button className="btn-quiet" onClick={onCancel}>
          {hi ? "वापस बदलें" : "Back to edit"}
        </button>
      </div>
    </section>
  );
}
