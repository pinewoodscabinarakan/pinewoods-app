import { createStore, ConflictError } from "./store.js";

// ---------- constants ----------
const CABINS = [
  { id: "summit",   name: "Summit",    short: "SUM", color: "var(--summit)",   commission: 500 },
  { id: "sunset",   name: "Sunset",    short: "SUN", color: "var(--sunset)",   commission: 500 },
  { id: "sunrise1", name: "Sunrise 1", short: "SR1", color: "var(--sunrise1)", commission: 200 },
  { id: "sunrise2", name: "Sunrise 2", short: "SR2", color: "var(--sunrise2)", commission: 300 },
];
const CABIN = Object.fromEntries(CABINS.map(c => [c.id, c]));
// Commission is a fixed amount per night for each cabin (the rates above). It is owed as soon as a
// stay is booked, even if the guest hasn't paid the full amount yet, and is split evenly between the
// two agents, as on the sheet's Income tab.
const AGENTS = ["Jecco", "Mikee"];
const EXPENSE_CATEGORIES = {
  "Sweldo": ["Nenet", "Dodong", "Ann", "Sunrise"],
  "Staff commission": ["Nenet", "Dodong", "Ann", "Sunrise"],
  "Electricity": ["Farm", "Ladislawa"],
  "Water": ["Farm", "Ladislawa"],
  "Gasul": [],
  "Travel": ["Mikee", "Jecco"],
  "Dental kits": [],
  "Loans": ["Condo", "BPI", "RCBC", "JCB"],
  "Subscriptions": ["Netflix", "Disney", "HBO", "Ads", "Internet"],
  "Misc.": [],
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ---------- date + money helpers (dates are local YYYY-MM-DD strings) ----------
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const mondayOf = s => { const d = parse(s); return addDays(s, -((d.getDay() + 6) % 7)); };
const monthKey = s => s.slice(0, 7);
const addMonths = (mk, n) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = mk => { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shortDate = s => { const d = parse(s); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
const longDate = s => { const d = parse(s); return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`; };
const daysIn = mk => { const [y, m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const peso = n => "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
const pesoK = n => n >= 1e6 ? "₱" + (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? "₱" + Math.round(n / 1000) + "K" : peso(n);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const remaining = b => b.complimentary ? 0 : Math.max(Number(b.total) - Number(b.down_payment), 0);
const isDue = b => remaining(b) > 0 && !b.balance_collected;
const income = list => list.reduce((s, b) => s + (b.complimentary ? 0 : Number(b.total)), 0);
const commission = list => list.reduce((s, b) => s + (b.complimentary ? 0 : Number(b.commission)), 0);
const sum = (list, k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);

// ---------- state ----------
let store;
const S = {
  bookings: [], expenses: [],
  tab: "home", month: monthKey(today()), week: mondayOf(today()),
  cabin: "all", calCabin: "all", search: "", money: "income",
};
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem("pinewoods-prefs")) || {}; } catch {}
if (["home", "calendar", "bookings", "money"].includes(prefs.tab)) S.tab = prefs.tab;
const savePrefs = () => { try { localStorage.setItem("pinewoods-prefs", JSON.stringify({ tab: S.tab })); } catch {} };

const app = document.getElementById("app");

// ---------- boot ----------
(async function boot() {
  try {
    store = await createStore();
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't start: ${esc(e.message)}</div>`;
    return;
  }
  store.onAuthChange(user => user ? start() : showLogin());
  (await store.currentUser()) ? start() : showLogin();
})();

let started = false;
async function start() {
  if (started) return;
  started = true;
  app.innerHTML = `<div class="loading">Loading bookings…</div>`;
  await reload();
  store.onChange(debounce(reload, 400));
}
async function reload() {
  try {
    [S.bookings, S.expenses] = await Promise.all([store.listBookings(), store.listExpenses()]);
    S.bookings.forEach(b => { b.total = Number(b.total); b.down_payment = Number(b.down_payment); b.commission = Number(b.commission); });
    S.expenses.forEach(e => { e.amount = Number(e.amount); });
    render();
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load data: ${esc(e.message)}</div>`;
  }
}
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

// ---------- login ----------
function showLogin() {
  started = false;
  app.innerHTML = `
  <div class="login"><form id="login-form">
    <img class="logo" src="icon.svg" alt="">
    <h1>Pinewoods</h1>
    <p>Sign in with the email the owner invited. We'll email you a sign-in link.</p>
    <label for="login-email">Email</label>
    <input id="login-email" type="email" required autocomplete="email" placeholder="you@example.com">
    <button class="btn primary" type="submit">Email me a sign-in link</button>
    <div id="login-msg"></div>
  </form></div>`;
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("login-msg"), btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await store.sendLoginLink(document.getElementById("login-email").value.trim());
      msg.innerHTML = `<p class="muted" style="margin-top:14px">Check your inbox and tap the link to open Pinewoods.</p>`;
    } catch (err) {
      msg.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

// ---------- shell ----------
const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bookings: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  money: '<path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/>',
};
const TABS = [["home", "Home"], ["calendar", "Calendar"], ["bookings", "Bookings"], ["money", "Money"]];

function render() {
  const scrollY = window.scrollY;
  const body = { home: viewHome, calendar: viewCalendar, bookings: viewBookings, money: viewMoney }[S.tab]();
  app.innerHTML = `
    <header class="appbar">
      <div class="appbar-row">${appbarContent()}</div>
      ${store.mode === "demo" ? `<div class="demo"><span>Demo mode: changes stay on this device only.</span><button data-act="reset-demo">Reset demo data</button></div>` : ""}
    </header>
    <main>${body}</main>
    ${S.tab === "money" && S.money === "expenses"
      ? `<button class="fab" data-act="new-expense">+ Expense</button>`
      : `<button class="fab" data-act="new-booking">+ Booking</button>`}
    <nav class="tabbar">${TABS.map(([id, label]) => `
      <button data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>${label}
      </button>`).join("")}
    </nav>`;
  window.scrollTo(0, scrollY);
}

function appbarContent() {
  if (S.tab === "calendar" && S.calCabin !== "all") {
    return `<h1>${CABIN[S.calCabin].name}</h1>
      <div class="stepper"><button data-act="month" data-n="-1" aria-label="Previous month">‹</button>
      <span>${monthLabel(S.month)}</span>
      <button data-act="month" data-n="1" aria-label="Next month">›</button></div>`;
  }
  if (S.tab === "calendar") {
    const end = addDays(S.week, 6);
    return `<h1>Calendar</h1>
      <div class="stepper"><button data-act="week" data-n="-1" aria-label="Previous week">‹</button>
      <span>${shortDate(S.week)} – ${shortDate(end)}</span>
      <button data-act="week" data-n="1" aria-label="Next week">›</button></div>`;
  }
  const title = { home: "Pinewoods", bookings: "Bookings", money: "Money" }[S.tab];
  return `<h1>${title}</h1>
    <div class="stepper"><button data-act="month" data-n="-1" aria-label="Previous month">‹</button>
    <span>${monthLabel(S.month)}</span>
    <button data-act="month" data-n="1" aria-label="Next month">›</button></div>`;
}

// ---------- views ----------
function bookingRow(b, { showCabin = false } = {}) {
  const d = parse(b.stay_date), c = CABIN[b.cabin];
  const status = b.complimentary ? `<span class="pill free">Free</span>`
    : isDue(b) ? `<span class="pill due">${peso(remaining(b))} due</span>`
    : `<span class="pill paid">Paid</span>`;
  const sub = [showCabin ? `<span class="cabin-tag" style="color:${c.color}">${c.name}</span>` : "",
    b.persons ? `${b.persons} pax` : "", b.complimentary ? "Complimentary" : `${peso(b.down_payment)} down`].filter(Boolean).join(" · ");
  return `<button class="row" data-booking="${b.id}">
    <div class="datechip">${d.getDate()}<small>${DOW[d.getDay()]}</small></div>
    <div><b>${esc(b.client_name)}</b><small>${sub}</small></div>
    <div class="right"><b class="num">${peso(b.complimentary ? 0 : b.total)}</b><br>${status}</div>
  </button>`;
}

function viewHome() {
  const inMonth = S.bookings.filter(b => monthKey(b.stay_date) === S.month);
  const year = S.month.slice(0, 4);
  const monthly = Array.from({ length: 12 }, (_, i) => income(S.bookings.filter(b => monthKey(b.stay_date) === `${year}-${pad(i + 1)}`)));
  const max = Math.max(...monthly, 1), sel = Number(S.month.slice(5)) - 1;
  const pts = monthly.map((v, i) => `${8 + i * (304 / 11)},${46 - v / max * 38}`);
  const nights = inMonth.length, capacity = CABINS.length * daysIn(S.month);
  const t = today();
  const due = S.bookings.filter(b => isDue(b) && b.stay_date >= addDays(t, -14)).sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const next = S.bookings.filter(b => b.stay_date >= t).sort((a, b) => a.stay_date.localeCompare(b.stay_date)).slice(0, 6);
  const byCabin = CABINS.map(c => { const l = inMonth.filter(b => b.cabin === c.id); return { c, nights: l.length, inc: income(l), com: commission(l) }; })
    .sort((a, b) => b.inc - a.inc);

  return `
  <section class="hero">
    <small>Income · ${monthLabel(S.month)}</small>
    <div class="big">${peso(income(inMonth))}</div>
    <div class="hero-stats">
      <div>Nights booked<b>${nights} of ${capacity}</b></div>
      <div>Occupancy<b>${Math.round(nights / capacity * 100)}%</b></div>
      <div>Commission<b>${peso(commission(inMonth))}</b></div>
    </div>
    <svg viewBox="0 0 320 58" width="100%" height="58" role="img" aria-label="Income by month, ${year}">
      <polyline points="${pts.join(" ")}" fill="none" stroke="rgba(247,239,217,.5)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${pts[sel].split(",")[0]}" cy="${pts[sel].split(",")[1]}" r="5" fill="var(--leaf)"/>
      ${MONTHS.map((m, i) => `<text x="${8 + i * (304 / 11)}" y="57" font-size="8" text-anchor="middle" fill="rgba(247,239,217,${i === sel ? 1 : .6})">${m[0]}</text>`).join("")}
    </svg>
  </section>

  <div class="section-label"><span>Balance due</span><span>${due.length ? peso(due.reduce((s, b) => s + remaining(b), 0)) : ""}</span></div>
  <div class="card">${due.length ? due.map(b => bookingRow(b, { showCabin: true })).join("") : `<div class="empty">Every guest is paid up.</div>`}</div>

  <div class="section-label"><span>Next check-ins</span></div>
  <div class="card">${next.length ? next.map(b => bookingRow(b, { showCabin: true })).join("") : `<div class="empty">No upcoming bookings yet.</div>`}</div>

  <div class="section-label"><span>By cabin · ${MONTHS[sel]}</span></div>
  <div class="card">${byCabin.map(({ c, nights, inc, com }) => `
    <div class="row"><i class="swatch" style="background:${c.color}"></i>
      <div><b>${c.name}</b><small>${nights} night${nights === 1 ? "" : "s"} · ${peso(com)} commission</small></div>
      <b class="num">${peso(inc)}</b></div>`).join("")}
  </div>`;
}

function viewCalendar() {
  const picker = `<div class="chips" role="group" aria-label="Calendar" style="margin-bottom:14px">
    <button class="chip" data-calcabin="all" aria-pressed="${S.calCabin === "all"}">All cabins</button>
    ${CABINS.map(c => `<button class="chip" data-calcabin="${c.id}" aria-pressed="${S.calCabin === c.id}">${c.name}</button>`).join("")}</div>`;
  return picker + (S.calCabin === "all" ? viewWeekBoard() : viewCabinMonth(CABIN[S.calCabin]));
}

// One cabin, one month: a regular month calendar, Monday first.
function viewCabinMonth(c) {
  const first = `${S.month}-01`, n = daysIn(S.month), t = today();
  const lead = (parse(first).getDay() + 6) % 7;
  const idx = new Map(S.bookings.filter(b => b.cabin === c.id && monthKey(b.stay_date) === S.month).map(b => [b.stay_date, b]));
  const list = [...idx.values()].sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<div></div>`);
  for (let day = 1; day <= n; day++) {
    const d = `${S.month}-${pad(day)}`, b = idx.get(d), cls = `${d < t ? "past" : ""} ${d === t ? "is-today" : ""}`;
    cells.push(b
      ? `<button class="mday booked ${isDue(b) ? "due" : ""} ${cls}" style="background-color:${c.color}" data-booking="${b.id}" aria-label="${esc(b.client_name)}, ${shortDate(d)}"><span class="dn">${day}</span><span class="gn">${esc(b.client_name)}</span></button>`
      : `<button class="mday ${cls}" data-add="${c.id}|${d}" aria-label="Book ${c.name} on ${shortDate(d)}"><span class="dn">${day}</span></button>`);
  }
  const inc = income(list), due = list.filter(isDue).reduce((s, b) => s + remaining(b), 0);
  return `
  <div class="mgrid">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<div class="mh">${d}</div>`).join("")}${cells.join("")}</div>
  <div class="legend"><span><i class="hatch"></i>Balance due</span><span>Tap an empty day to book it</span></div>
  <div class="totals">
    <div><small>Nights booked</small><b>${list.length} of ${n}</b></div>
    <div><small>Income</small><b>${pesoK(inc)}</b></div>
    <div><small>Still due</small><b>${pesoK(due)}</b></div>
  </div>
  <div class="section-label"><span>${c.name} · ${MONTHS[Number(S.month.slice(5)) - 1]}</span><span>${n - list.length} open night${n - list.length === 1 ? "" : "s"}</span></div>
  <div class="card">${list.length ? list.map(b => bookingRow(b)).join("") : `<div class="empty">No bookings for ${c.name} this month.</div>`}</div>`;
}

function viewWeekBoard() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.week, i));
  const t = today();
  const idx = new Map(S.bookings.map(b => [b.cabin + b.stay_date, b]));
  const week = S.bookings.filter(b => b.stay_date >= days[0] && b.stay_date <= days[6]).sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const free = CABINS.length * 7 - week.length;
  return `
  <div class="board">
    <div></div>
    ${days.map(d => { const x = parse(d); return `<div class="dh ${d === t ? "today" : ""}">${DOW[x.getDay()]}<b>${x.getDate()}</b></div>`; }).join("")}
    ${CABINS.map(c => `
      <div class="cl"><i style="background:${c.color}"></i>${c.name}</div>
      ${days.map(d => {
        const b = idx.get(c.id + d);
        if (!b) return `<button class="cell ${d < t ? "past" : ""}" data-add="${c.id}|${d}" aria-label="Book ${c.name} on ${shortDate(d)}">+</button>`;
        return `<button class="cell booked ${isDue(b) ? "due" : ""} ${d < t ? "past" : ""}" style="background-color:${c.color}" data-booking="${b.id}" aria-label="${esc(b.client_name)}, ${c.name}, ${shortDate(d)}">${esc(b.client_name.split(" ")[0])}</button>`;
      }).join("")}`).join("")}
  </div>
  <div class="legend"><span><i class="hatch"></i>Balance due</span><span>Tap an empty night to book it</span>
    <button class="chip" data-act="today" style="margin-left:auto">This week</button></div>

  <div class="section-label"><span>This week</span><span>${free} open night${free === 1 ? "" : "s"}</span></div>
  <div class="card">${week.length ? week.map(b => bookingRow(b, { showCabin: true })).join("") : `<div class="empty">Nothing booked this week.</div>`}</div>`;
}

function viewBookings() {
  const q = S.search.trim().toLowerCase();
  const list = S.bookings
    .filter(b => q ? b.client_name.toLowerCase().includes(q) : monthKey(b.stay_date) === S.month)
    .filter(b => S.cabin === "all" || b.cabin === S.cabin)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date) || a.cabin.localeCompare(b.cabin));
  const dueSum = list.filter(isDue).reduce((s, b) => s + remaining(b), 0);
  let lastMonth = "";
  const rows = list.map(b => {
    const mk = monthKey(b.stay_date), head = q && mk !== lastMonth ? `<div class="section-label"><span>${monthLabel(mk)}</span></div>` : "";
    lastMonth = mk;
    return (head ? `</div>${head}<div class="card">` : "") + bookingRow(b, { showCabin: S.cabin === "all" });
  }).join("");
  return `
  <div class="chips" role="group" aria-label="Cabin">
    <button class="chip" data-cabin="all" aria-pressed="${S.cabin === "all"}">All cabins</button>
    ${CABINS.map(c => `<button class="chip" data-cabin="${c.id}" aria-pressed="${S.cabin === c.id}">${c.name}</button>`).join("")}
  </div>
  <input class="search" id="search" type="search" placeholder="Search guests across all months" value="${esc(S.search)}" autocomplete="off">
  <div class="totals">
    <div><small>Nights</small><b>${list.length}</b></div>
    <div><small>Income</small><b>${pesoK(income(list))}</b></div>
    <div><small>Still due</small><b>${pesoK(dueSum)}</b></div>
  </div>
  <div class="section-label"><span>${q ? `Results for “${esc(S.search.trim())}”` : monthLabel(S.month)}</span></div>
  <div class="card">${list.length ? rows : `<div class="empty">${q ? "No guest by that name." : "No bookings this month."}</div>`}</div>`;
}

// Month-by-month figures, computed straight from the bookings and expenses.
// cabin = "all" counts everything; a cabin id counts only that cabin's bookings and expenses.
const forCabin = (list, cabin) => cabin === "all" ? list : list.filter(x => (x.cabin || "") === cabin);
function yearRows(year, cabin = "all") {
  const bookings = forCabin(S.bookings, cabin), expenses = forCabin(S.expenses, cabin);
  return Array.from({ length: 12 }, (_, i) => {
    const mk = `${year}-${pad(i + 1)}`;
    const bk = bookings.filter(b => monthKey(b.stay_date) === mk);
    const ex = expenses.filter(e => monthKey(e.spent_on) === mk);
    const inc = income(bk), com = commission(bk), exp = sum(ex, "amount");
    return { mk, i, bk, inc, com, exp, net: inc - com - exp,
      cab: Object.fromEntries(CABINS.map(c => [c.id, income(bk.filter(b => b.cabin === c.id))])) };
  });
}

function viewMoney() {
  const seg = `<div class="seg" role="group" aria-label="Money view">
    ${[["income", "Income"], ["expenses", "Expenses"], ["outcome", "Outcome"]].map(([id, l]) =>
      `<button data-money="${id}" aria-pressed="${S.money === id}">${l}</button>`).join("")}</div>`;
  const year = S.month.slice(0, 4), sel = Number(S.month.slice(5)) - 1;
  const rows = yearRows(year);
  const chips = `<div class="chips" role="group" aria-label="Cabin" style="margin-top:12px">
    <button class="chip" data-cabin="all" aria-pressed="${S.cabin === "all"}">All cabins</button>
    ${CABINS.map(c => `<button class="chip" data-cabin="${c.id}" aria-pressed="${S.cabin === c.id}">${c.name}</button>`).join("")}</div>`;
  const cabinName = S.cabin === "all" ? "All cabins" : CABIN[S.cabin].name;

  if (S.money === "income") {
    const totCab = Object.fromEntries(CABINS.map(c => [c.id, rows.reduce((s, r) => s + r.cab[c.id], 0)]));
    const totInc = rows.reduce((s, r) => s + r.inc, 0), totCom = rows.reduce((s, r) => s + r.com, 0);
    // commissions for the selected month next to the whole year, per cabin and per agent
    const yearBk = S.bookings.filter(b => b.stay_date.startsWith(year));
    const monthBk = yearBk.filter(b => monthKey(b.stay_date) === S.month);
    const unpaid = list => commission(list.filter(b => !b.commission_paid));
    const mon = MONTHS[sel].slice(0, 3);
    const comRow = (label, m, y, cls = "") => `<tr class="${cls}"><td>${label}</td><td>${m.toLocaleString("en-PH")}</td><td>${y.toLocaleString("en-PH")}</td></tr>`;
    return `${seg}
    <div class="section-label"><span>Income by cabin · ${year}</span></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Month</th>${CABINS.map(c => `<th>${c.short}</th>`).join("")}<th>Total</th><th>Comm.</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.i === sel ? "sel" : ""}"><td>${MONTHS[r.i].slice(0, 3)}</td>
        ${CABINS.map(c => `<td>${r.cab[c.id] ? r.cab[c.id].toLocaleString("en-PH") : "–"}</td>`).join("")}
        <td>${r.inc ? r.inc.toLocaleString("en-PH") : "–"}</td><td>${r.com ? r.com.toLocaleString("en-PH") : "–"}</td></tr>`).join("")}
        <tr class="tot"><td>Total</td>${CABINS.map(c => `<td>${totCab[c.id].toLocaleString("en-PH")}</td>`).join("")}
        <td>${totInc.toLocaleString("en-PH")}</td><td>${totCom.toLocaleString("en-PH")}</td></tr>
      </tbody></table></div>
    <div class="section-label"><span>Commissions by cabin</span></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Cabin</th><th>${mon} ${year}</th><th>All ${year}</th></tr></thead>
      <tbody>${CABINS.map(c => comRow(`<i class="swatch" style="background:${c.color};display:inline-block;vertical-align:-1px;margin-right:6px"></i>${c.name}`,
          commission(monthBk.filter(b => b.cabin === c.id)), commission(yearBk.filter(b => b.cabin === c.id)))).join("")}
        ${comRow("Total", commission(monthBk), commission(yearBk), "tot")}</tbody></table></div>
    <div class="section-label"><span>Agent commissions</span></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Agent</th><th>${mon} ${year}</th><th>All ${year}</th></tr></thead>
      <tbody>${AGENTS.map(a => comRow(a, commission(monthBk) / AGENTS.length, commission(yearBk) / AGENTS.length)).join("")}
        ${comRow("Not yet paid out", unpaid(monthBk), unpaid(yearBk), "tot")}</tbody></table></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Commission is fixed per night (Summit ₱500, Sunset ₱500, Sunrise 1 ₱200, Sunrise 2 ₱300) and counts as soon as a stay is booked, even if the guest still owes a balance. Each agent gets half. “Not yet paid out” is commission you haven't handed to the agents yet.</p>`;
  }

  if (S.money === "expenses") {
    const list = forCabin(S.expenses, S.cabin).filter(e => monthKey(e.spent_on) === S.month).sort((a, b) => a.spent_on.localeCompare(b.spent_on));
    const groups = Object.keys(EXPENSE_CATEGORIES).concat([...new Set(list.map(e => e.category))].filter(c => !(c in EXPENSE_CATEGORIES)))
      .map(cat => ({ cat, items: list.filter(e => e.category === cat) })).filter(g => g.items.length);
    const crow = yearRows(year, S.cabin)[sel];
    return `${seg}${chips}
    <div class="totals" style="grid-template-columns:1fr 1fr">
      <div><small>Expenses · ${MONTHS[sel]}</small><b>${peso(sum(list, "amount"))}</b></div>
      <div><small>Agent commissions</small><b>${peso(crow.com)}</b></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Jecco and Mikee's commissions come from bookings automatically, so don't enter them here.</p>
    ${groups.length ? groups.map(g => `
      <div class="section-label"><span>${esc(g.cat)}</span><span>${peso(sum(g.items, "amount"))}</span></div>
      <div class="card">${g.items.map(e => `<button class="row" data-expense="${e.id}">
        <div class="datechip">${parse(e.spent_on).getDate()}<small>${DOW[parse(e.spent_on).getDay()]}</small></div>
        <div><b>${esc(e.sub_category || e.category)}</b><small>${[e.cabin ? `<span class="cabin-tag" style="color:${CABIN[e.cabin].color}">${CABIN[e.cabin].name}</span>` : "Shared", esc(e.notes || "")].filter(Boolean).join(" · ")}</small></div>
        <b class="num">${peso(e.amount)}</b></button>`).join("")}</div>`).join("")
    : `<div class="section-label"><span>${monthLabel(S.month)}</span></div><div class="card"><div class="empty">No expenses entered for ${MONTHS[sel]}. Tap “+ Expense” to add one.</div></div>`}`;
  }

  // outcome, month by month for the chosen cabin
  const orows = yearRows(year, S.cabin);
  const tot = k => orows.reduce((s, r) => s + r[k], 0);
  const maxAbs = Math.max(...orows.map(r => Math.abs(r.net)), 1);
  const noExpenses = !S.expenses.some(e => e.spent_on.startsWith(year));
  return `${seg}${chips}
  <div class="section-label"><span>Cash surplus by month · ${cabinName} · ${year}</span></div>
  <div class="card" style="padding:12px">
    <svg viewBox="0 0 330 150" width="100%" role="img" aria-label="Monthly surplus ${year}">
      <line x1="34" x2="326" y1="120" y2="120" stroke="var(--line)"/>
      <text x="30" y="${123}" font-size="9" text-anchor="end" fill="var(--muted)">₱0</text>
      <text x="30" y="${19}" font-size="9" text-anchor="end" fill="var(--muted)">${pesoK(maxAbs)}</text>
      <line x1="34" x2="326" y1="16" y2="16" stroke="var(--line)" stroke-dasharray="2 3"/>
      ${orows.map(r => { const h = Math.abs(r.net) / maxAbs * 104, x = 40 + r.i * 24;
        return `<rect x="${x}" y="${r.net >= 0 ? 120 - h : 120}" width="16" height="${Math.max(h, r.net ? 1 : 0)}" rx="3" fill="${r.net < 0 ? "var(--bad)" : r.i === sel ? "var(--pine)" : "var(--summit)"}" opacity="${r.i === sel ? 1 : .55}"/>
        <text x="${x + 8}" y="136" font-size="9" text-anchor="middle" fill="var(--muted)">${MONTHS[r.i][0]}</text>`; }).join("")}
    </svg>
  </div>
  ${noExpenses ? `<div class="error" style="background:var(--due-bg);color:var(--due)">No expenses are entered for ${year} yet, so this surplus is too high. Add them under Expenses.</div>` : ""}
  ${S.cabin !== "all" ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Shared expenses that aren't tagged to a cabin only count under All cabins.</p>` : ""}
  <div class="section-label"><span>Outcome · ${cabinName} · ${year}</span></div>
  <div class="tablewrap"><table>
    <thead><tr><th>Month</th><th>Income</th><th>Comm.</th><th>Expenses</th><th>Surplus</th></tr></thead>
    <tbody>${orows.map(r => `<tr class="${r.i === sel ? "sel" : ""}"><td>${MONTHS[r.i].slice(0, 3)}</td>
      <td>${r.inc.toLocaleString("en-PH")}</td><td>${r.com.toLocaleString("en-PH")}</td><td>${r.exp.toLocaleString("en-PH")}</td>
      <td class="${r.net < 0 ? "neg" : ""}">${r.net.toLocaleString("en-PH")}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td>${tot("inc").toLocaleString("en-PH")}</td><td>${tot("com").toLocaleString("en-PH")}</td>
      <td>${tot("exp").toLocaleString("en-PH")}</td><td class="${tot("net") < 0 ? "neg" : "pos"}">${tot("net").toLocaleString("en-PH")}</td></tr>
    </tbody></table></div>`;
}

// ---------- bottom sheets ----------
function openSheet(html, onMount) {
  closeSheet();
  const el = document.createElement("div");
  el.className = "backdrop"; el.id = "sheet";
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  el.addEventListener("click", e => { if (e.target === el) closeSheet(); });
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
  onMount?.(el);
}
function closeSheet() { document.getElementById("sheet")?.remove(); document.body.style.overflow = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

function showBooking(id) {
  const b = S.bookings.find(x => x.id === id); if (!b) return;
  const c = CABIN[b.cabin];
  const status = b.complimentary ? `<span class="pill free">Complimentary</span>` : isDue(b) ? `<span class="pill due">Balance due</span>` : `<span class="pill paid">Paid</span>`;
  openSheet(`
    ${status}
    <h2>${esc(b.client_name)}</h2>
    <div class="muted" style="font-size:13.5px"><span style="color:${c.color};font-weight:600">${c.name}</span> · ${longDate(b.stay_date)}${b.persons ? ` · ${b.persons} persons` : ""}</div>
    ${b.phone ? `<div class="kv"><span>Phone</span><span style="user-select:all">${esc(b.phone)}</span></div>` : ""}
    <div class="kv"><span>Total</span><b class="num">${peso(b.complimentary ? 0 : b.total)}</b></div>
    <div class="kv"><span>Down payment</span><span class="num">${peso(b.down_payment)}</span></div>
    <div class="kv"><span>Remaining</span><b class="num" style="${isDue(b) ? "color:var(--due)" : ""}">${b.balance_collected && remaining(b) ? `${peso(remaining(b))} · collected` : peso(remaining(b))}</b></div>
    <div class="kv"><span>Commission</span><span class="num">${peso(b.commission)} · ${b.commission_paid ? "paid out" : "not paid out"}</span></div>
    ${b.notes ? `<div class="kv"><span>Notes</span><span>${esc(b.notes)}</span></div>` : ""}
    <div class="actions">
      ${remaining(b) ? `<button class="btn ${isDue(b) ? "accent" : ""}" data-sheet="toggle-collected">${isDue(b) ? "Mark balance collected" : "Undo balance collected"}</button>` : ""}
      ${b.commission ? `<button class="btn" data-sheet="toggle-commission">${b.commission_paid ? "Undo commission paid" : "Mark commission paid"}</button>` : ""}
      <button class="btn primary" data-sheet="edit">Edit</button>
      <button class="btn danger" data-sheet="delete">Delete</button>
    </div>`, el => {
    el.addEventListener("click", async e => {
      const act = e.target.closest("[data-sheet]")?.dataset.sheet; if (!act) return;
      if (act === "edit") return bookingForm(b);
      if (act === "delete") {
        e.target.outerHTML = `<button class="btn danger" data-sheet="confirm-delete">Tap again to delete</button>`; return;
      }
      if (act === "confirm-delete") { await guarded(() => store.deleteBooking(b.id), "Booking deleted"); return; }
      const patch = act === "toggle-collected" ? { balance_collected: !b.balance_collected } : { commission_paid: !b.commission_paid };
      await guarded(() => store.saveBookings([{ ...b, ...patch }]), "Saved");
    });
  });
}

async function guarded(fn, okMsg) {
  try { await fn(); closeSheet(); toast(okMsg); await reload(); }
  catch (e) { toast(e.message || "Something went wrong. Try again."); }
}

function bookingForm(b = null, preset = {}) {
  const v = b ?? { cabin: preset.cabin ?? "summit", stay_date: preset.date ?? today(), client_name: "", phone: "", persons: "",
    total: "", down_payment: "", complimentary: false, notes: "" };
  openSheet(`
    <h2>${b ? "Edit booking" : "New booking"}</h2>
    <form id="bf" novalidate>
      <label>Cabin</label>
      <div class="cabinpick">${CABINS.map(c => `<label><input type="radio" name="cabin" value="${c.id}" ${v.cabin === c.id ? "checked" : ""}><span>${c.name}</span></label>`).join("")}</div>
      <div class="grid2">
        <div><label for="bf-date">${b ? "Night" : "First night"}</label><input id="bf-date" name="stay_date" type="date" required value="${v.stay_date}"></div>
        ${b ? `<div><label for="bf-pax"># Persons</label><input id="bf-pax" name="persons" type="number" min="1" inputmode="numeric" value="${v.persons ?? ""}"></div>`
            : `<div><label for="bf-nights">Nights</label><input id="bf-nights" name="nights" type="number" min="1" max="30" value="1" inputmode="numeric"></div>`}
      </div>
      <label for="bf-client">Client</label><input id="bf-client" name="client_name" required autocomplete="off" value="${esc(v.client_name)}" list="bf-clients">
      <datalist id="bf-clients">${[...new Set(S.bookings.map(x => x.client_name))].sort().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="grid2">
        <div><label for="bf-phone">Phone</label><input id="bf-phone" name="phone" type="tel" value="${esc(v.phone || "")}"></div>
        ${b ? "" : `<div><label for="bf-pax"># Persons</label><input id="bf-pax" name="persons" type="number" min="1" inputmode="numeric" value="${v.persons ?? ""}"></div>`}
      </div>
      <div class="grid2">
        <div><label for="bf-total">Total per night (₱)</label><input id="bf-total" name="total" type="number" min="0" step="any" inputmode="decimal" value="${v.total}"></div>
        <div><label for="bf-down">Down payment (₱)</label><input id="bf-down" name="down_payment" type="number" min="0" step="any" inputmode="decimal" value="${v.down_payment}"></div>
      </div>
      <label class="check"><input type="checkbox" name="complimentary" ${v.complimentary ? "checked" : ""}> Complimentary stay (free)</label>
      <label for="bf-notes">Notes</label><textarea id="bf-notes" name="notes">${esc(v.notes || "")}</textarea>
      <div class="calc" id="bf-calc"></div>
      <div id="bf-err"></div>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${b ? "Save changes" : "Save booking"}</button></div>
    </form>`, el => {
    const f = el.querySelector("#bf");
    const val = () => Object.fromEntries(new FormData(f));
    const calc = () => {
      const x = val(), comp = f.complimentary.checked, nights = b ? 1 : Math.max(1, Number(x.nights) || 1);
      const tot = comp ? 0 : Number(x.total) || 0, down = Number(x.down_payment) || 0;
      el.querySelector("#bf-calc").innerHTML = `
        <div><span>Remaining${nights > 1 ? " (first night)" : ""}</span><b class="num">${peso(Math.max(tot - down, 0))}</b></div>
        ${nights > 1 ? `<div><span>${nights} nights total</span><b class="num">${peso(tot * nights)}</b></div>` : ""}
        <div><span>Commission (fixed, ${CABIN[x.cabin].name})</span><b class="num">${peso(comp ? 0 : CABIN[x.cabin].commission * nights)}</b></div>
        <div><span>Net to Pinewoods</span><b class="num">${peso((tot - (comp ? 0 : CABIN[x.cabin].commission)) * nights)}</b></div>`;
    };
    f.addEventListener("input", calc);
    f.addEventListener("change", calc);
    el.querySelector("[data-close]").addEventListener("click", closeSheet);
    calc();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const x = val(), err = el.querySelector("#bf-err");
      const fail = m => { err.innerHTML = `<div class="error">${esc(m)}</div>`; };
      if (!x.client_name.trim()) return fail("Enter the client's name.");
      if (!x.stay_date) return fail("Pick the night of the stay.");
      const comp = f.complimentary.checked;
      if (!comp && !(Number(x.total) > 0)) return fail("Enter the total per night, or tick Complimentary.");
      const nights = b ? 1 : Math.min(30, Math.max(1, Number(x.nights) || 1));
      const rows = Array.from({ length: nights }, (_, i) => ({
        ...(b ?? { balance_collected: false, commission_paid: false }),
        cabin: x.cabin, stay_date: addDays(x.stay_date, i), client_name: x.client_name.trim(), phone: x.phone.trim(),
        persons: x.persons ? Number(x.persons) : null, total: comp ? 0 : Number(x.total),
        // the down payment is recorded against the first night only
        down_payment: i === 0 ? Number(x.down_payment) || 0 : 0,
        commission: comp ? 0 : CABIN[x.cabin].commission, complimentary: comp, notes: x.notes.trim(),
      }));
      const clashes = rows.map(r => S.bookings.find(o => o.cabin === r.cabin && o.stay_date === r.stay_date && o.id !== b?.id)).filter(Boolean);
      if (clashes.length) return fail(`${CABIN[x.cabin].name} is already booked on ${clashes.map(c => `${shortDate(c.stay_date)} (${c.client_name})`).join(", ")}.`);
      f.querySelector("[type=submit]").disabled = true;
      try {
        await store.saveBookings(rows);
        closeSheet(); toast(b ? "Booking updated" : nights > 1 ? `${nights} nights booked` : "Booking saved");
        S.month = monthKey(rows[0].stay_date); S.week = mondayOf(rows[0].stay_date);
        await reload();
      } catch (e2) {
        f.querySelector("[type=submit]").disabled = false;
        fail(e2 instanceof ConflictError ? e2.message : `Couldn't save: ${e2.message}`);
      }
    });
  });
}

