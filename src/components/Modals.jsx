import React, { useEffect, useRef, useState } from "react";
import DeliveryPoint from "./DeliveryPoint.jsx";
import PhoneVerify from "./PhoneVerify.jsx";
import { passkeyAvailable } from "../lib/auth.js";
import {
  X,
  Check,
  ArrowRight,
  User,
  ArrowUpRight,
  Package,
  ChevronRight,
  MessageCircle,
  Download,
  LogOut,
  ShieldCheck,
  Trash2,
  Fingerprint,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";
import {
  money,
  labels,
  kgText,
  planNames,
  lineAmount,
  dateText,
} from "../lib/format.js";
import { CartLines, CartTotals } from "./Cart.jsx";
import { ledger } from "../lib/ledger.js";

const phonePattern = "[+0-9 \\(\\)\\-]{8,25}";

function LocalitySelect({ defaultValue }) {
  const { localities } = useStore();
  return (
    <label>
      Localidad de entrega
      <select name="localityId" defaultValue={defaultValue || ""} required>
        <option value="" disabled>
          Elegí una localidad…
        </option>
        {localities.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · CP {l.postalCode}
          </option>
        ))}
      </select>
    </label>
  );
}

function Checkout() {
  const {
    plan,
    totals,
    items,
    profile,
    session,
    me,
    config,
    busy,
    online,
    checkout,
  } = useStore();
  const admin = session?.role === "admin";
  const known =
    session?.role === "cliente"
      ? { ...profile, ...me, phone: profile.phone || session.phone }
      : admin
        ? {}
        : profile;
  const canCredit = plan === "mayorista" && (admin || me?.credit !== false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const { lat, lng, ...fields } = Object.fromEntries(
          new FormData(e.target),
        );
        checkout({
          ...fields,
          location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
        });
      }}
    >
      <span className="eyebrow">
        {admin ? "PEDIDO TELEFÓNICO" : "UN PASO MÁS"}
      </span>
      <h2>{admin ? "¿Para quién es el pedido?" : "¿Dónde lo llevamos?"}</h2>
      <p>
        {planNames[plan]} · {items.length}{" "}
        {items.length === 1 ? "producto" : "productos"} · {kgText(totals.kg)}
      </p>
      <label>
        {admin ? "Nombre del cliente" : "Nombre y apellido"}
        <input
          name="name"
          autoComplete={admin ? "off" : "name"}
          defaultValue={known.name || ""}
          required
          minLength="2"
          maxLength="100"
        />
      </label>
      <label>
        WhatsApp {admin ? "del cliente" : "de contacto"}
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete={admin ? "off" : "tel"}
          defaultValue={known.phone || ""}
          required
          pattern={phonePattern}
          placeholder="263 4 55-1234"
        />
        <small>
          Con código de área, sin 0 ni 15. Con este número seguís tu pedido.
        </small>
      </label>
      <DeliveryPoint known={known} />
      <label>
        Forma de pago
        <select name="payment" defaultValue={canCredit ? "cuenta" : "entrega"}>
          {canCredit && (
            <option value="cuenta">Cuenta corriente · cliente habitual</option>
          )}
          <option value="entrega">Efectivo al recibir</option>
          {config?.transfer && (
            <option value="transferencia">
              Transferencia a Mercado Pago / banco (alias)
            </option>
          )}
          {config?.mercadopago && (
            <option value="mercadopago">Pagar online con Mercado Pago</option>
          )}
        </select>
        <small>
          {config?.transfer
            ? "Si elegís transferencia, al confirmar te mostramos el alias y avisás cuando la hiciste."
            : "Pagás al recibir el pedido. La transferencia se habilita cuando el negocio cargue su alias."}
        </small>
      </label>
      <label>
        Indicaciones para el reparto <small>(opcional)</small>
        <textarea
          name="notes"
          maxLength="500"
          placeholder="Piso, timbre, horario o una referencia…"
        />
      </label>
      <div className="checkout-total">
        <span>Total estimado</span>
        <strong>{money(totals.total)}</strong>
      </div>
      <p className="demo-note">
        El peso final se ajusta en la balanza al preparar. El horario se
        coordina por WhatsApp.
      </p>
      <button className="primary full" disabled={busy || !online}>
        {busy ? "Confirmando…" : "Confirmar pedido"}
        <ArrowRight size={16} />
      </button>
    </form>
  );
}

