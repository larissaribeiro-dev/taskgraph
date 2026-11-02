import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isValidISO } from "./dates.js";
import { TaskError } from "./errors.js";
import { hasCycle } from "./graph.js";
import { emptyDb, type Db, type Task } from "./types.js";

export function defaultPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.TASKGRAPH_FILE ?? join(homedir(), ".taskgraph.json");
}

function isTask(x: unknown): x is Task {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    Number.isInteger(t.id) &&
    typeof t.title === "string" &&
    t.title.trim() !== "" &&
    typeof t.done === "boolean" &&
    (t.priority === 1 || t.priority === 2 || t.priority === 3) &&
    (t.due === null || (typeof t.due === "string" && isValidISO(t.due))) &&
    Array.isArray(t.tags) &&
    t.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(t.deps) &&
    t.deps.every((d) => Number.isInteger(d)) &&
    typeof t.createdAt === "string" &&
    (t.doneAt === null || typeof t.doneAt === "string")
  );
}

/** Regras que a forma do JSON não garante. Devolve o motivo, ou null se estiver tudo certo. */
export function integrityProblem(db: Db): string | null {
  const ids = new Set<number>();
  for (const t of db.tasks) {
    if (t.id < 1) return `id inválido: ${t.id}`;
    if (ids.has(t.id)) return `id repetido: #${t.id}`;
    ids.add(t.id);
  }
  if (db.nextId <= Math.max(0, ...ids)) return "nextId menor que um id já usado";

  for (const t of db.tasks) {
    if (new Set(t.deps).size !== t.deps.length) {
      return `#${t.id} tem dependência repetida`;
    }
    for (const dep of t.deps) {
      if (dep === t.id) return `#${t.id} depende de si mesma`;
      if (!ids.has(dep)) return `#${t.id} depende de #${dep}, que não existe`;
    }
  }
  if (hasCycle(db.tasks)) return "as dependências formam um ciclo";
  return null;
}

function validate(raw: unknown, path: string): Db {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const wellFormed =
    r.version === 1 &&
    Number.isInteger(r.nextId) &&
    Array.isArray(r.tasks) &&
    r.tasks.every(isTask);
  if (!wellFormed) throw new TaskError(`arquivo de dados inválido: ${path}`);

  const db: Db = { version: 1, nextId: r.nextId as number, tasks: r.tasks as Task[] };
  const problem = integrityProblem(db);
  if (problem) throw new TaskError(`arquivo de dados inconsistente (${problem}): ${path}`);
  return db;
}

export function load(path: string): Db {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
    throw e;
  }
  try {
    return validate(JSON.parse(text), path);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new TaskError(`arquivo de dados corrompido (JSON inválido): ${path}`);
    }
    throw e;
  }
}

// Escreve num temporário e renomeia. O rename é atômico, então quem lê
// sempre encontra a versão antiga inteira ou a nova inteira.
export function save(path: string, db: Db): void {
  // nunca grava um estado que o próprio load recusaria: isso seria um bug nosso
  const problem = integrityProblem(db);
  if (problem) throw new Error(`estado inconsistente, nada foi gravado: ${problem}`);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export interface LockOptions {
  /** Quanto esperar por outro processo antes de desistir. */
  timeoutMs?: number;
  /** Um .lock mais velho que isso é tratado como sobra de um processo que morreu. */
  staleMs?: number;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isStale(lockPath: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch {
    return false; // sumiu enquanto olhávamos, então não está mais preso
  }
}

function acquire(lockPath: string, timeoutMs: number, staleMs: number): number {
  const start = Date.now();
  for (;;) {
    try {
      // "wx" falha se o arquivo já existe, e é isso que faz dele um cadeado
      return openSync(lockPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (isStale(lockPath, staleMs)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() - start >= timeoutMs) {
        throw new TaskError("outro processo está usando o arquivo de dados, tente de novo");
      }
      sleep(25);
    }
  }
}

export function withLock<T>(path: string, fn: () => T, options: LockOptions = {}): T {
  const { timeoutMs = 3000, staleMs = 10_000 } = options;
  const lockPath = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const fd = acquire(lockPath, timeoutMs, staleMs);
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

/** Lê, aplica a alteração e grava, tudo com o cadeado. Se `fn` lançar erro, nada é gravado. */
export function update<T>(path: string, fn: (db: Db) => T, options?: LockOptions): T {
  return withLock(
    path,
    () => {
      const db = load(path);
      const result = fn(db);
      save(path, db);
      return result;
    },
    options,
  );
}
