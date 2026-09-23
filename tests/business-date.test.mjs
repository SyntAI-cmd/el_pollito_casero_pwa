import test from "node:test";
import assert from "node:assert/strict";
import { businessDate } from "../src/lib/businessDate.js";
for (const time of [
  "00:00:00",
  "12:30:00",
  "13:00:00",
  "18:00:00",
  "23:59:59",
]) {
  test(`pedido del 23 a las ${time} conserva el día de Mendoza`, () =>
    assert.equal(
      businessDate(new Date(`2026-09-23T${time}-03:00`)),
      "2026-09-23",
    ));
}
test("medianoche UTC todavía pertenece al día anterior de Mendoza", () =>
  assert.equal(businessDate(new Date("2026-09-24T01:30:00Z")), "2026-09-23"));
test("cambio real de día local", () =>
  assert.equal(businessDate(new Date("2026-09-24T03:00:00Z")), "2026-09-24"));
