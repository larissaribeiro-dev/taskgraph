import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, parseDue } from "../src/dates.js";
import { TaskError } from "../src/errors.js";
import { NOW } from "./helpers.js";

test("parseDue aceita data ISO", () => {
  assert.equal(parseDue("2026-12-25", NOW), "2026-12-25");
});

test("parseDue aceita atalhos", () => {
  assert.equal(parseDue("hoje", NOW), "2026-11-02");
  assert.equal(parseDue("amanha", NOW), "2026-11-03");
  assert.equal(parseDue("amanhã", NOW), "2026-11-03");
  assert.equal(parseDue("+3d", NOW), "2026-11-05");
  assert.equal(parseDue("+30d", NOW), "2026-12-02");
});

test("parseDue rejeita datas impossíveis", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "ontem", "01/02/2026", "+d", ""]) {
    assert.throws(() => parseDue(bad, NOW), TaskError, bad);
  }
});

test("parseDue rejeita prazo absurdo", () => {
  assert.throws(() => parseDue("+999999d", NOW), TaskError);
});

test("parseDue aceita 29 de fevereiro só em ano bissexto", () => {
  assert.equal(parseDue("2028-02-29", NOW), "2028-02-29");
  assert.throws(() => parseDue("2027-02-29", NOW), TaskError);
});

test("daysUntil conta dias com sinal", () => {
  assert.equal(daysUntil("2026-11-02", NOW), 0);
  assert.equal(daysUntil("2026-11-05", NOW), 3);
  assert.equal(daysUntil("2026-10-31", NOW), -2);
});

test("daysUntil atravessa virada de mês e ano", () => {
  assert.equal(daysUntil("2027-01-01", NOW), 60);
});