function expenseForm(x = null) {
  const v = x ?? { spent_on: S.month === monthKey(today()) ? today() : `${S.month}-01`, cabin: S.cabin === "all" ? "" : S.cabin, category: "Sweldo", sub_category: "", amount: "", notes: "" };
  const subOpts = cat => (EXPENSE_CATEGORIES[cat] || []).map(s => `<option ${s === v.sub_category ? "selected" : ""}>${s}</option>`).join("");
  openSheet(`
    <h2>${x ? "Edit expense" : "New expense"}</h2>
    <form id="xf" novalidate>
      <div class="grid2">
        <div><label for="xf-date">Date</label><input id="xf-date" name="spent_on" type="date" required value="${v.spent_on}"></div>
        <div><label for="xf-amt">Amount (₱)</label><input id="xf-amt" name="amount" type="number" min="0" step="any" inputmode="decimal" value="${v.amount}"></div>
      </div>
      <label for="xf-cabin">Cabin</label>
      <select id="xf-cabin" name="cabin"><option value="">Shared (whole resort)</option>${CABINS.map(c => `<option value="${c.id}" ${c.id === v.cabin ? "selected" : ""}>${c.name}</option>`).join("")}</select>
      <div class="grid2">
        <div><label for="xf-cat">Category</label><select id="xf-cat" name="category">${Object.keys(EXPENSE_CATEGORIES).map(c => `<option ${c === v.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label for="xf-sub">For</label><select id="xf-sub" name="sub_category"><option value="">—</option>${subOpts(v.category)}</select></div>
      </div>
      <label for="xf-notes">Notes</label><textarea id="xf-notes" name="notes">${esc(v.notes || "")}</textarea>
      <div id="xf-err"></div>
      <div class="actions">
        ${x ? `<button type="button" class="btn danger" data-del>Delete</button>` : `<button type="button" class="btn" data-close>Cancel</button>`}
        <button class="btn primary" type="submit">${x ? "Save changes" : "Save expense"}</button>
      </div>
    </form>`, el => {
    const f = el.querySelector("#xf");
    f.category.addEventListener("change", () => { f.sub_category.innerHTML = `<option value="">—</option>` + subOpts(f.category.value); });
    el.querySelector("[data-close]")?.addEventListener("click", closeSheet);
    el.querySelector("[data-del]")?.addEventListener("click", e => {
      if (e.target.dataset.armed) return guarded(() => store.deleteExpense(x.id), "Expense deleted");
      e.target.dataset.armed = "1"; e.target.textContent = "Tap again to delete";
    });
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!(Number(d.amount) > 0)) { el.querySelector("#xf-err").innerHTML = `<div class="error">Enter the amount spent.</div>`; return; }
      S.month = monthKey(d.spent_on);
      await guarded(() => store.saveExpense({ ...(x ?? {}), ...d, amount: Number(d.amount), notes: d.notes.trim() }), x ? "Expense updated" : "Expense saved");
    });
  });
}

// ---------- events ----------
app.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.tab) { S.tab = d.tab; savePrefs(); window.scrollTo(0, 0); return render(); }
  if (d.booking) return showBooking(Number(d.booking));
  if (d.expense) return expenseForm(S.expenses.find(x => x.id === Number(d.expense)));
  if (d.add) { const [cabin, date] = d.add.split("|"); return bookingForm(null, { cabin, date }); }
  if (d.cabin) { S.cabin = d.cabin; return render(); }
  if (d.calcabin) { S.calCabin = d.calcabin; return render(); }
  if (d.money) { S.money = d.money; return render(); }
  switch (d.act) {
    case "month": S.month = addMonths(S.month, Number(d.n)); return render();
    case "week": S.week = addDays(S.week, 7 * Number(d.n)); return render();
    case "today": S.week = mondayOf(today()); return render();
    case "new-booking": {
      if (S.tab !== "calendar") return bookingForm();
      if (S.calCabin === "all") return bookingForm(null, { date: S.week > today() ? S.week : today() });
      return bookingForm(null, { cabin: S.calCabin, date: S.month === monthKey(today()) ? today() : `${S.month}-01` });
    }
    case "new-expense": return expenseForm();
    case "reset-demo": store.reset(); location.reload(); return;
  }
});
app.addEventListener("input", e => {
  if (e.target.id !== "search") return;
  S.search = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const s = document.getElementById("search"); s.focus(); s.setSelectionRange(pos, pos);
});
