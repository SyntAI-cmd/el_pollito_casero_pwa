import { openStore } from "../server/store.mjs";
import { accountSummary } from "../domain.mjs";

export async function restaurarHistoricos({
  dbPath = "data/pollito.sqlite",
  backupPath = "data/backups/pollito-2026-09-22.sqlite",
  log = console.log,
} = {}) {
  log(`Abriendo base histórica: ${backupPath}`);
  const sOld = await openStore(backupPath);
  const oldCustomers = sOld.customers.all();
  const oldOrders = sOld.orders.all();

  // Calcular balances históricos de todos los clientes
  const historico = [];
  for (const c of oldCustomers) {
    const o = oldOrders.filter((ord) => ord.customer === c.phone);
    const sum = accountSummary(o, c);
    if (sum.balance !== 0 || sum.boxes !== 0) {
      historico.push({
        phone: c.phone,
        name: c.name,
        balance: sum.balance,
        boxes: sum.boxes,
      });
    }
  }
  sOld.close();

  log(`Clientes históricos con saldo/cajas en el backup: ${historico.length}`);

  log(`Abriendo base actual: ${dbPath}`);
  const sCur = await openStore(dbPath);
  const curOrders = sCur.orders.all();

  let restaurados = 0;
  sCur.transaction(() => {
    for (const h of historico) {
      const c = sCur.customers.get(h.phone);
      if (!c) {
        log(`Cliente ${h.name} (${h.phone}) no encontrado en la base actual.`);
        continue;
      }
      const cOrders = curOrders.filter((ord) => ord.customer === c.phone);
      const curSum = accountSummary(cOrders, c);

      // Si el cliente en la base actual quedó en 0 por el reset previo, restauramos su histórico
      if (curSum.balance === 0 && curSum.boxes === 0) {
        log(`Restaurando ${h.name} (${h.phone}): Saldo $${h.balance}, Cajas: ${h.boxes}`);
        c.balanceAdjustments = [
          ...(c.balanceAdjustments || []),
          {
            id: "hist-" + Date.now().toString(36),
            at: new Date().toISOString(),
            by: "restauracion-historica",
            amount: h.balance,
            note: "Restauración saldo histórico al 22/09",
          },
        ];
        if (h.boxes !== 0) {
          c.boxesAdjust = (c.boxesAdjust || 0) + h.boxes;
        }
        sCur.customers.save(c);
        restaurados++;
      } else {
        log(
          `Cliente ${h.name} (${h.phone}) ya tiene actividad actual ($${curSum.balance}, ${curSum.boxes} cajas). Se conserva actual.`,
        );
      }
    }
  });

  sCur.close();
  log(`✔ Restauración completada. Clientes restaurados: ${restaurados}`);
  return { restaurados };
}

if (process.argv[1] && /restaurar-historicos\.mjs$/.test(process.argv[1])) {
  await restaurarHistoricos();
}
