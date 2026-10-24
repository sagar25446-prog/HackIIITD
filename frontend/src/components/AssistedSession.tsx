import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, KeyRound, Lock, Power, RefreshCw } from "lucide-react";
import { api } from "../api";
import { ErrorNote, Modal, Spinner } from "./ui";

type Frame = { image: string; url: string; title: string; width: number; height: number; idle_seconds_left: number };

/** A TinyFish remote browser the citizen drives: JAAGRUK pre-fills, the citizen types their own OTP. */
export default function AssistedSession({ open, onClose, sourceId, url, title, prefill }: {
  open: boolean; onClose: () => void; sourceId?: string; url?: string; title: string; prefill?: Record<string, string>;
}) {
  const [sid, setSid] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [closedInfo, setClosedInfo] = useState<any>(null);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setClosedInfo(null);
    setBusy(true);
    api.post<any>("/api/assist/start", { source_id: sourceId, url, purpose: title })
      .then((r) => { setSid(r.session); setFrame(r); })
      .catch((e) => setError(`Could not open a remote browser: ${e.message}`))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!sid) return;
    const h = setInterval(() => api.get<Frame>(`/api/assist/${sid}/frame`).then(setFrame).catch(() => null), 2500);
    return () => clearInterval(h);
  }, [sid]);

  const act = async (p: Promise<Frame>) => {
    setBusy(true);
    try { setFrame(await p); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const click = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!sid || !frame || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * frame.width;
    const y = ((e.clientY - r.top) / r.height) * frame.height;
    act(api.post(`/api/assist/${sid}/click`, { x, y }));
  };
  const close = async () => {
    if (sid) {
      try { setClosedInfo(await api.del(`/api/assist/${sid}`)); } catch { /* already closed */ }
    }
    setSid(null);
    setFrame(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={title} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-teal-50 p-3 text-sm text-teal-800">
        <Lock className="h-4 w-4" /> A secure remote browser (TinyFish). Click on the page to interact. Type your OTP in the box below —
        it goes straight to the website and is never stored, logged or shown to any AI.
      </div>
      <ErrorNote error={error} />
      {busy && !frame && <div className="flex items-center gap-2 p-6 text-ink-500"><Spinner /> Opening the official site…</div>}
      {frame && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-500">
            <span className="truncate">{frame.url}</span>
            <span>auto-closes in {Math.max(0, Math.round(frame.idle_seconds_left / 60))} min idle</span>
          </div>
          <img ref={img} src={frame.image} alt="Remote page" onClick={click} className="w-full cursor-pointer rounded-xl border border-ink-100" />
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input flex-1" placeholder="Type here (OTP, CAPTCHA text, mobile number)…" value={text} onChange={(e) => setText(e.target.value)}
              autoComplete="one-time-code" />
            <button className="btn-primary" disabled={!text || busy} onClick={() => { act(api.post(`/api/assist/${sid}/type`, { text })); setText(""); }}>
              <KeyRound className="h-4 w-4" /> Type
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => act(api.post(`/api/assist/${sid}/key/Enter`))}><CornerDownLeft className="h-4 w-4" /> Enter</button>
            <button className="btn-ghost" disabled={busy} onClick={() => act(api.post(`/api/assist/${sid}/key/Tab`))}>Tab</button>
            {prefill && Object.keys(prefill).length > 0 && (
              <button className="btn-ghost" disabled={busy} onClick={() => act(api.post(`/api/assist/${sid}/prefill`, prefill))}>Pre-fill my details</button>
            )}
            <button className="btn-ghost" disabled={busy} onClick={() => act(api.get(`/api/assist/${sid}/frame`))}><RefreshCw className="h-4 w-4" /></button>
            <button className="btn-coral" onClick={close}><Power className="h-4 w-4" /> End session</button>
          </div>
        </>
      )}
      {closedInfo?.closed && <p className="mt-2 text-xs text-ink-500">Session closed after {closedInfo.minutes} min (≈${closedInfo.cost_usd}).</p>}
    </Modal>
  );
}
