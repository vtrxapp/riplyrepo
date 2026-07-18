// events.price is a free-text column ('Free', '$15.00', '15', 0, null, ...)
// rather than numeric — every read site needs to defensively parse it rather
// than assume a shape. This is the one place that parsing happens.
export function parseEventPrice(price) {
  if (price == null || price === "") return { isFree: true, amount: 0 };
  if (typeof price === "number") {
    return Number.isFinite(price) && price > 0 ? { isFree: false, amount: price } : { isFree: true, amount: 0 };
  }
  const str = String(price).trim();
  if (/^free$/i.test(str)) return { isFree: true, amount: 0 };
  // A negative-looking value isn't a real charge — treat as invalid/free
  // rather than silently dropping the sign into a positive amount.
  if (/^-/.test(str.replace(/^\$/, ""))) return { isFree: true, amount: 0 };
  // Take only the first numeric token, not every digit in the string —
  // stripping all non-digits before parsing would collapse a range like
  // "$10–$20" into "1020".
  const match = str.match(/\d+(?:\.\d+)?/);
  if (!match) return { isFree: true, amount: 0 };
  const num = parseFloat(match[0]);
  if (!Number.isFinite(num) || num <= 0) return { isFree: true, amount: 0 };
  return { isFree: false, amount: num };
}
