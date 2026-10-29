// Data-integrity check for the mock data of a /design-web project (run with: npx tsx check-mock.ts).
import * as m from "./src/lib/mock/index.ts";
const ids = (a: { id: string }[]) => new Set(a.map((x) => x.id));
const menu = ids(m.menuItems), ord = ids(m.orders), cust = ids(m.customers), st = ids(m.staff), tb = ids(m.tables), ing = ids(m.ingredients);
const bad: string[] = [];
for (const o of m.orders) { if (o.tableId && !tb.has(o.tableId)) bad.push("order.table " + o.code); if (o.customerId && !cust.has(o.customerId)) bad.push("order.cust " + o.code); if (!st.has(o.staffId)) bad.push("order.staff " + o.code);
  for (const it of o.items) if (!menu.has(it.menuItemId)) bad.push("order.item " + o.code + " " + it.menuItemId);
  const sub = o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0); if (sub !== o.subtotal || o.subtotal - o.discount !== o.total) bad.push(`order.math ${o.code} sub=${sub}/${o.subtotal} total=${o.total}`); }
for (const t of m.tables) if (t.currentOrderId && !ord.has(t.currentOrderId)) bad.push("table.order " + t.name);
for (const c of m.customers) if (!menu.has(c.favoriteItemId)) bad.push("cust.fav " + c.name);
for (const s of m.shifts) if (!st.has(s.staffId)) bad.push("shift.staff " + s.id);
for (const s of m.stockMovements) if (!ing.has(s.ingredientId)) bad.push("stock.ing " + s.id);
for (const t of m.topItems) if (!menu.has(t.menuItemId)) bad.push("top.item " + t.name);
const share = m.channelShare.reduce((s, c) => s + c.value, 0);
console.log({ menu: menu.size, orders: ord.size, tables: tb.size, ingredients: ing.size, staff: st.size, shifts: m.shifts.length, customers: cust.size, promotions: m.promotions.length, days: m.dailyRevenue.length, reviews: m.reviews.length, channelShareSum: share, kpis: m.kpis });
console.log(bad.length ? "PROBLEMS:\n" + bad.slice(0, 30).join("\n") : "ALL REFERENCES OK");
