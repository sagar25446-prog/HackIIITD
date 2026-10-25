import { Case, Person } from "./types";
import { FIELD, caseFields, choiceLabel } from "./fields";
import { stageLabel } from "./states";
export function FactInput({
  field,
  value,
  onChange,
  lang,
}: {
  field: string;
  value: any;
  onChange: (v: any) => void;
  lang: string;
}) {
  const spec = FIELD[field] || [field, field, "text"];
  const hi = lang === "hi";
  // A saved value outside the list (for example "Other" from an older profile) stays selectable.
  const choices = [
    ...(spec[3] || []),
    ...(spec[2] === "select" && value && !(spec[3] || []).includes(String(value))
      ? [String(value)]
      : []),
  ];
  return (
    <label className="block text-sm font-semibold text-ink-700">
      <span>{spec[hi ? 1 : 0]}</span>
      {spec[2] === "date" ? (
        <input
          className="input mt-1"
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      ) : spec[2] === "bool" || spec[2] === "select" ? (
        <select
          className="input mt-1"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? null
                : spec[2] === "bool"
                  ? e.target.value === "true"
                  : e.target.value,
            )
          }
        >
          <option value="">{hi ? "अज्ञात / नहीं बताया" : "Unknown / not answered"}</option>
          {(spec[2] === "bool" ? ["true", "false"] : choices).map((v) => (
            <option key={v} value={v}>
              {spec[2] === "bool"
                ? v === "true"
                  ? hi
                    ? "हाँ"
                    : "Yes"
                  : hi
                    ? "नहीं"
                    : "No"
                : choiceLabel(v, hi)}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input mt-1"
          type={spec[2] === "number" ? "number" : "text"}
          min={spec[2] === "number" ? 0 : undefined}
          value={value ?? ""}
          maxLength={120}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? null
                : spec[2] === "number"
                  ? Number(e.target.value)
                  : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
export default function CaseFields({
  value,
  people,
  lang,
  onChange,
}: {
  value: Case;
  people: Person[];
  lang: string;
  onChange: (c: Case) => void;
}) {
  const hi = lang === "hi";
  const base = people.find((p) => p.id === value.applicant_id)?.facts || {};
  const service = String(value.answers.service || "aadhaar");
  const stages: Record<string, string[]> = {
    aadhaar: ["new", "name_update", "address_update", "dob_update", "mobile_update"],
    pan: ["instant_epan", "new", "correction"],
    driving_licence: ["learner", "permanent", "renewal"],
    passport: ["new", "renewal"],
    birth_death_certificate: ["birth", "death"],
  };
  const relevant =
    value.kind === "paperwork"
      ? [
          "service",
          "state",
          "age",
          ...(service === "pan" && value.answers.application_stage === "instant_epan"
            ? ["already_has_pan", "aadhaar_ready", "linked_mobile", "representative_assessee"]
            : []),
          ...(service === "driving_licence"
            ? [
                "vehicle_type",
                ...(value.answers.application_stage === "permanent" ? ["learner_issued_on"] : []),
              ]
            : []),
        ]
      : caseFields(value.kind, value.mode);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        {hi
          ? "जवाब केवल इस मामले को बदलते हैं। खाली जवाब अज्ञात रहता है। पहचान संख्या, OTP या बैंक विवरण न लिखें।"
          : "Answers change this case only. Blank answers stay unknown. Do not enter identity numbers, OTPs or account details."}
      </p>
      {value.kind === "education" && (
        <label className="block">
          {hi ? "आवेदन प्रकार" : "Application type"}
          <select
            className="input"
            value={value.mode}
            onChange={(e) => onChange({ ...value, mode: e.target.value as Case["mode"] })}
          >
            <option value="fresh">{hi ? "नया आवेदन" : "Fresh application"}</option>
            <option value="renewal">{hi ? "नवीनीकरण" : "Renewal"}</option>
          </select>
        </label>
      )}
      {value.kind === "paperwork" && (
        <label className="block">
          {hi ? "आवेदन चरण" : "Application stage"}
          <select
            className="input"
            value={String(value.answers.application_stage || "")}
            onChange={(e) =>
              onChange({
                ...value,
                answers: { ...value.answers, application_stage: e.target.value },
              })
            }
          >
            <option value="">{hi ? "चुनें" : "Choose"}</option>
            {(stages[service] || ["new"]).map((v) => (
              <option key={v} value={v}>
                {stageLabel(v, hi)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {relevant.map((key) => (
          <FactInput
            key={key}
            field={key}
            value={
              Object.prototype.hasOwnProperty.call(value.answers, key)
                ? value.answers[key]
                : base[key]
            }
            lang={lang}
            onChange={(v) =>
              onChange({
                ...value,
                answers: {
                  ...value.answers,
                  [key]: v,
                  ...(key === "service" ? { application_stage: null } : {}),
                },
              })
            }
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          {hi ? "उपयोगकर्ता द्वारा बताई स्थिति" : "User-reported stage"}
          <select
            className="input"
            value={value.stage}
            onChange={(e) => onChange({ ...value, stage: e.target.value as Case["stage"] })}
          >
            {[
              ["preparing", "Preparing", "तैयारी"],
              ["user_reported_submitted", "Submitted (user-reported)", "जमा किया (स्वयं बताया)"],
              ["needs_attention", "Needs attention", "ध्यान चाहिए"],
              ["user_reported_resolved", "Resolved (user-reported)", "सुलझा (स्वयं बताया)"],
            ].map(([v, en, h]) => (
              <option key={v} value={v}>
                {hi ? h : en}
              </option>
            ))}
          </select>
        </label>
        <label>
          {hi ? "अपनी अगली जाँच की तिथि" : "Your follow-up date"}
          <input
            className="input"
            type="date"
            value={value.follow_up || ""}
            onChange={(e) => onChange({ ...value, follow_up: e.target.value || null })}
          />
        </label>
      </div>
      <label className="block">
        {hi ? "तैयारी के नोट्स (निजी विवरण नहीं)" : "Preparation notes (no sensitive identifiers)"}
        <textarea
          className="input mt-1"
          maxLength={2000}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
    </div>
  );
}
