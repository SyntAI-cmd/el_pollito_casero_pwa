import React from "react";
import { Check, Package } from "lucide-react";
import { Link } from "../lib/router.jsx";
import { labels, stages, stageHints, timeText } from "../lib/format.js";

export function PageHead({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow || "POLLITO CASERO"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon = Package, title, text, to, action }) {
  return (
    <div className="empty-state">
      <Icon />
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {to && (
        <Link to={to} className="primary">
          {action}
        </Link>
      )}
    </div>
  );
}

export function StatusBadge({ status }) {
  return (
    <span className={"badge status-" + status}>{labels[status] || status}</span>
  );
}

export function Timeline({ order }) {
  const current = stages.indexOf(order.status);
  const at = (s) => order.history?.findLast?.((h) => h.status === s)?.at;
  if (order.status === "cancelado")
    return (
      <ol className="timeline">
        <li className="done cancelled">
          <span>×</span>
          <div>
            <strong>Pedido cancelado</strong>
            <p>
              Lo cancelaste antes de la preparación
              {at("cancelado") ? " · " + timeText(at("cancelado")) : ""}.
            </p>
          </div>
        </li>
      </ol>
    );
  return (
    <ol className="timeline">
      {stages.map((s, i) => (
        <li
          key={s}
          className={i <= current ? "done" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{i < current ? <Check size={16} /> : i + 1}</span>
          <div>
            <strong>{labels[s]}</strong>
            <p>
              {stageHints[i]}
              {i <= current && at(s) ? (
                <small> · {timeText(at(s))}</small>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MiniMap() {
  return (
    <svg
      className="mini-map"
      viewBox="0 0 340 152"
      role="img"
      aria-label="Ilustración de un recorrido de reparto"
    >
      <rect width="340" height="152" fill="#eeeee8" />
      <g fill="#dfe7d7">
        <rect x="20" y="12" width="46" height="38" rx="6" />
        <rect x="245" y="78" width="70" height="50" rx="8" />
      </g>
      <g stroke="#fff" strokeWidth="11" fill="none">
        <path d="M0 64H340M0 122H340M91 0V152M189 0V152M277 0V152M0 0L340 152" />
      </g>
      <g stroke="#d8d9d3" strokeWidth="1" fill="none">
        <path d="M0 64H340M0 122H340M91 0V152M189 0V152M277 0V152" />
      </g>
      <path
        d="M92 112V65H190V35H247"
        stroke="#cc242a"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <circle
        cx="92"
        cy="112"
        r="9"
        fill="#cc242a"
        stroke="white"
        strokeWidth="4"
      />
      <circle
        cx="247"
        cy="35"
        r="10"
        fill="#20201e"
        stroke="white"
        strokeWidth="4"
      />
    </svg>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label>
      {label}
      {hint && <small> {hint}</small>}
      {children}
    </label>
  );
}
