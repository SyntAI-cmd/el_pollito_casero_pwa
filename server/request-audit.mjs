import { AsyncLocalStorage } from "node:async_hooks";
export const requestAudit = new AsyncLocalStorage();

/** Respaldo de auditoría para escrituras que no tienen un evento específico. */
export function withRequestAudit(handle, store) {
  return (request) =>
    requestAudit.run({ logged: false }, async () => {
      const result = await handle(request);
      const { method, path, session, body } = request;
      if (
        result?.status >= 200 &&
        result.status < 300 &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        ["admin", "repartidor"].includes(session?.role) &&
        !requestAudit.getStore().logged
      ) {
        const [, root, identifier] = path.replace(/^\/api\//, "/").split("/");
        const entity =
          {
            orders: "order",
            customers: "customer",
            vehicles: "vehicle",
            trips: "trip",
            documents: "document",
            news: "news",
            settings: "settings",
            staff: "staff",
            drivers: "driver",
          }[root] || "operation";
        store.audit.log(
          session,
          `${entity}.${method === "DELETE" ? "delete" : method === "POST" ? "create" : "update"}`,
          entity,
          identifier
            ? decodeURIComponent(identifier)
            : String(result.body?.id || root),
          body,
        );
      }
      return result;
    });
}
