import { ReactNode, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, Loader2, Radio, X, XCircle } from "lucide-react";
import { useApp } from "../state";

export function Section({ title, sub, right, children }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 fade-up">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">{title}</h2>
          {sub && <p className="text-sm text-ink-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => <Loader2 className={`${className} animate-spin`} />;

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button aria-label="Close" className="rounded-lg p-1 text-ink-500 hover:bg-ink-50" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProofLine({ state, label, value }: { state: string; label: string; value?: string | null }) {
  const icon = state === "pass" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-500" /> : state === "fail" ? <XCircle className="h-4 w-4 shrink-0 text-coral-500" /> : <CircleHelp className="h-4 w-4 shrink-0 text-amber-500" />;
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      {icon}
      <span className="flex-1">{label}</span>
      {value != null && <span className="text-ink-500">{value}</span>}
    </li>
  );
}

export function ModeBadge({ replay, recordedAt }: { replay?: boolean; recordedAt?: string | null }) {
  const { t } = useApp();
  return replay ? (
    <span className="chip bg-amber-100 text-amber-600" title={recordedAt ? `Recorded ${recordedAt}` : "Recorded real TinyFish run"}>⟲ {t("replay")}</span>
  ) : (
    <span className="chip bg-teal-100 text-teal-700"><Radio className="h-3 w-3" /> {t("live")}</span>
  );
}

export function CountUp({ value, prefix = "₹" }: { value: number; prefix?: string }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(a + (value - a) * e));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{v.toLocaleString("en-IN")}</>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-ink-100 bg-white p-6 text-center text-sm text-ink-500">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-600">{error}</div>;
}

export const statusColor: Record<string, string> = {
  eligible: "bg-teal-100 text-teal-700",
  needs_info: "bg-amber-100 text-amber-600",
  not_eligible: "bg-coral-100 text-coral-600",
  not_yet: "bg-ink-100 text-ink-700",
  verified: "bg-teal-100 text-teal-700",
  suspicious: "bg-amber-100 text-amber-600",
  failed: "bg-coral-100 text-coral-600",
  blocked: "bg-coral-100 text-coral-600",
  needs_human: "bg-amber-100 text-amber-600",
  unavailable: "bg-ink-100 text-ink-500",
};
