// events.price is a free-text column ('Free', '$15.00', '15', 0, null, ...)
// rather than numeric — every read site needs to defensively parse it rather
// than assume a shape. This is the one place that parsing happens.
export function parseEventPrice(price) {
  if (price == null || price === "") return { isFree: true, amount: 0 };
  if (typeof price === "number") return { isFree: price <= 0, amount: price };
  const str = String(price).trim();
  if (/^free$/i.test(str)) return { isFree: true, amount: 0 };
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num)) return { isFree: true, amount: 0 };
  return { isFree: num <= 0, amount: num };
}
