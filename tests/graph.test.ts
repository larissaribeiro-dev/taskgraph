import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGraph,
  downstreamCount,
  hasCycle,
  isBlocked,
  plan,
  rankNext,
  scoreTask,
  toMap,
  toMermaid,
  wouldCreateCycle,
} from "../src/graph.js";
import type { Task } from "../src/types.js";
import { mk, NOW } from "./helpers.js";

test("tarefa sem dependências não é bloqueada", () => {
  const t = mk(1);
  assert.equal(isBlocked(t, toMap([t])), false);
});

test("tarefa é bloqueada enquanto a dependência estiver pendente", () => {
  const a = mk(1);
  const b = mk(2, { deps: [1] });
  assert.equal(isBlocked(b, toMap([a, b])), true);
  a.done = true;
  assert.equal(isBlocked(b, toMap([a, b])), false);
});

test("dependência que não existe mais não bloqueia", () => {
  const b = mk(2, { deps: [99] });
  assert.equal(isBlocked(b, toMap([b])), false);
});

test("detecta ciclo direto, indireto e autorreferência", () => {
  const tasks = [mk(1), mk(2, { deps: [1] }), mk(3, { deps: [2] })];
  assert.equal(wouldCreateCycle(tasks, 1, 1), true);
  assert.equal(wouldCreateCycle(tasks, 1, 2), true); // 2 depende de 1
  assert.equal(wouldCreateCycle(tasks, 1, 3), true); // 3 -> 2 -> 1
  assert.equal(wouldCreateCycle(tasks, 3, 1), false); // já é o sentido certo
});

test("grafo em diamante não gera falso ciclo", () => {
  const tasks = [mk(1), mk(2, { deps: [1] }), mk(3, { deps: [1] }), mk(4, { deps: [2, 3] })];
  assert.equal(wouldCreateCycle(tasks, 4, 1), false);
});

test("downstreamCount conta dependentes transitivos e pendentes", () => {
  const tasks = [
    mk(1),
    mk(2, { deps: [1] }),
    mk(3, { deps: [2] }),
    mk(4, { deps: [1], done: true }),
  ];
  const g = buildGraph(tasks);
  assert.equal(downstreamCount(g, 1), 2); // 2 e 3, ignora a concluída
  assert.equal(downstreamCount(g, 3), 0);
});

test("scoreTask soma prioridade, prazo e tarefas liberadas", () => {
  const score = (t: Task, all: Task[] = [t]) => scoreTask(t, buildGraph(all), NOW);

  const base = mk(1, { priority: 3 });
  assert.equal(score(base), 30);

  const overdue = mk(1, { priority: 1, due: "2026-11-01" });
  assert.equal(score(overdue), 10 + 30);

  const soon = mk(1, { priority: 1, due: "2026-11-04" });
  assert.equal(score(soon), 10 + 20);

  const week = mk(1, { priority: 1, due: "2026-11-09" });
  assert.equal(score(week), 10 + 10);

  const far = mk(1, { priority: 1, due: "2026-12-30" });
  assert.equal(score(far), 10);

  const root = mk(1, { priority: 1 });
  const tasks = [root, mk(2, { deps: [1] }), mk(3, { deps: [2] })];
  assert.equal(score(root, tasks), 10 + 2 * 5);
});

test("rankNext ignora concluídas e bloqueadas, e ordena por pontuação", () => {
  const tasks = [
    mk(1, { priority: 1 }),
    mk(2, { priority: 3 }),
    mk(3, { priority: 3, deps: [1] }),
    mk(4, { priority: 3, done: true }),
  ];
  const ids = rankNext(tasks, NOW).map((s) => s.task.id);
  assert.deepEqual(ids, [2, 1]);
});

test("rankNext desempata pelo menor id", () => {
  const tasks = [mk(3), mk(1), mk(2)];
  assert.deepEqual(
    rankNext(tasks, NOW).map((s) => s.task.id),
    [1, 2, 3],
  );
});

test("plan respeita dependências mesmo com prioridade invertida", () => {
  // a tarefa 2 é mais urgente, mas só pode vir depois da 1
  const tasks = [mk(1, { priority: 1 }), mk(2, { priority: 3, deps: [1] })];
  assert.deepEqual(
    plan(tasks, NOW).map((s) => s.task.id),
    [1, 2],
  );
});

test("plan é uma ordenação topológica válida", () => {
  const tasks = [
    mk(1, { priority: 1 }),
    mk(2, { priority: 3, deps: [1] }),
    mk(3, { priority: 2, deps: [1] }),
    mk(4, { priority: 3, deps: [2, 3] }),
    mk(5, { priority: 2 }),
  ];
  const order = plan(tasks, NOW).map((s) => s.task.id);
  assert.equal(order.length, 5);
  for (const t of tasks) {
    for (const dep of t.deps) {
      assert.ok(order.indexOf(dep) < order.indexOf(t.id), `${dep} antes de ${t.id}`);
    }
  }
});

test("plan ignora dependências já concluídas", () => {
  const tasks = [mk(1, { done: true }), mk(2, { deps: [1] })];
  assert.deepEqual(
    plan(tasks, NOW).map((s) => s.task.id),
    [2],
  );
});

test("toMermaid gera nós, arestas e escapa aspas", () => {
  const tasks = [mk(1, { title: 'diz "oi"', done: true }), mk(2, { deps: [1] })];
  const out = toMermaid(tasks);
  assert.match(out, /^graph TD/);
  assert.match(out, /t1\["#1 diz 'oi'"\]:::done/);
  assert.match(out, /t2\["#2 tarefa 2"\]:::pending/);
  assert.match(out, /t1 --> t2/);
});

test("hasCycle reconhece grafos válidos e ciclos de qualquer tamanho", () => {
  assert.equal(hasCycle([]), false);
  assert.equal(hasCycle([mk(1), mk(2, { deps: [1] }), mk(3, { deps: [1, 2] })]), false);
  assert.equal(hasCycle([mk(1, { deps: [2] }), mk(2, { deps: [1] })]), true);
  const longo = [mk(1, { deps: [3] }), mk(2, { deps: [1] }), mk(3, { deps: [2] }), mk(4)];
  assert.equal(hasCycle(longo), true);
});
