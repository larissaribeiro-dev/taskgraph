#!/usr/bin/env node
import { run } from "./cli.js";
import { defaultPath } from "./store.js";

// `taskgraph list | head -1` fecha o pipe antes de terminarmos de escrever.
// Isso não é erro nosso, então saímos em silêncio como os comandos do Unix fazem.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

process.exitCode = run(process.argv.slice(2), {
  file: defaultPath(),
  now: new Date(),
  color: useColor,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
