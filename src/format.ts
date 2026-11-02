import { daysUntil } from "./dates.js";
import { pendingBlockers, type TaskMap } from "./graph.js";
import { PRIORITY_LABEL, type Task } from "./types.js";

const CODES = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
} as const;

export function paint(enabled: boolean, style: keyof typeof CODES, text: string): string {
  return enabled ? `${CODES[style]}${text}${CODES.reset}` : text;
}

export function dueText(due: string, today: Date): string {
  const days = daysUntil(due, today);
  if (days < -1) return `venceu há ${-days} dias`;
  if (days === -1) return "venceu ontem";
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}

export interface FormatContext {
  map: TaskMap;
  today: Date;
  color: boolean;
}

export function formatTask(task: Task, ctx: FormatContext): string {
  const { color } = ctx;
  const box = task.done ? paint(color, "green", "[x]") : "[ ]";
  const id = paint(color, "cyan", `#${task.id}`);

  const prio = `(${PRIORITY_LABEL[task.priority]})`;
  const prioColored =
    task.priority === 3 ? paint(color, "red", prio) : paint(color, "dim", prio);

  const parts = [`${id} ${box} ${prioColored} ${task.title}`];

  if (task.due !== null && !task.done) {
    const text = dueText(task.due, ctx.today);
    const overdue = daysUntil(task.due, ctx.today) < 0;
    parts.push(paint(color, overdue ? "red" : "yellow", text));
  }
  if (task.tags.length > 0) {
    parts.push(paint(color, "dim", task.tags.map((t) => `#${t}`).join(" ")));
  }
  if (!task.done) {
    const blockers = pendingBlockers(task, ctx.map);
    if (blockers.length > 0) {
      parts.push(paint(color, "yellow", `aguarda ${blockers.map((b) => `#${b}`).join(", ")}`));
    }
  }

  const line = parts.join("  ·  ");
  return task.done ? paint(color, "dim", line) : line;
}
