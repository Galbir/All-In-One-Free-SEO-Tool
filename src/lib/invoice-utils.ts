export type InvoiceItem = {
  description: string;
  quantity: number;
  rate: number;
};

export function lineAmount(item: InvoiceItem): number {
  return item.quantity * item.rate;
}

export function invoiceTotals(
  items: InvoiceItem[],
  taxRateBasisPoints: number,
): { subtotal: number; tax: number; total: number } {
  const subtotal = items.reduce((sum, i) => sum + lineAmount(i), 0);
  const tax = (subtotal * taxRateBasisPoints) / 10_000;
  return {
    subtotal,
    tax,
    total: subtotal + tax,
  };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}


/**
 * Next INV-<year>-<seq> number: one past the highest sequence used this
 * year, whether it is still in the table or was issued and since deleted
 * (`alreadyIssued`). Sequences restart each year.
 */
export function nextSequenceNumber(
  existing: string[],
  year: number,
  alreadyIssued = 0,
): string {
  const prefix = `INV-${year}-`;
  let max = alreadyIssued;
  for (const n of existing) {
    if (!n.startsWith(prefix)) continue;
    const seq = Number(n.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  const used = new Set(existing);
  let next = max + 1;
  while (used.has(`${prefix}${String(next).padStart(4, "0")}`)) next++;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
