import { TaskError } from "./errors.js";
import { isBlocked, pendingBlockers, toMap, wouldCreateCycle } from "./graph.js";
import type { Db, Priority, Task } from "./types.js";

export function findTask(db: Db, id: number): Task {
  const task = db.tasks.find((t) => t.id === id);
  if (!task) throw new TaskError(`tarefa #${id} não encontrada`);
  return task;
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (t === "") throw new TaskError("o título não pode ficar vazio");
  return t;
}

function cleanTags(tags: string[]): string[] {
  const clean = tags
    .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
    .filter((t) => t !== "");
  return [...new Set(clean)];
}

export interface NewTask {
  title: string;
  priority: Priority;
  due: string | null;
  tags: string[];
  deps: number[];
}

export function addTask(db: Db, input: NewTask, now: Date): Task {
  const deps = [...new Set(input.deps)];
  for (const dep of deps) findTask(db, dep);

  const task: Task = {
    id: db.nextId,
    title: cleanTitle(input.title),
    done: false,
    priority: input.priority,
    due: input.due,
    tags: cleanTags(input.tags),
    deps,
    createdAt: now.toISOString(),
    doneAt: null,
  };
  db.nextId += 1;
  db.tasks.push(task);
  return task;
}

export interface CompleteResult {
  task: Task;
  alreadyDone: boolean;
  /** Tarefas que só esperavam por esta e agora estão livres. */
  unlocked: Task[];
}

export function completeTask(db: Db, id: number, now: Date, force = false): CompleteResult {
  const task = findTask(db, id);
  if (task.done) return { task, alreadyDone: true, unlocked: [] };

  const before = toMap(db.tasks);
  const blockers = pendingBlockers(task, before);
  if (!force && blockers.length > 0) {
    const list = blockers.map((b) => `#${b}`).join(", ");
    throw new TaskError(`#${id} está bloqueada por ${list}. Conclua antes ou use --force`);
  }

  const wasBlocked = db.tasks.filter(
    (t) => !t.done && t.deps.includes(id) && isBlocked(t, before),
  );
  task.done = true;
  task.doneAt = now.toISOString();

  const after = toMap(db.tasks);
  const unlocked = wasBlocked.filter((t) => !isBlocked(t, after));
  return { task, alreadyDone: false, unlocked };
}

export function reopenTask(db: Db, id: number): Task {
  const task = findTask(db, id);
  task.done = false;
  task.doneAt = null;
  return task;
}

export function removeTask(db: Db, id: number): Task {
  const task = findTask(db, id);
  db.tasks = db.tasks.filter((t) => t.id !== id);
  for (const t of db.tasks) t.deps = t.deps.filter((d) => d !== id);
  return task;
}

export interface Changes {
  title?: string;
  priority?: Priority;
  /** null tira o prazo. */
  due?: string | null;
  tags?: string[];
}

export function editTask(db: Db, id: number, changes: Changes): Task {
  const task = findTask(db, id);
  if (changes.title !== undefined) task.title = cleanTitle(changes.title);
  if (changes.priority !== undefined) task.priority = changes.priority;
  if (changes.due !== undefined) task.due = changes.due;
  if (changes.tags !== undefined) task.tags = cleanTags(changes.tags);
  return task;
}

export function addDependency(db: Db, id: number, on: number): Task {
  const task = findTask(db, id);
  findTask(db, on);
  if (id === on) throw new TaskError("uma tarefa não pode depender de si mesma");
  if (wouldCreateCycle(db.tasks, id, on)) {
    throw new TaskError(
      `isso criaria um ciclo: #${on} já depende de #${id}, direta ou indiretamente`,
    );
  }
  if (!task.deps.includes(on)) task.deps.push(on);
  return task;
}

export function removeDependency(db: Db, id: number, on: number): Task {
  const task = findTask(db, id);
  if (!task.deps.includes(on)) throw new TaskError(`#${id} não depende de #${on}`);
  task.deps = task.deps.filter((d) => d !== on);
  return task;
}
