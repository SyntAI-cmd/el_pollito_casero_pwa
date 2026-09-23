import React, { useEffect, useState } from "react";
import {
  House,
  ShoppingBag,
  MapPin,
  Wallet,
  Tag,
  CircleHelp,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Bell,
  Download,
  WifiOff,
  CircleCheck,
  MessageCircle,
  Truck,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ClipboardList,
  Plus,
  Users,
  ShieldCheck,
  Scale,
  Package,
  Printer,
  History,
} from "lucide-react";
import { useStore } from "./lib/store.jsx";
import { Link, useRoute, useDocumentMeta } from "./lib/router.jsx";
import { isActive, planNames } from "./lib/format.js";
import { MobileCartBar } from "./components/Cart.jsx";
import Modals from "./components/Modals.jsx";
import Chat from "./components/Chat.jsx";
import PushToggle from "./components/PushToggle.jsx";
import Documents from "./pages/Documents.jsx";
import Movimientos from "./pages/Movimientos.jsx";
import { setArchiveOwner } from "./lib/archive.js";
import Catalog from "./pages/Catalog.jsx";
import Orders from "./pages/Orders.jsx";
import Tracking from "./pages/Tracking.jsx";
import Account from "./pages/Account.jsx";
import Plans from "./pages/Plans.jsx";
import Help from "./pages/Help.jsx";
import Login from "./pages/Login.jsx";
import Operations from "./pages/Operations.jsx";
import Customers from "./pages/Customers.jsx";
import { PageHead } from "./components/ui.jsx";
import { todayKey } from "./lib/day.js";
import {
  useHideOnScroll,
  useKeyboardOpen,
  useVisibleHeight,
} from "./lib/media.js";
import Delivery from "./pages/Delivery.jsx";
import Access from "./pages/Access.jsx";
import Print from "./pages/Print.jsx";
import QuickOrder from "./pages/QuickOrder.jsx";
import Weighing from "./pages/Weighing.jsx";
import TruckLoading from "./pages/TruckLoading.jsx";
import PrintHub from "./pages/PrintHub.jsx";
import DaySheet from "./pages/DaySheet.jsx";
import PriceLists from "./pages/PriceLists.jsx";

/**
 * Tres aplicaciones en una, separadas por rol. El servidor ya filtra los datos;
 * acá además cada rol solo puede ver sus pantallas y nunca ve enlaces a las otras.
 */
const CLIENT_ROUTES = {
  "/": Catalog,
  "/ingresar": Login,
  "/pedidos": Orders,
  "/seguimiento": Tracking,
  "/cuenta": Account,
  "/planes": Plans,
  "/ayuda": Help,
};
const CLIENT_PRIVATE = ["/pedidos", "/seguimiento", "/cuenta"];
const ADMIN_ROUTES = {
  "/operacion/documentos": Documents,
  "/operacion/movimientos": Movimientos,
  "/operacion": Operations,
  "/operacion/clientes": Operations,
  "/operacion/equipo": Operations,
  "/operacion/nuevo": QuickOrder,
  "/operacion/dia": DaySheet,
  "/operacion/precios": PriceLists,
  "/operacion/pesada": Weighing,
  "/operacion/carga": TruckLoading,
  "/operacion/imprimir": PrintHub,
  "/imprimir": Print,
  "/ayuda": Help,
};
/** Clientes para el preventista: la misma ficha, saldos y precios que administración. */
function DriverCustomers() {
  return (
    <>
      <PageHead
        eyebrow="CLIENTES"
        title="Clientes."
        description="Fichas, cuenta corriente, envases y precios propios."
      />
      <Customers />
    </>
  );
}
const DRIVER_ROUTES = {
  "/reparto/documentos": Documents,
  "/reparto": Delivery,
  "/reparto/nuevo": QuickOrder,
  "/reparto/pesada": Weighing,
  "/reparto/carga": TruckLoading,
  "/reparto/clientes": DriverCustomers,
  "/ayuda": Help,
};
const STAFF_LOGIN = { "/admin": Access, "/acceso": Access };
const homeFor = (role) =>
  role === "admin" ? "/operacion" : role === "repartidor" ? "/reparto" : "/";

