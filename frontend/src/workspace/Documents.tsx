import { Case, DocumentAssertion, Person, Requirement, uid } from "./types";
import { indiaToday } from "./calendarDates";
export default function Documents({
  value,
  requirements,
  people,
  globalDocs,
  lang,
  onChange,
}: {
  value: Case;
  requirements: Requirement[];
  people: Person[];
  globalDocs: DocumentAssertion[];
  lang: string;
  onChange: (c: Case) => void;
}) {
  const hi = lang === "hi";
  const update = (person: string, kind: string, patch: Partial<DocumentAssertion>) => {
    const existing = value.documents.find((d) => d.person_id === person && d.kind === kind) ||
      globalDocs.find((d) => d.person_id === person && d.kind === kind) || {
        id: uid(),
        person_id: person,
        kind,
        state: "unknown" as const,
      };
    onChange({
      ...value,
      documents: [
        ...value.documents.filter((d) => !(d.person_id === person && d.kind === kind)),
        { ...existing, ...patch },
      ],
    });
  };
  return (
    <div className="space-y-3">
      {requirements.map((r) => {
        const d =
          value.documents.find((d) => d.person_id === r.person_id && d.kind === r.selected) ||
          globalDocs.find((d) => d.person_id === r.person_id && d.kind === r.selected);
        return (
          <div className="rounded-xl border border-ink-100 p-3" key={r.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="font-bold">{hi ? r.label_hi : r.label}</h4>
              <span className="chip bg-ink-50">
                {people.find((p) => p.id === r.person_id)?.name}
              </span>
              <span className="chip bg-amber-50">
                {hi
                  ? (
                      {
                        already_available: "पहले से उपलब्ध",
                        missing: "नहीं है",
                        expired: "अवधि समाप्त",
                        needs_confirmation: "पुष्टि चाहिए",
                      } as Record<string, string>
                    )[r.state]
                  : r.state.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mb-2 text-sm text-ink-500">{hi ? r.explanation_hi : r.explanation}</p>
            {r.options.length > 1 && (
              <p className="mb-2 text-sm">
                {hi ? "स्वीकृत विकल्प" : "Accepted options"}: {r.options.join(" / ")}.{" "}
                {hi ? "जो उपलब्ध है उसे चुनें।" : "Select the proof you have."}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                {hi ? "उपलब्धता" : "Availability"}
                <select
                  className="input"
                  value={d?.state || "unknown"}
                  onChange={(e) =>
                    update(r.person_id, r.selected, {
                      state: e.target.value as DocumentAssertion["state"],
                    })
                  }
                >
                  <option value="unknown">{hi ? "अज्ञात" : "Unknown"}</option>
                  <option value="available">{hi ? "उपलब्ध" : "Available"}</option>
                  <option value="missing">{hi ? "नहीं है" : "Missing"}</option>
                </select>
              </label>
              <label className="text-sm">
                {hi ? "समाप्ति तिथि (यदि हो)" : "Expiry date (if any)"}
                <input
                  className="input"
                  type="date"
                  value={d?.expires_on || ""}
                  onChange={(e) =>
                    update(r.person_id, r.selected, { expires_on: e.target.value || null })
                  }
                />
              </label>
              {(r.id === "residence" || r.id === "bank_statement") && (
                <>
                  <label className="text-sm">
                    {hi ? "प्रमाण अवधि शुरू" : "Evidence covers from"}
                    <input
                      type="date"
                      className="input"
                      max={indiaToday()}
                      value={d?.covers_from || ""}
                      onChange={(e) =>
                        update(r.person_id, r.selected, { covers_from: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="text-sm">
                    {hi ? "प्रमाण अवधि अंत" : "Evidence covers to"}
                    <input
                      type="date"
                      className="input"
                      value={d?.covers_to || ""}
                      onChange={(e) =>
                        update(r.person_id, r.selected, { covers_to: e.target.value || null })
                      }
                    />
                  </label>
                </>
              )}
            </div>
            {r.options.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.options
                  .filter((k) => k !== r.selected)
                  .map((kind) => (
                    <button
                      key={kind}
                      className="btn-ghost text-xs"
                      onClick={() => update(r.person_id, kind, { state: "available" })}
                    >
                      {hi ? "मेरे पास है: " : "I have: "}
                      {kind.replace("doc_", "").replaceAll("_", " ")}
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
