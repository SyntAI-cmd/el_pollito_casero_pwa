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
  stored,
  persist,
  serverDownMessage,
  onAuthError,
} from "./api.js";
import {
  labels,
  productPrice,
  lineAmount,
  waLink,
  isActive,
  orderNumber,
} from "./format.js";
import { useRoute } from "./router.jsx";
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
  const [chat, setChat] = useState({ thread: null, messages: [], unread: {} });
  const chatThread = useRef(null);
  const chatOpen = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [serverDown, setServerDown] = useState(false);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState(null);
  const [plan, setPlanState] = useState(() => stored("pc-plan", "minorista"));
  const [cart, setCart] = useState(() => stored("pc-cart", {}));
  const [profile, setProfile] = useState(() => stored("pc-profile", {}));
  const [pushState, setPushState] = useState(() => pushPermission());
  const orderKey = useRef(crypto.randomUUID());
  const lastStatuses = useRef({});
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const notify = useCallback((text) => setToast(text), []);

  const loadOrders = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const list = await api("/orders");
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
        setOrders(list);
        setServerDown(false);
        setError("");
        return list;
      } catch (e) {
        if (e.status === 401) return setOrders([]);
        if (e.network) {
          setServerDown(true);
          if (!silent) setError(serverDownMessage);
        } else if (!silent) setError(e.message);
      }
    },
    [notify],
  );

  const loadMe = useCallback(async () => {
    if (sessionRef.current?.role === "cliente")
      setMe(await api("/me").catch(() => null));
    else setMe(null);
  }, []);
  const loadCustomers = useCallback(async () => {
    if (
      sessionRef.current?.role === "admin" ||
      sessionRef.current?.role === "repartidor"
    )
      setCustomers(await api("/customers").catch(() => []));
    else setCustomers([]);
  }, []);
  /** Vuelve a traer pedidos y clientes del servidor (al entrar a una vista, para no mostrar datos viejos). */
  const reload = useCallback(
    () =>
      Promise.all([
        loadOrders({ silent: true }),
        loadMe(),
        loadCustomers(),
      ]).catch(() => {}),
    [loadOrders, loadMe, loadCustomers],
  );

  // Carga inicial: configuración, sesión y pedidos.
  useEffect(() => {
    api("/config")
      .then(async (c) => {
        const { session: s, ...rest } = c;
        setConfig(rest);
        persist("pc-config-v3", rest);
        setSession(s);
        sessionRef.current = s;
        if (s?.plan) setPlanState(s.plan);
        await Promise.all([loadOrders(), loadMe(), loadCustomers()]);
        loadChat().catch(() => {});
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
  }, [loadOrders, loadMe, loadCustomers]);

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
        setSession(null);
        sessionRef.current = null;
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

  // Novedades en tiempo real mientras haya sesión; respaldo por sondeo cada 30 s.
  useEffect(() => {
    if (!session) return;
    const close = subscribe(
      (type, data) => {
        if (type === "message") {
          loadChat(data.thread).catch(() => {});
          announceMessage(data);
          return;
        }
        if (type === "orders")
          loadOrders({ silent: true }).then(() =>
            Promise.all([loadMe(), loadCustomers()]),
          );
        if (type === "customer") {
          loadMe();
          loadCustomers();
        }
      },
      (state) => setLive(state),
    );
    const timer = setInterval(() => loadOrders({ silent: true }), 30000);
    return () => {
      close();
      clearInterval(timer);
      setLive(false);
    };
  }, [session, loadOrders, loadMe, loadCustomers]);

  useEffect(() => persist("pc-cart", cart), [cart]);
  useEffect(() => persist("pc-plan", plan), [plan]);
  useEffect(() => persist("pc-profile", profile), [profile]);
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
      // El equipo no hereda carrito ni datos del cliente anterior en este dispositivo.
      setCart({});
      setProfile({});
      await Promise.all([loadOrders(), loadCustomers()]);
      loadChat().catch(() => {});
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
    setSession(null);
    sessionRef.current = null;
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
        await loadCustomers();
        if (!keepOpen) setModal(null);
        notify(keepOpen ? "Lista guardada." : "Ficha guardada.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const createCustomer = (fields) =>
    run(async () => {
      const c = await post("/customers", fields);
      await loadCustomers();
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
        await loadCustomers();
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
        await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
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
      await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
      notify(`Pedido ${order.id} cargado para ${order.name}.`);
      return order;
    });

  const update = (o, data) =>
    run(
      async () => {
        await patch("/orders/" + o.id, data);
        await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  /** Edición del pedido cargado: renglones, precios, observaciones y datos del reparto. */
  const editOrder = (o, data) =>
    run(
      async () => {
        await put("/orders/" + o.id + "/editar", data);
        await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
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
        await Promise.all([loadCustomers(), loadOrders({ silent: true })]);
        notify(`Saldos de ${c.name} actualizados.`);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  const updateCustomer = (c, data) =>
    run(
      async () => {
        await patch("/customers/" + c.phone, data);
        await loadCustomers();
        notify("Cliente actualizado.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  const registerPayment = (customer, data) =>
    run(
      async () => {
        await post("/customers/" + customer.phone + "/payments", data);
        await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
        notify("Pago registrado.");
        return true;
      },
      { onError: (e) => notify(e.message) },
    );

  /** Chat interno administración ↔ repartidor. */
  async function loadChat(thread, { read = chatOpen.current } = {}) {
    const role = sessionRef.current?.role;
    if (role !== "admin" && role !== "repartidor") return;
    const target = role === "admin" ? thread || chatThread.current : null;
    if (role === "admin" && !target) {
      const r = await api("/messages");
      setChat((c) => ({ ...c, unread: r.unread || {} }));
      return;
    }
    // Solo se marca como leída la conversación abierta.
    if (
      role === "admin" &&
      thread &&
      chatThread.current &&
      thread !== chatThread.current
    ) {
      const r = await api("/messages");
      setChat((c) => ({ ...c, unread: r.unread || {} }));
      return;
    }
    const params = new URLSearchParams();
    if (target) params.set("thread", target);
    if (read) params.set("read", "1");
    const r = await api("/messages" + (params.size ? "?" + params : ""));
    chatThread.current = r.thread;
    setChat({ thread: r.thread, messages: r.messages, unread: r.unread || {} });
  }
  const openChat = (thread) => {
    chatThread.current = thread || chatThread.current;
    chatOpen.current = true;
    return loadChat(thread, { read: true }).catch((e) => notify(e.message));
  };
  const closeChat = () => {
    chatOpen.current = false;
  };
  const sendMessage = (text, thread) =>
    run(
      async () => {
        await post("/messages", { text, thread: thread || chatThread.current });
        await loadChat(thread || chatThread.current);
        return true;
      },
      { onError: (e) => notify(e.message) },
    );
  const unreadTotal = Object.values(chat.unread || {}).reduce(
    (s, n) => s + n,
    0,
  );
  /** Mensaje nuevo del chat: cartel en la app, sonido y aviso del sistema si la pestaña está atrás. */
  function announceMessage(data) {
    const role = sessionRef.current?.role;
    if (!role || role === "cliente") return;
    if (
      chatOpen.current &&
      (role === "repartidor" || chatThread.current === data.thread)
    )
      return;
    const who =
      role === "admin"
        ? (data.thread || "").slice(11) || "reparto"
        : "administración";
    notify(`Mensaje nuevo de ${who}: tocá el chat para leerlo.`);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.18);
    } catch {}
    if (
      document.hidden &&
      "Notification" in window &&
      Notification.permission === "granted"
    )
      try {
        new Notification(`Pollito Casero · mensaje de ${who}`, {
          body: "Abrí el chat interno.",
          tag: "chat",
        });
      } catch {}
  }

  const returnBoxes = (customer, boxes) =>
    run(
      async () => {
        await post("/customers/" + customer.phone + "/boxes", { boxes });
        await Promise.all([loadOrders({ silent: true }), loadCustomers()]);
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
    chat,
    unreadTotal,
    openChat,
    closeChat,
    loadChat,
    sendMessage,
    contact,
    activeOrder,
    pushState,
    enableNotifications,
  };
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}
