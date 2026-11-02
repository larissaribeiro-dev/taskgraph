import { daysUntil } from "./dates.js";
import type { Task } from "./types.js";

export type TaskMap = Map<number, Task>;

export interface Graph {
  byId: TaskMap;
  /** id -> ids das tarefas que dependem dele (as arestas ao contrário). */
  dependents: Map<number, number[]>;
}

export interface Scored {
  task: Task;
  score: number;
}

export function toMap(tasks: Task[]): TaskMap {
  return new Map(tasks.map((t) => [t.id, t]));
}

export function buildGraph(tasks: Task[]): Graph {
  const dependents = new Map<number, number[]>();
  for (const t of tasks) {
    for (const dep of t.deps) {
      const list = dependents.get(dep);
      if (list) list.push(t.id);
      else dependents.set(dep, [t.id]);
    }
  }
  return { byId: toMap(tasks), dependents };
}

export function pendingBlockers(task: Task, byId: TaskMap): number[] {
  return task.deps.filter((id) => byId.get(id)?.done === false);
}

export function isBlocked(task: Task, byId: TaskMap): boolean {
  return pendingBlockers(task, byId).length > 0;
}

// Busca em profundidade seguindo as dependências: dá para chegar de `from` em `target`?
function reaches(byId: TaskMap, from: number, target: number): boolean {
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of byId.get(current)?.deps ?? []) stack.push(dep);
  }
  return false;
}

// `id` passar a depender de `dep` fecha um ciclo se `dep` já depender de `id`.
export function wouldCreateCycle(tasks: Task[], id: number, dep: number): boolean {
  return id === dep || reaches(toMap(tasks), dep, id);
}

// Algoritmo de Kahn: se alguma tarefa nunca fica com zero dependências
// pendentes na ordem de remoção, ela está presa num ciclo.
export function hasCycle(tasks: Task[]): boolean {
  const { dependents } = buildGraph(tasks);
  const waiting = new Map(tasks.map((t) => [t.id, t.deps.length]));
  const free = tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  let visited = 0;
  while (free.length > 0) {
    const id = free.pop() as number;
    visited++;
    for (const child of dependents.get(id) ?? []) {
      const left = (waiting.get(child) ?? 0) - 1;
      waiting.set(child, left);
      if (left === 0) free.push(child);
    }
  }
  return visited !== tasks.length;
}

// Quantas tarefas pendentes dependem de `id`, de forma direta ou indireta.
export function downstreamCount(graph: Graph, id: number): number {
  const seen = new Set<number>();
  const stack = [...(graph.dependents.get(id) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.dependents.get(current) ?? []));
  }
  let pending = 0;
  for (const other of seen) {
    if (graph.byId.get(other)?.done === false) pending++;
  }
  return pending;
}

// prioridade x 10, mais bônus de prazo, mais 5 por tarefa pendente que ela libera.
// Prazo: vencida +30, até 2 dias +20, até 7 dias +10.
export function scoreTask(task: Task, graph: Graph, today: Date): number {
  let score = task.priority * 10;
  if (task.due !== null) {
    const days = daysUntil(task.due, today);
    if (days < 0) score += 30;
    else if (days <= 2) score += 20;
    else if (days <= 7) score += 10;
  }
  return score + downstreamCount(graph, task.id) * 5;
}

function byScoreThenId(a: Scored, b: Scored): number {
  return b.score - a.score || a.task.id - b.task.id;
}

/** Pendentes que já estão liberadas, da mais urgente para a menos. */
export function rankNext(tasks: Task[], today: Date): Scored[] {
  const graph = buildGraph(tasks);
  return tasks
    .filter((t) => !t.done && !isBlocked(t, graph.byId))
    .map((task) => ({ task, score: scoreTask(task, graph, today) }))
    .sort(byScoreThenId);
}

/**
 * Ordem para concluir todas as pendentes. É uma ordenação topológica em que,
 * a cada passo, entra a de maior pontuação entre as que já estão liberadas.
 */
export function plan(tasks: Task[], today: Date): Scored[] {
  const graph = buildGraph(tasks);
  const scores = new Map<number, number>();
  for (const t of tasks) {
    if (!t.done) scores.set(t.id, scoreTask(t, graph, today));
  }

  const remaining = tasks.filter((t) => !t.done);
  const planned = new Set<number>();
  const order: Scored[] = [];

  while (remaining.length > 0) {
    // dependência concluída (ou que não existe mais) não conta como espera
    const best = remaining
      .filter((t) => t.deps.every((d) => planned.has(d) || !scores.has(d)))
      .map((task) => ({ task, score: scores.get(task.id) as number }))
      .sort(byScoreThenId)[0];
    if (!best) break; // só aconteceria com ciclo, e o store não deixa chegar aqui
    order.push(best);
    planned.add(best.task.id);
    remaining.splice(remaining.indexOf(best.task), 1);
  }
  return order;
}

export function toMermaid(tasks: Task[]): string {
  const lines = ["graph TD"];
  for (const t of tasks) {
    const label = `#${t.id} ${t.title}`.replace(/"/g, "'");
    lines.push(`  t${t.id}["${label}"]:::${t.done ? "done" : "pending"}`);
  }
  for (const t of tasks) {
    for (const dep of t.deps) lines.push(`  t${dep} --> t${t.id}`);
  }
  lines.push("  classDef done fill:#d4edda,stroke:#28a745,color:#155724;");
  lines.push("  classDef pending fill:#fff3cd,stroke:#e0a800,color:#533f03;");
  return lines.join("\n");
}
