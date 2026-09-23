const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Mendoza",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día comercial; nunca depende del huso horario del celular ni adelanta la tarde. */
export function businessDate(date = new Date()) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
