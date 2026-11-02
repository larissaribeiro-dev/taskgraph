import { daysUntil, parseDue } from "./dates.js";
import { TaskError } from "./errors.js";
import { isBlocked, plan, rankNext, toMap, toMermaid } from "./graph.js";
import { parseId, parseIds, parsePositive, parsePriority, parseTags } from "./parse.js";
import {
  addDependency,
  addTask,
  completeTask,
  editTask,
  removeDependency,
  removeTask,
  reopenTask,
  type Changes,
} from "./service.js";
import type { Db, Task } from "./types.js";

export interface Options {
  priority?: string;
  due?: string;
  tag?: string;
  deps?: string;
  title?: string;
  all?: boolean;
  force?: boolean;
}

export interface Run {
  db: Db;
  args: string[];
  opts: Options;
  now: Date;
  say: (line?: string) => void;
  /** Uma tarefa formatada para o terminal. */
  show: (task: Task) => string;
  /** Texto esmaecido, para detalhes secundários. */
  dim: (text: string) => string;
}

export interface Command {
  usage: string;
  /** Mínimo e máximo de argumentos posicionais. */
  arity: [min: number, max: number];
  /** Opções aceitas. Qualquer outra é erro, em vez de ser ignorada. */
  options: (keyof Options)[];
  /** Se altera os dados, o comando roda com o arquivo travado e grava no fim. */
  writes: boolean;
  run: (r: Run) => void;
}

const NO_DUE = ["nenhum", "nenhuma", "-"];

function add({ db, args, opts, now, say, show }: Run): void {
  const task = addTask(
    db,
    {
      title: args.join(" "),
      priority: parsePriority(opts.priority ?? "media"),
      due: opts.due === undefined ? null : parseDue(opts.due, now),
      tags: parseTags(opts.tag),
      deps: parseIds(opts.deps),
    },
    now,
  );
  say(`adicionada: ${show(task)}`);
}

function list({ db, opts, say, show }: Run): void {
  const tag = opts.tag?.trim().toLowerCase().replace(/^#/, "");
  const tasks = db.tasks
    .filter((t) => opts.all || !t.done)
    .filter((t) => tag === undefined || t.tags.includes(tag));
  if (tasks.length === 0) return say("nenhuma tarefa por aqui.");
  for (const t of tasks) say(show(t));
}

function done({ db, args, opts, now, say, show }: Run): void {
  const result = completeTask(db, parseId(args[0] as string), now, opts.force);
  if (result.alreadyDone) return say(`#${result.task.id} já estava concluída.`);
  say(`concluída: ${show(result.task)}`);
  for (const t of result.unlocked) say(`  liberou: ${show(t)}`);
}

function undo({ db, args, say, show }: Run): void {
  say(`reaberta: ${show(reopenTask(db, parseId(args[0] as string)))}`);
}

function rm({ db, args, say }: Run): void {
  const task = removeTask(db, parseId(args[0] as string));
  say(`removida: #${task.id} ${task.title}`);
}

function edit({ db, args, opts, now, say, show }: Run): void {
  const changes: Changes = {};
  if (opts.title !== undefined) changes.title = opts.title;
  if (opts.priority !== undefined) changes.priority = parsePriority(opts.priority);
  if (opts.due !== undefined) {
    const clear = NO_DUE.includes(opts.due.trim().toLowerCase());
    changes.due = clear ? null : parseDue(opts.due, now);
  }
  if (opts.tag !== undefined) changes.tags = parseTags(opts.tag);

  if (Object.keys(changes).length === 0) {
    throw new TaskError("nada para alterar. Use --title, --priority, --due ou --tag");
  }
  say(`atualizada: ${show(editTask(db, parseId(args[0] as string), changes))}`);
}

function dep({ db, args, say, show }: Run): void {
  const id = parseId(args[0] as string);
  const on = parseId(args[1] as string, "id da dependência");
  say(`ok: ${show(addDependency(db, id, on))}`);
}

function undep({ db, args, say, show }: Run): void {
  const id = parseId(args[0] as string);
  const on = parseId(args[1] as string, "id da dependência");
  say(`ok: ${show(removeDependency(db, id, on))}`);
}

function next({ db, args, now, say, show, dim }: Run): void {
  const limit = args[0] === undefined ? 3 : parsePositive(args[0], "número");
  const ranked = rankNext(db.tasks, now).slice(0, limit);
  if (ranked.length === 0) return say("nada pendente para fazer agora.");
  ranked.forEach(({ task, score }, i) => {
    say(`${i + 1}. ${show(task)}  ${dim(`[pontos: ${score}]`)}`);
  });
}

function planCommand({ db, now, say, show, dim }: Run): void {
  const order = plan(db.tasks, now);
  if (order.length === 0) return say("nada pendente. Tudo em dia.");
  const width = String(order.length).length;
  order.forEach(({ task, score }, i) => {
    const n = String(i + 1).padStart(width, " ");
    say(`${n}. ${show(task)}  ${dim(`[pontos: ${score}]`)}`);
  });
}

function graph({ db, say }: Run): void {
  if (db.tasks.length === 0) return say("nenhuma tarefa para desenhar.");
  say(toMermaid(db.tasks));
}

function stats({ db, now, say }: Run): void {
  const pending = db.tasks.filter((t) => !t.done);
  const byId = toMap(db.tasks);
  const total = db.tasks.length;
  const finished = total - pending.length;
  const blocked = pending.filter((t) => isBlocked(t, byId)).length;
  const overdue = pending.filter((t) => t.due !== null && daysUntil(t.due, now) < 0).length;
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);

  say(`total       ${total}`);
  say(`concluídas  ${finished} (${pct}%)`);
  say(`pendentes   ${pending.length}`);
  say(`bloqueadas  ${blocked}`);
  say(`atrasadas   ${overdue}`);
}

// Map e não objeto: com objeto, `taskgraph constructor` encontraria Object.prototype.constructor.
export const COMMANDS = new Map<string, Command>([
  [
    "add",
    {
      usage: "add <título>",
      arity: [1, Infinity],
      options: ["priority", "due", "tag", "deps"],
      writes: true,
      run: add,
    },
  ],
  ["list", { usage: "list", arity: [0, 0], options: ["tag", "all"], writes: false, run: list }],
  ["done", { usage: "done <id>", arity: [1, 1], options: ["force"], writes: true, run: done }],
  ["undo", { usage: "undo <id>", arity: [1, 1], options: [], writes: true, run: undo }],
  ["rm", { usage: "rm <id>", arity: [1, 1], options: [], writes: true, run: rm }],
  [
    "edit",
    {
      usage: "edit <id>",
      arity: [1, 1],
      options: ["title", "priority", "due", "tag"],
      writes: true,
      run: edit,
    },
  ],
  ["dep", { usage: "dep <id> <de-id>", arity: [2, 2], options: [], writes: true, run: dep }],
  [
    "undep",
    { usage: "undep <id> <de-id>", arity: [2, 2], options: [], writes: true, run: undep },
  ],
  ["next", { usage: "next [n]", arity: [0, 1], options: [], writes: false, run: next }],
  ["plan", { usage: "plan", arity: [0, 0], options: [], writes: false, run: planCommand }],
  ["graph", { usage: "graph", arity: [0, 0], options: [], writes: false, run: graph }],
  ["stats", { usage: "stats", arity: [0, 0], options: [], writes: false, run: stats }],
]);