const clientNav = [
  ["/", "Hacer un pedido", House],
  ["/pedidos", "Mis pedidos", ShoppingBag],
  ["/seguimiento", "Seguir mi pedido", MapPin],
  ["/cuenta", "Mi cuenta", Wallet],
  ["/planes", "Nuestros planes", Tag],
];
const shortNames = {
  "Hacer un pedido": "Pedir",
  "Seguir mi pedido": "Seguimiento",
  "Mis pedidos": "Pedidos",
  "Mi cuenta": "Cuenta",
  "Nuestros planes": "Planes",
};

function NotFound() {
  return (
    <section className="not-found">
      <span className="eyebrow">ESTE PEDIDO TOMÓ OTRO CAMINO</span>
      <div>
        4<img src="/icon.svg" width="100" height="100" alt="0" />4
      </div>
      <h1>Por acá no era.</h1>
      <p>La página que buscás no está, pero el pollo te espera.</p>
      <Link to="/" className="primary">
        Volver al catálogo <ArrowRight size={18} />
      </Link>
    </section>
  );
}

function Notices() {
  const { online, serverDown, error } = useStore();
  return (
    <>
      {!online && (
        <div className="notice offline">
          <WifiOff size={18} /> Estás sin conexión a internet. Podés consultar
          el catálogo cargado; los pedidos requieren conexión.
        </div>
      )}
      {error && (
        <div role="alert" className="notice error">
          <span>
            {serverDown && online && <strong>Servidor apagado · </strong>}
            {error}
          </span>
          <button onClick={() => location.reload()}>Reintentar</button>
        </div>
      )}
    </>
  );
}

function Toast() {
  const { toast } = useStore();
  return (
    <div
      className={"toast " + (toast ? "visible" : "")}
      role="status"
      aria-live="polite"
    >
      <CircleCheck size={19} />
      {toast}
    </div>
  );
}

