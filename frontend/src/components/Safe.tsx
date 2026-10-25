import { Component, ComponentType, lazy, ReactNode } from "react";

/**
 * Lazy page loader that survives a new deployment: if a page's file was replaced by a newer build while the
 * app was open, the browser reloads once to fetch the current version instead of showing a blank screen.
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load()
      .then((m) => {
        try {
          sessionStorage.removeItem("jk.reloaded-for-update"); // loaded fine: allow a future one-time reload
        } catch {
          /* nothing to clear */
        }
        return m;
      })
      .catch((err) => {
        const key = "jk.reloaded-for-update";
        let tried = false;
        try {
          tried = sessionStorage.getItem(key) === "1";
          sessionStorage.setItem(key, "1");
        } catch {
          /* storage blocked: still reload once */
        }
        if (!tried) {
          window.location.reload();
          return new Promise<{ default: T }>(() => undefined); // wait for the reload
        }
        throw err;
      }),
  );
}

/** Any unexpected error shows a recovery message instead of a white screen; local data stays safe. */
export class SafeBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    const hi = document.documentElement.lang === "hi";
    return (
      <div role="alert" className="card mx-auto my-10 max-w-lg p-6 text-center">
        <h2 className="text-lg font-bold">
          {hi ? "यह हिस्सा खुल नहीं पाया" : "This part could not open"}
        </h2>
        <p className="mt-2 text-sm text-ink-600">
          {hi
            ? "आपकी जानकारी इसी ब्राउज़र में सुरक्षित है। पेज दोबारा लोड करें।"
            : "Your information is still saved in this browser. Reload the page to continue."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>
            {hi ? "दोबारा लोड करें" : "Reload"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              this.setState({ error: null });
              window.location.hash = "home";
            }}
          >
            {hi ? "मेरी योजना पर जाएँ" : "Go to My plan"}
          </button>
        </div>
      </div>
    );
  }
}
