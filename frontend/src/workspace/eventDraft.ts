export type EventKind =
  | "note"
  | "moving"
  | "income_review"
  | "bereavement"
  | "retirement"
  | "education";
export type EventDraft = {
  text: string;
  kind: EventKind;
  date: string;
  destination: string;
  confirmMove: boolean;
  confirmIncome: boolean;
  income: number | null;
  mode: "" | "fresh" | "renewal";
  courseYear: number | null;
  subjectId: string;
  confirmDeceased: boolean;
};

export const createEventDraft = (): EventDraft => ({
  text: "",
  kind: "note",
  date: "",
  destination: "",
  confirmMove: false,
  confirmIncome: false,
  income: null,
  mode: "",
  courseYear: null,
  subjectId: "",
  confirmDeceased: false,
});

export type EventDraftAction =
  | { type: "text"; text: string }
  | {
      type: "interpret";
      kind: EventKind;
      destination?: string | null;
      // details the reader found in the text; each is still reviewed before saving
      date?: string | null;
      income?: number | null;
      mode?: "fresh" | "renewal" | null;
      courseYear?: number | null;
      subjectId?: string | null;
    }
  | { type: "kind"; kind: EventKind }
  | { type: "date"; date: string }
  | { type: "destination"; destination: string }
  | { type: "confirmMove"; confirmed: boolean }
  | { type: "confirmIncome"; confirmed: boolean }
  | { type: "income"; income: number | null }
  | { type: "mode"; mode: "fresh" | "renewal" }
  | { type: "courseYear"; courseYear: number | null }
  | { type: "subject"; subjectId: string }
  | { type: "confirmDeceased"; confirmed: boolean }
  | { type: "reset" };

export function eventDraftReducer(state: EventDraft, action: EventDraftAction): EventDraft {
  switch (action.type) {
    // Consent belongs to one reviewed event, never to the next text or interpretation.
    case "text":
      return { ...createEventDraft(), text: action.text };
    case "interpret":
      return {
        ...createEventDraft(),
        text: state.text,
        kind: action.kind,
        destination: action.destination || "",
        date: action.date || "",
        income: action.income ?? null,
        mode: action.mode || "",
        courseYear: action.courseYear ?? null,
        subjectId: action.subjectId || "",
      };
    case "kind":
      return { ...createEventDraft(), text: state.text, kind: action.kind, date: state.date };
    case "date":
      return { ...state, date: action.date };
    case "destination":
      return { ...state, destination: action.destination };
    case "confirmMove":
      return { ...state, confirmMove: action.confirmed };
    case "confirmIncome":
      return { ...state, confirmIncome: action.confirmed };
    case "income":
      return { ...state, income: action.income };
    case "mode":
      return { ...state, mode: action.mode };
    case "courseYear":
      return { ...state, courseYear: action.courseYear };
    case "subject":
      return { ...state, subjectId: action.subjectId, confirmDeceased: false };
    case "confirmDeceased":
      return { ...state, confirmDeceased: action.confirmed };
    case "reset":
      return createEventDraft();
  }
}
