import { parseArgs } from "node:util";
import { COMMANDS, type Options, type Run } from "./commands.js";
import { TaskError } from "./errors.js";
import { formatTask, paint } from "./format.js";
import { toMap } from "./graph.js";
import { HELP, VERSION } from "./help.js";
import { load, update } from "./store.js";
import type { Db } from "./types.js";

export interface Context {
  file: string;
  now: Date;
  color: boolean;
  out: (text: string) => void;
  err: (text: string) => void;
}

const GLOBAL_FLAGS = new Set(["help", "version"]);

function execute(argv: string[], ctx: Context): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      priority: { type: "string", short: "p" },
      due: { type: "string", short: "d" },
      tag: { type: "string", short: "t" },
      deps: { type: "string" },
      title: { type: "string" },
      all: { type: "boolean", short: "a" },
      force: { type: "boolean", short: "f" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help || positionals[0] === "help") {
    ctx.out(HELP);
    return 0;
  }
  if (values.version) {
    ctx.out(`taskgraph ${VERSION}\n`);
    return 0;
  }

  const name = positionals[0] ?? "list";
  const command = COMMANDS.get(name);
  if (!command) throw new TaskError(`comando desconhecido: '${name}'. Use --help`);

  for (const flag of Object.keys(values)) {
    if (!GLOBAL_FLAGS.has(flag) && !command.options.includes(flag as keyof Options)) {
      throw new TaskError(`a opção --${flag} não vale para '${name}'`);
    }
  }

  const args = positionals.slice(1);
  const [min, max] = command.arity;
  if (args.length < min || args.length > max) {
    throw new TaskError(`uso: taskgraph ${command.usage}`);
  }

  const exec = (db: Db): void =>
    command.run({
      db,
      args,
      opts: values,
      now: ctx.now,
      say: (line = "") => ctx.out(line + "\n"),
      show: (task) =>
        formatTask(task, { map: toMap(db.tasks), today: ctx.now, color: ctx.color }),
      dim: (text) => paint(ctx.color, "dim", text),
    } satisfies Run);

  if (command.writes) update(ctx.file, exec);
  else exec(load(ctx.file));
  return 0;
}

/** Executa um comando e devolve o código de saída (0 ok, 1 erro de uso, 2 opção inválida). */
export function run(argv: string[], ctx: Context): number {
  try {
    return execute(argv, ctx);
  } catch (e) {
    if (e instanceof TaskError) {
      ctx.err(`erro: ${e.message}\n`);
      return 1;
    }
    const code = (e as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
      ctx.err(`erro: ${(e as Error).message}\n`);
      return 2;
    }
    throw e;
  }
}
