import test from "node:test";
import assert from "node:assert/strict";
import { renderPdf } from "../src/lib/pdf-job.js";
test("PDF: limita concurrencia y destruye motor al finalizar, cancelar o fallar", async () => {
  const previous = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor() {
      workers.push(this);
    }
    postMessage(data) {
      this.data = data;
    }
    terminate() {
      this.terminated = true;
    }
  };
  try {
    const first = renderPdf("remito", { orders: [] });
    await assert.rejects(renderPdf("remito", {}), /Ya se está/);
    const blob = new Blob(["%PDF-"]);
    workers[0].onmessage({ data: { blob } });
    assert.equal(await first, blob);
    assert.ok(workers[0].terminated);
    const controller = new AbortController();
    const cancelled = renderPdf("remito", {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.ok(workers[1].terminated);
    const failed = renderPdf("remito", {});
    workers[2].onerror();
    await assert.rejects(failed, /No se pudo/);
    assert.ok(workers[2].terminated);
  } finally {
    globalThis.Worker = previous;
  }
});
