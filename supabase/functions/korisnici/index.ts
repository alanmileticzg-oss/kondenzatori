// Supabase Edge Function "korisnici": upravljanje korisničkim računima iz aplikacije.
// Smije je koristiti samo prijavljeni administrator (tablica public.app_admins).
// Glavni (service role / secret) ključ postoji samo ovdje na serveru, nikad u pregledniku.
// Pri izradi isključiti "Verify JWT with legacy secret" — prijavu provjerava ova funkcija.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
function secretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const m = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return m.default || Object.values(m)[0] as string || "";
  } catch { return ""; }
}
const KEY = secretKey();
const adminHeaders = () => ({
  apikey: KEY,
  ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
  "Content-Type": "application/json",
});

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: { ...adminHeaders(), ...(init.headers || {}) } });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const m = String(data?.msg || data?.message || data?.error_description || data?.error || `Greška ${r.status}`);
    if (/already been registered|already exists/i.test(m)) throw new Error("Korisnik s tim e-mailom već postoji.");
    if (/password/i.test(m) && /weak|short|least/i.test(m)) throw new Error("Lozinka je preslaba: " + m);
    throw new Error(m);
  }
  return data;
}
const adminIds = async (): Promise<string[]> =>
  (await call("/rest/v1/app_admins?select=user_id")).map((r: { user_id: string }) => r.user_id);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!KEY) return reply({ ok: false, error: "Na serveru nije dostupan glavni ključ baze." });
    // 1) tko poziva?
    const auth = req.headers.get("Authorization") || "";
    const ur = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
    if (!auth.startsWith("Bearer ") || !ur.ok) return reply({ ok: false, error: "Niste prijavljeni." });
    const me = await ur.json();
    // 2) je li administrator?
    const admins = await adminIds();
    if (!admins.includes(me.id)) return reply({ ok: false, error: "Samo administrator može upravljati korisnicima." });

    const b = await req.json();
    const id = String(b.id || "");
    const self = id === me.id;

    switch (b.action) {
      case "list": {
        const d = await call("/auth/v1/admin/users?per_page=1000");
        const users = (d.users || d || []).map((u: any) => ({
          id: u.id, email: u.email, name: u.user_metadata?.full_name || "",
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
          blocked: !!(u.banned_until && new Date(u.banned_until) > new Date()),
          admin: admins.includes(u.id), me: u.id === me.id,
        }));
        return reply({ ok: true, users });
      }
      case "create": {
        const email = String(b.email || "").trim().toLowerCase();
        const password = String(b.password || "");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ ok: false, error: "Neispravan e-mail." });
        if (password.length < 8) return reply({ ok: false, error: "Lozinka mora imati barem 8 znakova." });
        const u = await call("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: String(b.name || "").trim() } }),
        });
        if (b.admin) await call("/rest/v1/app_admins", { method: "POST", body: JSON.stringify({ user_id: u.id }), headers: { Prefer: "resolution=ignore-duplicates" } });
        return reply({ ok: true, id: u.id });
      }
      case "password": {
        if (String(b.password || "").length < 8) return reply({ ok: false, error: "Lozinka mora imati barem 8 znakova." });
        await call(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ password: b.password }) });
        return reply({ ok: true });
      }
      case "name": {
        await call(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ user_metadata: { full_name: String(b.name || "").trim() } }) });
        return reply({ ok: true });
      }
      case "block": {
        if (self) return reply({ ok: false, error: "Ne možete blokirati sami sebe." });
        await call(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ ban_duration: b.blocked ? "876000h" : "none" }) });
        return reply({ ok: true });
      }
      case "admin": {
        if (self && !b.admin) return reply({ ok: false, error: "Ne možete sebi ukloniti administratorska prava." });
        if (b.admin) await call("/rest/v1/app_admins", { method: "POST", body: JSON.stringify({ user_id: id }), headers: { Prefer: "resolution=ignore-duplicates" } });
        else await call(`/rest/v1/app_admins?user_id=eq.${id}`, { method: "DELETE" });
        return reply({ ok: true });
      }
      case "delete": {
        if (self) return reply({ ok: false, error: "Ne možete obrisati sami sebe." });
        await call(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
        return reply({ ok: true });
      }
      default:
        return reply({ ok: false, error: "Nepoznata radnja." });
    }
  } catch (e) {
    return reply({ ok: false, error: String((e as Error).message || e) });
  }
});
