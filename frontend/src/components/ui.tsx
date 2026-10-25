import { ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Info,
  Loader2,
  Radio,
  X,
  XCircle,
} from "lucide-react";
import { useApp } from "../state";

export function PageHeader({
  icon,
  title,
  sub,
  right,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 fade-up">
      <div className="min-w-0 flex-1">
        <h1 className="page-title flex items-center gap-2.5">
          {icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              {icon}
            </span>
          )}
          <span className="min-w-0">{title}</span>
        </h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

export function Section({
  title,
  sub,
  right,
  children,
  className = "",
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 fade-up ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title">{title}</h2>
          {sub && <p className="text-sm text-ink-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
  <Loader2 className={`${className} animate-spin`} aria-hidden="true" />
);

/**
 * One accessible dialog behaviour for every overlay (Modal and Sheet): focus moves into the dialog and is
 * contained there, focus returns where it was on close, the page behind is inert and does not scroll.
 */
function useDialog(open: boolean, panel: RefObject<HTMLDivElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    const root = document.getElementById("root");
    document.body.style.overflow = "hidden";
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    const items = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button,a[href],input,select,textarea,summary,[tabindex="0"]',
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
    // Focus the dialog itself so it opens at the top; Tab then moves through its controls.
    panel.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const all = items();
        if (!all.length) return e.preventDefault();
        const first = all[0],
          last = all[all.length - 1];
        const inside = panel.current?.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      // only the last open dialog restores the page
      if (!document.querySelector('[role="dialog"][data-open="true"]:not([data-closing])')) {
        document.body.style.overflow = before;
        root?.removeAttribute("inert");
        root?.removeAttribute("aria-hidden");
      }
      previous?.focus?.();
    };
  }, [open]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(open, panel, onClose);
  if (!open) return null;
  // Portal to <body>: an animated ancestor (transform) would otherwise trap this fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        data-open="true"
        tabIndex={-1}
        aria-label={typeof title === "string" ? title : "Details"}
        className={`sheet-up flex max-h-[94vh] outline-none w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-bold leading-snug">{title}</h2>
          <button
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-lg p-2.5 text-ink-500 hover:bg-ink-50 hover:text-ink-900"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3 print-hide">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A bottom sheet on phones (used for More and the filter panel) — same dialog behaviour as Modal. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(open, panel, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-ink-900/50" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        data-open="true"
        tabIndex={-1}
        aria-label={typeof title === "string" ? title : "Menu"}
        className="sheet-up max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-200" />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button aria-label="Close" className="rounded-lg p-2.5 text-ink-500" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "success" | "warn" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const style = {
    info: "border-teal-100 bg-teal-50 text-teal-900",
    success: "border-teal-200 bg-teal-50 text-teal-900",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-coral-200 bg-coral-50 text-coral-700",
  }[tone];
  const icon = {
    info: <Info className="h-5 w-5 shrink-0" />,
    success: <CheckCircle2 className="h-5 w-5 shrink-0" />,
    warn: <AlertTriangle className="h-5 w-5 shrink-0" />,
    danger: <XCircle className="h-5 w-5 shrink-0" />,
  }[tone];
  return (
    <div
      className={`flex gap-3 rounded-xl border p-3.5 text-sm ${style}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      {icon}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function ProofLine({
  state,
  label,
  value,
}: {
  state: string;
  label: string;
  value?: string | null;
}) {
  const icon =
    state === "pass" ? (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" />
    ) : state === "fail" ? (
      <XCircle className="h-4 w-4 shrink-0 text-coral-500" />
    ) : (
      <CircleHelp className="h-4 w-4 shrink-0 text-amber-500" />
    );
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1">{label}</span>
      {value != null && <span className="text-ink-500">{value}</span>}
    </li>
  );
}

export function ModeBadge({
  replay,
  recordedAt,
}: {
  replay?: boolean;
  recordedAt?: string | null;
}) {
  const { t } = useApp();
  return replay ? (
    <span
      className="chip bg-amber-100 text-amber-800"
      title={recordedAt ? `Recorded ${recordedAt}` : "Recorded real TinyFish run"}
    >
      ⟲ {t("replay")}
    </span>
  ) : (
    <span className="chip bg-teal-100 text-teal-800">
      <Radio className="h-3 w-3" /> {t("live")}
    </span>
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
  return (
    <>
      {prefix}
      {v.toLocaleString("en-IN")}
    </>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-8 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-50 text-ink-500">
          {icon}
        </div>
      )}
      {title && <div className="font-semibold text-ink-800">{title}</div>}
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-500">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-coral-200 bg-coral-50 px-3 py-2 text-sm text-coral-700"
    >
      {error}
    </div>
  );
}

export function ToastView() {
  const { toast, showToast, go } = useApp();
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => showToast(null), 9000);
    return () => clearTimeout(h);
  }, [toast, showToast]);
  if (!toast) return null;
  const tone =
    toast.tone === "alert"
      ? "border-amber-300 bg-white"
      : toast.tone === "success"
        ? "border-teal-300 bg-white"
        : "border-ink-200 bg-white";
  return (
    <div
      role="status"
      className={`fade-up fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border p-4 shadow-lift lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0 ${tone}`}
    >
      <div className="flex items-start gap-3">
        {toast.tone === "alert" ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{toast.title}</div>
          {toast.body && <div className="text-sm text-ink-600">{toast.body}</div>}
          {toast.action && (
            <button
              className="link mt-1 text-sm"
              onClick={() => {
                go(toast.action!.page);
                showToast(null);
              }}
            >
              {toast.action.label} →
            </button>
          )}
        </div>
        <button
          aria-label="Dismiss"
          className="rounded-lg p-1 text-ink-400 hover:text-ink-700"
          onClick={() => showToast(null)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export const statusColor: Record<string, string> = {
  eligible: "bg-teal-100 text-teal-800",
  needs_info: "bg-amber-100 text-amber-800",
  not_eligible: "bg-coral-100 text-coral-700",
  not_yet: "bg-ink-100 text-ink-700",
  verified: "bg-teal-100 text-teal-800",
  suspicious: "bg-amber-100 text-amber-800",
  failed: "bg-coral-100 text-coral-700",
  blocked: "bg-coral-100 text-coral-700",
  needs_human: "bg-amber-100 text-amber-800",
  unavailable: "bg-ink-100 text-ink-600",
};

/** Case status → colour, shared by My plan, the case panel and the helper page. */
export const caseTone: Record<string, string> = {
  preparing: "bg-teal-100 text-teal-800",
  needs_answers: "bg-amber-100 text-amber-800",
  review_needed: "bg-amber-100 text-amber-800",
  not_supported: "bg-coral-100 text-coral-700",
  ready: "bg-teal-100 text-teal-800",
};

export const fmtDate = (iso: string | null | undefined, lang: string) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