/** Interfaz del cliente: catálogo, pedidos, seguimiento, cuenta. */
function ClientShell({ Page, path }) {
  const {
    session,
    orders,
    profile,
    me,
    plan,
    config,
    loaded,
    setModal,
    install,
    setInstall,
    contact,
  } = useStore();
  const pending = orders.filter(isActive).length;
  const displayName = session?.name || profile.name || "";
  const address = me?.address || profile.address || "";
  const account = () => setModal({ type: "profile" });
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <img src="/icon.svg" width="48" height="48" alt="" />
          <span>
            pollito<em>casero</em>
          </span>
        </Link>
        <div className="brand-caption">DE NUESTRA CASA A LA TUYA</div>
        <nav aria-label="Navegación principal">
          {clientNav.map(([url, name, Icon]) => (
            <Link
              to={url}
              className={"nav-link " + (path === url ? "active" : "")}
              aria-current={path === url ? "page" : undefined}
              key={url}
            >
              <Icon size={19} />
              <span>{name}</span>
              {url === "/pedidos" && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <MessageCircle size={23} />
            <h3>¿Te damos una mano?</h3>
            <p>Estamos del otro lado.</p>
            <button onClick={() => contact("admin")}>
              Hablemos <ArrowUpRight size={16} />
            </button>
          </div>
          <Link to="/ayuda" className="nav-link">
            <CircleHelp size={19} /> Ayuda y contacto
          </Link>
          {session ? (
            <button className="profile" onClick={account}>
              <span className="avatar">
                {displayName[0]?.toUpperCase() || "PC"}
              </span>
              <span>
                <strong>{displayName}</strong>
                <small>Cliente {planNames[plan].toLowerCase()}</small>
              </span>
              <ChevronDown size={16} />
            </button>
          ) : (
            <Link
              to={"/ingresar?volver=" + encodeURIComponent(path)}
              className="profile"
            >
              <span className="avatar">PC</span>
              <span>
                <strong>Ingresar</strong>
                <small>Celular o email</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          {session ? (
            <button className="address-button" onClick={account}>
              <span className="location-icon">
                <MapPin size={18} />
              </span>
              <span>
                <small>ENTREGAR EN</small>
                <strong>{address || "Elegí tu dirección de entrega"}</strong>
              </span>
              <ChevronDown size={15} />
            </button>
          ) : (
            <Link to="/ingresar" className="address-button">
              <span className="location-icon">
                <MapPin size={18} />
              </span>
              <span>
                <small>ENTREGAR EN</small>
                <strong>San Martín, Mendoza y alrededores</strong>
              </span>
              <ArrowRight size={15} />
            </Link>
          )}
          <div className="topbar-right">
            {config?.demo && <span className="demo-pill">Demo</span>}
            <Link
              to="/admin"
              className="top-staff"
              rel="nofollow"
              title="Ingreso de administración y reparto"
            >
              <ShieldCheck size={16} /> <span>Equipo</span>
            </Link>
            {session && (
              <button
                className="icon-button notification-button"
                aria-label="Ver novedades de pedidos"
                onClick={() => setModal({ type: "notifications" })}
              >
                <Bell size={20} />
                {pending > 0 && <i />}
              </button>
            )}
            <button
              className="mobile-menu icon-button"
              aria-label="Abrir menú"
              onClick={() => setModal({ type: "menu" })}
            >
              <MenuIcon size={20} />
            </button>
            {session ? (
              <button
                className="top-avatar"
                aria-label="Mis datos"
                onClick={account}
              >
                {displayName[0]?.toUpperCase() || "PC"}
              </button>
            ) : (
              <Link to="/ingresar" className="top-login">
                Ingresar
              </Link>
            )}
          </div>
        </header>
        <main id="contenido" tabIndex="-1">
          <Notices />
          {!config && !loaded ? (
            <div
              className="skeleton"
              aria-busy="true"
              aria-label="Cargando el catálogo"
            >
              <div className="skeleton-hero" />
              <div className="skeleton-grid">
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
            </div>
          ) : Page ? (
            <Page />
          ) : (
            <NotFound />
          )}
        </main>
        <footer>
          <span>
            pollito casero <span>·</span>{" "}
            {config?.origin?.address || "San Martín, Mendoza"}
          </span>
          <div>
            <Link to="/ayuda">Ayuda</Link>
            <Link to="/planes">Planes</Link>
            <Link to="/admin" className="footer-staff" rel="nofollow">
              Equipo
            </Link>
            <button
              onClick={async () => {
                if (install) {
                  await install.prompt();
                  setInstall(null);
                } else setModal({ type: "install" });
              }}
            >
              <Download size={13} /> Instalar app
            </button>
          </div>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {clientNav.slice(0, 4).map(([url, name, Icon]) => (
          <Link
            key={url}
            to={url}
            className={path === url ? "active" : ""}
            aria-current={path === url ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{shortNames[name] || name}</span>
          </Link>
        ))}
      </nav>
      {Page === Catalog && <MobileCartBar />}
    </>
  );
}

/**
 * Barra inferior del celular: cuatro accesos frecuentes con icono y palabra, más "Más".
 * Todos los casilleros miden igual (ninguno recorta su etiqueta) y la barra se aparta sola
 * al bajar por la pantalla o cuando se abre el teclado.
 */
function TabBar({ nav, path, badge, onMore, oculta }) {
  const main = nav.slice(0, 4);
  return (
    <nav
      className={"tabbar glass" + (oculta ? " oculta" : "")}
      aria-label="Secciones"
    >
      {main.map(([url, name, Icon, corto]) => (
        <Link
          key={url}
          to={url}
          className={path === url ? "active" : ""}
          aria-current={path === url ? "page" : undefined}
        >
          <Icon size={20} />
          <span>{corto || name}</span>
          {url === "/operacion" && badge > 0 && (
            <b className="tab-count">{badge}</b>
          )}
        </Link>
      ))}
      <button type="button" onClick={onMore} aria-haspopup="dialog">
        <MenuIcon size={20} />
        <span>Más</span>
      </button>
    </nav>
  );
}

/**
 * Secciones del equipo, agrupadas por función y filtradas por rol.
 * Cada entrada es [url, nombre, icono, nombre corto para la barra del celular].
 */
function seccionesDe(role) {
  if (role === "admin")
    return [
      [
        "Operación del día",
        [
          ["/operacion", "Pedidos", ClipboardList, "Pedidos"],
          ["/operacion/nuevo", "Cargar pedido", Plus, "Nuevo"],
          ["/operacion/pesada", "Pesaje", Scale, "Pesaje"],
          ["/operacion/clientes", "Clientes", Users, "Clientes"],
        ],
      ],
      [
        "Gestión",
        [
          ["/operacion/imprimir", "Imprimir", Printer, "Imprimir"],
          ["/operacion/documentos", "Documentos", ClipboardList, "Documentos"],
          ["/operacion/movimientos", "Movimientos", History, "Movimientos"],
          ["/operacion/equipo", "Equipo", ShieldCheck, "Equipo"],
        ],
      ],
    ];
  return [
    [
      "Mi día",
      [
        ["/reparto", "Mis entregas", Truck, "Entregas"],
        ["/reparto/nuevo", "Cargar pedido", Plus, "Nuevo"],
        ["/reparto/pesada", "Pesaje", Scale, "Pesaje"],
        ["/reparto/clientes", "Clientes", Users, "Clientes"],
        ["/reparto/documentos", "Documentos", ClipboardList, "Documentos"],
      ],
    ],
  ];
}

/** Panel lateral de escritorio: secciones agrupadas, plegable, con perfil y salida aparte. */
function SideRail({ grupos, path, badge, plegado, onPlegar, session, logout }) {
  return (
    <aside className="side-rail" aria-label="Navegación del equipo">
      <Link to={path} className="rail-brand">
        <img src="/icon.svg" width="30" height="30" alt="" />
        <span>
          <strong>Pollito Casero</strong>
          <small>
            {session.role === "admin" ? "Administración" : "Reparto"}
          </small>
        </span>
      </Link>
      <button
        type="button"
        className="rail-toggle"
        onClick={onPlegar}
        aria-expanded={!plegado}
        title={plegado ? "Mostrar los nombres" : "Dejar solo los iconos"}
      >
        {plegado ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span>{plegado ? "" : "Plegar menú"}</span>
      </button>
      {grupos.map(([titulo, items]) => (
        <nav className="rail-group" key={titulo} aria-label={titulo}>
          <h3>{titulo}</h3>
          {items.map(([url, name, Icon]) => (
            <Link
              key={url}
              to={url}
              title={name}
              className={path === url ? "active" : ""}
              aria-current={path === url ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{name}</span>
              {url === "/operacion" && badge > 0 && (
                <b className="nav-count" title="Pedidos abiertos">
                  {badge}
                </b>
              )}
            </Link>
          ))}
        </nav>
      ))}
      <div className="rail-foot">
        <span className="rail-user" title={session.name}>
          <i className="avatar" aria-hidden="true">
            {session.name[0]}
          </i>
          <span>{session.name}</span>
        </span>
        <Link to="/ayuda" title="Ayuda">
          <CircleHelp size={17} />
          <span>Ayuda</span>
        </Link>
        <button type="button" onClick={logout} title="Salir">
          <LogOut size={17} />
          <span>Salir</span>
        </button>
      </div>
    </aside>
  );
}

/** Interfaz del equipo: panel lateral en escritorio, barra inferior en el celular. */
function StaffShell({ Page, path }) {
  const { session, orders, logout, config, notify } = useStore();
  useEffect(() => {
    setArchiveOwner(session);
    return () => setArchiveOwner(null);
  }, [session]);
  useEffect(() => {
    const on = (e) => notify(e.detail);
    window.addEventListener("archive-status", on);
    return () => window.removeEventListener("archive-status", on);
  }, [notify]);
  const [more, setMore] = useState(false);
  const [plegado, setPlegado] = useState(
    () => localStorage.getItem("menu-plegado") === "1",
  );
  const oculta = useHideOnScroll();
  useKeyboardOpen();
  const admin = session.role === "admin";
  const grupos = seccionesDe(session.role);
  const nav = grupos.flatMap(([, items]) => items);
  const seccion = nav.find(([url]) => url === path)?.[1] || "Pollito Casero";
  // Globo de Pedidos: abiertos de HOY (lo mismo que se ve al entrar, que arranca filtrado en hoy).
  const hoy = todayKey();
  const received = orders.filter(
    (o) =>
      ["recibido", "preparando", "en_camino"].includes(o.status) &&
      (o.deliveryDate || (o.created || "").slice(0, 10)) === hoy,
  ).length;
  const plegar = () => {
    setPlegado((v) => {
      localStorage.setItem("menu-plegado", v ? "0" : "1");
      return !v;
    });
  };
  return (
    <div className={"staff-app railed" + (plegado ? " plegado" : "")}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <SideRail
        grupos={grupos}
        path={path}
        badge={received}
        plegado={plegado}
        onPlegar={plegar}
        session={session}
        logout={logout}
      />
      <div className="rail-main">
        <header className="app-head glass">
          <h1>{seccion}</h1>
          <div className="app-head-right">
            {config?.demo && <span className="demo-pill">Demo</span>}
          </div>
        </header>
        {/* Barra superior del celular: solo marca y usuario; la navegación va abajo. */}
        <header className="staff-bar">
          <Link to={homeFor(session.role)} className="staff-brand">
            <img src="/icon.svg" width="34" height="34" alt="" />
            <img
              className="staff-wordmark"
              src="/brand/logo-texto.png"
              width="1200"
              height="362"
              alt="El Pollito Casero"
            />
            <span>
              <strong className="sr-only">Pollito Casero</strong>
              <small>{admin ? "Administración" : "Reparto"}</small>
            </span>
          </Link>
          <div className="staff-bar-right">
            {config?.demo && <span className="demo-pill">Demo</span>}

            <span className="staff-user">
              <span className="avatar">{session.name[0]}</span>
              <span>{session.name}</span>
            </span>
          </div>
        </header>
        <main id="contenido" tabIndex="-1" className="staff-main">
          <Notices />
          {Page ? <Page /> : <NotFound />}
        </main>
      </div>
      <TabBar
        nav={nav}
        path={path}
        badge={received}
        oculta={oculta}
        onMore={() => setMore(true)}
      />
      {more && (
        <div
          className="more-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Más secciones"
          onClick={(e) => e.target === e.currentTarget && setMore(false)}
        >
          <div className="more-sheet-box">
            <h2>Más</h2>
            {nav.slice(4).map(([url, name, Icon]) => (
              <Link key={url} to={url} onClick={() => setMore(false)}>
                <Icon size={18} /> {name}
              </Link>
            ))}
            <Link to="/ayuda" onClick={() => setMore(false)}>
              <CircleHelp size={18} /> Ayuda
            </Link>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setMore(false);
                logout();
              }}
            >
              <LogOut size={18} /> Salir
            </button>
          </div>
        </div>
      )}
      <Chat />
    </div>
  );
}

export default function App() {
  const { path, navigate } = useRoute();
  const { session, loaded, config } = useStore();
  useDocumentMeta(path);
  // Alto realmente visible con el teclado abierto: lo usan las ventanas para no dejar
  // los botones de guardar debajo del teclado.
  useVisibleHeight();
  // Modo equipo: el portal de clientes queda apagado; todo el mundo entra por /admin.
  const teamOnly = config?.mode === "equipo";
  const role =
    teamOnly && session?.role === "cliente" ? "anon" : session?.role || "anon";
  const staff = role === "admin" || role === "repartidor";

  // Redirecciones por rol: nadie llega a una pantalla que no le corresponde.
  useEffect(() => {
    if (!loaded) return;
    const inClient = path in CLIENT_ROUTES;
    const inAdmin = path in ADMIN_ROUTES;
    const inDriver = path in DRIVER_ROUTES;
    const inLogin = path in STAFF_LOGIN;
    if (teamOnly && !staff && !inLogin) {
      navigate("/admin", { replace: true });
      return;
    }
    if (role === "admin" && !inAdmin && !inLogin)
      navigate(homeFor("admin"), { replace: true });
    else if (role === "repartidor" && !inDriver && !inLogin)
      navigate("/reparto", { replace: true });
    else if (role === "cliente" && (inAdmin || inDriver) && !inClient)
      navigate("/", { replace: true });
    else if (role === "anon" && (inAdmin || inDriver) && !inClient)
      navigate("/admin", { replace: true });
    else if (role === "anon" && CLIENT_PRIVATE.includes(path))
      navigate(
        "/ingresar?volver=" + encodeURIComponent(path + location.search),
        { replace: true },
      );
  }, [path, role, loaded, teamOnly]);

  if (!loaded && !session) return <div className="loading">Preparando…</div>;
  const chrome = (
    <>
      <Toast />
      <Modals />
    </>
  );
  if (path in STAFF_LOGIN)
    return (
      <>
        <Access />
        {chrome}
      </>
    );
  if (teamOnly && !staff)
    return (
      <>
        <Access />
        {chrome}
      </>
    );
  if (path === "/ingresar" && !staff)
    return (
      <>
        <Login />
        {chrome}
      </>
    );
  if (staff)
    return (
      <>
        <StaffShell
          Page={(role === "admin" ? ADMIN_ROUTES : DRIVER_ROUTES)[path]}
          path={path}
        />
        {chrome}
      </>
    );
  return (
    <>
      <ClientShell Page={CLIENT_ROUTES[path]} path={path} />
      {chrome}
    </>
  );
}
