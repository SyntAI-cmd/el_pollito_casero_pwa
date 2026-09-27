import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  api,
  post,
  patch,
  put,
  del,
  subscribe,
  isLive,
  stored,
  persist,
  serverDownMessage,
  onAuthError,
} from "./api.js";
import {
  tick,
  mergeFull,
  mergePartial,
  upsertList,
  removeFromList,
  createBatcher,
  idsParam,
} from "./sync.js";
import {
  labels,
  productPrice,
  lineAmount,
  waLink,
  isActive,
  orderNumber,
} from "./format.js";
import { useRoute } from "./router.jsx";
import { setDueño } from "./outbox.js";
import { coalescedRefresh } from "./refresh.js";
import { dueñoDe } from "./sesion.js";
import { enablePush, disablePush, syncPush, pushPermission } from "./push.js";
import {
  passkeyLogin,
  passkeyRegister,
  passkeyRemove,
  deviceLabel,
} from "./auth.js";

const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

export function StoreProvider({ children }) {
  const { navigate } = useRoute();
  const [config, setConfig] = useState(() => stored("pc-config-v3", null));
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [serverDown, setServerDown] = useState(false);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingOrders, setStartingOrders] = useState({});
  const startLocks = useRef(new Set());
  const [install, setInstall] = useState(null);
  const [plan, setPlanState] = useState(() => stored("pc-plan", "minorista"));
  const [cart, setCart] = useState(() => stored("pc-cart", {}));
  const [profile, setProfile] = useState(() => stored("pc-profile", {}));
  const [pushState, setPushState] = useState(() => pushPermission());
  const orderKey = useRef(crypto.randomUUID());
  const lastStatuses = useRef({});
  const sessionRef = useRef(null);
  sessionRef.current = session;
  // Quién está usando la app: lo necesitan la cola de envíos (para no mandar lo de otro con esta
  // sesión) y el service worker (para no servir la copia privada de otro). PC-019.
  // "Sin sesión" se avisa sólo cuando el servidor lo confirmó (o al salir): al arrancar, la sesión
  // todavía no se conoce, y avisarlo borraba la copia de datos del teléfono. Sin señal, la app
  // volvía al ingreso y no se veían las pesadas pendientes.
  const [sessionKnown, setSessionKnown] = useState(false);
  useEffect(() => {
    setDueño(session);
    if (!session && !sessionKnown) return;
    const id = dueñoDe(session);
    navigator.serviceWorker?.ready
      ?.then((reg) => reg.active?.postMessage({ type: "sesion", id }))
      .catch(() => {});
  }, [session, sessionKnown]);

  const notify = useCallback((text) => setToast(text), []);

  // ---- Sincronización por entidad (PC-017) ----
  // Cada pedido y cada ficha recuerdan cuán nueva es la información aplicada: una respuesta que
  // salió antes de un cambio no lo pisa. Los eventos traen el id y se consultan sólo esos.
  const orderVersions = useRef(new Map());
  const customerVersions = useRef(new Map());
  const lastFull = useRef(0);
  const ordersSilent = useRef(true);
  const byPhone = (c) => c.phone;
  const clientStatusNotice = useCallback(
    (list) => {
      if (sessionRef.current?.role !== "cliente") return;
      for (const o of list) {
        const prev = lastStatuses.current[o.id];
        if (prev && prev !== o.status) notify(`${o.id}: ${labels[o.status]}`);
        lastStatuses.current[o.id] = o.status;
      }
    },
    [notify],
  );
  /** Pedido devuelto por una escritura: se aplica directo (sin volver a pedir la lista). */
  const applyOrder = useCallback((order) => {
    if (!order?.id) return;
    const { crates: _crates, ...o } = order;
    const seq = tick();
    lastStatuses.current[o.id] = o.status;
    setOrders((current) => upsertList(current, o, seq, orderVersions.current));
  }, []);
  const dropOrder = useCallback((id) => {
    const seq = tick();
    delete lastStatuses.current[id];
    setOrders((current) =>
      removeFromList(current, id, seq, orderVersions.current),
    );
  }, []);

  const loadOrders = useMemo(() => {
    const refresh = coalescedRefresh(async () => {
      const owner = sessionRef.current;
      const silent = ordersSilent.current;
      ordersSilent.current = true;
      const seq = tick();
      try {
        const list = await api("/orders");
        if (sessionRef.current !== owner) return;
        const previous = lastStatuses.current;
        for (const o of list)
          if (
            previous[o.id] &&
            previous[o.id] !== o.status &&
            sessionRef.current?.role === "cliente"
          )
            notify(`${o.id}: ${labels[o.status]}`);
        lastStatuses.current = Object.fromEntries(
          list.map((o) => [o.id, o.status]),
        );
        setOrders((current) =>
          mergeFull(current, list, seq, orderVersions.current),
        );
        setServerDown(false);
        setError("");
        return list;
      } catch (e) {
        if (sessionRef.current !== owner) return;
        if (e.status === 401) return setOrders([]);
        if (e.network) {
          setServerDown(true);
          if (!silent) setError(serverDownMessage);
        } else if (!silent) setError(e.message);
      }
    });
    return ({ silent = false } = {}) => {
      if (!silent) ordersSilent.current = false;
      return refresh();
    };
  }, [notify]);

  const loadMe = useCallback(async () => {
    if (sessionRef.current?.role === "cliente")
      setMe(await api("/me").catch(() => null));
    else setMe(null);
  }, []);
  const loadCustomers = useMemo(
    () =>
      coalescedRefresh(async () => {
        const owner = sessionRef.current;
        if (!["admin", "repartidor"].includes(owner?.role)) {
          setCustomers([]);
          return;
        }
        const seq = tick();
        try {
          const list = await api("/customers");
          if (sessionRef.current === owner)
            setCustomers((current) =>
              mergeFull(current, list, seq, customerVersions.current, byPhone),
            );
        } catch (e) {
          // Una falla temporal no vacía las fichas ni cambia sus saldos a cero.
          if (sessionRef.current === owner && !e.network) notify(e.message);
        }
      }),
    [notify],
  );
  /** Pedidos puntuales (eventos en vivo): los que no vuelven ya no existen o no le tocan. */
  const orderBatch = useMemo(
    () =>
      createBatcher(async (ids) => {
        const owner = sessionRef.current;
        if (!owner) return;
        const seq = tick();
        const list = await api("/orders?ids=" + idsParam(ids));
        if (sessionRef.current !== owner || !Array.isArray(list)) return;
        clientStatusNotice(list);
        setOrders((current) =>
          mergePartial(current, ids, list, seq, orderVersions.current),
        );
        for (const id of ids)
          if (!list.some((o) => o.id === id)) delete lastStatuses.current[id];
      }, 150),
    [clientStatusNotice],
  );
  /** Fichas puntuales: el saldo del cliente de un pedido recién pesado, cobrado o editado. */
  const customerBatch = useMemo(
    () =>
      createBatcher(async (phones) => {
        const owner = sessionRef.current;
        if (!["admin", "repartidor"].includes(owner?.role)) return;
        if (phones.includes("*")) return loadCustomers();
        const seq = tick();
        const list = await api("/customers?phones=" + idsParam(phones));
        if (sessionRef.current !== owner || !Array.isArray(list)) return;
        setCustomers((current) =>
          mergePartial(
            current,
            phones,
            list,
            seq,
            customerVersions.current,
            byPhone,
          ),
        );
      }, 300),
    [loadCustomers],
  );
  const fullSync = useCallback(async () => {
    const [list] = await Promise.all([
      loadOrders({ silent: true }),
      loadMe(),
      loadCustomers(),
    ]);
    // Sólo cuenta como conciliado si la lista llegó (una falla vuelve a intentar pronto).
    if (Array.isArray(list)) lastFull.current = Date.now();
  }, [loadOrders, loadMe, loadCustomers]);
  /**
   * Después de una escritura: con eventos en vivo, se aplica lo devuelto y se consultan sólo el
   * pedido y la ficha afectados (el resto llega por eventos). Sin eventos, se concilia todo.
   */
  const afterWrite = useCallback(
    async ({ order, removed, orderIds = [], customers: phones = [] }) => {
      if (order?.id) applyOrder(order);
      if (removed) dropOrder(removed);
      if (!isLive()) return fullSync();
      await Promise.all([
        ...orderIds.map((id) => orderBatch.add(id, true)),
        ...phones.filter(Boolean).map((p) => customerBatch.add(p, true)),
      ]);
    },
    [applyOrder, dropOrder, fullSync, orderBatch, customerBatch],
  );
  /**
   * Vuelve a traer pedidos y clientes (al entrar a una vista, para no mostrar datos viejos). Con
   * eventos en vivo y una conciliación reciente no hace falta: los cambios ya llegaron solos.
   */
  const reload = useCallback(
    ({ force = false } = {}) =>
      !force && isLive() && Date.now() - lastFull.current < 60000
        ? Promise.resolve()
        : fullSync().catch(() => {}),
    [fullSync],
  );
  /** Olvida lo aplicado de la sesión anterior (otra persona, otro alcance de datos). */
  const resetSync = () => {
    orderVersions.current = new Map();
    customerVersions.current = new Map();
    lastFull.current = 0;
  };

  // Carga inicial: configuración, sesión y pedidos.
  useEffect(() => {
    api("/config")
      .then(async (c) => {
        const { session: s, ...rest } = c;
        setConfig(rest);
        persist("pc-config-v3", rest);
        setSession(s);
        sessionRef.current = s;
        // La sesión ya se conoce (del servidor o, sin señal, de la copia privada de esta persona).
        setSessionKnown(true);
        if (s?.plan) setPlanState(s.plan);
        await fullSync();
        if (s) syncPush(rest.pushKey).catch(() => {});
      })
      .catch(() => {
        setServerDown(true);
        setError(serverDownMessage);
      })
      .finally(() => setLoaded(true));
    const status = () => setOnline(navigator.onLine);
    const prompt = (e) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el servidor rechaza la sesión (usuario desactivado, rol cambiado, vencida), se vuelve al ingreso.
  useEffect(() => {
    let checking = false;
    onAuthError(async () => {
      const current = sessionRef.current;
      if (!current || checking) return;
      checking = true;
      try {
        const s = await api("/session");
        if (s) return;
        const wasStaff = current.role !== "cliente";
        setSessionKnown(true);
        setSession(null);
        sessionRef.current = null;
        resetSync();
        setOrders([]);
        setMe(null);
        setCustomers([]);
        setModal(null);
        navigate(wasStaff ? "/admin" : "/ingresar", { replace: true });
        notify("Tu sesión ya no es válida. Volvé a ingresar.");
      } catch {
      } finally {
        checking = false;
      }
    });
    return () => onAuthError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Novedades en tiempo real mientras haya sesión. Con eventos en vivo sólo se consulta lo que
  // cambió, más una conciliación completa cada 5 min; sin eventos, cada 30 s como antes. Al
  // reconectar se concilia todo (los eventos del corte se perdieron). Con la pestaña oculta no
  // se consulta; al volver, si pasó más de un minuto, se concilia.
  useEffect(() => {
    if (!session) return;
    let meTimer;
    const close = subscribe(
      (type, data) => {
        const cliente = sessionRef.current?.role === "cliente";
        if (type === "orders") {
          if (data?.id) {
            if (data.deleted) dropOrder(data.id);
            else void orderBatch.add(data.id);
          } else void loadOrders({ silent: true });
          // Servidores anteriores no dicen de qué cliente es: se refrescan todas las fichas.
          if (data && "customer" in data) {
            if (data.customer) void customerBatch.add(data.customer);
          } else void customerBatch.add("*");
        }
        if (type === "customer") {
          if (data?.phone && data.phone !== "*")
            void customerBatch.add(data.phone);
          else void customerBatch.add("*");
        }
        if (cliente && (type === "orders" || type === "customer")) {
          clearTimeout(meTimer);
          meTimer = setTimeout(loadMe, 600);
        }
      },
      (state, info) => {
        setLive(state);
        if (state && info?.reconnected) void fullSync();
      },
    );
    const visible = () => document.visibilityState !== "hidden";
    const timer = setInterval(() => {
      if (!visible()) return;
      const age = Date.now() - lastFull.current;
      if (age >= (isLive() ? 5 * 60000 : 30000)) void fullSync();
    }, 15000);
    const onVisible = () => {
      if (visible() && Date.now() - lastFull.current >= 60000) void fullSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      close();
      clearInterval(timer);
      clearTimeout(meTimer);
      document.removeEventListener("visibilitychange", onVisible);
      setLive(false);
    };
  }, [
    session,
    orderBatch,
    customerBatch,
    loadOrders,
    loadMe,
    fullSync,
    dropOrder,
  ]);

  useEffect(() => {
    persist("pc-cart", cart);
  }, [cart]);
  useEffect(() => {
    persist("pc-plan", plan);
  }, [plan]);
  useEffect(() => {
    persist("pc-profile", profile);
  }, [profile]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => setFormError(""), [modal]);

  const products = config?.products || [];
  const price = useCallback((p) => productPrice(p, plan), [plan]);

  // Quita del carrito productos sin precio para la modalidad elegida.
  useEffect(() => {
    if (!config) return;
    setCart((current) => {
      const kept = Object.fromEntries(
        Object.entries(current).filter(([id, q]) => {
          const p = config.products.find((p) => p.id === id);
          return (
            p &&
            Number.isFinite(productPrice(p, plan)) &&
            Number.isFinite(q) &&
            q >= 1 &&
            q <= 1000
          );
        }),
      );
      if (Object.keys(kept).length === Object.keys(current).length)
        return current;
      notify(
        "Se quitaron del carrito los productos sin precio para esta modalidad.",
      );
      return kept;
    });
  }, [config, plan, notify]);

  const items = useMemo(
    () => products.filter((p) => cart[p.id] > 0),
    [products, cart],
  );
  const totals = useMemo(() => {
    const kg = items.reduce((s, p) => s + cart[p.id], 0);
    const subtotal =
      items.reduce(
        (s, p) => s + Math.round(lineAmount(price(p), cart[p.id]) * 100),
        0,
      ) / 100;
    const shipping = kg ? (config?.shipping?.[plan] ?? 0) : 0;
    return { kg, subtotal, shipping, total: subtotal + shipping };
  }, [items, cart, price, plan, config]);

  // Con un id explícito que no existe se devuelve null (no otro pedido).
  const activeOrder = useCallback(
    (id) =>
      id
        ? orders.find((o) => o.id === id) || null
        : orders.find(isActive) || orders[0],
    [orders],
  );

  function setPlan(next) {
    setPlanState(next);
    if (sessionRef.current?.role === "cliente")
      patch("/me", { plan: next })
        .then(loadMe)
        .catch(() => {});
  }
  function add(p, quantity) {
    if (!Number.isFinite(price(p)))
      return notify("Este corte todavía no tiene precio para esta modalidad.");
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 1 || q > 1000 || !Number.isInteger(q * 2))
      return notify("Elegí entre 1 y 1000 kg, en pasos de 0,5 kg.");
    if ((cart[p.id] || 0) + q > 1000)
      return notify("El máximo por producto es 1000 kg.");
    setCart({ ...cart, [p.id]: (cart[p.id] || 0) + q });
    notify(`${q} kg de ${p.name.toLowerCase()} en tu pedido`);
    orderKey.current = crypto.randomUUID();
  }
  function setQuantity(id, kg) {
    const next = { ...cart };
    if (kg <= 0) delete next[id];
    else next[id] = Math.min(1000, Math.max(1, Math.round(kg * 2) / 2));
    setCart(next);
    orderKey.current = crypto.randomUUID();
  }
  function clearCart() {
    setCart({});
    orderKey.current = crypto.randomUUID();
  }
  function repeat(o) {
    const valid = Object.fromEntries(
      o.items
        .filter((p) => products.some((x) => x.id === p.id))
        // Se repite lo pedido (no el peso de balanza), en pasos de medio kilo.
        .map((p) => [
          p.id,
          Math.min(1000, Math.max(1, Math.round((p.ordered ?? p.kg) * 2) / 2)),
        ]),
    );
    setCart(valid);
    setPlan(o.plan);
    orderKey.current = crypto.randomUUID();
    navigate("/");
    notify("Pedido cargado al carrito con los precios de hoy.");
  }

  async function run(action, { onError } = {}) {
    if (busy) return false;
    setBusy(true);
    setFormError("");
    try {
      return (await action()) ?? true;
    } catch (e) {
      setFormError(e.message);
      onError?.(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const checkout = (fields) =>
    run(async () => {
      if (!online) throw Error("Necesitás conexión para confirmar el pedido.");
      const order = await post("/orders", {
        ...fields,
        plan,
        items: items.map((p) => ({ id: p.id, kg: cart[p.id] })),
        key: orderKey.current,
      });
      setProfile({
        name: fields.name,
        address: fields.address,
        phone: fields.phone,
        localityId: fields.localityId,
        location: fields.location || null,
      });
      clearCart();
      setModal(null);
      const s = await api("/session");
      setSession(s);
      sessionRef.current = s;
      await Promise.all([loadOrders(), loadMe()]);
      syncPush(config?.pushKey).catch(() => {});
      navigate("/seguimiento?pedido=" + order.id);
      notify(
        config?.demo
          ? "Pedido creado. Avanzalo desde Operación para ver el seguimiento."
          : "Pedido confirmado.",
      );
      return order;
    });

  /** Ingreso por celular en dos pasos: pedir el código por WhatsApp y confirmarlo. */
  const requestPhoneCode = (fields) =>
    run(async () => {
      const r = await post("/auth/phone", fields);
      notify(
        r.sent
          ? "Te enviamos el código por WhatsApp."
          : "Código generado (modo demostración).",
      );
      return r;
    });
  const verifyPhone = (fields, { message, redirect } = {}) =>
    run(async () => {
      const s = await post("/auth/phone/verify", fields);
      setSession(s);
      sessionRef.current = s;
      setProfile((p) => ({ ...p, name: s.name, phone: fields.phone }));
      if (s.plan) setPlanState(s.plan);
      lastStatuses.current = {};
      resetSync();
      await Promise.all([loadOrders(), loadMe()]);
      syncPush(config?.pushKey).catch(() => {});
      setModal(null);
      if (redirect) navigate(redirect);
      notify(message || `Hola, ${(s.name || "").split(" ")[0] || "de nuevo"}.`);
      return s;
    });
  const setPassword = (fields) =>
    run(async () => {
      await post("/auth/password", fields);
      await loadMe();
      notify("Contraseña guardada.");
      return true;
    });

  /** Ingreso con cuenta (email, Google, passkey): aplica la sesión devuelta por el servidor. */
  async function adoptSession(s, { redirect, message } = {}) {
    setSession(s);
    sessionRef.current = s;
    if (s.plan) setPlanState(s.plan);
    setProfile((p) => ({
      ...p,
      name: s.name || p.name,
      ...(s.phone ? {} : {}),
    }));
    lastStatuses.current = {};
    resetSync();
    await Promise.all([loadOrders(), loadMe()]);
    syncPush(config?.pushKey).catch(() => {});
    setModal(null);
    if (redirect) navigate(redirect);
    notify(message || `Hola, ${(s.name || "").split(" ")[0] || "de nuevo"}.`);
  }
  const saveProfile = (fields) =>
    run(async () => {
      await patch("/me", fields);
      const s = await api("/session");
      setSession(s);
      sessionRef.current = s;
      if (s?.plan) setPlanState(s.plan);
      await Promise.all([loadMe(), loadOrders({ silent: true })]);
      setModal(null);
      notify("Datos guardados.");
      return true;
    });
  const emailLogin = (fields, opts) =>
    run(async () => adoptSession(await post("/auth/login", fields), opts));
  const emailRegister = (fields, opts) =>
    run(async () =>
      adoptSession(await post("/auth/register", fields), {
        ...opts,
        message: "Cuenta creada. Bienvenido.",
      }),
    );
  const googleLogin = (credential, opts) =>
    run(async () =>
      adoptSession(await post("/auth/google", { credential }), opts),
    );
  const consumeMagicLink = (token, opts) =>
    run(async () =>
      adoptSession(await post("/auth/magic/consume", { token }), opts),
    );
  const requestMagicLink = (fields) =>
    run(async () => {
      const r = await post("/auth/magic", fields);
      notify(
        r.sent
          ? "Te enviamos el enlace por email. Vale 15 minutos."
          : "Enlace generado.",
      );
      return r;
    });
  const loginWithPasskey = (opts) =>
    run(async () => adoptSession(await passkeyLogin(), opts), {
      onError: (e) =>
        notify(
          e.name === "NotAllowedError"
            ? "Cancelaste la verificación del dispositivo."
            : e.message,
        ),
    });
  const addPasskey = () =>
    run(
      async () => {
        await passkeyRegister(deviceLabel());
        await loadMe();
        notify(
          "Listo: ya podés entrar con la huella, Face ID o el PIN de este dispositivo.",
        );
        return true;
      },
      {
        onError: (e) =>
          notify(
            e.name === "NotAllowedError"
              ? "Cancelaste el registro."
              : e.name === "InvalidStateError"
                ? "Este dispositivo ya está registrado."
                : e.message,
          ),
      },
    );
  const removePasskey = (id) =>
    run(async () => {
      await passkeyRemove(id);
      await loadMe();
      notify("Llave de acceso quitada.");
      return true;
    });

  const staffLogin = (fields) =>
    run(async () => {
      const s = await post("/session/staff", fields);
      setSession(s);
      sessionRef.current = s;
      lastStatuses.current = {};
      resetSync();
      // El equipo no hereda carrito ni datos del cliente anterior en este dispositivo.
      setCart({});
      setProfile({});
      await fullSync();
      syncPush(config?.pushKey).catch(() => {});
      setModal(null);
      navigate(s.role === "admin" ? "/operacion" : "/reparto");
      notify(
        s.role === "admin"
          ? "Panel de operación habilitado."
          : `Entregas de ${s.driver}.`,
      );
    });

  const logout = async () => {
    const wasStaff =
      sessionRef.current?.role === "admin" ||
      sessionRef.current?.role === "repartidor";
    await disablePush().catch(() => {});
    await del("/session").catch(() => {});
    setSessionKnown(true);
    setSession(null);
    sessionRef.current = null;
    resetSync();
    setOrders([]);
    setMe(null);
    setCustomers([]);
    // Nada personal queda para la próxima persona que use este dispositivo.
    setCart({});
    setProfile({});
    orderKey.current = crypto.randomUUID();
    lastStatuses.current = {};
    setModal(null);
    // El equipo vuelve al ingreso para entrar con otro usuario; el cliente, a la tienda.
    navigate(wasStaff ? "/admin" : "/");
    notify("Sesión cerrada en este dispositivo.");
  };

  /** Fichas de clientes (GC), precios propios y repartidores. */
  const saveFicha = (customer, fields, { keepOpen = false } = {}) =>
    run(
      async () => {
        await patch(
          "/customers/" + encodeURIComponent(customer.phone) + "/ficha",
          fields,
        );
        await afterWrite({ customers: [customer.phone] });
        if (!keepOpen) setModal(null);
        notify(keepOpen ? "Lista guardada." : "Ficha guardada.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const createCustomer = (fields) =>
    run(async () => {
      const c = await post("/customers", fields);
      await afterWrite({ customers: [c.phone] });
      setModal(null);
      notify(
        `Cliente ${c.name} creado${c.status === "incompleto" ? " (CUIT pendiente)" : ""}.`,
      );
      return c;
    });
  const savePrices = (customer, prices) =>
    run(
      async () => {
        await api(
          "/customers/" + encodeURIComponent(customer.phone) + "/prices",
          {
            method: "PUT",
            body: JSON.stringify({ prices }),
          },
        );
        await afterWrite({ customers: [customer.phone] });
        setModal(null);
        notify("Precios guardados.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const saveDriver = (name, fields) =>
    run(
      async () => {
        if (name) await patch("/drivers/" + encodeURIComponent(name), fields);
        else await post("/drivers", fields);
        const c = await api("/config");
        const { session: _s, ...rest } = c;
        setConfig(rest);
        persist("pc-config-v3", rest);
        notify(name ? "Repartidor actualizado." : "Repartidor creado.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  /** Pedido cargado por administración desde la pantalla rápida. */
  const refreshConfig = async () => {
    const c = await api("/config");
    const { session: _s, ...rest } = c;
    setConfig(rest);
    persist("pc-config-v3", rest);
    return rest;
  };
  /** Borra un pedido (administración). Lo cobrado con efectivo/transferencia vuelve como saldo a favor. */
  const deleteOrder = (o, reason) =>
    run(
      async () => {
        await api("/orders/" + o.id, {
          method: "DELETE",
          body: JSON.stringify({ reason: reason || "" }),
        });
        await afterWrite({ removed: o.id, customers: [o.customer] });
        notify(`Pedido ${o.id} eliminado.`);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const createStaffOrder = ({ prices, ...payload }) =>
    run(async () => {
      // Precios corregidos en la pantalla: quedan como precios propios del cliente antes de cargar el pedido.
      if (prices && Object.keys(prices).length)
        await api(
          "/customers/" + encodeURIComponent(payload.customer) + "/prices",
          {
            method: "PUT",
            body: JSON.stringify({ prices }),
          },
        );
      const order = await post("/orders", {
        ...payload,
        key: crypto.randomUUID(),
      });
      // La respuesta ya es el pedido: se agrega sin bajar la lista entera (PC-017).
      await afterWrite({ order, customers: [order.customer] });
      notify(`Pedido ${order.id} cargado para ${order.name}.`);
      return order;
    });

  /** Respuesta de una escritura sobre un pedido: se usa si es el pedido; si no, se consulta. */
  const orderResult = (o, r) =>
    r && r.id === o.id && Array.isArray(r.items)
      ? { order: r, customers: [o.customer] }
      : { orderIds: [o.id], customers: [o.customer] };
  const startDelivery = async (o) => {
    if (startLocks.current.has(o.id)) return false;
    startLocks.current.add(o.id);
    setStartingOrders((s) => ({ ...s, [o.id]: true }));
    const owner = sessionRef.current;
    try {
      let confirmed;
      try {
        confirmed = await patch("/orders/" + o.id, {
          status: "en_camino",
          opId: `departure:${o.id}`,
        });
      } catch (error) {
        if (!error.network) throw error;
        confirmed = await api("/orders/" + o.id);
        if (!["en_camino", "entregado"].includes(confirmed.status)) throw error;
      }
      if (sessionRef.current !== owner) return false;
      applyOrder(confirmed);
      notify("Inicio de reparto confirmado.");
      return true;
    } catch (error) {
      if (sessionRef.current === owner) notify(error.message);
      return false;
    } finally {
      startLocks.current.delete(o.id);
      setStartingOrders((s) => {
        const next = { ...s };
        delete next[o.id];
        return next;
      });
    }
  };
  const update = (o, data) =>
    data.status === "en_camino" && Object.keys(data).length === 1
      ? startDelivery(o)
      : run(
          async () => {
            const r = await patch("/orders/" + o.id, data);
            await afterWrite(orderResult(o, r));
            return true;
          },
          { onError: (e) => notify(e.message) },
        );
  /** Edición del pedido cargado: renglones, precios, observaciones y datos del reparto. */
  const editOrder = (o, data) =>
    run(
      async () => {
        const r = await put("/orders/" + o.id + "/editar", data);
        await afterWrite(orderResult(o, r));
        notify(`Pedido N° ${orderNumber(o)} actualizado.`);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  /** Saldo real de cuenta corriente y de cajas de un cliente (la diferencia queda como ajuste). */
  const saveBalances = (c, data) =>
    run(
      async () => {
        await patch(
          "/customers/" + encodeURIComponent(c.phone) + "/saldos",
          data,
        );
        await afterWrite({ customers: [c.phone] });
        notify(`Saldos de ${c.name} actualizados.`);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  const updateCustomer = (c, data) =>
    run(
      async () => {
        await patch("/customers/" + c.phone, data);
        await afterWrite({ customers: [c.phone] });
        notify("Cliente actualizado.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  const registerPayment = (customer, data) =>
    run(
      async () => {
        await post("/customers/" + customer.phone + "/payments", data);
        // Los pedidos que cubre el cobro llegan por eventos; la ficha se trae ya.
        await afterWrite({ customers: [customer.phone] });
        notify("Pago registrado.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const returnBoxes = (customer, boxes) =>
    run(
      async () => {
        await post("/customers/" + customer.phone + "/boxes", { boxes });
        await afterWrite({ customers: [customer.phone] });
        notify(`${boxes} envases recibidos de ${customer.name}.`);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const reportTransfer = (o, reference) =>
    run(
      async () => {
        await patch("/orders/" + o.id, { transfer: { reference } });
        await loadOrders({ silent: true });
        notify(
          "Avisamos a administración. Te confirmamos el pago en cuanto lo veamos acreditado.",
        );
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const payOnline = (o) =>
    run(
      async () => {
        const { url } = await post("/orders/" + o.id + "/mp", {});
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  function contact(who, order) {
    const phone =
      who === "driver" ? order?.driverContact?.phone : config?.adminPhone;
    if (!phone) return setModal({ type: "contact" });
    const text = order
      ? `Hola${who === "driver" ? " " + order.driver : ""}, te escribo por el pedido ${order.id} de Pollito Casero.`
      : "Hola, quisiera hacer una consulta sobre un pedido de Pollito Casero.";
    window.open(waLink(phone, text), "_blank", "noopener,noreferrer");
  }

  async function enableNotifications() {
    try {
      await enablePush(config?.pushKey);
      setPushState("granted");
      notify("Avisos activados en este dispositivo.");
      return true;
    } catch (e) {
      setPushState(pushPermission());
      notify(e.message);
      return false;
    }
  }

  const value = {
    config,
    products,
    localities: config?.localities || [],
    session,
    me,
    orders,
    customers,
    loaded,
    error,
    online,
    serverDown,
    live,
    toast,
    modal,
    setModal,
    formError,
    setFormError,
    busy,
    install,
    setInstall,
    plan,
    setPlan,
    cart,
    items,
    totals,
    price,
    profile,
    setProfile,
    notify,
    add,
    setQuantity,
    clearCart,
    repeat,
    checkout,
    requestPhoneCode,
    verifyPhone,
    setPassword,
    createStaffOrder,
    startingOrders,
    editOrder,
    saveBalances,
    saveFicha,
    createCustomer,
    savePrices,
    loadCustomers,
    reload,
    saveDriver,
    refreshConfig,
    deleteOrder,
    saveProfile,
    emailLogin,
    emailRegister,
    googleLogin,
    requestMagicLink,
    consumeMagicLink,
    loginWithPasskey,
    addPasskey,
    removePasskey,
    staffLogin,
    logout,
    update,
    updateCustomer,
    registerPayment,
    returnBoxes,
    reportTransfer,
    payOnline,
    contact,
    activeOrder,
    pushState,
    enableNotifications,
  };
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}
