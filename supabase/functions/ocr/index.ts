// Supabase Edge Function "ocr": očitavanje natpisne pločice preko Claude API-ja.
// API ključ je tajna na serveru (ANTHROPIC_API_KEY) i nikad ne ide u preglednik.
// Postavljanje: vidi README.md → "Očitavanje pločice". Pri izradi isključiti "Verify JWT"
// (provjera prijave radi se ovdje, jer ugrađena provjera ne razumije nove ključeve).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `Na slici je natpisna pločica (ili natpis) kondenzatora. Pročitaj podatke i vrati ISKLJUČIVO JSON:
{
 "manufacturer": "proizvođač ili prazno",
 "cap_type": "tip/oznaka modela (kataloški broj)",
 "serial_no": "serijski broj (S/N, Ser. No., No.)",
 "cap_value": "nazivni kapacitet kao broj, decimalna točka (npr. \\"100\\", \\"3.3\\")",
 "cap_unit": "jedno od: pF, nF, µF, mF, F",
 "volt_value": "nazivni napon kao broj",
 "volt_unit": "V ili kV",
 "volt_kind": "AC, DC ili prazno (~ znači AC, = ili ⎓ znači DC)",
 "freq_value": "nazivna frekvencija u Hz kao broj (npr. \"50\"), prazno ako nije navedena",
 "power_kvar": "nazivna snaga u kVAr kao broj (ako piše u var ili MVAr, preračunaj u kVAr)",
 "energy_j": "energija u J (joule) kao broj (ako piše u kJ, preračunaj u J)",
 "phases": "broj faza: \"1\" ili \"3\" (1 Phase / single phase = 1, 3 Phase / three phase = 3)",
 "bil_kv": "razina izolacije AC/BIL u kV kako piše, bez jedinice (npr. \"50/125\")",
 "int_fuse": "unutarnji osigurači (Int. Fuse, internal fuses): \"da\", \"ne\" ili prazno",
 "weight_kg": "masa (Weight, Mass) u kg kao broj",
 "extra": "ostali važni podaci kratko, odvojeni ' · ' (tolerancija/DEV, temp. kategorija, dielektrik/punjenje, uređaj za pražnjenje, norma, datum proizvodnje, Rel.ID...) — bez podataka koji već imaju svoje polje",
 "notes": "na hrvatskom: što je nečitko ili nesigurno; prazno ako je sve jasno"
}
Pravila: ne izmišljaj — ako podatak ne postoji ili je nečitak, ostavi prazan string.
Ako ima više kapaciteta (npr. 3 × 50 µF ili više sekcija), u cap_value stavi vrijednost jedne jedinice/sekcije, a raspored opiši u extra.
Ako je naveden i ispitni napon, u volt_value stavi NAZIVNI (Un, rated), a ispitni u extra.`;

const num = (s: unknown) => (String(s ?? "").replace(/\s/g, "").replace(",", ".").match(/\d+(?:\.\d+)?/) || [""])[0];
function clean(d: Record<string, unknown>) {
  const g = (k: string) => String(d[k] ?? "").trim();
  const cu = g("cap_unit").replace("μ", "µ").replace(/^u/i, "µ").toLowerCase();
  const capUnit = ({ pf: "pF", nf: "nF", "µf": "µF", mf: "mF", f: "F" } as Record<string, string>)[cu] || (num(d.cap_value) ? "µF" : "");
  const vk = g("volt_kind").toUpperCase();
  return {
    manufacturer: g("manufacturer"), cap_type: g("cap_type"), serial_no: g("serial_no"),
    cap_value: num(d.cap_value), cap_unit: capUnit,
    volt_value: num(d.volt_value), volt_unit: g("volt_unit").toLowerCase() === "kv" ? "kV" : (num(d.volt_value) ? "V" : ""),
    volt_kind: vk.includes("AC") || vk.includes("~") ? "AC" : vk.includes("DC") ? "DC" : "",
    freq_value: num(d.freq_value), power_kvar: num(d.power_kvar), energy_j: num(d.energy_j),
    phases: ["1", "3"].includes(num(d.phases)) ? num(d.phases) : "",
    bil_kv: g("bil_kv").replace(/\s*kV$/i, ""),
    int_fuse: /^(da|yes|y|ja)$/i.test(g("int_fuse")) ? "da" : /^(ne|no|n|nein)$/i.test(g("int_fuse")) ? "ne" : "",
    weight_kg: num(d.weight_kg),
    extra: g("extra"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    // samo prijavljeni korisnici aplikacije (provjera tokena kod Supabase Auth)
    const auth = req.headers.get("Authorization") || "";
    const sbUrl = Deno.env.get("SUPABASE_URL"), sbKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const u = await fetch(`${sbUrl}/auth/v1/user`, { headers: { Authorization: auth, apikey: sbKey } });
    if (!auth.startsWith("Bearer ") || !u.ok) return new Response(JSON.stringify({ ok: false, error: "Niste prijavljeni." }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return reply({ ok: false, error: "Na serveru nije postavljen ANTHROPIC_API_KEY." });
    const { images } = await req.json();
    if (!Array.isArray(images) || !images.length) return reply({ ok: false, error: "Nema slike." });
    const content = images.slice(0, 3).map((b64: string) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
    content.push({ type: "text", text: PROMPT });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("OCR_MODEL") || "claude-sonnet-5-5", max_tokens: 1200, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) return reply({ ok: false, error: j?.error?.message || `Claude API ${r.status}` });
    const text = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return reply({ ok: false, error: "Model nije vratio podatke." });
    const raw = JSON.parse(m[0]);
    return reply({ ok: true, fields: clean(raw), notes: String(raw.notes || ""), raw: text.slice(0, 4000) });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error).message || e) });
  }
});
