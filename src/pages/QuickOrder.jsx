import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  UserPlus,
  Check,
  ArrowRight,
  Truck,
  Wallet,
  RotateCcw,
  Package,
  CalendarDays,
  Pencil,
  Users,
  MapPin,
  Plus,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { vehicleLabel } from "../components/Vehicles.jsx";
import { api } from "../lib/api.js";
import { Link } from "../lib/router.jsx";
import { useFieldVisibility } from "../lib/media.js";
import {
  money,
  kgText,
  planNames,
  productPrice,
  normalize,
  paymentNames,
} from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";
import { shiftNames } from "./Customers.jsx";
import { businessDate as todayKey } from "../lib/businessDate.js";
import {
  DOC_MODES,
  docModeOf,
  docModeFlags,
  docModeTag,
} from "../lib/docMode.js";

/**
 * Carga de pedidos para el reparto (administración y preventistas): se elige el cliente de la
 * lista (con su zona, turno, camión y precios propios), se indican cajas y/o kilos por producto,
 * fecha y turno de reparto, y listo. Los kilos definitivos los pone la balanza.
 */
export default function QuickOrder() {
  const ensureFieldVisible = useFieldVisibility();
  const {
    config,
    customers,
    createStaffOrder,
    createProduct,
    notify,
    busy,
    formError,
    setModal,
    session,
    orders,
  } = useStore();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [lines, setLines] = useState({}); // productId → { boxes, units, kg }
  const [priceEdits, setPriceEdits] = useState({}); // productId → "5500" (solo administración)
  const [editingPrice, setEditingPrice] = useState(null);
  const [deliveryDate, setDeliveryDate] = useState(todayKey);
  const [shift, setShift] = useState("");
  const [driver, setDriver] = useState("");
  const [driver2, setDriver2] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [zone, setZone] = useState("");
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    api("/vehicles")
      .then((v) => setVehicles(v.filter((x) => x.active)))
      .catch(() => {});
  }, []);
  const zones = useMemo(
    () => [...new Set(customers.map((c) => c.zone).filter(Boolean))].sort(),
    [customers],
  );
  const [payment, setPayment] = useState("");
  const [notes, setNotes] = useState("");
  // Cómo sale el remito: con precio y saldo, con precio sin saldo, o sin precio ni saldo
  // (viene de la ficha; se puede cambiar por pedido).
  const [docMode, setDocMode] = useState("completo");
  const noPricing = docMode === "exclusivo";
  // Si el modo elegido no es el de la ficha, se guarda en la ficha junto con el pedido.
  const [saveDocMode, setSaveDocMode] = useState(true);
  const [otherLabel, setOtherLabel] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  /**
   * "Otro" con nombre → producto nuevo del catálogo, en el momento y para todos. Lo que ya se
   * había cargado en el renglón "Otro" (cajas, kilos, precio) pasa al renglón del producto.
   */
  async function addOtherProduct() {
    const name = otherLabel.trim();
    if (name.length < 2 || addingProduct) return;
    setAddingProduct(true);
    try {
      const p = await createProduct(name);
      const move = (m) => {
        if (m.otro === undefined) return m;
        const { otro, ...rest } = m;
        return { ...rest, [p.id]: rest[p.id] ?? otro };
      };
      setLines(move);
      setPriceEdits(move);
      setOtherLabel("");
      notify(`${p.name} ya está en los productos.`);
    } catch (e) {
      notify(e.message);
    } finally {
      setAddingProduct(false);
    }
  }
  const [created, setCreated] = useState(null);
  // Antes de cargar se confirma cómo va el pedido: con precio y saldo, o sin precio ni saldo
  // (cliente exclusivo: familiares, facturación propia). La ficha sugiere la opción.
  const [confirming, setConfirming] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewLock = useRef(false);
  const confirmRef = useRef(null);
  useEffect(() => {
    if (!confirming) return;
    const origin = document.activeElement;
    confirmRef.current?.showModal();
    return () => {
      confirmRef.current?.close();
      origin?.focus?.();
    };
  }, [confirming]);
  const searchRef = useRef();
  const products = config?.products || [];
  const drivers = config?.drivers || [];
  const isAdmin = session?.role === "admin";

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return customers
      .filter(
        (c) =>
          (c.status || "ok") !== "inactivo" &&
          normalize(
            `${c.name} ${c.alias || ""} ${c.legalName || ""} ${c.zone || ""} ${c.cuit || ""} ${(c.contactPhone || "").replace(/^549/, "")}`,
          ).includes(q),
      )
      .slice(0, 8);
  }, [query, customers]);

  function pick(c) {
    setPriceEdits({});
    setEditingPrice(null);
    setReviewError("");
    setPicked(c);
    setQuery("");
    setShift(c.shift || "");
    setDriver(drivers.includes(c.truck || c.driver) ? c.truck || c.driver : "");
    setDriver2("");
    setZone(c.zone || "");
    setPayment(c.credit ? "cuenta" : "entrega");
    setDocMode(docModeOf(c));
    setSaveDocMode(true);
    setTimeout(() => document.querySelector(".qo-box input")?.focus(), 0);
  }
  function reset() {
    setPriceEdits({});
    setEditingPrice(null);
    setDeliveryDate(todayKey());
    setReviewError("");
    setPicked(null);
    setLines({});
    setNotes("");
    setDocMode("completo");
    setOtherLabel("");
    setCreated(null);
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }
  const repeatLast = () => {
    if (!picked) return;
    const last = orders
      .filter((o) => o.customer === picked.phone && o.status !== "cancelado")
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    if (!last) return;
    setLines(
      Object.fromEntries(
        last.items.map((i) => [
          i.id,
          {
            boxes: i.boxes ? String(i.boxes) : "",
            units: i.units ? String(i.units) : "",
            kg: i.boxes || i.units ? "" : String(i.ordered ?? i.kg),
          },
        ]),
      ),
    );
  };

  const parse = (v) =>
    Number(
      String(v ?? "")
        .trim()
        .replace(",", "."),
    );
  const priceOf = (p) => {
    const edited = priceEdits[p.id];
    if (edited !== undefined && String(edited).trim() !== "") {
      const v = Number(String(edited).replace(",", "."));
      return Number.isFinite(v) ? v : NaN;
    }
    const own = picked?.prices?.[p.id];
    // El precio propio del cliente; si no tiene, el de su lista (Mayorista, Preferencial…, y el
    // trozado por mayor o por menor). Siempre se puede corregir en la fila; sin ninguno, se tipea.
    if (Number.isFinite(Number(own)) && own !== null && own !== "")
      return Number(own);
    const lista = picked?.lista?.precios?.[p.id];
    return Number.isFinite(Number(lista)) && lista > 0 ? Number(lista) : NaN;
  };
  const rows = products.map((p) => {
    const l = lines[p.id] || {};
    const boxes = String(l.boxes ?? "").trim() === "" ? null : parse(l.boxes);
    const units = String(l.units ?? "").trim() === "" ? null : parse(l.units);
    const kg = String(l.kg ?? "").trim() === "" ? null : parse(l.kg);
    const boxesBad =
      boxes !== null && (!Number.isInteger(boxes) || boxes < 0 || boxes > 500);
    const unitsBad =
      units !== null && (!Number.isInteger(units) || units < 0 || units > 5000);
    const kgBad = kg !== null && (!Number.isFinite(kg) || kg <= 0 || kg > 5000);
    const active =
      (boxes !== null && boxes > 0) ||
      (units !== null && units > 0) ||
      (kg !== null && kg > 0);
    return {
      p,
      boxes,
      units,
      kg,
      bad: boxesBad || unitsBad || kgBad,
      active,
      price: priceOf(p),
    };
  });
  const items = rows.filter((r) => r.active && !r.bad);
  const invalid = rows.filter((r) => r.bad);
  const totalBoxes = items.reduce((s, r) => s + (r.boxes || 0), 0);
  const totalUnits = items.reduce((s, r) => s + (r.units || 0), 0);
  const totalKg = items.reduce((s, r) => s + (r.kg || 0), 0);
  // Sin importe estimado: nada vale hasta pasar por la balanza.
  // Renglones sin precio propio: bloquean "con precio y saldo", no "sin precio ni saldo".
  const missingPrice = items.filter(
    (r) => !Number.isFinite(r.price) || r.price <= 0,
  );
  const noPrice = noPricing ? [] : missingPrice;
  const otroSinNombre = items.some(
    (r) => r.p.id === "otro" && otherLabel.trim().length < 2,
  );
  const canSubmit =
    picked && items.length > 0 && !invalid.length && !otroSinNombre && !busy;

  async function refreshCustomer() {
    const list = await api("/customers");
    const fresh = list.find((c) => c.phone === picked.phone);
    if (!fresh || fresh.status === "inactivo")
      throw Error("El cliente ya no está disponible. Revisá su ficha.");
    if (
      !Number.isFinite(fresh.summary?.balance) ||
      !Number.isFinite(fresh.summary?.boxes)
    )
      throw Error(
        "No se pudieron verificar los saldos del cliente. Volvé a intentar antes de cargar.",
      );
    return fresh;
  }
  const reviewSignature = (c) =>
    JSON.stringify([
      c.summary?.balance,
      c.summary?.boxes,
      c.prices,
      c.lista?.precios,
      c.credit,
      c.noPricing,
      c.noBalance,
    ]);
  async function submit(e) {
    e?.preventDefault();
    if (!canSubmit || reviewLock.current) return;
    reviewLock.current = true;
    setConfirming(true);
    setReviewLoading(true);
    setReviewError("");
    try {
      setPicked(await refreshCustomer());
    } catch (error) {
      setReviewError(error.message);
    } finally {
      setReviewLoading(false);
      reviewLock.current = false;
    }
  }
  async function confirmAndSubmit(mode) {
    if (
      reviewLock.current ||
      reviewError ||
      !picked ||
      !items.length ||
      invalid.length ||
      otroSinNombre
    )
      return;
    if (mode !== "exclusivo" && missingPrice.length) return;
    reviewLock.current = true;
    setReviewLoading(true);
    try {
      const fresh = await refreshCustomer();
      if (reviewSignature(fresh) !== reviewSignature(picked)) {
        setPicked(fresh);
        // Una actualización de precios mientras se armaba el pedido: se avisa, no se cambia en silencio.
        setReviewError(
          JSON.stringify([fresh.prices, fresh.lista?.precios]) !==
            JSON.stringify([picked.prices, picked.lista?.precios])
            ? "Cambiaron los precios de este cliente (por ejemplo, una actualización de precios). Volvé a editar y revisá el resumen con los precios nuevos antes de confirmar."
            : "Cambió el saldo o la ficha del cliente. Volvé a editar y revisá el resumen actualizado antes de confirmar.",
        );
        return;
      }
      setDocMode(mode);
      const { noPricing, noBalance } = docModeFlags(mode);
      // Siempre se manda el precio de cada renglón activo (propio o tipeado): el servidor no usa listas.
      const editedPrices = noPricing
        ? {}
        : Object.fromEntries(
            items
              .map((r) => [r.p.id, r.price])
              .filter(([, v]) => Number.isFinite(v) && v > 0),
          );
      const order = await createStaffOrder({
        customer: picked.phone,
        expectedSummary: {
          balance: picked.summary.balance,
          boxes: picked.summary.boxes,
        },
        prices: editedPrices,
        noPricing,
        noBalance,
        saveDocMode: saveDocMode && mode !== docModeOf(picked),
        items: items.map((r) => ({
          id: r.p.id,
          ...(r.boxes !== null ? { boxes: r.boxes } : {}),
          ...(r.units ? { units: r.units } : {}),
          ...(r.kg !== null ? { kg: r.kg } : {}),
          ...(r.p.id === "otro" ? { label: otherLabel.trim() } : {}),
        })),
        deliveryDate,
        shift: shift || undefined,
        driver: driver || undefined,
        driver2: driver2 || undefined,
        vehicleId: vehicleId || undefined,
        zone: zone || undefined,
        payment: payment || undefined,
        plan: picked.plan || "mayorista",
        notes,
      });
      if (order) {
        setConfirming(false);
        setCreated(order);
        setLines({});
        setPriceEdits({});
        setNotes("");
        setOtherLabel("");
      }
    } catch (error) {
      setReviewError(error.message);
    } finally {
      reviewLock.current = false;
      setReviewLoading(false);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="REPARTO · POLLITO CASERO"
        title="Cargar pedido."
        description="Cliente, cajas, unidades o kilos por producto, fecha y turno. Los kilos finales los pone la balanza."
      >
        <div className="head-actions">
          <button type="button" className="secondary" onClick={reset}>
            <RotateCcw size={15} /> Limpiar
          </button>
        </div>
      </PageHead>
      {created && (
        <div className="notice success qo-created" role="status">
          <Check size={18} />
          <span>
            Pedido <strong>{created.id}</strong> de {created.name} para el{" "}
            {created.deliveryDate?.split("-").reverse().join("/")}
            {created.shift
              ? ` (${shiftNames[created.shift].toLowerCase()})`
              : ""}
            {created.driver ? ` · ${created.driver}` : ""}.
          </span>
          <Link
            to={isAdmin ? "/operacion" : "/reparto"}
            className="secondary small"
          >
            Ver pedidos
          </Link>
          <button type="button" className="primary small" onClick={reset}>
            Otro pedido
          </button>
        </div>
      )}
      {confirming && picked && (
        <dialog
          ref={confirmRef}
          className="qo-review-dialog"
          aria-labelledby="qo-confirm-title"
          onCancel={(e) => {
            if (reviewLoading || busy) e.preventDefault();
            else setConfirming(false);
          }}
        >
          <div className="qo-confirm-box">
            <span className="eyebrow">ANTES DE CARGAR</span>
            <h2 id="qo-confirm-title">Revisar pedido de {picked.name}</h2>
            <p className="muted">
              {items.length} {items.length === 1 ? "renglón" : "renglones"} ·{" "}
              {deliveryDate.split("-").reverse().join("/")}
              {docModeTag(picked)
                ? ` · en la ficha figura ${docModeTag(picked)}`
                : ""}
            </p>
            <p>
              {picked.branch ? `Sucursal: ${picked.branch} · ` : ""}
              {zone || picked.zone || "Sin zona"}
              <br />
              {shiftNames[shift] || "Sin turno"} · {driver || "Sin preventista"}
              {driver2 ? ` / ${driver2}` : ""}
              <br />
              {paymentNames[payment] || payment} ·{" "}
              {picked.address || "Sin dirección"}
            </p>
            {reviewLoading && (
              <p role="status">Verificando datos actuales del cliente…</p>
            )}
            {(reviewError || formError) && (
              <p className="notice error" role="alert">
                {reviewError || formError}
              </p>
            )}
            <div className="qo-review-lines">
              {items.map((r) => (
                <div key={r.p.id}>
                  <strong>{r.p.id === "otro" ? otherLabel : r.p.name}</strong>
                  <span>
                    {r.boxes > 0
                      ? `${r.boxes} cajas`
                      : r.units > 0
                        ? `${r.units} ${r.units === 1 ? "unidad" : "unidades"} (kilos por balanza)`
                        : `${kgText(r.kg)} kg solicitados`}
                  </span>
                  <b>
                    {Number.isFinite(r.price) && r.price > 0
                      ? `${money(r.price)} / kg`
                      : "SIN PRECIO"}
                  </b>
                  {priceEdits[r.p.id] !== undefined && (
                    <small>
                      Precio editado: se guardará en la ficha del cliente.
                    </small>
                  )}
                </div>
              ))}
            </div>
            <div className="qo-review-account">
              <strong>
                Saldo actual de dinero:{" "}
                {Number.isFinite(picked.summary?.balance)
                  ? money(picked.summary.balance)
                  : "No disponible"}
              </strong>
              <br />
              {picked.summary?.balance < 0
                ? "Saldo a favor del cliente"
                : "Deuda del cliente antes de este pedido"}
              <br />
              <strong>
                Saldo actual de cajas:{" "}
                {picked.summary?.boxes ?? "No disponible"}
              </strong>
              <br />
              Pedido nuevo: importe pendiente de pesaje. No se suma todavía al
              saldo.
            </div>
            {notes && <p>Observaciones: {notes}</p>}
            <label className="toggle">
              <input
                type="checkbox"
                checked={saveDocMode}
                onChange={(e) => setSaveDocMode(e.target.checked)}
              />{" "}
              Si elijo otra opción que la de la ficha, guardarla en la ficha de{" "}
              {picked.name} (próximos pedidos y remitos)
            </label>
            <div className="qo-confirm-options">
              {[
                [
                  "completo",
                  "Confirmar y cargar con precio y saldo",
                  "Remito con precios, total y saldo",
                ],
                [
                  "sinSaldo",
                  "Confirmar con precio, sin saldo",
                  "Remito con precios y total del pedido, sin deuda ni saldo a favor",
                ],
                [
                  "exclusivo",
                  "Confirmar sin precio ni saldo",
                  "Cliente exclusivo: remito con kilos, detalle y control de cajas",
                ],
              ].map(([mode, text, hint]) => {
                const needsPrice = mode !== "exclusivo";
                const blocked = needsPrice && missingPrice.length > 0;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={docMode === mode ? "primary" : "secondary"}
                    disabled={busy || reviewLoading || !!reviewError || blocked}
                    title={blocked ? "Falta el precio de algún producto" : hint}
                    onClick={() => confirmAndSubmit(mode)}
                  >
                    {text}
                    <small>
                      {blocked
                        ? "Falta precio de " +
                          missingPrice
                            .map((r) => r.p.name.toLowerCase())
                            .join(", ")
                        : hint}
                    </small>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="link-button"
              disabled={busy || reviewLoading}
              onClick={() => setConfirming(false)}
            >
              Volver a editar
            </button>
          </div>
        </dialog>
      )}
      <form
        className="quick-order"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
        }}
      >
        <section className="panel qo-customer">
          <h2>
            <UserPlus size={17} /> Cliente
          </h2>
          <label className="qo-search">
            Buscar cliente
            <div className="search-field">
              <Search size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Apodo, zona, razón social…"
                autoComplete="off"
                enterKeyHint="search"
                aria-label="Buscar cliente por nombre, zona o CUIT"
                onFocus={ensureFieldVisible}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (matches[0]) pick(matches[0]);
                  }
                }}
              />
            </div>
            {matches.length > 0 && (
              <ul className="suggestions" aria-label="Clientes encontrados">
                {matches.map((c) => (
                  <li key={c.phone}>
                    <button
                      type="button"
                      /* Sin quitarle el foco al campo: si no, el teclado se cierra, la lista
                         se reacomoda y el toque termina cayendo en otro lado. */
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(c)}
                    >
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {[
                            c.zone,
                            shiftNames[c.shift || ""] !== "—"
                              ? shiftNames[c.shift || ""]
                              : null,
                            c.truck || c.driver,
                            c.legalName !== c.name ? c.legalName : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          {c.summary?.balance > 0
                            ? ` · debe ${money(c.summary.balance)}`
                            : ""}
                          {docModeTag(c) ? ` · ${docModeTag(c)}` : ""}
                          {c.status && c.status !== "ok"
                            ? ` · ${c.status}`
                            : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          {picked ? (
            <div className="qo-picked-card">
              <div>
                <strong>{picked.name}</strong>
                <small>
                  {[
                    picked.legalName !== picked.name ? picked.legalName : null,
                    picked.cuit ? "CUIT " + picked.cuit : "sin CUIT",
                    picked.zone,
                    picked.address,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>
                  {picked.credit ? "Cuenta corriente" : "Paga al recibir"}
                </small>
                <div className="qo-balances" aria-label="Saldos del cliente">
                  <span
                    className={
                      "qo-balance " +
                      ((picked.summary?.balance || 0) > 0
                        ? "due"
                        : (picked.summary?.balance || 0) < 0
                          ? "favor"
                          : "")
                    }
                  >
                    <small>Saldo de cuenta</small>
                    <strong>
                      {(picked.summary?.balance || 0) < 0
                        ? `${money(-picked.summary.balance)} a favor`
                        : money(picked.summary?.balance || 0)}
                    </strong>
                  </span>
                  <span
                    className={
                      "qo-balance " + (picked.summary?.boxes > 0 ? "due" : "")
                    }
                  >
                    <small>Saldo de cajas</small>
                    <strong>
                      {picked.summary?.boxes || 0}{" "}
                      {picked.summary?.boxes === 1 ? "caja" : "cajas"}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="qo-picked-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={repeatLast}
                >
                  Repetir último
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setModal({ type: "prices", customer: picked })}
                >
                  Precios / lista
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setPicked(null);
                    setLines({});
                  }}
                >
                  Cambiar
                </button>
              </div>
            </div>
          ) : (
            <p className="qo-hint">
              Escribí el apodo o la zona y elegí de la lista.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => setModal({ type: "new-customer" })}
              >
                ¿Cliente nuevo? Crealo acá
              </button>
            </p>
          )}
          <div className="qo-grid">
            <label>
              <CalendarDays size={14} /> Fecha de reparto
              <input
                type="date"
                value={deliveryDate}
                min={todayKey()}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
              />
            </label>
            <label>
              Turno
              <select value={shift} onChange={(e) => setShift(e.target.value)}>
                <option value="">Según el cliente</option>
                <option value="manana">Mañana</option>
                <option value="tarde">Tarde</option>
              </select>
            </label>
            {vehicles.length > 0 && (
              <label>
                <Truck size={14} /> Vehículo
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">Sin vehículo</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <Users size={14} /> Preventista
              <select
                value={driver}
                onChange={(e) => {
                  setDriver(e.target.value);
                  if (driver2 === e.target.value) setDriver2("");
                }}
              >
                <option value="">Asignar después</option>
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              <Users size={14} /> Segundo preventista
              <select
                value={driver2}
                onChange={(e) => setDriver2(e.target.value)}
              >
                <option value="">Va solo</option>
                {drivers
                  .filter((d) => d !== driver)
                  .map((d) => (
                    <option key={d}>{d}</option>
                  ))}
              </select>
            </label>
            <label>
              <MapPin size={14} /> Zona
              <input
                list="qo-zonas"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="Zona del cliente"
                maxLength="60"
              />
              <datalist id="qo-zonas">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
            <label>
              <Wallet size={14} /> Pago
              <select
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                {picked?.credit && (
                  <option value="cuenta">{paymentNames.cuenta}</option>
                )}
                <option value="entrega">{paymentNames.entrega}</option>
                {config?.transfer && (
                  <option value="transferencia">
                    {paymentNames.transferencia}
                  </option>
                )}
              </select>
            </label>
            <label className="wide">
              Remito
              <select
                value={docMode}
                onChange={(e) => setDocMode(e.target.value)}
              >
                {Object.entries(DOC_MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {picked && docMode !== docModeOf(picked) && (
                <small>
                  La ficha dice “{DOC_MODES[docModeOf(picked)]}”. Al confirmar
                  podés guardar el cambio en la ficha.
                </small>
              )}
            </label>
            <label className="wide">
              Observaciones <small>(salen en el remito)</small>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength="500"
                autoComplete="off"
                placeholder="Pollo grande, dejar en el galpón…"
              />
            </label>
          </div>
        </section>

        <section className="panel qo-products">
          <h2>
            <Package size={17} /> Cajas, unidades y kilos por producto
          </h2>
          <div className="table-scroll">
            <table className="qo-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num qo-price">$/kg</th>
                  <th className="num qo-box">Cajas</th>
                  <th className="num qo-units">Unid.</th>
                  <th className="num qo-kg">Kilos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, price, bad, active }, i) => (
                  <tr
                    key={p.id}
                    className={(active ? "on" : "") + (bad ? " bad" : "")}
                  >
                    <td>
                      {p.id === "otro" ? (
                        <span className="qo-other-row">
                          <input
                            type="text"
                            className="qo-other"
                            value={otherLabel}
                            maxLength="60"
                            placeholder="Producto nuevo: escribí el nombre"
                            aria-label="Nombre del producto nuevo"
                            onChange={(e) => setOtherLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void addOtherProduct();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="secondary small"
                            disabled={
                              otherLabel.trim().length < 2 || addingProduct
                            }
                            onClick={() => void addOtherProduct()}
                          >
                            <Plus size={14} /> Agregar
                          </button>
                        </span>
                      ) : (
                        p.name
                      )}
                      {!noPricing && (
                        <small className="qo-price-mobile">
                          {Number.isFinite(price) && price > 0
                            ? money(price) + " / kg"
                            : "sin precio"}
                        </small>
                      )}
                    </td>
                    <td
                      className={
                        "num qo-price " +
                        (priceEdits[p.id] !== undefined
                          ? "edited"
                          : picked?.prices?.[p.id]
                            ? "own"
                            : picked?.lista?.precios?.[p.id]
                              ? "from-list"
                              : "")
                      }
                    >
                      {noPricing ? (
                        <span className="muted">—</span>
                      ) : picked && editingPrice === p.id ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          className="qo-price-input"
                          aria-label={`Precio por kilo de ${p.name}`}
                          value={priceEdits[p.id] ?? String(price || "")}
                          onChange={(e) =>
                            setPriceEdits({
                              ...priceEdits,
                              [p.id]: e.target.value,
                            })
                          }
                          onBlur={() => setEditingPrice(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") {
                              e.preventDefault();
                              setEditingPrice(null);
                            }
                          }}
                        />
                      ) : picked ? (
                        <button
                          type="button"
                          className="qo-price-btn"
                          title={
                            !picked.prices?.[p.id] &&
                            picked.lista?.precios?.[p.id]
                              ? "Precio de la lista del cliente. Tocá para cambiarlo."
                              : "Cambiar el precio por kilo para este cliente"
                          }
                          aria-label={`Cambiar precio de ${p.name}`}
                          onClick={() => setEditingPrice(p.id)}
                        >
                          {Number.isFinite(price) && price > 0 ? (
                            money(price)
                          ) : (
                            <em className="qo-bad">sin precio</em>
                          )}
                          <Pencil size={11} />
                        </button>
                      ) : Number.isFinite(price) && price > 0 ? (
                        money(price)
                      ) : (
                        <em className="qo-bad">sin precio</em>
                      )}
                    </td>
                    <td className="num qo-box">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={lines[p.id]?.boxes ?? ""}
                        disabled={!picked}
                        aria-label={`Cajas de ${p.name}`}
                        aria-invalid={bad || undefined}
                        className={
                          lines[p.id]?.kg || lines[p.id]?.units ? "qo-off" : ""
                        }
                        title="Se pesan en balanza: los kilos salen de la pesada"
                        onChange={(e) =>
                          setLines({
                            ...lines,
                            [p.id]: {
                              boxes: e.target.value,
                              units: "",
                              kg: "",
                            },
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.ctrlKey) {
                            e.preventDefault();
                            const inputs = [
                              ...document.querySelectorAll(
                                ".qo-box input:not(:disabled)",
                              ),
                            ];
                            const at = inputs.indexOf(e.currentTarget);
                            (inputs[at + 1] || inputs[0])?.focus();
                          }
                        }}
                      />
                    </td>
                    <td className="num qo-units">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={lines[p.id]?.units ?? ""}
                        disabled={!picked}
                        aria-label={`Unidades de ${p.name}`}
                        aria-invalid={bad || undefined}
                        className={
                          lines[p.id]?.kg || lines[p.id]?.boxes ? "qo-off" : ""
                        }
                        title="Pollos o piezas contadas: los kilos y el importe salen de la balanza"
                        onChange={(e) =>
                          setLines({
                            ...lines,
                            [p.id]: {
                              units: e.target.value,
                              boxes: "",
                              kg: "",
                            },
                          })
                        }
                      />
                    </td>
                    <td className="num qo-kg">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={lines[p.id]?.kg ?? ""}
                        disabled={!picked}
                        aria-label={`Kilos de ${p.name}`}
                        aria-invalid={bad || undefined}
                        className={
                          lines[p.id]?.boxes || lines[p.id]?.units
                            ? "qo-off"
                            : ""
                        }
                        title="Pedido por peso: en la pesada se cargan bruto y neto"
                        onChange={(e) =>
                          setLines({
                            ...lines,
                            [p.id]: {
                              kg: e.target.value,
                              boxes: "",
                              units: "",
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Cada producto va por <strong>cajas</strong>, por{" "}
            <strong>unidades</strong> o por <strong>kilos</strong>, uno solo: al
            escribir en una columna se borran las otras. Las cajas se pesan
            después en balanza (la app descuenta la tara de cada cajón); las
            unidades (pollos o piezas contadas) y lo pedido por kilos se pesan
            en bruto y neto. El precio siempre es por kilo: el importe sale de
            los kilos de la balanza.
          </p>
          {invalid.length > 0 && (
            <p className="form-error" role="alert">
              Revisá {invalid.map((r) => r.p.name.toLowerCase()).join(", ")}:
              cajas enteras (0 a 500), unidades enteras y kilos válidos.
            </p>
          )}
          {noPrice.length > 0 && (
            <p className="form-error" role="alert">
              {picked?.name} no tiene precio para{" "}
              {noPrice.map((r) => r.p.name.toLowerCase()).join(", ")}: tocá el
              precio en la fila para cargarlo, o marcá "sin precio" si es un
              cliente exclusivo.
            </p>
          )}
          {otroSinNombre && (
            <p className="form-error" role="alert">
              Escribí el nombre del producto nuevo y tocá Agregar.
            </p>
          )}
        </section>

        <aside className="panel qo-summary">
          <h2>Resumen</h2>
          <dl>
            <div>
              <dt>Cajas a armar</dt>
              <dd>{totalBoxes}</dd>
            </div>
            <div>
              <dt>Unidades</dt>
              <dd>{totalUnits || "—"}</dd>
            </div>
            <div>
              <dt>Kilos pedidos</dt>
              <dd>{totalKg ? kgText(totalKg) : "—"}</dd>
            </div>
            <div className="total">
              <dt>Importe</dt>
              <dd>{noPricing ? "sin precio" : "según balanza"}</dd>
            </div>
          </dl>
          {picked && items.length > 0 && (
            <p className="qo-confirm">
              <strong>{picked.name}</strong> ·{" "}
              {deliveryDate.split("-").reverse().join("/")}
              {shift || picked.shift
                ? ` · ${shiftNames[shift || picked.shift].toLowerCase()}`
                : ""}
              {driver ? ` · ${driver}` : ""} ·{" "}
              {paymentNames[
                payment || (picked.credit ? "cuenta" : "entrega")
              ]?.toLowerCase()}
            </p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="primary full" disabled={!canSubmit}>
            {busy ? "Cargando…" : "Cargar pedido"} <ArrowRight size={16} />
          </button>
          <small className="muted">Ctrl + Enter también confirma.</small>
        </aside>
        {picked && items.length > 0 && (
          <div className="qo-bar" aria-hidden="true">
            <span>
              {totalBoxes ? `${totalBoxes} cj` : ""}
              {totalBoxes && totalKg ? " · " : ""}
              {totalKg ? kgText(totalKg) : ""}
            </span>
            <button
              type="submit"
              className="primary"
              tabIndex={-1}
              disabled={!canSubmit}
            >
              Cargar pedido <ArrowRight size={15} />
            </button>
          </div>
        )}
      </form>
    </>
  );
}