function CartSheet() {
  const { items, online, setModal } = useStore();
  return (
    <div className="cart-sheet">
      <h2>Tu pedido</h2>
      {items.length ? <CartLines /> : <p>Tu pedido está vacío.</p>}
      <CartTotals />
      <button
        className="primary full"
        disabled={!items.length || !online}
        onClick={() => setModal({ type: "checkout" })}
      >
        Continuar pedido <ArrowRight size={17} />
      </button>
    </div>
  );
}

function Login() {
  const { profile } = useStore();
  const { navigate } = useRoute();
  return (
    <>
      <span className="eyebrow">TUS PEDIDOS, DONDE ESTÉS</span>
      <h2>Ingresá con tu celular.</h2>
      <p>
        Te mandamos un código por WhatsApp, el mismo con el que hacés tus
        pedidos.
      </p>
      <PhoneVerify
        initialName={profile.name || ""}
        initialPhone={profile.phone || ""}
      />
      <p className="demo-note">
        ¿Preferís email, Google o huella?{" "}
        <Link
          to="/ingresar"
          onClick={(e) => {
            e.preventDefault();
            navigate("/ingresar");
          }}
        >
          Ver todas las opciones
        </Link>
      </p>
    </>
  );
}

function Profile() {
  const {
    profile,
    me,
    session,
    setProfile,
    saveProfile,
    busy,
    logout,
    plan,
    setPlan,
    addPasskey,
    removePasskey,
    setPassword,
    setModal,
    config,
  } = useStore();
  const [verifying, setVerifying] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const known = {
    ...profile,
    ...me,
    phone: session?.phone
      ? profile.phone || session.phone
      : profile.phone || "",
  };
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    passkeyAvailable().then(setCanPasskey);
  }, []);
  const account = me?.account;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        setProfile((p) => ({ ...p, ...f }));
        saveProfile(f);
      }}
    >
      <h2>Tus datos, a mano.</h2>
      <p>Los usamos para completar tu próximo pedido más rápido.</p>
      {account && (
        <div className="account-box">
          <div>
            <small>CUENTA</small>
            <strong>{account.email || "Sin email"}</strong>
            <span>
              {[
                account.google && "Google",
                account.password && "contraseña",
                account.passkeys.length &&
                  `${account.passkeys.length} llave${account.passkeys.length > 1 ? "s" : ""} de acceso`,
              ]
                .filter(Boolean)
                .join(" · ") || "enlace por email"}
            </span>
          </div>
          {changingPassword ? (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const f = Object.fromEntries(new FormData(e.target));
                if (await setPassword(f)) setChangingPassword(false);
              }}
            >
              {account.password && (
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Contraseña actual"
                  required
                />
              )}
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength="8"
                placeholder="Nueva contraseña (mín. 8)"
                required
              />
              <button className="primary small" disabled={busy}>
                <Check size={14} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => setChangingPassword(true)}
            >
              {account.password ? "Cambiar contraseña" : "Crear una contraseña"}
            </button>
          )}
          {canPasskey && (
            <button
              type="button"
              className="secondary"
              onClick={addPasskey}
              disabled={busy}
            >
              <Fingerprint size={15} />{" "}
              {account.passkeys.length
                ? "Agregar este dispositivo"
                : "Activar huella / Face ID"}
            </button>
          )}
          {account.passkeys.length > 0 && (
            <ul className="passkey-list">
              {account.passkeys.map((k) => (
                <li key={k.id}>
                  <Fingerprint size={13} /> {k.device || "Dispositivo"} · desde{" "}
                  {new Date(k.created).toLocaleDateString("es-AR")}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => removePasskey(k.id)}
                    disabled={busy}
                  >
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {session && !session.phone && (
        <div className="notice verify-box">
          <p>
            <strong>Verificá tu WhatsApp</strong> para ver todos tus pedidos, tu
            cuenta corriente y recibir avisos del reparto.
          </p>
          {verifying ? (
            <PhoneVerify
              askName={false}
              initialPhone={known.phone || ""}
              compact
              message="WhatsApp verificado."
              onDone={() => setVerifying(false)}
            />
          ) : (
            config?.phoneLogin !== false && (
              <button
                type="button"
                className="primary small"
                onClick={() => setVerifying(true)}
              >
                Verificar con un código
              </button>
            )
          )}
        </div>
      )}
      <label>
        Nombre y apellido
        <input
          name="name"
          autoComplete="name"
          defaultValue={known.name || ""}
          required
          minLength="2"
          maxLength="100"
        />
      </label>
      {session?.phone ? (
        <label>
          WhatsApp <small>(verificado)</small>
          <input name="phone" type="tel" value={known.phone} readOnly />
        </label>
      ) : null}
      <label>
        Dirección
        <input
          name="address"
          autoComplete="street-address"
          defaultValue={known.address || ""}
          minLength="8"
          maxLength="250"
        />
      </label>
      <LocalitySelect defaultValue={known.localityId} />
      <label>
        Modalidad habitual
        <select
          name="plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        >
          {Object.entries(planNames).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button className="primary full" disabled={busy}>
        Guardar datos <Check size={16} />
      </button>
      {session && (
        <button type="button" className="link-button" onClick={logout}>
          <LogOut size={14} /> Cerrar sesión en este dispositivo
        </button>
      )}
    </form>
  );
}

/** Extracto de cuenta corriente de un cliente (administración). */
function Statement({ customer }) {
  const { orders } = useStore();
  const rows = ledger(
    orders.filter((o) => o.customer === customer.phone),
    customer.payments || [],
  ).reverse();
  const balance = rows[0]?.balance || 0;
  return (
    <>
      <span className="eyebrow">CUENTA CORRIENTE</span>
      <h2>{customer.name}</h2>
      <p>
        Saldo actual:{" "}
        <strong className={balance > 0 ? "red" : balance < 0 ? "green" : ""}>
          {balance < 0 ? `${money(-balance)} a favor` : money(balance)}
        </strong>
      </p>
      {rows.length === 0 ? (
        <p className="muted">Sin movimientos a cuenta.</p>
      ) : (
        <div className="table-scroll">
          <table className="statement">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th className="num">Cargo</th>
                <th className="num">Pago</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.ref + r.kind + i} className={"kind-" + r.kind}>
                  <td>{dateText(r.at)}</td>
                  <td>{r.label}</td>
                  <td className="num">{r.amount > 0 ? money(r.amount) : ""}</td>
                  <td className="num green">
                    {r.amount < 0 ? money(-r.amount) : ""}
                  </td>
                  <td className={"num " + (r.balance > 0 ? "red" : "")}>
                    {r.balance < 0
                      ? `${money(-r.balance)} a favor`
                      : money(r.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Menu() {
  const { setModal, session, logout } = useStore();
  const { navigate } = useRoute();
  const links = [
    ["/", "Hacer un pedido"],
    ["/cuenta", "Mi cuenta"],
    ["/planes", "Nuestros planes"],
    ["/ayuda", "Ayuda y WhatsApp"],
  ];
  return (
    <>
      <h2>Tu Pollito Casero</h2>
      {session ? (
        <button
          className="notification-row"
          onClick={() => setModal({ type: "profile" })}
        >
          <User size={20} /> {session.name} · mis datos
        </button>
      ) : (
        <Link
          to="/ingresar"
          className="notification-row"
          onClick={(e) => {
            e.preventDefault();
            setModal(null);
            navigate("/ingresar");
          }}
        >
          <User size={20} /> Ingresar o crear cuenta
        </Link>
      )}
      {links.map(([to, title]) => (
        <Link
          to={to}
          className="notification-row"
          key={to}
          onClick={(e) => {
            e.preventDefault();
            setModal(null);
            navigate(to);
          }}
        >
          {title}
          <ArrowUpRight size={17} />
        </Link>
      ))}
      {session && (
        <button className="notification-row" onClick={logout}>
          <LogOut size={18} /> Cerrar sesión
        </button>
      )}
      <Link
        to="/admin"
        className="notification-row staff-row"
        rel="nofollow"
        onClick={(e) => {
          e.preventDefault();
          setModal(null);
          navigate("/admin");
        }}
      >
        <ShieldCheck size={18} /> Administración / Equipo
        <ArrowUpRight size={17} />
      </Link>
    </>
  );
}

function Notifications() {
  const { orders, setModal } = useStore();
  const { navigate } = useRoute();
  return (
    <>
      <h2>Novedades de tus pedidos</h2>
      <p>Se actualizan al instante mientras la app está abierta.</p>
      {orders.length ? (
        orders.slice(0, 6).map((o) => (
          <button
            className="notification-row"
            key={o.id}
            onClick={() => {
              setModal(null);
              navigate("/seguimiento?pedido=" + o.id);
            }}
          >
            <Package size={20} />
            <span>
              <strong>{o.id}</strong>
              <small>{labels[o.status]}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))
      ) : (
        <p>Todavía no hay novedades.</p>
      )}
    </>
  );
}

function Payment({ order }) {
  const { busy, update, setModal } = useStore();
  const [method, setMethod] = useState(
    order.payment === "transferencia" ? "transferencia" : "efectivo",
  );
  return (
    <>
      <h2>Registrar un cobro</h2>
      <p>
        Confirmá únicamente si recibiste <strong>{money(order.total)}</strong>{" "}
        por el pedido {order.id} de {order.name}.
        {order.transfer
          ? ` El cliente avisó una transferencia a las ${new Date(order.transfer.reportedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}${order.transfer.reference ? " (ref. " + order.transfer.reference + ")" : ""}: verificá el ingreso antes de confirmar.`
          : ""}
      </p>
      <label>
        ¿Cómo pagó?
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia (alias / CVU)</option>
          <option value="mercadopago">Mercado Pago (QR / link)</option>
        </select>
      </label>
      <button
        disabled={busy}
        className="primary full"
        onClick={async () => {
          if (await update(order, { paid: true, paidMethod: method }))
            setModal(null);
        }}
      >
        Ya recibí el pago <Check size={16} />
      </button>
    </>
  );
}

function Boxes({ order, kind }) {
  const { busy, update, setModal, formError } = useStore();
  const returning = kind === "return";
  const pending = order.boxes - order.returned;
  const wholesale = order.plan === "mayorista";
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const count = Number(new FormData(e.target).get("boxes") || 0);
        const ok = await update(
          order,
          returning
            ? { returnBoxes: count }
            : { status: "entregado", boxes: wholesale ? count : 0 },
        );
        if (ok) setModal(null);
      }}
    >
      <h2>{returning ? "Devolución de envases" : "Completar entrega"}</h2>
      <p>
        {order.id} · {order.name}
        {!returning && order.payment !== "cuenta" && !order.paid
          ? " · Falta registrar el cobro"
          : ""}
      </p>
      {returning || wholesale ? (
        <label>
          {returning
            ? `Envases devueltos (pendientes: ${pending})`
            : "Envases que dejás al cliente"}
          <input
            name="boxes"
            type="number"
            inputMode="numeric"
            defaultValue={returning ? pending : 0}
            min={returning ? 1 : 0}
            max={returning ? pending : 100}
            step="1"
            required
          />
        </label>
      ) : (
        <p>Pedido minorista: sin envases retornables.</p>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button className="primary full" disabled={busy}>
        Confirmar <Check size={16} />
      </button>
    </form>
  );
}

/** Carga del peso real de balanza por corte; recalcula el total en vivo. */
function Weights({ order }) {
  const { busy, update, setModal } = useStore();
  const [kg, setKg] = useState(
    Object.fromEntries(order.items.map((p) => [p.id, String(p.kg)])),
  );
  const total =
    order.items.reduce((s, p) => {
      const v = Number(String(kg[p.id]).replace(",", "."));
      return (
        s +
        Math.round(
          (Number.isFinite(v) && v > 0
            ? lineAmount(p.price, Math.round(v * 100) / 100)
            : p.lineTotal) * 100,
        )
      );
    }, 0) /
      100 +
    (order.shipping || 0);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const weights = Object.fromEntries(
          order.items.map((p) => [
            p.id,
            Math.round(Number(String(kg[p.id]).replace(",", ".")) * 100) / 100,
          ]),
        );
        if (await update(order, { weights })) setModal(null);
      }}
    >
      <span className="eyebrow">BALANZA</span>
      <h2>Peso real del pedido</h2>
      <p>
        {order.id} · {order.name}. Cargá los kilos pesados; el importe se
        recalcula con el precio por kilo de cada corte.
      </p>
      <div className="weights">
        {order.items.map((p) => (
          <label key={p.id} className="weight-row">
            <span>
              {p.name}
              <small>
                Pedido: {kgText(p.ordered ?? p.kg)} · {money(p.price)}/kg
              </small>
            </span>
            <span className="weight-input">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.05"
                max="1000"
                value={kg[p.id]}
                onChange={(e) => setKg({ ...kg, [p.id]: e.target.value })}
                required
                aria-label={"Kilos pesados de " + p.name}
              />
              <b>kg</b>
            </span>
          </label>
        ))}
      </div>
      <div className="checkout-total">
        <span>Total con peso real</span>
        <strong>{money(total)}</strong>
      </div>
      <button className="primary full" disabled={busy}>
        Guardar pesaje <Check size={16} />
      </button>
    </form>
  );
}

/** Pago de cuenta corriente de un cliente habitual: se aplica a los pedidos más viejos. */
/** Envases devueltos por un cliente (se descuentan de sus pedidos más viejos). */
function BoxesReturn({ customer }) {
  const { busy, returnBoxes, setModal, formError } = useStore();
  const pending = customer.summary?.boxes || 0;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await returnBoxes(
            customer,
            Number(new FormData(e.target).get("boxes")),
          )
        )
          setModal(null);
      }}
    >
      <span className="eyebrow">ENVASES</span>
      <h2>Recibir envases de {customer.name}</h2>
      <p>
        Tiene {pending}{" "}
        {pending === 1 ? "envase pendiente" : "envases pendientes"}. Se
        descuentan de sus entregas más antiguas.
      </p>
      <label>
        Envases que devuelve ahora
        <input
          name="boxes"
          type="number"
          inputMode="numeric"
          min="1"
          max={pending}
          defaultValue={pending}
          step="1"
          required
        />
      </label>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button className="primary full" disabled={busy || !pending}>
        Registrar devolución <Check size={16} />
      </button>
    </form>
  );
}

