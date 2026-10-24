import { CalendarHeart, Cpu, Home as HomeIcon, MessageCircleQuestion, Radar as RadarIcon, ShieldAlert, Users, Wallet } from "lucide-react";
import Ask from "./pages/Ask";
import Home from "./pages/Home";
import Life from "./pages/Life";
import Onboarding from "./pages/Onboarding";
import Ops from "./pages/Ops";
import Radar from "./pages/Radar";
import Scam from "./pages/Scam";
import Wapsi from "./pages/Wapsi";
import { Page, useApp } from "./state";

const NAV: { id: Page; key: any; icon: any }[] = [
  { id: "home", key: "home", icon: HomeIcon },
  { id: "life", key: "life", icon: CalendarHeart },
  { id: "wapsi", key: "wapsi", icon: Wallet },
  { id: "scam", key: "scam", icon: ShieldAlert },
  { id: "radar", key: "radar", icon: RadarIcon },
  { id: "ask", key: "ask", icon: MessageCircleQuestion },
  { id: "ops", key: "ops", icon: Cpu },
];

export default function App() {
  const { profile, page, go, t, lang, setLang, setProfile, health } = useApp();
  if (!profile) return <Onboarding />;
  const P = { home: Home, life: Life, wapsi: Wapsi, scam: Scam, radar: Radar, ask: Ask, ops: Ops }[page] || Home;

  return (
    <div className="min-h-full lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-100 bg-white p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-extrabold tracking-tight">JAAGRUK</span>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${page === n.id ? "bg-teal-50 text-teal-700" : "text-ink-700 hover:bg-ink-50"}`}>
              <n.icon className="h-5 w-5" /> {t(n.key)}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2 text-xs text-ink-500">
          <div className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${health?.tinyfish?.live ? "bg-teal-500" : "bg-amber-500"}`} /> TinyFish {health?.tinyfish?.live ? "live" : `replay (${health?.tinyfish?.recordings ?? 0} recorded runs)`}</div>
          <div className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${health?.llm?.available ? "bg-teal-500" : "bg-ink-300"}`} /> Claude {health?.llm?.available ? "on" : "off (deterministic mode)"}</div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-100 bg-white/90 px-4 py-3 backdrop-blur">
          <img src="/icon.svg" alt="" className="h-7 w-7 lg:hidden" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{profile.name || "My family"}</div>
            <div className="truncate text-xs text-ink-500">{[profile.age && `${profile.age} yrs`, profile.state, profile.occupation?.replace("_", " ")].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="inline-flex rounded-lg border border-ink-100 p-0.5 text-xs font-semibold">
            {(["en", "hi"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2.5 py-1 ${lang === l ? "bg-teal-500 text-white" : "text-ink-700"}`}>{l === "en" ? "EN" : "हि"}</button>)}
          </div>
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setProfile(null)} title="Switch family"><Users className="h-4 w-4" /></button>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 lg:pb-10">
          <P />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-ink-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map((n) => (
          <button key={n.id} onClick={() => go(n.id)} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${page === n.id ? "text-teal-600" : "text-ink-500"}`}>
            <n.icon className="h-5 w-5" />
            <span className="truncate">{t(n.key)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
