export const indiaToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
};
export const dateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
export function monthDays(year: number, month: number): (string | null)[] {
  const start = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, i) =>
    i < start || i >= start + count ? null : dateKey(year, month, i - start + 1),
  );
}
export const displayDate = (d: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
