import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { inr } from "../api";
import { Empty, Section } from "../components/ui";
import { hi, useApp } from "../state";

export default function Life() {
  const { evaluation: ev, catalog, lang, go, profile, patchProfile, t } = useApp();
  const all = catalog?.life_events || [];
  const mine = new Set(profile?.life_events || []);
  const schemes = (ids: string[]) => ids.map((id) => catalog?.schemes.find((s: any) => s.id === id)).filter(Boolean);
  const status = (id: string) => ev?.matches.find((m: any) => m.scheme_id === id)?.decision.status;

  return (
    <div>
      <Section title={lang === "hi" ? "जीवन की घटनाएँ" : "Life-event mode"} sub={lang === "hi" ? "जो हुआ, उसके हिसाब से पूरी सूची" : "Tell us what happened; get the complete checklist — schemes, claims and documents, in order."}>
        <div className="flex flex-wrap gap-2">
          {all.map((e: any) => (
            <button key={e.id} onClick={() => patchProfile({ life_events: mine.has(e.id) ? [...mine].filter((x) => x !== e.id) : [...mine, e.id] })}
              className={`chip px-3 py-1.5 text-sm ${mine.has(e.id) ? "bg-teal-500 text-white" : "bg-white text-ink-700 ring-1 ring-ink-100"}`}>
              {hi(e, "label", lang)}
            </button>
          ))}
        </div>
      </Section>
      {mine.size === 0 && <Empty>{lang === "hi" ? "ऊपर कोई घटना चुनें।" : "Pick an event above."}</Empty>}
      {all.filter((e: any) => mine.has(e.id)).map((e: any) => (
        <div key={e.id} className="card mb-5 p-5 fade-up">
          <h3 className="text-lg font-bold">{hi(e, "label", lang)}</h3>
          <p className="mt-1 text-sm text-ink-700">{hi(e, "intro", lang)}</p>
          {e.claims?.length > 0 && (
            <div className="mt-4">
              <div className="label mb-2">{t("claimsToMake")}</div>
              <div className="space-y-2">
                {e.claims.map((c: any) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-xl bg-ink-50 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
                    <div className="flex-1 text-sm">
                      <div className="font-semibold">{hi(c, "title", lang)}</div>
                      <div className="text-ink-700">{hi(c, "detail", lang)}</div>
                      {c.check && <div className="mt-1 text-xs text-ink-500">{t("howToCheck")}: {hi(c, "check", lang)}</div>}
                      {c.source_url && <a className="mt-1 inline-flex items-center gap-1 text-xs text-teal-600 underline" href={c.source_url} target="_blank" rel="noreferrer">source <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                    {c.action === "wapsi" && <button className="btn-amber px-3 py-1.5 text-sm" onClick={() => go("wapsi")}>Search <ArrowRight className="h-4 w-4" /></button>}
                    {c.value && <span className="chip bg-teal-50 text-teal-700">{inr(c.value, true)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {e.schemes?.length > 0 && (
            <div className="mt-4">
              <div className="label mb-2">{t("schemesToApply")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {schemes(e.schemes).map((s: any) => {
                  const st = status(s.id);
                  return (
                    <div key={s.id} className="rounded-xl border border-ink-100 p-3 text-sm">
                      <div className="font-semibold">{hi(s, "name", lang)}</div>
                      <div className="text-ink-500">{s.benefit.display}</div>
                      <div className="mt-1 text-xs">{st === "eligible" ? <span className="text-teal-700">{t("provenEligible")}</span> : st === "needs_info" ? <span className="text-amber-600">{t("needsOneAnswer")}</span> : <span className="text-ink-500">{t("notEligibleOrChoose")}</span>}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
