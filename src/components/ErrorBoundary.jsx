import React from "react";

const chunkError = (e) =>
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
    String(e?.message || e),
  );

/** Nunca una pantalla en blanco: ante un error se recarga (versión nueva) o se ofrece recargar. */
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (chunkError(error)) {
      const last = Number(sessionStorage.getItem("pc-reload") || 0);
      if (Date.now() - last > 30000) {
        sessionStorage.setItem("pc-reload", String(Date.now()));
        location.reload();
      }
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = chunkError(this.state.error);
    return (
      <div className="fatal">
        <img src="/icon.svg" width="56" height="56" alt="" />
        <h1>{stale ? "Hay una versión nueva de la app" : "Algo salió mal"}</h1>
        <p>
          {stale
            ? "Recargá para seguir con la última versión."
            : "Recargá la página; si vuelve a pasar, avisanos por WhatsApp."}
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Recargar
        </button>
        {!stale && (
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
        )}
      </div>
    );
  }
}
