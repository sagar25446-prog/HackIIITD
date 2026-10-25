import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Mic, ShieldCheck, Volume2 } from "lucide-react";
import { api } from "../api";
import { Spinner } from "../components/ui";
import { useApp } from "../state";

type Opt = { v: any; en: string; hi: string; say?: string[] };
type Q = {
  field: string;
  type: "text" | "number" | "choice" | "multi";
  q: string;
  q_hi: string;
  options?: Opt[];
  chips?: Opt[];
  min?: number;
  max?: number;
  unit?: string;
};

// ---- voice helpers -------------------------------------------------------------------------
const HI_NUM: Record<string, number> = {
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  bees: 20,
  tees: 30,
  chalees: 40,
  pachaas: 50,
  pachas: 50,
  saath: 60,
  sattar: 70,
  assi: 80,
  nabbe: 90,
  sau: 100,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  बीस: 20,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  साठ: 60,
  सत्तर: 70,
  अस्सी: 80,
  नब्बे: 90,
  सौ: 100,
  डेढ़: 1.5,
  ढाई: 2.5,
  dedh: 1.5,
  dhai: 2.5,
};
const MULT: [RegExp, number][] = [
  [/lakh|lac|लाख/, 100000],
  [/hazaar|hazar|thousand|हज़ार|हजार/, 1000],
];

export function parseNumber(s: string): number | null {
  const low = s.toLowerCase().replace(/,/g, "");
  const deva = low.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
  let n: number | null = null;
  const m = deva.match(/\d+(\.\d+)?/);
  if (m) n = parseFloat(m[0]);
  else {
    const words = deva
      .split(/\s+/)
      .map((w) => HI_NUM[w])
      .filter((x) => x !== undefined) as number[];
    if (words.length) n = words.reduce((a, b) => (b === 100 ? a * 100 : a + b), 0) || words[0];
  }
  if (n === null) return null;
  for (const [re, k] of MULT) if (re.test(deva)) return Math.round(n * k);
  return Math.round(n);
}

function matchOptions(s: string, opts: Opt[]): Opt[] {
  const low = s.toLowerCase();
  return opts.filter((o) =>
    [o.en, o.hi, ...(o.say || [])].some((w) => w && low.includes(String(w).toLowerCase())),
  );
}

