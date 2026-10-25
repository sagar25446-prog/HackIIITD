import { useRef, useState } from "react";
import { BookOpenCheck, Globe, MessageCircleQuestion, Mic, Send } from "lucide-react";
import { api, stream } from "../api";
import { ModeBadge, PageHeader, Section, Spinner } from "../components/ui";
import { useApp } from "../state";

type Msg = {
  role: "user" | "bot";
  text: string;
  sources?: any[];
  composer?: string;
  q?: string;
  research?: any;
};
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const SUGGEST = {
  en: [
    "Delhi widow pension: monthly amount and who is eligible",
    "My husband died. What can the family claim?",
    "How do I get an income certificate in Delhi?",
    "UPSC age limit for OBC",
  ],
  hi: [
    "विधवा पेंशन दिल्ली में कितनी मिलती है?",
    "आय प्रमाण पत्र कैसे बनवाएँ?",
    "पति की मृत्यु के बाद बीमा का पैसा कैसे मिलेगा?",
    "बेटी के लिए कौन सी योजना है?",
  ],
};

export default function Ask() {
  const { t, lang } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const ask = async (text = q) => {
    if (!text.trim()) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const r = await api.post<any>("/api/ask", { q: text, lang });
      setMsgs((m) => [
        ...m,
        { role: "bot", text: r.answer, sources: r.sources, composer: r.composer, q: text },
      ]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "bot", text: `Sorry — ${e.message}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const research = (idx: number) => {
    const m = msgs[idx];
    const upd = (r: any) =>
      setMsgs((all) =>
        all.map((x, i) => (i === idx ? { ...x, research: { ...(x.research || {}), ...r } } : x)),
      );
    upd({ running: true, sources: [], draft: "", step: "Planning the research…" });
    const merge = (f: (r: any) => any) =>
      setMsgs((all) =>
        all.map((x, i) =>
          i === idx ? { ...x, research: { ...x.research, ...f(x.research || {}) } } : x,
        ),
      );
    // research starts once with POST (the question never goes in a URL); following it is read-only
    api
      .post<any>("/api/ask/research", { q: m.q || "", lang })
      .then(({ job_id }) =>
        stream(
          `/api/jobs/${job_id}/events`,
          (ev) => {
            if (ev.type === "plan") merge(() => ({ plan: ev.questions, replay: ev.replay }));
            if (ev.type === "step") merge(() => ({ step: ev.text, replay: ev.replay }));
            if (ev.type === "source")
              merge((r) => ({ sources: [...(r.sources || []), ev], step: `Reading ${ev.title}` }));
            if (ev.type === "delta")
              merge((r) => ({ draft: (r.draft || "") + ev.text, step: "Writing the answer…" }));
            if (ev.type === "final")
              upd({ running: false, text: ev.text, citations: ev.citations, replay: ev.replay });
            if (ev.type === "error") upd({ running: false, error: ev.message });
            if (ev.type === "related")
              merge(() => ({
                step: `An earlier report on a related question exists (“${ev.title}”); it is not shown as your answer.`,
              }));
          },
          () =>
            merge((r) =>
              r.text || r.error
                ? { running: false }
                : { running: false, error: "Research ended without an answer — try again later." },
            ),
        ),
      )
      .catch((e) => upd({ running: false, error: e.message }));
  };

  const listen = () => {
    if (!SR) return;
    const r = new SR();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.onresult = (e: any) => ask(e.results[0][0].transcript);
    r.start();
  };

  return (
    <div className="flex min-h-[70vh] flex-col">
      <PageHeader
        icon={<MessageCircleQuestion className="h-5 w-5" />}
        title={lang === "hi" ? "JAAGRUK से पूछें" : "Ask JAAGRUK"}
        sub={
          lang === "hi"
            ? "हिंदी या अंग्रेज़ी में कुछ भी पूछें। हर जवाब के साथ आधिकारिक स्रोत — या साफ़ “पता नहीं”। लाइव जवाब के लिए “सरकारी साइटें अभी पढ़ें” दबाएँ।"
            : "Ask anything in Hindi or English. Every answer comes with its official source — or an honest “I don't know”. Tap “Read official sites live” for a fresh, cited answer."
        }
      />
      {msgs.length === 0 && (
        <Section title={lang === "hi" ? "शुरू करने के लिए" : "Try asking"}>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGEST[lang].map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="card card-hover p-3 text-left text-sm font-medium text-ink-800"
              >
                {s}
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="flex-1 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[85%] rounded-2xl p-4 ${m.role === "user" ? "bg-teal-600 text-white" : "card"}`}
            >
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</div>
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 space-y-1">
                  {m.sources.map((s: any) => (
                    <a
                      key={s.id}
                      href={s.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs text-teal-700 hover:underline"
                    >
                      <BookOpenCheck className="h-3.5 w-3.5" /> {s.title}{" "}
                      <span className="text-ink-500">· {s.source}</span>
                    </a>
                  ))}
                </div>
              )}
              {m.role === "bot" && m.q && (
                <div className="mt-3 border-t border-ink-100 pt-2">
                  {!m.research && (
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => research(i)}>
                      <Globe className="h-3.5 w-3.5" /> {t("readLive")} · TinyFish Research
                    </button>
                  )}
                  {m.research?.running && (
                    <div className="rounded-xl bg-ink-50 p-3 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-teal-700">
                        <Spinner className="h-3.5 w-3.5" /> {m.research.step}
                      </div>
                      {m.research.plan && (
                        <ul className="mt-1 list-disc pl-4 text-ink-500">
                          {m.research.plan.map((p: string) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      )}
                      {(m.research.sources || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {m.research.sources.map((s: any) => (
                            <a
                              key={s.url}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className={`chip ${s.official ? "bg-teal-100 text-teal-700" : "bg-ink-100 text-ink-500"}`}
                              title={s.url}
                            >
                              {s.official ? "✓ " : ""}
                              {new URL(s.url).hostname.replace("www.", "")}
                            </a>
                          ))}
                        </div>
                      )}
                      {m.research.draft && (
                        <div className="mt-2 whitespace-pre-wrap text-ink-700">
                          {m.research.draft.slice(-900)}
                        </div>
                      )}
                    </div>
                  )}
                  {m.research?.error && (
                    <div className="text-xs text-coral-600">{m.research.error}</div>
                  )}
                  {m.research?.text && (
                    <div className="mt-1 rounded-xl bg-ink-50 p-3 text-xs">
                      <div className="mb-1 flex items-center gap-2 font-semibold">
                        {m.research.replay
                          ? "Read from the web earlier today"
                          : "Read from the web just now"}{" "}
                        · TinyFish Research <ModeBadge replay={m.research.replay} />
                      </div>
                      <div className="max-h-72 overflow-y-auto text-ink-700">
                        <Markdown text={String(m.research.text).slice(0, 4000)} />
                      </div>
                      <div className="mt-2 label">
                        Sources (
                        {(m.research.citations || []).filter((c: any) => c.official).length}{" "}
                        official)
                      </div>
                      {[...(m.research.citations || [])]
                        .sort((a: any, b: any) => Number(b.official) - Number(a.official))
                        .slice(0, 8)
                        .map((c: any, k: number) => (
                          <a
                            key={k}
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`mt-1 block truncate underline ${c.official ? "text-teal-700" : "text-ink-500"}`}
                          >
                            {c.official ? "✓ official · " : ""}
                            {c.title}
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {m.composer && (
                <div className="mt-1 text-[10px] text-ink-300">
                  composed by {m.composer} · grounded in retrieved passages only
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Spinner /> …
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="sticky bottom-20 mt-4 flex gap-2 rounded-2xl bg-white p-2 shadow-card lg:bottom-4">
        <input
          className="input border-0 focus:ring-0"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder={t("askPlaceholder")}
        />
        {SR && (
          <button className="btn-ghost px-3" onClick={listen} aria-label="Speak">
            <Mic className="h-4 w-4" />
          </button>
        )}
        <button
          className="btn-primary px-3"
          onClick={() => ask()}
          disabled={busy}
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Minimal, safe Markdown for research reports: headings, bold, rules and bullets — no raw HTML. */
function Markdown({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <b key={i}>{part.slice(2, -2)}</b>
        ) : (
          <span key={i}>{part.replace(/\*/g, "")}</span>
        ),
      );
  return (
    <div className="space-y-1">
      {text.split(/\r?\n/).map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return null;
        if (/^-{3,}$/.test(line.trim())) return <hr key={i} className="my-2 border-ink-100" />;
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h)
          return (
            <div
              key={i}
              className={h[1].length === 1 ? "pt-1 text-sm font-bold" : "pt-1 font-semibold"}
            >
              {inline(h[2])}
            </div>
          );
        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li)
          return (
            <div key={i} className="pl-3">
              • {inline(li[1])}
            </div>
          );
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
