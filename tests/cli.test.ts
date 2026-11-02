import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { run } from "../src/cli.js";
import { VERSION } from "../src/help.js";
import { NOW } from "./helpers.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taskgraph-cli-"));
  file = join(dir, "dados.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function cli(...argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(argv, {
    file,
    now: NOW,
    color: false,
    out: (t) => (out += t),
    err: (t) => (err += t),
  });
  return { code, out, err };
}

test("sem comando lista, e começa vazio", () => {
  const r = cli();
  assert.equal(r.code, 0);
  assert.match(r.out, /nenhuma tarefa/);
});

test("add com opções e list mostram a tarefa formatada", () => {
  const add = cli(
    "add",
    "Escrever",
    "relatório",
    "-p",
    "alta",
    "-d",
    "amanha",
    "-t",
    "Backend,estudo",
  );
  assert.equal(add.code, 0);
  const list = cli("list");
  assert.match(list.out, /#1 \[ \] \(alta\) Escrever relatório/);
  assert.match(list.out, /vence amanhã/);
  assert.match(list.out, /#backend #estudo/);
});

test("fluxo completo: dependência bloqueia, concluir libera", () => {
  cli("add", "escrever a API");
  cli("add", "fazer o deploy", "--deps", "1");

  assert.match(cli("list").out, /aguarda #1/);

  const blocked = cli("done", "2");
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /bloqueada por #1/);

  const done = cli("done", "1");
  assert.equal(done.code, 0);
  assert.match(done.out, /liberou: #2/);

  assert.doesNotMatch(cli("list").out, /aguarda/);
});

test("list esconde concluídas, --all mostra", () => {
  cli("add", "a");
  cli("done", "1");
  assert.match(cli("list").out, /nenhuma tarefa/);
  assert.match(cli("list", "--all").out, /\[x\]/);
});

test("list filtra por tag", () => {
  cli("add", "a", "-t", "casa");
  cli("add", "b", "-t", "trabalho");
  const r = cli("list", "-t", "trabalho");
  assert.match(r.out, /b/);
  assert.doesNotMatch(r.out, /#1/);
});

test("next sugere a tarefa mais urgente já liberada", () => {
  cli("add", "tranquila", "-p", "baixa");
  cli("add", "urgente", "-p", "alta", "-d", "hoje");
  cli("add", "presa", "-p", "alta", "--deps", "1");
  const r = cli("next", "1");
  assert.match(r.out, /1\. #2/);
  assert.doesNotMatch(r.out, /#3/);
});

test("plan lista todas respeitando dependências", () => {
  cli("add", "base", "-p", "baixa");
  cli("add", "topo", "-p", "alta", "--deps", "1");
  const lines = cli("plan").out.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /#1/);
  assert.match(lines[1] ?? "", /#2/);
});

test("dep recusa ciclo", () => {
  cli("add", "a");
  cli("add", "b");
  cli("dep", "2", "1");
  const r = cli("dep", "1", "2");
  assert.equal(r.code, 1);
  assert.match(r.err, /ciclo/);
});

test("edit, undo, rm e stats", () => {
  cli("add", "a", "-d", "2026-10-30");
  assert.match(cli("edit", "1", "--title", "novo", "-p", "baixa").out, /novo/);
  assert.match(cli("edit", "1", "-d", "nenhum").out, /atualizada/);
  assert.equal(cli("edit", "1").code, 1);

  cli("add", "b");
  cli("done", "2");
  assert.match(cli("stats").out, /concluídas\s+1 \(50%\)/);
  assert.match(cli("undo", "2").out, /reaberta/);
  assert.match(cli("rm", "2").out, /removida/);
  assert.equal(cli("rm", "2").code, 1);
});

test("stats conta atrasadas e bloqueadas", () => {
  cli("add", "a", "-d", "2026-10-30");
  cli("add", "b", "--deps", "1");
  const out = cli("stats").out;
  assert.match(out, /bloqueadas\s+1/);
  assert.match(out, /atrasadas\s+1/);
});

test("graph imprime Mermaid", () => {
  cli("add", "a");
  cli("add", "b", "--deps", "1");
  assert.match(cli("graph").out, /t1 --> t2/);
});

test("erros de uso têm código e mensagem", () => {
  assert.equal(cli("bagunça").code, 1);
  assert.match(cli("done", "abc").err, /inválido/);
  assert.match(cli("done").err, /uso: taskgraph done <id>/);
  assert.match(cli("add", "x", "-p", "urgentissima").err, /prioridade inválida/);
  assert.match(cli("add", "x", "-d", "ontem").err, /data inválida/);
  assert.equal(cli("add", "x", "--naoexiste").code, 2);
  assert.equal(cli("add").code, 1); // título vazio
});

test("--help e --version", () => {
  assert.match(cli("--help").out, /Uso: taskgraph/);
  assert.match(cli("--version").out, /taskgraph \d+\.\d+\.\d+/);
});

test("a versão do programa é a mesma do package.json", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test("opção que não vale para o comando é erro, não é ignorada", () => {
  cli("add", "a");
  const r = cli("done", "1", "--priority", "alta");
  assert.equal(r.code, 1);
  assert.match(r.err, /--priority não vale para 'done'/);
  assert.match(cli("list", "--deps", "1").err, /--deps não vale para 'list'/);
  assert.match(cli("stats", "-f").err, /--force não vale para 'stats'/);
  assert.match(cli("list").out, /#1/); // nada foi concluído
});

test("quantidade errada de argumentos mostra o uso do comando", () => {
  assert.match(cli("done", "1", "2").err, /uso: taskgraph done <id>/);
  assert.match(cli("dep", "1").err, /uso: taskgraph dep <id> <de-id>/);
  assert.match(cli("list", "extra").err, /uso: taskgraph list/);
  assert.match(cli("add").err, /uso: taskgraph add <título>/);
});

test("next exige um número maior que zero", () => {
  assert.match(cli("next", "0").err, /maior que zero/);
  assert.match(cli("next", "x").err, /inválido/);
});

test("nomes herdados de Object não viram comando", () => {
  for (const nome of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.match(cli(nome).err, /comando desconhecido/, nome);
  }
});

test("arquivo de dados inconsistente é recusado e não é alterado", () => {
  const ruim = JSON.stringify({
    version: 1,
    nextId: 3,
    tasks: [
      {
        id: 1,
        title: "a",
        done: false,
        priority: 2,
        due: null,
        tags: [],
        deps: [2],
        createdAt: "x",
        doneAt: null,
      },
      {
        id: 2,
        title: "b",
        done: false,
        priority: 2,
        due: null,
        tags: [],
        deps: [1],
        createdAt: "x",
        doneAt: null,
      },
    ],
  });
  writeFileSync(file, ruim);
  const r = cli("add", "c");
  assert.equal(r.code, 1);
  assert.match(r.err, /ciclo/);
  assert.equal(readFileSync(file, "utf8"), ruim);
});

test("help como comando mostra a ajuda", () => {
  assert.match(cli("help").out, /Uso: taskgraph/);
});
