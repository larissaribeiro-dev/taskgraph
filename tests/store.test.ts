import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TaskError } from "../src/errors.js";
import { defaultPath, load, save, update, withLock } from "../src/store.js";
import { emptyDb, type Task } from "../src/types.js";
import { mk } from "./helpers.js";

function tmpFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "taskgraph-"));
  return { dir, file: join(dir, "dados.json") };
}

test("load de arquivo inexistente devolve banco vazio", () => {
  const { dir, file } = tmpFile();
  assert.deepEqual(load(file), emptyDb());
  rmSync(dir, { recursive: true });
});

test("save e load preservam os dados e não deixam temporários", () => {
  const { dir, file } = tmpFile();
  const db = { ...emptyDb(), nextId: 3, tasks: [mk(1), mk(2, { deps: [1] })] };
  save(file, db);
  assert.deepEqual(load(file), db);
  assert.deepEqual(readdirSync(dir), ["dados.json"]);
  rmSync(dir, { recursive: true });
});

test("load recusa JSON corrompido e estrutura inválida", () => {
  const { dir, file } = tmpFile();
  writeFileSync(file, "{ isso nao e json");
  assert.throws(() => load(file), /corrompido/);
  writeFileSync(file, JSON.stringify({ version: 1, nextId: 1, tasks: [{ id: "x" }] }));
  assert.throws(() => load(file), TaskError);
  writeFileSync(file, JSON.stringify([1, 2, 3]));
  assert.throws(() => load(file), TaskError);
  rmSync(dir, { recursive: true });
});

test("defaultPath respeita TASKGRAPH_FILE", () => {
  assert.equal(defaultPath({ TASKGRAPH_FILE: "/tmp/x.json" }), "/tmp/x.json");
  assert.match(defaultPath({}), /\.taskgraph\.json$/);
});

function writeDb(file: string, tasks: Task[], nextId = 10): void {
  writeFileSync(file, JSON.stringify({ version: 1, nextId, tasks }));
}

test("load recusa dados que o JSON válido não garante", () => {
  const { dir, file } = tmpFile();
  const casos: [string, Task[], number?][] = [
    ["id repetido", [mk(1), mk(1)]],
    ["dependência que não existe", [mk(1, { deps: [9] })]],
    ["dependência de si mesma", [mk(1, { deps: [1] })]],
    ["dependência repetida", [mk(1), mk(2, { deps: [1, 1] })]],
    ["ciclo", [mk(1, { deps: [2] }), mk(2, { deps: [1] })]],
    ["nextId menor que um id usado", [mk(5)], 3],
    ["prazo impossível", [mk(1, { due: "2026-02-30" })]],
    ["título vazio", [mk(1, { title: "  " })]],
  ];
  for (const [nome, tasks, nextId] of casos) {
    writeDb(file, tasks, nextId);
    assert.throws(() => load(file), /inconsistente|inválido/, nome);
  }
  rmSync(dir, { recursive: true });
});

test("update grava o que a função alterou e libera o cadeado", () => {
  const { dir, file } = tmpFile();
  update(file, (db) => {
    db.tasks.push(mk(1));
    db.nextId = 2;
  });
  assert.equal(load(file).tasks.length, 1);
  assert.equal(existsSync(`${file}.lock`), false);
  rmSync(dir, { recursive: true });
});

test("update não grava nada se a função lançar erro, e ainda libera o cadeado", () => {
  const { dir, file } = tmpFile();
  assert.throws(
    () =>
      update(file, (db) => {
        db.tasks.push(mk(1));
        throw new TaskError("falhou no meio");
      }),
    /falhou no meio/,
  );
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(`${file}.lock`), false);
  rmSync(dir, { recursive: true });
});

test("withLock desiste depois do tempo limite se outro processo segurar o cadeado", () => {
  const { dir, file } = tmpFile();
  writeFileSync(`${file}.lock`, "");
  assert.throws(
    () => withLock(file, () => 1, { timeoutMs: 60, staleMs: 60_000 }),
    /outro processo/,
  );
  assert.equal(existsSync(`${file}.lock`), true); // não é nosso, não pode apagar
  rmSync(dir, { recursive: true });
});

test("withLock recupera um cadeado velho deixado por um processo que morreu", () => {
  const { dir, file } = tmpFile();
  const lock = `${file}.lock`;
  writeFileSync(lock, "");
  const longeNoPassado = new Date(Date.now() - 60_000);
  utimesSync(lock, longeNoPassado, longeNoPassado);
  assert.equal(
    withLock(file, () => "ok", { staleMs: 1000 }),
    "ok",
  );
  assert.equal(existsSync(lock), false);
  rmSync(dir, { recursive: true });
});

test("save se recusa a gravar um estado inconsistente", () => {
  const { dir, file } = tmpFile();
  const db = { ...emptyDb(), tasks: [mk(1, { deps: [1] })], nextId: 2 };
  assert.throws(() => save(file, db), /nada foi gravado/);
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true });
});
