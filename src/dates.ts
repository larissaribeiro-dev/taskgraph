import { TaskError } from "./errors.js";

const MAX_OFFSET_DAYS = 36_500;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isValidISO(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function addDays(base: Date, n: number): string {
  return toISODate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
}

/** Aceita AAAA-MM-DD, "hoje", "amanha" e "+Nd". Devolve AAAA-MM-DD. */
export function parseDue(input: string, today: Date): string {
  const s = input.trim().toLowerCase();
  if (s === "hoje") return toISODate(today);
  if (s === "amanha" || s === "amanhã") return addDays(today, 1);

  const rel = /^\+(\d+)d$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    if (n > MAX_OFFSET_DAYS) {
      throw new TaskError(`prazo muito distante: '${input}'`);
    }
    return addDays(today, n);
  }

  if (isValidISO(s)) return s;
  throw new TaskError(`data inválida: '${input}'. Use AAAA-MM-DD, hoje, amanha ou +Nd`);
}

/** Dias entre hoje e a data limite. Negativo quando já venceu. */
export function daysUntil(due: string, today: Date): number {
  const [y, m, d] = due.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86_400_000);
}
