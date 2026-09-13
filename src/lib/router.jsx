import React, { createContext, useContext, useEffect, useState } from "react";

const RouteContext = createContext(null);
const read = () => ({
  path: location.pathname,
  query: new URLSearchParams(location.search),
});

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const pop = () => setRoute(read());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (to, { replace = false, scroll = true } = {}) => {
    const url = new URL(to, location.origin);
    if (
      url.pathname + url.search === location.pathname + location.search &&
      !url.hash
    )
      return;
    history[replace ? "replaceState" : "pushState"](
      {},
      "",
      url.pathname + url.search + url.hash,
    );
    setRoute(read());
    if (url.hash) {
      // El destino puede renderizarse recién en el próximo cuadro.
      requestAnimationFrame(() =>
        document.getElementById(url.hash.slice(1))?.scrollIntoView(),
      );
    } else if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
  };
  return (
    <RouteContext.Provider value={{ ...route, navigate }}>
      {children}
    </RouteContext.Provider>
  );
}

export const useRoute = () => useContext(RouteContext);

export function Link({ to, children, onClick, ...props }) {
  const { navigate } = useRoute();
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.button !== 0
        )
          return;
        e.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

const meta = {
  "/": [
    "Hacer un pedido",
    "Pedí pollo entero o por corte, por kilo, para tu casa o negocio. Elegí tu modalidad y seguí la preparación de tu pedido.",
  ],
  "/planes": [
    "Nuestros planes",
    "Compará precios por kilo y condiciones para clientes mayoristas y minoristas.",
  ],
  "/pedidos": ["Mis pedidos", "Consultá el historial y estado de tus pedidos."],
  "/seguimiento": [
    "Seguir mi pedido",
    "Seguí la preparación y entrega de tu pedido.",
  ],
  "/cuenta": ["Mi cuenta", "Consultá tu saldo mayorista y envases pendientes."],
  "/ayuda": [
    "Ayuda y contacto",
    "Respuestas sobre pedidos, pagos, envases y reparto.",
  ],
  "/operacion": ["Operación", "Gestión de pedidos, repartidores y clientes."],
  "/reparto": ["Mis entregas", "Entregas asignadas, GPS y cobros."],
  "/ingresar": [
    "Ingresar",
    "Ingresá con tu WhatsApp para ver y seguir tus pedidos.",
  ],
  "/operacion/nuevo": ["Cargar pedido", "Pedido telefónico."],
  "/operacion/reparto": ["Reparto y rendición", "Panel interno."],
  "/operacion/clientes": ["Clientes", "Panel interno."],
  "/operacion/equipo": ["Equipo", "Panel interno."],
  "/admin": [
    "Ingreso Pollito Casero",
    "Ingreso de administración de Pollito Casero.",
  ],
  "/imprimir": [
    "Hoja de pedidos y ruta",
    "Impresión de la hoja de pedidos y la hoja de ruta por repartidor.",
  ],
  "/acceso": [
    "Acceso del equipo",
    "Ingreso para administración y repartidores.",
  ],
};
const indexable = ["/", "/planes", "/ayuda"];

/** Mantiene título, descripción, canonical y robots sincronizados con la ruta en el cliente. */
export function useDocumentMeta(path) {
  useEffect(() => {
    const [title, description] = meta[path] || [
      "Página no encontrada",
      "La página que buscás no existe.",
    ];
    document.title = `${title} | Pollito Casero`;
    const set = (selector, attr, value) => {
      const el = document.querySelector(selector);
      if (el) el[attr] = value;
    };
    const canonical = location.origin + (meta[path] ? path : "/");
    set('link[rel="canonical"]', "href", canonical);
    set('meta[property="og:url"]', "content", canonical);
    set('meta[property="og:title"]', "content", document.title);
    set('meta[name="description"]', "content", description);
    set('meta[property="og:description"]', "content", description);
    set(
      'meta[name="robots"]',
      "content",
      indexable.includes(path) ? "index,follow" : "noindex,nofollow",
    );
  }, [path]);
}