const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export default function Onboarding() {
  const { lang, setLang, t, setProfile } = useApp();
  const [personas, setPersonas] = useState<any[]>([]);
  const [conf, setConf] = useState<{ intro: any; questions: Q[] } | null>(null);
  const [mode, setMode] = useState<"pick" | "ask">("pick");
  const [i, setI] = useState(0);
  const [ans, setAns] = useState<Record<string, any>>({ language: lang });
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const rec = useRef<any>(null);

  useEffect(() => {
    api
      .get<any[]>("/api/personas")
      .then(setPersonas)
      .catch(() => setPersonas([]));
    api
      .get<any>("/api/onboarding")
      .then(setConf)
      .catch(() => null);
  }, []);

  const q = conf?.questions[i];
  const say = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "hi" ? "hi-IN" : "en-IN";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* no TTS */
    }
  };
  useEffect(() => {
    if (mode === "ask" && q) say(lang === "hi" ? q.q_hi : q.q);
    setHeard("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, mode]);

  const set = (v: any) => setAns((a) => ({ ...a, [q!.field]: v }));
  const listen = () => {
    if (!SR || !q) return;
    const r = new SR();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.interimResults = false;
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setHeard(text);
      if (q.type === "text")
        set(
          text
            .replace(/^(my name is|mera naam|मेरा नाम)\s*/i, "")
            .replace(/\s*(hai|है)$/i, "")
            .trim(),
        );
      else if (q.type === "number") {
        const n = parseNumber(text);
        if (n !== null) set(n);
      } else if (q.options) {
        const hits = matchOptions(text, q.options);
        if (q.type === "multi") set(hits.map((h) => h.v));
        else if (hits[0]) set(hits[0].v);
      }
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const finish = () => {
    const p: Record<string, any> = { ...ans, language: lang };
    if (!p.life_events) p.life_events = [];
    setProfile(p, null);
  };

  if (!conf)
    return (
      <div className="flex min-h-full items-center justify-center gap-2 p-10 text-ink-500">
        <Spinner /> {lang === "hi" ? "लोड हो रहा है…" : "Loading…"}
      </div>
    );

  if (mode === "pick")
    return (
      <div className="min-h-full bg-gradient-to-b from-teal-50 via-ink-50 to-ink-50">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/icon.svg" alt="" className="h-10 w-10" />
              <span className="text-xl font-extrabold tracking-tight">JAAGRUK</span>
            </div>
            <div className="segmented" role="group" aria-label="Language">
              {(["en", "hi"] as const).map((l) => (
                <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l === "en" ? "English" : "हिन्दी"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-10 text-center sm:mt-14">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {lang === "hi" ? "आपका हक़, आपके हाथ" : "Every rupee your family is owed"}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-600">{t("tagline")}</p>
          </div>
          <div className="card mx-auto mt-8 max-w-xl p-6 text-center shadow-lift">
            <p className="mb-5 text-ink-700">{conf.intro[lang]}</p>
            <button className="btn-primary px-6 py-3 text-base" onClick={() => setMode("ask")}>
              <Mic className="h-5 w-5" /> {t("myProfile")}
            </button>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <ShieldCheck className="h-4 w-4 text-teal-700" /> {t("noFee")}
            </p>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {(lang === "hi"
              ? [
                  ["1", "बताइए", "90 सेकंड में बोलकर या लिखकर — आधार नहीं चाहिए।"],
                  ["2", "प्रमाण देखिए", "हर योजना आधिकारिक नियमों पर सॉल्वर से जाँची जाती है।"],
                  [
                    "3",
                    "दावा कीजिए",
                    "दस्तावेज़, तिथियाँ और लावारिस पैसे की खोज — आपकी अनुमति से।",
                  ],
                ]
              : [
                  ["1", "Tell us", "Speak or type for 90 seconds — no Aadhaar needed."],
                  [
                    "2",
                    "See the proof",
                    "Every scheme is checked against the official rules by a solver.",
                  ],
                  [
                    "3",
                    "Claim it",
                    "Documents, deadlines and unclaimed money — only with your consent.",
                  ],
                ]
            ).map(([n, h, b]) => (
              <div key={n} className="rounded-2xl bg-white/70 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                  {n}
                </div>
                <div className="mt-2 font-bold">{h}</div>
                <div className="text-sm text-ink-600">{b}</div>
              </div>
            ))}
          </div>
          <p className="label mb-3 mt-10 text-center">{t("tryPersona")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => setProfile(p.profile, p.id)}
                className="card card-hover p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-800">
                    {String(p.label).slice(0, 1)}
                  </span>
                  <div className="font-bold leading-snug">{p.label}</div>
                </div>
                <div className="mt-2 text-sm text-ink-600">{p.story}</div>
              </button>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-ink-500">
            {lang === "hi"
              ? "डेमो परिवार काल्पनिक हैं। आपकी जानकारी केवल इसी ब्राउज़र में रहती है।"
              : "Demo families are fictional. Your details stay in this browser only."}
          </p>
        </div>
      </div>
    );

  const val = q ? ans[q.field] : undefined;
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${((i + 1) / conf.questions.length) * 100}%` }}
          />
        </div>
        <span className="text-sm text-ink-500">
          {i + 1}/{conf.questions.length}
        </span>
      </div>
      {q && (
        <div className="card p-6 fade-up" key={q.field}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <h2 className="text-2xl font-bold leading-snug">{lang === "hi" ? q.q_hi : q.q}</h2>
            <button
              className="rounded-lg p-2 text-ink-500 hover:bg-ink-50"
              aria-label="Read aloud"
              onClick={() => say(lang === "hi" ? q.q_hi : q.q)}
            >
              <Volume2 className="h-5 w-5" />
            </button>
          </div>
          {q.type === "text" && (
            <input
              className="input text-lg"
              value={val || ""}
              onChange={(e) => set(e.target.value)}
              autoFocus
            />
          )}
          {q.type === "number" && (
            <>
              <input
                className="input text-lg"
                inputMode="numeric"
                value={val ?? ""}
                onChange={(e) =>
                  set(e.target.value === "" ? undefined : Number(e.target.value.replace(/\D/g, "")))
                }
                autoFocus
              />
              {q.unit && <p className="mt-1 text-xs text-ink-500">{q.unit}</p>}
              {q.chips && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.chips.map((c) => (
                    <button
                      key={c.v}
                      onClick={() => set(c.v)}
                      className={`chip px-3 py-1.5 text-sm ${val === c.v ? "bg-teal-600 text-white" : "bg-ink-50 text-ink-700"}`}
                    >
                      {c[lang]}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {(q.type === "choice" || q.type === "multi") && (
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options!.map((o) => {
                const on = q.type === "multi" ? (val || []).includes(o.v) : val === o.v;
                return (
                  <button
                    key={String(o.v)}
                    onClick={() =>
                      q.type === "multi"
                        ? set(
                            on ? (val || []).filter((x: any) => x !== o.v) : [...(val || []), o.v],
                          )
                        : set(o.v)
                    }
                    className={`rounded-xl border px-4 py-3 text-left font-medium transition ${on ? "border-teal-500 bg-teal-50 text-teal-800" : "border-ink-100 bg-white hover:border-teal-200"}`}
                  >
                    {o[lang]}
                  </button>
                );
              })}
            </div>
          )}
          {SR && (
            <button
              onClick={listen}
              disabled={listening}
              className={`btn-ghost mt-5 w-full ${listening ? "pulse-ring border-teal-400" : ""}`}
            >
              <Mic className="h-5 w-5 text-teal-600" /> {listening ? t("listening") : t("speak")}
            </button>
          )}
          {heard && <p className="mt-2 text-center text-sm text-ink-500">“{heard}”</p>}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between">
        <button className="btn-ghost" onClick={() => (i === 0 ? setMode("pick") : setI(i - 1))}>
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </button>
        {i < conf.questions.length - 1 ? (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setI(i + 1)}>
              {t("skip")}
            </button>
            <button className="btn-primary" onClick={() => setI(i + 1)}>
              {t("next")} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button className="btn-primary" onClick={finish}>
            {t("start")} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
