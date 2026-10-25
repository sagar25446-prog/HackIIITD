import { Suspense, useEffect, useState } from "react";
import {
  CalendarHeart,
  ClipboardList,
  Cpu,
  Home as HomeIcon,
  Info,
  LucideIcon,
  MessageCircleQuestion,
  MoreHorizontal,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { Key } from "./i18n";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import { Page, useApp } from "./state";
import { Sheet, ToastView } from "./components/ui";
import { lazyPage, SafeBoundary } from "./components/Safe";
import CaseDetail from "./workspace/CaseDetail";
import Family from "./workspace/Family";
import { useWorkspace } from "./workspace/WorkspaceProvider";

// Heavier screens load when first opened.
const Ask = lazyPage(() => import("./pages/Ask"));
const Ops = lazyPage(() => import("./pages/Ops"));
const Wapsi = lazyPage(() => import("./pages/Wapsi"));
const PersonalEvents = lazyPage(() => import("./workspace/PersonalEvents"));
const ServicePlanner = lazyPage(() => import("./workspace/ServicePlanner"));

type NavItem = { id: Page; key: Key; icon: LucideIcon };
/** Four primary destinations. My plan also holds Discover, Calendar and Updates as tabs. */
const PRIMARY: NavItem[] = [
  { id: "home", key: "home", icon: HomeIcon },
  { id: "life", key: "life", icon: CalendarHeart },
  { id: "paperwork", key: "paperwork", icon: ClipboardList },
  { id: "wapsi", key: "wapsi", icon: Wallet },
];
const SECONDARY: NavItem[] = [
  { id: "ask", key: "ask", icon: MessageCircleQuestion },
  { id: "ops", key: "judges", icon: Cpu },
];
const PLAN_PAGES: Page[] = ["home", "explore", "radar", "calendar"];
const PAGE: Partial<Record<Page, any>> = {
  life: PersonalEvents,
  paperwork: ServicePlanner,
  wapsi: Wapsi,
  ask: Ask,
  ops: Ops,
};
const active = (id: Page, page: Page) => (id === "home" ? PLAN_PAGES.includes(page) : page === id);

function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const { t } = useApp();
  const { mode, setMode, fullWorkspace } = useWorkspace();
  const others = fullWorkspace.people.length - 1;
  return (
    <div className="segmented w-full" role="group" aria-label="Personal or family view">
      {(["personal", "family"] as const).map((m) => (
        <button
          key={m}
          aria-pressed={mode === m}
          className="flex flex-1 items-center justify-center gap-1.5"
          onClick={() => setMode(m)}
        >
          {m === "personal" ? <UserRound className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          {t(m === "personal" ? "me" : "family")}
          {m === "family" && !compact && others > 0 && (
            <span className="text-xs opacity-80">+{others}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="segmented" role="group" aria-label="Language">
      {(["en", "hi"] as const).map((l) => (
        <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
          {l === "en" ? "EN" : "हिं"}
        </button>
      ))}
    </div>
  );
}

const Loading = () => (
  <div className="space-y-3" aria-busy="true">
    <div className="skeleton h-10 w-64" />
    <div className="skeleton h-40" />
  </div>
);

export default function App() {
  const { profile, page, go, t, lang, health, updates, personaId } = useApp();
  const { error, storageError, workspace, mode, fullWorkspace } = useWorkspace();
  const [familyOpen, setFamilyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const hi = lang === "hi";
  // every page starts at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  if (!profile) return <Onboarding />;
  const P = PAGE[page] || Home;
  const owner = fullWorkspace.people.find((p) => p.id === fullWorkspace.owner_id) ||
    fullWorkspace.people[0] || { name: profile.name };
  const facts: any = (owner as any).facts || profile;
  const dot =
    updates > 0 ? (
      <span className="ml-auto rounded-full bg-coral-600 px-1.5 text-[11px] font-bold text-white">
        {updates}
      </span>
    ) : null;

  return (
    <div className="min-h-full lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-100 bg-white px-3 py-4 lg:flex">
        <button
          className="mb-4 flex items-center gap-2 rounded-xl px-2 py-1 text-left"
          onClick={() => go("home")}
        >
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span>
            <span className="block text-lg font-extrabold leading-tight tracking-tight">
              JAAGRUK
            </span>
            <span className="block text-xs leading-tight text-ink-500">
              {hi ? "आपका हक़, आपके हाथ" : "Your rights, in your hands"}
            </span>
          </span>
        </button>
        <div className="mb-4 px-1">
          <ModeSwitch />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Main">
          {PRIMARY.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={active(n.id, page) ? "page" : undefined}
              className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-semibold transition ${active(n.id, page) ? "bg-teal-50 text-teal-800" : "text-ink-700 hover:bg-ink-50"}`}
            >
              <n.icon
                className={`h-5 w-5 ${active(n.id, page) ? "text-teal-700" : "text-ink-400"}`}
              />
              {t(n.key)}
              {n.id === "home" && dot}
            </button>
          ))}
        </nav>
        <div className="space-y-1 border-t border-ink-100 pt-3">
          {SECONDARY.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={page === n.id ? "page" : undefined}
              className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium ${page === n.id ? "bg-ink-50 text-ink-900" : "text-ink-600 hover:bg-ink-50"}`}
            >
              <n.icon className="h-4 w-4 text-ink-400" /> {t(n.key)}
            </button>
          ))}
          <div className="space-y-1.5 px-3 pt-2 text-xs text-ink-500">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${health?.tinyfish?.live ? "bg-teal-500" : "bg-amber-500"}`}
              />
              TinyFish {health?.tinyfish?.live ? "live" : "offline (recorded runs only)"}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${health?.llm?.available ? "bg-teal-500" : "bg-ink-300"}`}
              />
              Claude {health?.llm?.available ? "on" : "off (rule-based mode)"}
            </div>
            {health?.rules_version && (
              <div
                className="truncate"
                title={hi ? "समीक्षित नियम संस्करण" : "Reviewed rules version"}
              >
                {hi ? "नियम" : "Rules"}: {health.rules_version}
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-100 bg-white/90 px-4 py-2.5 backdrop-blur">
          <img src="/icon.svg" alt="" className="h-8 w-8 lg:hidden" />
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => setFamilyOpen(true)}
          >
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-800 sm:flex">
              {(owner.name || "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">
                {owner.name || (hi ? "मेरा परिवार" : "My family")}
              </span>
              <span className="block truncate text-xs text-ink-500">
                {[
                  facts.age && `${facts.age} ${hi ? "वर्ष" : "yrs"}`,
                  facts.state,
                  mode === "family"
                    ? `${workspace.people.length} ${hi ? "लोग" : "people"}`
                    : hi
                      ? "व्यक्तिगत दृश्य"
                      : "Personal view",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
          <button
            className="btn-quiet btn-sm hidden px-2 sm:inline-flex"
            onClick={() => go("ask")}
            aria-label={t("ask")}
          >
            <MessageCircleQuestion className="h-5 w-5" />
            <span className="hidden md:inline">{t("ask")}</span>
          </button>
          <LangSwitch />
          <button
            className="btn-ghost btn-sm hidden sm:inline-flex"
            onClick={() => setFamilyOpen(true)}
          >
            <Users className="h-4 w-4" /> {t("manageFamily")}
          </button>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-32 pt-6 lg:px-8 lg:pb-12">
          {personaId && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{t("sample")}</span>
              <button className="link shrink-0 text-amber-900" onClick={() => setFamilyOpen(true)}>
                {t("manageFamily")}
              </button>
            </div>
          )}
          {storageError && (
            <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm">
              {storageError}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-coral-50 p-3 text-sm text-coral-700">
              {error}
            </p>
          )}
          <SafeBoundary key={page}>
            <Suspense fallback={<Loading />}>
              <P key={mode + (PLAN_PAGES.includes(page) ? "" : page)} />
            </Suspense>
          </SafeBoundary>
          {workspace.people.length > 0 && <CaseDetail />}
          {familyOpen && <Family onClose={() => setFamilyOpen(false)} />}
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Main"
      >
        {PRIMARY.map((n) => (
          <button
            key={n.id}
            onClick={() => go(n.id)}
            aria-current={active(n.id, page) ? "page" : undefined}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${active(n.id, page) ? "text-teal-700" : "text-ink-500"}`}
          >
            <n.icon className="h-5 w-5" />
            <span className="max-w-full truncate px-1">{t(n.key)}</span>
            {n.id === "home" && updates > 0 && (
              <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-coral-600" />
            )}
          </button>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${SECONDARY.some((n) => n.id === page) ? "text-teal-700" : "text-ink-500"}`}
        >
          <MoreHorizontal className="h-5 w-5" />
          {t("more")}
        </button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t("more")}>
        <div className="mb-4">
          <ModeSwitch compact />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SECONDARY.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setMoreOpen(false);
                go(n.id);
              }}
              className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border p-3 text-left text-sm font-semibold ${page === n.id ? "border-teal-300 bg-teal-50 text-teal-800" : "border-ink-100"}`}
            >
              <n.icon className="h-5 w-5 shrink-0 text-teal-700" />
              {t(n.key)}
            </button>
          ))}
          <button
            onClick={() => {
              setMoreOpen(false);
              setFamilyOpen(true);
            }}
            className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-ink-100 p-3 text-left text-sm font-semibold"
          >
            <Users className="h-5 w-5 shrink-0 text-teal-700" />
            {t("manageFamily")}
          </button>
        </div>
      </Sheet>
      <ToastView />
    </div>
  );
}