function AccountPayment({ customer }) {
  const { busy, registerPayment, setModal, formError } = useStore();
  const balance = customer.summary?.balance || 0;
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (
          await registerPayment(customer, {
            amount: Number(String(f.amount).replace(",", ".")),
            method: f.method,
            note: f.note,
          })
        )
          setModal(null);
      }}
    >
      <span className="eyebrow">CUENTA CORRIENTE</span>
      <h2>Cobrar a {customer.name}</h2>
      <p>
        Saldo pendiente: <strong>{money(balance > 0 ? balance : 0)}</strong>
        {customer.summary?.creditBalance > 0
          ? ` · a favor ${money(customer.summary.creditBalance)}`
          : ""}
        {customer.summary?.pendingOrders
          ? ` · ${customer.summary.pendingOrders} pedidos sin pagar`
          : ""}
      </p>
      <label>
        Importe recibido
        <input
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <small>
          Se cancelan primero los pedidos más antiguos; si sobra, queda como
          saldo a favor.
        </small>
      </label>
      <label>
        Medio
        <select name="method" defaultValue="efectivo">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
        </select>
      </label>
      <label>
        Nota <small>(opcional)</small>
        <input
          name="note"
          maxLength="200"
          placeholder="Recibo, comprobante, aclaración…"
        />
      </label>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button className="primary full" disabled={busy}>
        Registrar pago <Check size={16} />
      </button>
    </form>
  );
}

