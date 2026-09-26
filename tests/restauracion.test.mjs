import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { accountSummary } from "../domain.mjs";
import { restaurarHistoricos } from "../scripts/restaurar-historicos.mjs";

test("restauración: cero no revive deuda; plan conciliado preserva actividad y no se duplica", async () => {
  const dir = await mkdtemp(join(tmpdir(), "restore-test-"));
  const dbPath = join(dir, "current.sqlite"),
    backupPath = join(dir, "old.sqlite");
  let s;
  try {
    for (const [path, amount] of [
      [backupPath, 100],
      [dbPath, 0],
    ]) {
      s = await openStore(path);
      s.customers.save({
        phone: "test",
        name: "Ensayo",
        balanceAdjustments: [{ id: "initial", amount }],
        boxesAdjust: 0,
      });
      s.close();
      s = null;
    }
    assert.equal(
      (await restaurarHistoricos({ dbPath, backupPath, log() {} })).restaurados,
      0,
    );
    s = await openStore(dbPath);
    assert.equal(accountSummary([], s.customers.get("test")).balance, 0);
    s.customers.save({
      ...s.customers.get("test"),
      balanceAdjustments: [{ id: "new", amount: 25 }],
    });
    s.close();
    s = null;
    await assert.rejects(
      restaurarHistoricos({ dbPath, backupPath, apply: true }),
      /plan/,
    );
    const plan = [
      {
        phone: "test",
        balanceDelta: 100,
        boxesDelta: 2,
        expectedBalance: 25,
        expectedBoxes: 0,
        reason: "Faltante conciliado con registro de reset",
      },
    ];
    await assert.rejects(
      restaurarHistoricos({
        dbPath,
        backupPath,
        plan: [{ ...plan[0], expectedBalance: 0 }],
        apply: true,
      }),
      /saldo cambió/,
    );
    const applied = await restaurarHistoricos({
      dbPath,
      backupPath,
      plan,
      apply: true,
    });
    assert.equal(applied.restaurados, 1);
    assert.ok(applied.safetyBackup);
    assert.equal(
      (await restaurarHistoricos({ dbPath, backupPath, plan, apply: true }))
        .alreadyApplied,
      true,
    );
    s = await openStore(dbPath);
    const after = accountSummary([], s.customers.get("test"));
    assert.equal(after.balance, 125);
    assert.equal(after.boxes, 2);
  } finally {
    s?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
