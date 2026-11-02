import type { Priority, Task } from "../src/types.js";

/** Data fixa para os testes serem determinísticos (meio-dia, horário local). */
export const NOW = new Date(2026, 10, 2, 12, 0, 0); // 2026-11-02

export function mk(id: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `tarefa ${id}`,
    done: false,
    priority: 2 as Priority,
    due: null,
    tags: [],
    deps: [],
    createdAt: NOW.toISOString(),
    doneAt: null,
    ...extra,
  };
}
