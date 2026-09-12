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
  del,
  subscribe,
  stored,
  persist,
  serverDownMessage,
} from "./api.js";
import {
  labels,
  productPrice,
  lineAmount,
  waLink,
  isActive,
} from "./format.js";
import { useRoute } from "./router.jsx";
import { enablePush, disablePush, syncPush, pushPermission } from "./push.js";

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
  const [install, setInstall] = useState(null);
  const [plan, setPlanState] = useState(() => stored("pc-plan", "minorista"));
  const [cart, setCart] = useState(() => stored("pc-cart", {}));
  const [profile, setProfile] = useState(() => stored("pc-profile", {}));
  const [sharing, setSharing] = useState(null);
  const [pushState, setPushState] = useState(() => pushPermission());
  const gps = useRef(null);
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
      if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    };
  }, [loadOrders, loadMe, loadCustomers]);

  // Novedades en tiempo real mientras haya sesión; respaldo por sondeo cada 30 s.
  useEffect(() => {
    if (!session) return;
    const close = subscribe(
      (type) => {
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

  const activeOrder = useCallback(
    (id) =>
      orders.find((o) => o.id === id) || orders.find(isActive) || orders[0],
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
      syncPush().catch(() => {});
      navigate("/seguimiento?pedido=" + order.id);
      notify(
        config?.demo
          ? "Pedido creado. Avanzalo desde Operación para ver el seguimiento."
          : "¡Pedido confirmado!",
      );
      return order;
    });

  const login = (fields, { message } = {}) =>
    run(async () => {
      const s = await post("/session", fields);
      setSession(s);
      sessionRef.current = s;
      setProfile((p) => ({
        ...p,
        name: fields.name,
        phone: fields.phone,
        ...(fields.address
          ? { address: fields.address, localityId: fields.localityId }
          : {}),
      }));
      if (s.plan) setPlanState(s.plan);
      lastStatuses.current = {};
      await Promise.all([loadOrders(), loadMe()]);
      syncPush().catch(() => {});
      setModal(null);
      notify(message || `Hola, ${s.name.split(" ")[0]}.`);
    });

  const staffLogin = (fields) =>
    run(async () => {
      const s = await post("/session/staff", fields);
      setSession(s);
      sessionRef.current = s;
      lastStatuses.current = {};
      await Promise.all([loadOrders(), loadCustomers()]);
      syncPush().catch(() => {});
      setModal(null);
      navigate(s.role === "admin" ? "/operacion" : "/reparto");
      notify(
        s.role === "admin"
          ? "Panel de operación habilitado."
          : `Entregas de ${s.driver}.`,
      );
    });

  const logout = async () => {
    stopSharing();
    await disablePush().catch(() => {});
    await del("/session").catch(() => {});
    setSession(null);
    sessionRef.current = null;
    setOrders([]);
    setMe(null);
    setCustomers([]);
    lastStatuses.current = {};
    setModal(null);
    navigate("/");
    notify("Sesión cerrada en este dispositivo.");
  };

  const update = (o, data) =>
    run(
      async () => {
        await patch("/orders/" + o.id, data);
        await loadOrders({ silent: true });
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

  function contact(who, order) {
    const phone =
      who === "driver" ? order?.driverContact?.phone : config?.adminPhone;
    if (!phone) return setModal({ type: "contact" });
    const text = order
      ? `Hola${who === "driver" ? " " + order.driver : ""}, te escribo por el pedido ${order.id} de Pollito Casero.`
      : "Hola, quisiera hacer una consulta sobre un pedido de Pollito Casero.";
    window.open(waLink(phone, text), "_blank", "noopener,noreferrer");
  }

  function stopSharing() {
    if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    gps.current = null;
    setSharing(null);
  }
  function share(o) {
    if (sharing) return stopSharing();
    if (!navigator.geolocation)
      return notify("Tu dispositivo no admite ubicación.");
    gps.current = navigator.geolocation.watchPosition(
      (pos) =>
        patch("/orders/" + o.id, {
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        })
          .then(() => loadOrders({ silent: true }))
          .catch((e) => {
            notify(e.message);
            stopSharing();
          }),
      () => {
        notify(
          "No pudimos acceder a tu ubicación. Revisá los permisos del navegador.",
        );
        stopSharing();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setSharing(o.id);
    notify("Compartiendo tu ubicación con el cliente.");
  }
  useEffect(() => {
    if (sharing && orders.find((o) => o.id === sharing)?.status !== "en_camino")
      stopSharing();
  }, [orders, sharing]);

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
    sharing,
    notify,
    add,
    setQuantity,
    clearCart,
    repeat,
    checkout,
    login,
    staffLogin,
    logout,
    update,
    updateCustomer,
    registerPayment,
    contact,
    share,
    activeOrder,
    pushState,
    enableNotifications,
    reload: () => Promise.all([loadOrders(), loadMe(), loadCustomers()]),
  };
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}
