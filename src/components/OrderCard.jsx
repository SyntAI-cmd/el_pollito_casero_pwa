import React from "react";
import OrderDetail from "./OrderDetail.jsx";
export default function OrderCard({ order, role }) {
  return (
    <article className="operation-order">
      <OrderDetail order={order} role={role} />
    </article>
  );
}
