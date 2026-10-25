import { useEffect, useState } from "react";
import { Download, LifeBuoy, Trash2, UserPlus, UserRound, Users } from "lucide-react";
import { Callout, Modal } from "../components/ui";
import { useApp } from "../state";
import { useWorkspace } from "./WorkspaceProvider";
import { Person, uid } from "./types";
import { FactInput } from "./CaseFields";
import { primaryPerson } from "./scope";
import { downloadWorkspace, downloadRecovery } from "./storage";

const RELATIONS: [string, string][] = [
  ["spouse", "जीवनसाथी"],
  ["wife", "पत्नी"],
  ["husband", "पति"],
  ["daughter", "बेटी"],
  ["son", "बेटा"],
  ["mother", "माँ"],
  ["father", "पिता"],
  ["sister", "बहन"],
  ["brother", "भाई"],
  ["grandmother", "दादी/नानी"],
  ["grandfather", "दादा/नाना"],
  ["member", "अन्य सदस्य"],
];

export default function Family({ onClose }: { onClose: () => void }) {
  const { lang } = useApp();
  const hi = lang === "hi";
  const { workspace: ws, setWorkspace, reset, mode, setMode } = useWorkspace();
  const owner = primaryPerson(ws);
  const [selected, setSelected] = useState(ws.people[0]?.id || "");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ws.people.some((p) => p.id === selected)) setSelected(ws.people[0]?.id || "");
  }, [ws.people.map((p) => p.id).join("|")]);
  const person = ws.people.find((p) => p.id === selected);
  const edit = (patch: Partial<Person>) =>
    setWorkspace((w) => ({
      ...w,
      people: w.people.map((p) => (p.id === selected ? { ...p, ...patch } : p)),
    }));
  const relationKnown = RELATIONS.some(([r]) => r === person?.relation);
  return (
    <Modal
      open
      onClose={onClose}
      title={
        mode === "personal"
          ? hi
            ? "मेरी प्रोफ़ाइल"
            : "My profile"
          : hi
            ? "परिवार और प्रोफ़ाइल"
            : "Family & profile"
      }
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => downloadWorkspace(ws)}>
            <Download className="h-4 w-4" /> {hi ? "योजना निर्यात करें" : "Export plan"}
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              if (!downloadRecovery())
                setError(
                  hi ? "कोई पुनर्प्राप्ति बैकअप नहीं है।" : "No recovery backup is present.",
                );
            }}
          >
            <LifeBuoy className="h-4 w-4" /> {hi ? "पुनर्प्राप्ति बैकअप" : "Recovery export"}
          </button>
          <button
            className="btn-ghost btn-sm ml-auto text-coral-700"
            onClick={async () => {
              if (
                !confirm(
                  hi
                    ? "साझा लिंक बंद करके इस ब्राउज़र की योजना मिटाएँ?"
                    : "Revoke shared links and erase the plan saved in this browser?",
                )
              )
                return;
              try {
                await reset();
                onClose();
              } catch (e: any) {
                setError(e.message + " — plan retained so you can revoke its links.");
              }
            }}
          >
            <Trash2 className="h-4 w-4" />{" "}
            {hi ? "मिटाएँ / नए सिरे से शुरू करें" : "Erase / start again"}
          </button>
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 p-3">
        <p className="text-sm text-ink-600">
          {mode === "personal"
            ? hi
              ? "व्यक्तिगत मोड: योजना सिर्फ़ आपके लिए। परिवार के सदस्य सहेजे रहते हैं।"
              : "Personal mode: the plan is just for you. Family members stay saved."
            : hi
              ? "परिवार मोड: हर व्यक्ति की जानकारी और दस्तावेज़ अलग रहते हैं।"
              : "Family mode: each person's facts and documents stay separate."}
        </p>
        <button
          className="btn-secondary btn-sm"
          onClick={() => setMode(mode === "personal" ? "family" : "personal")}
        >
          {mode === "personal" ? <Users className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
          {mode === "personal"
            ? hi
              ? "परिवार मोड"
              : "Use Family mode"
            : hi
              ? "व्यक्तिगत मोड"
              : "Personal mode"}
        </button>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {ws.people.map((p) => (
          <button
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${p.id === selected ? "border-teal-600 bg-teal-600 text-white" : "border-ink-200 bg-white text-ink-700"}`}
            key={p.id}
            onClick={() => setSelected(p.id)}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${p.id === selected ? "bg-white/20" : "bg-teal-50 text-teal-800"}`}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            {p.name}
            {p.id === owner ? (hi ? " (आप)" : " (you)") : p.deceased ? " †" : ""}
          </button>
        ))}
        {mode === "family" && (
          <button
            className="btn-ghost btn-sm rounded-full"
            disabled={ws.people.length >= 20}
            onClick={() => {
              const id = uid();
              setWorkspace((w) => ({
                ...w,
                people: [
                  ...w.people,
                  {
                    id,
                    name: hi ? "नया सदस्य" : "New member",
                    relation: "member",
                    deceased: false,
                    facts: {},
                  },
                ],
              }));
              setSelected(id);
            }}
          >
            <UserPlus className="h-4 w-4" /> {hi ? "सदस्य जोड़ें" : "Add member"}
          </button>
        )}
      </div>
      {person && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="field-label">{hi ? "नाम" : "Name"}</span>
              <input
                className="input"
                maxLength={80}
                value={person.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </label>
            {person.id === owner ? (
              <div>
                <span className="field-label">{hi ? "संबंध" : "Relationship"}</span>
                <div className="input flex items-center bg-ink-50 text-ink-600">
                  {hi ? "स्वयं" : "You"}
                </div>
              </div>
            ) : (
              <label>
                <span className="field-label">{hi ? "आपसे संबंध" : "Relationship to you"}</span>
                <select
                  className="input"
                  value={relationKnown ? person.relation : "other"}
                  onChange={(e) =>
                    edit({ relation: e.target.value === "other" ? "" : e.target.value })
                  }
                >
                  {RELATIONS.map(([r, h]) => (
                    <option key={r} value={r}>
                      {hi ? h : r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                  <option value="other">{hi ? "अन्य (लिखें)" : "Other (type it)"}</option>
                </select>
                {!relationKnown && (
                  <input
                    className="input mt-2"
                    maxLength={40}
                    value={person.relation}
                    placeholder={hi ? "जैसे बहू" : "e.g. daughter-in-law"}
                    onChange={(e) => edit({ relation: e.target.value })}
                  />
                )}
              </label>
            )}
            {person.id !== owner && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={person.deceased}
                  onChange={(e) => edit({ deceased: e.target.checked })}
                />
                {hi ? "इनका देहांत हो चुका है" : "This person has passed away"}
              </label>
            )}
          </div>
          <div>
            <h3 className="label mb-2">
              {hi ? "जानकारी (जो पता हो वही भरें)" : "Details (fill only what you know)"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "age",
                "state",
                "gender",
                "marital_status",
                "category",
                "annual_family_income",
                "annual_personal_income",
                "years_in_state",
                "has_bank_account",
                "disability",
              ].map((field) => (
                <FactInput
                  key={field}
                  field={field}
                  lang={lang}
                  value={person.facts[field]}
                  onChange={(value) => edit({ facts: { ...person.facts, [field]: value } })}
                />
              ))}
            </div>
          </div>
          {mode === "family" && ws.people.length > 1 && (
            <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4">
              <h3 className="font-bold">
                {hi ? "परिवार की साझा जानकारी" : "Shared household facts"}
              </h3>
              <p className="mb-3 text-sm text-ink-600">
                {hi
                  ? "केवल चुने सदस्यों पर लागू होती है। किसी व्यक्ति का अपना जवाब प्राथमिक रहता है।"
                  : "Applies only to the members you select. A person's own answer always takes precedence."}
              </p>
              {["state", "annual_family_income"].map((field) => {
                const item = ws.household.find((x) => x.field === field);
                return (
                  <div className="mb-4 rounded-xl bg-white p-3" key={field}>
                    <FactInput
                      field={field}
                      lang={lang}
                      value={item?.value}
                      onChange={(value) =>
                        setWorkspace((w) => ({
                          ...w,
                          household: [
                            ...w.household.filter((x) => x.field !== field),
                            { field, value, person_ids: item?.person_ids || [], confirmed: false },
                          ],
                        }))
                      }
                    />
                    <div className="mt-2 flex flex-wrap gap-3">
                      {ws.people.map((p) => (
                        <label className="flex items-center gap-1.5 text-sm" key={p.id}>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={item?.person_ids.includes(p.id) || false}
                            onChange={(e) =>
                              setWorkspace((w) => ({
                                ...w,
                                household: [
                                  ...w.household.filter((x) => x.field !== field),
                                  {
                                    field,
                                    value: item?.value ?? null,
                                    person_ids: e.target.checked
                                      ? [...(item?.person_ids || []), p.id]
                                      : (item?.person_ids || []).filter((id) => id !== p.id),
                                    confirmed: false,
                                  },
                                ],
                              }))
                            }
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={item?.confirmed || false}
                        disabled={!item?.person_ids.length || item?.value == null}
                        onChange={(e) =>
                          setWorkspace((w) => ({
                            ...w,
                            household: w.household.map((x) =>
                              x.field === field ? { ...x, confirmed: e.target.checked } : x,
                            ),
                          }))
                        }
                      />
                      {hi
                        ? "मैं पुष्टि करता/करती हूँ कि यह चुने लोगों पर लागू है"
                        : "I confirm this applies to the selected people"}
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          {mode === "personal" && ws.people.length === 1 && (
            <Callout tone="info">
              {hi
                ? "परिवार के सदस्यों के लिए योजनाएँ देखने हेतु ऊपर “परिवार मोड” चुनें और सदस्य जोड़ें।"
                : "To see schemes for family members, switch to Family mode above and add them."}
            </Callout>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-coral-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
