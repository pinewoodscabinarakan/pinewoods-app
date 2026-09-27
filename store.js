// Data layer. Two backends with the same interface:
//   Supabase (shared team data, sign-in required) when config.js is filled in,
//   Demo (this browser's localStorage, seeded from the 2026 sheet) otherwise.
import * as config from "./config.js";
const { SUPABASE_URL, SUPABASE_ANON_KEY } = config;
export const TEAM_EMAIL = config.TEAM_EMAIL || "";

export class ConflictError extends Error {}

export async function createStore() {
  // Read before the Supabase client consumes the link: invite/reset links arrive as #...&type=invite|recovery.
  const linkType = new URLSearchParams(location.hash.slice(1)).get("type");
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return new SupabaseStore(await supabaseClient(), linkType);
  // The 2026 client data is kept out of the public site; demo mode starts empty without it.
  const seed = await import("./data/seed.js").catch(() => ({ SEED_BOOKINGS: [] }));
  return new DemoStore(seed);
}

async function supabaseClient() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const BOOKING_FIELDS = ["cabin", "stay_date", "client_name", "phone", "persons", "total", "down_payment",
  "commission", "complimentary", "balance_collected", "commission_paid", "notes"];
const EXPENSE_FIELDS = ["spent_on", "cabin", "category", "sub_category", "amount", "notes"];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

class SupabaseStore {
  mode = "team";
  constructor(sb, linkType) { this.sb = sb; this.fromLink = ["invite", "recovery", "magiclink", "signup"].includes(linkType); }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user ?? null;
  }
  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid login/i.test(error.message)
      ? "That password isn't right. Ask the owner for the team password." : error.message);
  }
  // Arriving from an invite or reset email means it's time to choose the team password.
  needsPassword() { return this.fromLink; }
  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    this.fromLink = false;
  }
  async sendLoginLink(email) {
    const { error } = await this.sb.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(error.message.includes("Signups not allowed")
      ? "That email isn't on the team yet. Ask the owner to invite you." : error.message);
  }
  onAuthChange(cb) { this.sb.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null)); }
  async signOut() { await this.sb.auth.signOut(); }

  async #all(table, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from(table).select("*").order(order).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  listBookings() { return this.#all("bookings", "stay_date"); }
  listExpenses() { return this.#all("expenses", "spent_on"); }

  async saveBookings(rows) {
    for (const r of rows) {
      const q = r.id
        ? this.sb.from("bookings").update(pick(r, BOOKING_FIELDS)).eq("id", r.id)
        : this.sb.from("bookings").insert(pick(r, BOOKING_FIELDS));
      const { error } = await q;
      if (error?.code === "23505") throw new ConflictError(`${r.stay_date} is already booked for that cabin.`);
      if (error) throw error;
    }
  }
  async deleteBooking(id) { const { error } = await this.sb.from("bookings").delete().eq("id", id); if (error) throw error; }
  async saveExpense(e) {
    const q = e.id ? this.sb.from("expenses").update(pick(e, EXPENSE_FIELDS)).eq("id", e.id)
                   : this.sb.from("expenses").insert(pick(e, EXPENSE_FIELDS));
    const { error } = await q; if (error) throw error;
  }
  async deleteExpense(id) { const { error } = await this.sb.from("expenses").delete().eq("id", id); if (error) throw error; }

  onChange(cb) {
    this.sb.channel("pinewoods")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, cb)
      .subscribe();
  }
}

const DEMO_KEY = "pinewoods-demo-v1";

class DemoStore {
  mode = "demo";
  constructor({ SEED_BOOKINGS }) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch {}
    this.db = saved ?? {
      nextId: SEED_BOOKINGS.length + 1,
      bookings: SEED_BOOKINGS.map((b, i) => ({ id: i + 1, phone: "", ...b })),
      expenses: [],
    };
  }
  #persist() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch {} }
  async currentUser() { return { email: "demo" }; }
  onAuthChange() {}
  needsPassword() { return false; }
  async signOut() {}
  async listBookings() { return structuredClone(this.db.bookings); }
  async listExpenses() { return structuredClone(this.db.expenses); }
  async saveBookings(rows) {
    for (const r of rows) {
      const clash = this.db.bookings.find(b => b.cabin === r.cabin && b.stay_date === r.stay_date && b.id !== r.id);
      if (clash) throw new ConflictError(`${r.stay_date} is already booked for that cabin (${clash.client_name}).`);
    }
    for (const r of rows) {
      const clean = pick(r, BOOKING_FIELDS);
      if (r.id) Object.assign(this.db.bookings.find(b => b.id === r.id), clean);
      else this.db.bookings.push({ id: this.db.nextId++, ...clean });
    }
    this.#persist();
  }
  async deleteBooking(id) { this.db.bookings = this.db.bookings.filter(b => b.id !== id); this.#persist(); }
  async saveExpense(e) {
    const clean = pick(e, EXPENSE_FIELDS);
    if (e.id) Object.assign(this.db.expenses.find(x => x.id === e.id), clean);
    else this.db.expenses.push({ id: this.db.nextId++, ...clean });
    this.#persist();
  }
  async deleteExpense(id) { this.db.expenses = this.db.expenses.filter(x => x.id !== id); this.#persist(); }
  onChange() {}
  reset() { try { localStorage.removeItem(DEMO_KEY); } catch {} }
}
