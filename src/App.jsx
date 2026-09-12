import React from "react";
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
  Settings2,
  Download,
  WifiOff,
  CircleCheck,
  MessageCircle,
  Truck,
  Menu as MenuIcon,
  ShieldCheck,
} from "lucide-react";
import { useStore } from "./lib/store.jsx";
import { Link, useRoute, useDocumentMeta } from "./lib/router.jsx";
import { isActive, planNames } from "./lib/format.js";
import { MobileCartBar } from "./components/Cart.jsx";
import Modals from "./components/Modals.jsx";
import Catalog from "./pages/Catalog.jsx";
import Orders from "./pages/Orders.jsx";
import Tracking from "./pages/Tracking.jsx";
import Account from "./pages/Account.jsx";
import Plans from "./pages/Plans.jsx";
import Help from "./pages/Help.jsx";
import Operations from "./pages/Operations.jsx";
import Delivery from "./pages/Delivery.jsx";
import Access from "./pages/Access.jsx";
import Print from "./pages/Print.jsx";

const pages = {
  "/": Catalog,
  "/pedidos": Orders,
  "/seguimiento": Tracking,
  "/cuenta": Account,
  "/planes": Plans,
  "/ayuda": Help,
  "/operacion": Operations,
  "/reparto": Delivery,
  "/acceso": Access,
  "/admin": Access,
  "/imprimir": Print,
};

function navFor(session) {
  const base = [
    ["/", "Hacer un pedido", House],
    ["/pedidos", "Mis pedidos", ShoppingBag],
    ["/seguimiento", "Seguir mi pedido", MapPin],
  ];
  if (session?.role === "admin")
    return [
      ["/operacion", "Operación", Settings2],
      ["/", "Catálogo", House],
      ["/pedidos", "Pedidos", ShoppingBag],
      ["/seguimiento", "Seguimiento", MapPin],
      ["/planes", "Planes", Tag],
    ];
  if (session?.role === "repartidor")
    return [
      ["/reparto", "Mis entregas", Truck],
      ["/seguimiento", "Seguimiento", MapPin],
      ["/", "Catálogo", House],
    ];
  return [
    ...base,
    ["/cuenta", "Mi cuenta", Wallet],
    ["/planes", "Nuestros planes", Tag],
  ];
}
const shortNames = {
  "Hacer un pedido": "Pedir",
  "Seguir mi pedido": "Seguimiento",
  "Mis pedidos": "Pedidos",
  "Mi cuenta": "Cuenta",
  "Nuestros planes": "Planes",
  "Mis entregas": "Entregas",
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

export default function App() {
  const { path } = useRoute();
  const {
    session,
    orders,
    profile,
    me,
    plan,
    config,
    loaded,
    error,
    online,
    serverDown,
    toast,
    setModal,
    install,
    setInstall,
    contact,
  } = useStore();
  useDocumentMeta(path);
  const nav = navFor(session);
  const Page = pages[path];
  const pending = orders.filter(isActive).length;
  const displayName = session?.name || profile.name || "";
  const address = me?.address || profile.address || "";
  const roleLabel =
    session?.role === "admin"
      ? "Administración"
      : session?.role === "repartidor"
        ? "Repartidor"
        : `Cliente ${planNames[plan].toLowerCase()}`;
  const staff = session && session.role !== "cliente";
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
          {nav.map(([url, name, Icon]) => (
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
              {url === "/reparto" && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
              {url === "/operacion" &&
                orders.filter((o) => o.status === "recibido").length > 0 && (
                  <span className="nav-count">
                    {orders.filter((o) => o.status === "recibido").length}
                  </span>
                )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!staff && (
            <div className="sidebar-help">
              <MessageCircle size={23} />
              <h3>¿Te damos una mano?</h3>
              <p>Estamos del otro lado.</p>
              <button onClick={() => contact("admin")}>
                Hablemos <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          <Link to="/ayuda" className="nav-link">
            <CircleHelp size={19} /> Ayuda y contacto
          </Link>
          {!staff && (
            <Link to="/admin" className="nav-link operation-link">
              <ShieldCheck size={17} /> Soy de Pollito Casero
            </Link>
          )}
          <button
            className="profile"
            onClick={() => setModal({ type: session ? "profile" : "login" })}
          >
            <span className="avatar">
              {displayName ? displayName[0].toUpperCase() : "PC"}
            </span>
            <span>
              <strong>{displayName || "Ingresar"}</strong>
              <small>{session ? roleLabel : "Con tu teléfono"}</small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          {staff ? (
            <div className="address-button static">
              <span className="location-icon">
                {session.role === "admin" ? (
                  <Settings2 size={18} />
                ) : (
                  <Truck size={18} />
                )}
              </span>
              <span>
                <small>{roleLabel.toUpperCase()}</small>
                <strong>{session.name}</strong>
              </span>
            </div>
          ) : (
            <button
              className="address-button"
              onClick={() => setModal({ type: session ? "profile" : "login" })}
            >
              <span className="location-icon">
                <MapPin size={18} />
              </span>
              <span>
                <small>ENTREGAR EN</small>
                <strong>{address || "Elegí tu dirección de entrega"}</strong>
              </span>
              <ChevronDown size={15} />
            </button>
          )}
          <div className="topbar-right">
            {config?.demo && <span className="demo-pill">Demo</span>}
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
            <button
              className="top-avatar"
              aria-label={session ? "Mis datos" : "Ingresar"}
              onClick={() => setModal({ type: session ? "profile" : "login" })}
            >
              {displayName ? displayName[0].toUpperCase() : "PC"}
            </button>
          </div>
        </header>
        <main id="contenido" tabIndex="-1">
          {!online && (
            <div className="notice offline">
              <WifiOff size={18} /> Estás sin conexión a internet. Podés
              consultar el catálogo cargado; los pedidos requieren conexión.
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
          {!config && !loaded ? (
            <div className="loading">Preparando el catálogo…</div>
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
            <Link to="/admin">Ingreso Pollito Casero</Link>
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
        {nav.slice(0, 4).map(([url, name, Icon]) => (
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
      {path === "/" && <MobileCartBar />}
      <div
        className={"toast " + (toast ? "visible" : "")}
        role="status"
        aria-live="polite"
      >
        <CircleCheck size={19} />
        {toast}
      </div>
      <Modals />
    </>
  );
}
