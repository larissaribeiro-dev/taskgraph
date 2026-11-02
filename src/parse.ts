import { TaskError } from "./errors.js";
import type { Priority } from "./types.js";

export function parseId(raw: string, what = "id"): number {
  const text = raw.replace(/^#/, "");
  if (!/^\d+$/.test(text)) throw new TaskError(`${what} inválido: '${raw}'`);
  return Number(text);
}

export function parseIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((part) => parseId(part.trim()));
}

export function parsePositive(raw: string, what: string): number {
  const n = parseId(raw, what);
  if (n < 1) throw new TaskError(`${what} precisa ser maior que zero`);
  return n;
}

export function parsePriority(raw: string): Priority {
  switch (raw.trim().toLowerCase()) {
    case "alta":
    case "a":
    case "3":
      return 3;
    case "media":
    case "média":
    case "m":
    case "2":
      return 2;
    case "baixa":
    case "b":
    case "1":
      return 1;
    default:
      throw new TaskError(`prioridade inválida: '${raw}'. Use alta, media ou baixa`);
  }
}

export function parseTags(raw: string | undefined): string[] {
  return raw === undefined ? [] : raw.split(",");
}
