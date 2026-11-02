import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskError } from "../src/errors.js";
import {
  addDependency,
  addTask,
  completeTask,
  editTask,
  removeDependency,
  removeTask,
  reopenTask,
} from "../src/service.js";
import { emptyDb } from "../src/types.js";
import { NOW } from "./helpers.js";

const base = { priority: 2 as const, due: null, tags: [], deps: [] };

test("addTask atribui ids crescentes e limpa título e tags", () => {
  const db = emptyDb();
  const a = addTask(
    db,
    { ...base, title: "  estudar  ", tags: ["Backend", "#backend", " "] },
    NOW,
  );
  const b = addTask(db, { ...base, title: "revisar" }, NOW);
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.equal(a.title, "estudar");
  assert.deepEqual(a.tags, ["backend"]);
});

test("addTask rejeita título vazio e dependência inexistente", () => {
  const db = emptyDb();
  assert.throws(() => addTask(db, { ...base, title: "   " }, NOW), TaskError);
  assert.throws(() => addTask(db, { ...base, title: "x", deps: [7] }, NOW), TaskError);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.nextId, 1);
});

test("ids não são reaproveitados depois de remover", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b" }, NOW);
  removeTask(db, 2);
  const c = addTask(db, { ...base, title: "c" }, NOW);
  assert.equal(c.id, 3);
});

test("completeTask bloqueia tarefa com dependência pendente", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b", deps: [1] }, NOW);
  assert.throws(() => completeTask(db, 2, NOW), /bloqueada por #1/);
  assert.equal(db.tasks[1]?.done, false);
});

test("completeTask --force ignora o bloqueio", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b", deps: [1] }, NOW);
  const r = completeTask(db, 2, NOW, true);
  assert.equal(r.task.done, true);
});

test("completeTask informa o que foi liberado", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b", deps: [1] }, NOW);
  addTask(db, { ...base, title: "c", deps: [1, 2] }, NOW); // continua presa à 2
  const r = completeTask(db, 1, NOW);
  assert.deepEqual(
    r.unlocked.map((t) => t.id),
    [2],
  );
});

test("completeTask em tarefa já concluída é inofensivo", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  completeTask(db, 1, NOW);
  assert.equal(completeTask(db, 1, NOW).alreadyDone, true);
});

test("reopenTask volta a pendente", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  completeTask(db, 1, NOW);
  const t = reopenTask(db, 1);
  assert.equal(t.done, false);
  assert.equal(t.doneAt, null);
});

test("removeTask limpa a dependência nas outras tarefas", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b", deps: [1] }, NOW);
  removeTask(db, 1);
  assert.deepEqual(db.tasks[0]?.deps, []);
});

test("editTask altera só o que foi pedido e permite limpar o prazo", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a", due: "2026-12-01", tags: ["x"] }, NOW);
  editTask(db, 1, { title: "novo" });
  assert.equal(db.tasks[0]?.title, "novo");
  assert.equal(db.tasks[0]?.due, "2026-12-01");
  editTask(db, 1, { due: null, priority: 3 });
  assert.equal(db.tasks[0]?.due, null);
  assert.equal(db.tasks[0]?.priority, 3);
  assert.throws(() => editTask(db, 1, { title: " " }), TaskError);
});

test("addDependency impede ciclo e autorreferência", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b" }, NOW);
  addTask(db, { ...base, title: "c" }, NOW);
  addDependency(db, 2, 1);
  addDependency(db, 3, 2);
  assert.throws(() => addDependency(db, 1, 3), /ciclo/);
  assert.throws(() => addDependency(db, 1, 1), /si mesma/);
  assert.deepEqual(db.tasks[0]?.deps, []);
});

test("addDependency não duplica e removeDependency valida", () => {
  const db = emptyDb();
  addTask(db, { ...base, title: "a" }, NOW);
  addTask(db, { ...base, title: "b" }, NOW);
  addDependency(db, 2, 1);
  addDependency(db, 2, 1);
  assert.deepEqual(db.tasks[1]?.deps, [1]);
  removeDependency(db, 2, 1);
  assert.deepEqual(db.tasks[1]?.deps, []);
  assert.throws(() => removeDependency(db, 2, 1), TaskError);
});