function Cancel({ order }) {
  const { busy, update, setModal, notify } = useStore();
  return (
    <>
      <h2>¿Cancelar el pedido {order.id}?</h2>
      <p>
        Todavía no empezamos a prepararlo, así que podés cancelarlo sin cargo.
        Si querés cambiar algo, escribinos por WhatsApp.
      </p>
      <div className="actions-row">
        <button
          disabled={busy}
          className="danger-button"
          onClick={async () => {
            if (await update(order, { cancel: true })) {
              setModal(null);
              notify("Pedido cancelado.");
            }
          }}
        >
          <Trash2 size={16} /> Sí, cancelar
        </button>
        <button className="secondary" onClick={() => setModal(null)}>
          Volver
        </button>
      </div>
    </>
  );
}

export default function Modals() {
  const { modal, setModal, formError } = useStore();
  const dialog = useRef();
  useEffect(() => {
    if (modal) {
      if (!dialog.current.open) dialog.current.showModal();
    } else dialog.current?.close();
  }, [modal]);
  const type = modal?.type;
  const showError =
    formError &&
    !["delivery", "return", "account-payment", "boxes-return"].includes(type);
  return (
    <dialog
      className={type === "cart" ? "sheet" : ""}
      aria-label="Ventana de Pollito Casero"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        setModal(null);
      }}
      onClick={(e) => {
        if (e.target === dialog.current) setModal(null);
      }}
    >
      <button
        className="modal-close icon-button"
        onClick={() => setModal(null)}
        aria-label="Cerrar ventana"
      >
        <X size={20} />
      </button>
      {showError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {type === "checkout" ? (
        <Checkout />
      ) : type === "cart" ? (
        <CartSheet />
      ) : type === "login" ? (
        <Login />
      ) : type === "profile" ? (
        <Profile />
      ) : type === "menu" ? (
        <Menu />
      ) : type === "notifications" ? (
        <Notifications />
      ) : type === "payment" ? (
        <Payment order={modal.order} />
      ) : type === "delivery" || type === "return" ? (
        <Boxes order={modal.order} kind={type} />
      ) : type === "weights" ? (
        <Weights order={modal.order} />
      ) : type === "boxes-return" ? (
        <BoxesReturn customer={modal.customer} />
      ) : type === "account-payment" ? (
        <AccountPayment customer={modal.customer} />
      ) : type === "cancel" ? (
        <Cancel order={modal.order} />
      ) : type === "statement" ? (
        <Statement customer={modal.customer} />
      ) : type === "contact" ? (
        <>
          <MessageCircle size={32} />
          <h2>Falta configurar WhatsApp</h2>
          <p>
            El negocio todavía no cargó ese número. Cuando esté configurado,
            este botón abrirá la conversación.
          </p>
          <button className="primary full" onClick={() => setModal(null)}>
            Entendido
          </button>
        </>
      ) : type === "install" ? (
        <>
          <Download size={32} />
          <h2>Pollito, siempre a mano.</h2>
          <p>
            En Chrome o Edge, abrí el menú del navegador y elegí “Instalar
            aplicación”. En iPhone, usá Safari → Compartir → Agregar a inicio.
          </p>
        </>
      ) : type === "staff" ? (
        <>
          <ShieldCheck size={32} />
          <h2>Acceso del equipo</h2>
          <p>
            Administración y repartidores ingresan con su usuario y contraseña.
          </p>
          <Link
            to="/admin"
            className="primary full"
            onClick={() => setModal(null)}
          >
            Ir al acceso <ArrowRight size={16} />
          </Link>
        </>
      ) : null}
    </dialog>
  );
}
