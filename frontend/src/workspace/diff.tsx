import { FIELD } from "./fields";

const show = (v: any): string =>
  v === null || v === undefined || v === ""
    ? "—"
    : Array.isArray(v)
      ? `${v.length}`
      : typeof v === "object"
        ? Object.entries(v)
            .map(([k, x]) => `${k}: ${String(x)}`)
            .join(", ")
        : String(v);

/** Only the fields that differ, in words — never a raw JSON dump. */
export function diffFields(a: any, b: any): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const k of ["stage", "notes", "follow_up", "completed_tasks", "documents"]) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]))
      out.push([k, show(a?.[k]), show(b?.[k])]);
  }
  const keys = new Set([...Object.keys(a?.answers || {}), ...Object.keys(b?.answers || {})]);
  for (const k of keys)
    if (JSON.stringify(a?.answers?.[k]) !== JSON.stringify(b?.answers?.[k]))
      out.push([k, show(a?.answers?.[k]), show(b?.answers?.[k])]);
  return out;
}

export function fieldLabel(k: string, hi: boolean): string {
  const own: Record<string, [string, string]> = {
    stage: ["Stage", "चरण"],
    notes: ["Notes", "नोट्स"],
    follow_up: ["Follow-up date", "अगली जाँच"],
    completed_tasks: ["Completed steps", "पूरे कदम"],
    documents: ["Documents", "दस्तावेज़"],
  };
  return own[k]?.[hi ? 1 : 0] || FIELD[k]?.[hi ? 1 : 0] || k.replaceAll("_", " ");
}

/** Before/after of a reviewed rule configuration, as changed keys only. */
export function diffConfig(a: any, b: any): [string, string, string][] {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys]
    .filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]))
    .map((k) => [k, show(a?.[k]), show(b?.[k])]);
}

export function DiffTable({
  rows,
  hi,
  left,
  right,
}: {
  rows: [string, string, string][];
  hi: boolean;
  left: string;
  right: string;
}) {
  if (!rows.length) return <p className="text-sm">{hi ? "कोई अंतर नहीं" : "No differences"}</p>;
  return (
    <table className="mt-2 w-full text-left text-sm">
      <thead>
        <tr>
          <th className="p-1">{hi ? "फ़ील्ड" : "Field"}</th>
          <th className="p-1">{left}</th>
          <th className="p-1">{right}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k} className="border-t border-ink-200 align-top">
            <td className="p-1 font-semibold">{fieldLabel(k, hi)}</td>
            <td className="p-1">{a}</td>
            <td className="p-1">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
