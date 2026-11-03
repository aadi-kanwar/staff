/**
 * Indian rupee formatting (en-IN grouping, ₹). Whole rupees by default;
 * line items that aren't whole rupees (e.g. a half-day) show paise.
 */
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number, options: { exact?: boolean; signed?: boolean } = {}): string {
  const value = options.exact ? Math.round(amount * 100) / 100 : Math.round(amount);
  const text = (options.exact && !Number.isInteger(value) ? exact : whole).format(Math.abs(value));
  if (value < 0) return `−${text}`;
  return options.signed && value > 0 ? `+${text}` : text;
}
