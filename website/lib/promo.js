/** Promo codes that skip hosted Checkout. Keep this server-side only. */

export function promoIsValid(code) {
  const allowed = new Set(
    String(process.env.KLEO_PROMO_CODES || "asdfs7")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(String(code ?? "").trim().toLowerCase());
}
