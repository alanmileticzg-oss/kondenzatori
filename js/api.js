// Sloj za podatke: sve komunikacije sa Supabaseom su ovdje.
(function () {
  const K = window.KONFIG || {};
  const configured = !!(K.SUPABASE_URL && K.SUPABASE_KEY);
  // Novi "sb_publishable_…" ključevi smiju ići samo u zaglavlje apikey; kao "Bearer" ih
  // platforma pokušava čitati kao JWT. Zato ga uklanjamo iz Authorization (korisnički JWT ostaje).
  const isNewKey = /^sb_publishable_/.test(K.SUPABASE_KEY || "");
  function safeFetch(input, init = {}) {
    if (isNewKey) {
      const hd = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (hd.get("Authorization") === "Bearer " + K.SUPABASE_KEY) hd.delete("Authorization");
      init = { ...init, headers: hd };
    }
    return fetch(input, init);
  }
  const sb = configured ? window.supabase.createClient(K.SUPABASE_URL, K.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: safeFetch },
  }) : null;

  const BUCKET = "slike";
  let me = null;
  let admin = false;
  async function loadAdmin() {
    try { const { data } = await sb.rpc("is_admin"); admin = data === true; } catch (e) { admin = false; }
  }

  function ok({ data, error }) {
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  function who(u) {
    if (!u) return null;
    const m = u.user_metadata || {};
    return { id: u.id, email: u.email, name: m.full_name || m.name || (u.email || "").split("@")[0] };
  }

  const API = {
    configured,

    // ---------------- prijava
    async session() {
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      me = who(data.session && data.session.user);
      if (me) await loadAdmin();
      return me;
    },
    me: () => me,
    isAdmin: () => admin,
    async users(action, body = {}) {
      const { data, error } = await sb.functions.invoke("korisnici", { body: { action, ...body } });
      if (error) throw new Error(error.message || "Funkcija za korisnike nije dostupna.");
      if (!data || !data.ok) throw new Error((data && data.error) || "Nepoznata greška.");
      return data;
    },
    async signIn(email, password) {
      const r = await sb.auth.signInWithPassword({ email, password });
      me = who(ok(r).user);
      await loadAdmin();
      return me;
    },
    async signOut() { await sb.auth.signOut(); me = null; admin = false; },
    async resetPassword(email, redirectTo) {
      ok(await sb.auth.resetPasswordForEmail(email, { redirectTo }));
    },
    async setPassword(password, fullName) {
      const attrs = { password };
      if (fullName) attrs.data = { full_name: fullName };
      me = who(ok(await sb.auth.updateUser(attrs)).user);
      return me;
    },
    async setName(fullName) {
      me = who(ok(await sb.auth.updateUser({ data: { full_name: fullName } })).user);
      return me;
    },

    // ---------------- projekti
    async projects(filter) {
      let q = sb.from("projects_v").select("*").order("created_at", { ascending: false });
      if (filter === "otvoreni") q = q.eq("closed", false);
      if (filter === "zakljuceni") q = q.eq("closed", true);
      if (filter === "nefakturirani") q = q.eq("closed", true).eq("invoiced", false);
      return ok(await q);
    },
    async project(id) {
      return ok(await sb.from("projects_v").select("*").eq("id", id).maybeSingle());
    },
    async projectByName(name) {
      return ok(await sb.from("projects").select("id").eq("name", name).maybeSingle());
    },
    async createProject(fields) {
      const ex = await API.projectByName(fields.name);
      if (ex) return ex.id;
      return ok(await sb.from("projects").insert(fields).select("id").single()).id;
    },
    async deleteProject(id) {
      // najprije fotografije iz pohrane, zatim kondenzatori (povijest i zapisi slika brišu se kaskadno) i projekt
      const caps = ok(await sb.from("capacitors").select("id").eq("project_id", id)).map((c) => c.id);
      if (caps.length) {
        const paths = ok(await sb.from("photos").select("path").in("capacitor_id", caps)).map((p) => p.path);
        for (let i = 0; i < paths.length; i += 100) ok(await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)));
      }
      ok(await sb.rpc("delete_project", { p_id: id }));
    },
    async updateProject(id, fields) {
      ok(await sb.from("projects").update(fields).eq("id", id));
    },

    // ---------------- kondenzatori
    async cap(code) {
      return ok(await sb.from("caps_v").select("*").eq("code", code).maybeSingle());
    },
    async caps(f = {}) {
      let q = sb.from("caps_v").select("*").order("code");
      if (f.project) q = q.eq("project_id", f.project);
      if (f.status) q = q.eq("status", f.status);
      if (f.disposition) q = q.eq("disposition", f.disposition);
      if (f.cmin != null) q = q.gte("capacitance_uf", f.cmin);
      if (f.cmax != null) q = q.lte("capacitance_uf", f.cmax);
      if (f.umin != null) q = q.gte("voltage_v", f.umin);
      if (f.umax != null) q = q.lte("voltage_v", f.umax);
      if (f.test) q = q.ilike("tests", `%${f.test}%`);
      if (f.q) {
        const s = f.q.replace(/[,()%]/g, " ").trim();
        q = q.or(["code", "manufacturer", "cap_type", "serial_no", "extra", "project_name", "location"]
          .map((c) => `${c}.ilike.%${s}%`).join(","));
      }
      return ok(await q);
    },
    async unusedLabels() {
      return ok(await sb.from("capacitors").select("code").eq("status", "rezerviran").order("code"));
    },
    async statusCounts() {
      const sts = ["rezerviran", "zaprimljen", "u_ispitivanju", "zavrsen"];
      const res = await Promise.all(sts.map((st) => sb.from("capacitors").select("id", { count: "exact", head: true }).eq("status", st)));
      const out = {};
      res.forEach((r, i) => { if (r.error) throw new Error(r.error.message); out[sts[i]] = r.count || 0; });
      return out;
    },
    async capsByCodes(codes) {
      if (!codes.length) return [];
      return ok(await sb.from("caps_v").select("code,project_name").in("code", codes));
    },
    async saveCap(code, fields) {
      // novi ili rezervirani (naljepnica ispisana) -> upis podataka
      const ex = ok(await sb.from("capacitors").select("id").eq("code", code).maybeSingle());
      if (ex) {
        ok(await sb.from("capacitors").update(fields).eq("id", ex.id));
        return ex.id;
      }
      return ok(await sb.from("capacitors").insert({ code, ...fields }).select("id").single()).id;
    },
    async updateCap(id, fields) {
      ok(await sb.from("capacitors").update(fields).eq("id", id));
    },
    async reserveCodes(projectId, n) {
      return ok(await sb.rpc("reserve_codes", { p_project: projectId, p_count: n }));
    },

    // ---------------- događaji i slike
    async addEvent(capId, kind, testType, note) {
      return ok(await sb.from("events").insert({
        capacitor_id: capId, kind, test_type: testType || null, note: note || "",
        user_name: me ? me.name : "",
      }).select("id").single()).id;
    },
    async events(capId) {
      return ok(await sb.from("events").select("*").eq("capacitor_id", capId).order("id", { ascending: false }));
    },
    async recentEvents(limit = 15) {
      return ok(await sb.from("events_v").select("*").order("id", { ascending: false }).limit(limit));
    },
    async allEvents() {
      return ok(await sb.from("events_v").select("*").order("id", { ascending: false }));
    },
    async photos(capId) {
      return ok(await sb.from("photos").select("*").eq("capacitor_id", capId).order("id"));
    },
    async uploadPhoto(capId, code, eventId, blob, kind) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const path = `${code}/${stamp}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      ok(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" }));
      ok(await sb.from("photos").insert({ capacitor_id: capId, event_id: eventId, path, kind }));
      return path;
    },
    async signedUrls(paths) {
      const uniq = [...new Set(paths.filter(Boolean))];
      if (!uniq.length) return {};
      const data = ok(await sb.storage.from(BUCKET).createSignedUrls(uniq, 3600));
      const out = {};
      data.forEach((d) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
      return out;
    },

    // ---------------- vrste ispitivanja
    async testTypes(all) {
      let q = sb.from("test_types").select("*").order("id");
      if (!all) q = q.eq("active", true);
      return ok(await q);
    },
    async addTestType(name) {
      ok(await sb.from("test_types").upsert({ name, active: true }, { onConflict: "name" }));
    },
    async setTestType(id, active) {
      ok(await sb.from("test_types").update({ active }).eq("id", id));
    },

    // ---------------- očitavanje pločice (Edge funkcija "ocr")
    async ocr(images) {
      const { data, error } = await sb.functions.invoke("ocr", { body: { images } });
      if (error) throw new Error(error.message || "OCR nije uspio");
      return data;
    },
  };

  window.API = API;
})();
