// Praćenje kondenzatora — sučelje (GitHub Pages + Supabase)
(function () {
  "use strict";
  const K = window.KONFIG || {};
  const app = document.getElementById("app");

  // ------------------------------------------------------------------ konstante
  const STATUS = { rezerviran: "Naljepnica ispisana", zaprimljen: "Zaprimljen", u_ispitivanju: "U ispitivanju", zavrsen: "Završen" };
  const DISPOSITION = { teardown: "Teardown", zbrinjavanje: "Zbrinjavanje (otpad)", spremanje: "Spremanje" };
  const EVENT_KIND = { dolazak: "Zaprimanje", pokus: "Ispitivanje", napomena: "Napomena", zavrsetak: "Završni korak", izmjena: "Izmjena podataka" };
  const CAP_UNITS = { pF: 1e-6, nF: 1e-3, "µF": 1, mF: 1e3, F: 1e6 };
  const VOLT_UNITS = { V: 1, kV: 1e3 };

  // ------------------------------------------------------------------ pomoćne
  const h = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  // datumi se prikazuju kao yyyy/mm/dd
  const p2 = (n) => String(n).padStart(2, "0");
  const fmtTs = (t) => { if (!t) return ""; const d = new Date(t); return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const fmtD = (d) => (d ? String(d).slice(0, 10).replace(/-/g, "/") : "");
  // polje za datum u obliku yyyy/mm/dd (tekst + kalendar); pod imenom name šalje se ISO datum
  const parseYmd = (v) => {
    const m = String(v).trim().match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\.?$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${p2(mo)}-${p2(d)}` : null;
  };
  const dateIn = (name, iso, extra = "") => `<span class="dfield"><input type="text" class="dtext" value="${fmtD(iso)}" placeholder="yyyy/mm/dd" inputmode="numeric" autocomplete="off" ${extra}><span class="dpick" aria-hidden="true">📅</span><input type="date" class="dnat" tabindex="-1" aria-label="Kalendar" value="${iso || ""}" ${extra}><input type="hidden" name="${name}" value="${iso || ""}" ${extra}></span>`;
  document.addEventListener("input", (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains("dtext")) return;
    const w = t.closest(".dfield"), v = t.value.trim(), iso = v ? parseYmd(v) : "";
    t.setCustomValidity(iso === null ? "Datum upišite u obliku yyyy/mm/dd, npr. 2026/11/09" : "");
    w.querySelector("input[type=hidden]").value = iso || ""; w.querySelector(".dnat").value = iso || "";
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains("dnat")) return;
    const w = t.closest(".dfield"), x = w.querySelector(".dtext");
    w.querySelector("input[type=hidden]").value = t.value; x.value = fmtD(t.value); x.setCustomValidity("");
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains("dnat")) return;
    try { t.showPicker(); } catch (_) { /* preglednik sam otvara kalendar */ }
  });
  const num = (s) => { s = String(s == null ? "" : s).replace(/\s/g, "").replace(",", "."); if (!s) return null; const n = Number(s); return isFinite(n) ? n : null; };
  const fmtCap = (uF) => { if (uF == null) return ""; for (const [u, f] of [["F", 1e6], ["mF", 1e3], ["µF", 1], ["nF", 1e-3], ["pF", 1e-6]]) if (Math.abs(uF) >= f) return `${+(uF / f).toPrecision(6)} ${u}`; return `${uF} µF`; };
  const fmtVolt = (V) => (V == null ? "" : V >= 1000 ? `${+(V / 1000).toPrecision(6)} kV` : `${+V.toPrecision(6)} V`);
  const pill = (st) => `<span class="pill ${h(st)}">${h(STATUS[st] || st)}</span>`;
  const baseUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");
  const qrUrl = (code) => `${baseUrl()}?k=${encodeURIComponent(code)}`;
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const flash = (msg, kind = "ok") => sessionStorage.setItem("flash", JSON.stringify([kind, msg]));
  const params = () => new URLSearchParams((location.hash.split("?")[1]) || "");

  // smanjivanje fotografija (max 2000 px, JPEG)
  async function shrink(file, max = 2000, q = 0.85) {
    if (!file.type || !file.type.startsWith("image/")) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      return blob || file;
    } catch (e) { return file; }
  }
  const toB64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });

  // zajedničko slanje obrasca: gumb "Šaljem…", greška ostaje na stranici
  function onSubmit(form, fn) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit],button:not([type])");
      const old = btn && btn.textContent;
      if (btn) { btn.disabled = true; btn.textContent = "Šaljem…"; }
      form.classList.add("loading");
      try { await fn(new FormData(form), form); }
      catch (err) { showError(err, form); }
      finally { form.classList.remove("loading"); if (btn) { btn.disabled = false; btn.textContent = old; } }
    });
  }
  function showError(err, where) {
    console.error(err);
    const d = document.createElement("div");
    d.className = "flash err";
    d.textContent = "Greška: " + (err && err.message || err);
    (where || app).prepend(d);
    d.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ------------------------------------------------------------------ okvir stranice
  function page(html, narrow) {
    const me = API.me();
    const r = location.hash.split("?")[0];
    const nav = [["#/", "Projekti"], ["#/kondenzatori", "Kondenzatori"], ["#/naljepnice", "Naljepnice"], ["#/skeniraj", "Skeniranje"], ...(API.isAdmin() ? [["#/korisnici", "Korisnici"]] : []), ["#/postavke", "Postavke"]];
    let f = sessionStorage.getItem("flash"); sessionStorage.removeItem("flash");
    f = f ? JSON.parse(f) : null;
    document.body.className = "";
    app.innerHTML = `<header><a class="brand" href="#/">⚡ ${h(K.NAZIV || "Kondenzatori")}</a>
      ${nav.map(([u, t]) => `<a href="${u}" class="${(r || "#/") === u ? "nav-on" : ""}${u === "#/postavke" || u === "#/korisnici" ? " hide-m" : ""}">${t}</a>`).join("")}
      <a class="who" href="#/postavke">${h(me ? me.name : "")}</a></header>
      <main class="${narrow ? "narrow" : ""}">${f ? `<div class="flash ${h(f[0])}">${h(f[1])}</div>` : ""}${html}</main>`;
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ prijava
  function viewSetup() {
    document.body.className = "";
    app.innerHTML = `<main class="narrow"><div class="card"><h1>Aplikacija još nije povezana s bazom</h1>
      <p>U datoteku <code>config.js</code> upišite <b>SUPABASE_URL</b> i <b>SUPABASE_KEY</b> (Supabase → Project Settings → API). Vidi README.md.</p></div></main>`;
  }

  function viewLogin() {
    document.body.className = "";
    app.innerHTML = `<div class="center"><form class="card login" id="f"><h1>⚡ Prijava</h1>
      <label>E-mail</label><input name="email" type="email" autocomplete="username" required autofocus>
      <label>Lozinka</label><input name="password" type="password" autocomplete="current-password" required>
      <button class="big">Prijavi se</button>
      <p class="small" style="margin-top:14px"><a href="#" id="forgot">Zaboravljena lozinka?</a></p>
      <p class="muted small">Račun otvara administrator (poziv stiže e-mailom). Prijava se pamti na uređaju.</p></form></div>`;
    onSubmit($("#f"), async (fd) => {
      await API.signIn(fd.get("email").trim(), fd.get("password"));
      const back = sessionStorage.getItem("afterLogin") || "#/";
      sessionStorage.removeItem("afterLogin");
      go(back);
    });
    $("#forgot").onclick = async (e) => {
      e.preventDefault();
      const email = $("#f").email.value.trim();
      if (!email) { showError("Upišite e-mail pa kliknite ponovno.", $("#f")); return; }
      try { await API.resetPassword(email, baseUrl()); alert("Poslan je e-mail s poveznicom za novu lozinku."); }
      catch (err) { showError(err, $("#f")); }
    };
  }

  function viewSetPassword() {
    const me = API.me();
    document.body.className = "";
    app.innerHTML = `<div class="center"><form class="card login" id="f"><h1>Postavite lozinku</h1>
      <p class="muted">${h(me ? me.email : "")}</p>
      <label>Ime i prezime (prikazuje se uz unose)</label><input name="name" value="${h(me && me.name && !me.name.includes("@") ? me.name : "")}" required>
      <label>Nova lozinka (min. 8 znakova)</label><input name="p1" type="password" minlength="8" autocomplete="new-password" required>
      <label>Ponovite lozinku</label><input name="p2" type="password" minlength="8" autocomplete="new-password" required>
      <button class="big">Spremi</button></form></div>`;
    onSubmit($("#f"), async (fd) => {
      if (fd.get("p1") !== fd.get("p2")) throw new Error("Lozinke se ne podudaraju.");
      await API.setPassword(fd.get("p1"), fd.get("name").trim());
      flash("Lozinka spremljena.");
      go("#/");
    });
  }

  // ------------------------------------------------------------------ mobilni: skeniranje
  async function viewScan() {
    const ev = await API.recentEvents(15);
    page(`<div class="card"><h1>Skeniranje</h1>
      <p class="muted">Usmjerite kameru mobitela na QR kod na kondenzatoru — stranica kondenzatora otvara se sama.
      Ako kod nije čitljiv, upišite broj:</p>
      <form id="f"><div class="row"><input name="q" placeholder="npr. K00012 ili 12" autocapitalize="characters"><button class="u">Otvori</button></div></form></div>
      <div class="card"><h2>Zadnji unosi</h2><ul class="timeline">
      ${ev.map((e) => `<li><a class="code" href="#/k/${h(e.code)}">${h(e.code)}</a> · ${h(EVENT_KIND[e.kind])}${e.test_type ? `: <b>${h(e.test_type)}</b>` : ""}
        <div class="t">${fmtTs(e.ts)} · ${h(e.project_name || "")} · ${h(e.user_name || "")}</div></li>`).join("") || `<li class="muted">Još nema unosa.</li>`}
      </ul></div>`, true);
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      let q = e.target.q.value.trim().toUpperCase();
      if (/^\d+$/.test(q)) q = "K" + q.padStart(5, "0");
      if (q) go("#/k/" + q);
    };
  }

  // ------------------------------------------------------------------ natpisna pločica (polja)
  function nameplateFields(c) {
    const cv = c && c.cap_text ? c.cap_text.split(" ") : ["", "µF"];
    const vv = c && c.volt_text ? c.volt_text.split(" ") : ["", "V"];
    const sel = (name, opts, cur) => `<select class="u" name="${name}">${opts.map((o) => `<option ${o === cur ? "selected" : ""}>${h(o)}</option>`).join("")}</select>`;
    return `<div class="row"><div><label>Proizvođač</label><input name="manufacturer" value="${h(c && c.manufacturer)}"></div>
      <div><label>Tip / oznaka</label><input name="cap_type" value="${h(c && c.cap_type)}"></div></div>
      <label>Serijski broj</label><input name="serial_no" value="${h(c && c.serial_no)}">
      <label>Kapacitet</label><div class="row"><input name="cap_value" inputmode="decimal" value="${h(cv[0])}" placeholder="npr. 100">${sel("cap_unit", Object.keys(CAP_UNITS), cv[1] || "µF")}</div>
      <label>Nazivni napon</label><div class="row"><input name="volt_value" inputmode="decimal" value="${h(vv[0])}" placeholder="npr. 1100">${sel("volt_unit", Object.keys(VOLT_UNITS), vv[1] || "V")}${sel("volt_kind", ["", "AC", "DC"], (c && c.volt_kind) || "")}</div>
      <label>Nazivna frekvencija [Hz]</label><div class="row"><input name="freq_value" inputmode="decimal" value="${h(c && c.frequency_hz != null ? c.frequency_hz : "")}" placeholder="npr. 50 (prazno za DC)" list="freqs"><span class="u" style="align-self:center;color:var(--mut)">Hz</span></div>
      <datalist id="freqs"><option value="50"><option value="60"><option value="16.7"><option value="400"></datalist>
      <label>Ostalo s pločice (tolerancija, temp., norma…)</label><input name="extra" value="${h(c && c.extra)}">`;
  }
  function nameplateFromForm(fd) {
    const cv = num(fd.get("cap_value")), vv = num(fd.get("volt_value"));
    const cu = fd.get("cap_unit") || "µF", vu = fd.get("volt_unit") || "V";
    return {
      manufacturer: (fd.get("manufacturer") || "").trim(), cap_type: (fd.get("cap_type") || "").trim(),
      serial_no: (fd.get("serial_no") || "").trim(), extra: (fd.get("extra") || "").trim(),
      capacitance_uf: cv == null ? null : +(cv * CAP_UNITS[cu]).toPrecision(12), cap_text: cv == null ? "" : `${String(fd.get("cap_value")).trim()} ${cu}`,
      voltage_v: vv == null ? null : +(vv * VOLT_UNITS[vu]).toPrecision(12), volt_text: vv == null ? "" : `${String(fd.get("volt_value")).trim()} ${vu}`,
      volt_kind: fd.get("volt_kind") || "",
      frequency_hz: num(fd.get("freq_value")),
    };
  }
  async function uploadAll(capId, code, eventId, input, kind) {
    for (const f of input ? [...input.files] : []) await API.uploadPhoto(capId, code, eventId, await shrink(f), kind);
  }
  const photoInput = (id, capture) => `<div class="upl"><input ${id ? `id="${id}"` : ""} type="file" name="photos" accept="image/*" ${capture ? 'capture="environment"' : ""} multiple><small></small></div>`;
  function wireFileCounters() {
    $$("input[type=file]").forEach((i) => i.addEventListener("change", () => {
      const s = i.parentElement.querySelector("small"); if (s) s.textContent = i.files.length ? i.files.length + " slika odabrano" : "";
    }));
  }

  // ------------------------------------------------------------------ kondenzator
  async function viewCap(code) {
    code = code.toUpperCase();
    const cap = await API.cap(code);
    if (!cap || cap.status === "rezerviran") return viewRegister(code, cap);
    const [events, photos, tests] = await Promise.all([API.events(cap.id), API.photos(cap.id), API.testTypes()]);
    const urls = await API.signedUrls(photos.map((p) => p.path));
    const kv = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : "");
    const open = cap.status !== "zavrsen";
    page(`<h1><span class="code">${h(cap.code)}</span> ${pill(cap.status)}</h1>
      <div class="card"><dl class="kv">
        ${kv("Projekt", `<a href="#/p/${cap.project_id}">${h(cap.project_name)}</a>`)}
        ${kv("Dolazak", fmtD(cap.arrival_date))}
        ${kv("Proizvođač / tip", h([cap.manufacturer, cap.cap_type].filter(Boolean).join(" ")))}
        ${kv("Ser. br.", h(cap.serial_no))}
        ${kv("C", h(cap.cap_text))}${kv("U", h([cap.volt_text, cap.volt_kind].filter(Boolean).join(" ")))}${kv("f", cap.frequency_hz != null ? h(cap.frequency_hz + " Hz") : "")}
        ${kv("Ostalo", h(cap.extra))}
        ${cap.disposition ? kv("Završni korak", `${h(DISPOSITION[cap.disposition])} (${fmtD(cap.disposition_date)})${cap.location ? " — " + h(cap.location) : ""}`) : ""}
      </dl>
      <p style="margin-top:12px"><a class="btn sec" href="#/k/${h(cap.code)}/uredi">✏️ Uredi podatke</a></p>
      ${photos.length ? `<div class="photos" style="margin-top:12px">${photos.map((p) => `<a href="${h(urls[p.path] || "#")}" target="_blank"><img src="${h(urls[p.path] || "")}" loading="lazy" alt=""></a>`).join("")}</div>` : ""}
      </div>
      ${open ? `
      <form class="card" id="fTest"><h2>Ispitivanje</h2>
        <div class="choice two">${tests.map((t) => `<label><input type="radio" name="test_type" value="${h(t.name)}">${h(t.name)}</label>`).join("")}</div>
        <label>Drugo ispitivanje (upiši)</label><input name="test_other">
        <label>Napomena (parametri, ishod…)</label><textarea name="note"></textarea>
        <label>Fotografije (neobavezno)</label>${photoInput()}
        <button class="big">Upiši ispitivanje</button></form>
      <form class="card" id="fFin"><h2>Završni korak</h2>
        <div class="choice">${Object.entries(DISPOSITION).map(([k, v]) => `<label><input type="radio" name="disposition" value="${k}" required>${v}</label>`).join("")}</div>
        <label>Lokacija (za spremanje — ormar, polica…)</label><input name="location">
        <label>Napomena</label><textarea name="note"></textarea>
        <label>Fotografije (neobavezno)</label>${photoInput()}
        <button class="big">Zaključi</button></form>`
      : `<form class="card" id="fReopen"><button class="sec">Poništi završni korak</button></form>`}
      <form class="card" id="fNote"><h2>Napomena / fotografija</h2><textarea name="note"></textarea>
        <div style="margin-top:8px">${photoInput()}</div><button class="sec big">Dodaj</button></form>
      <div class="card"><h2>Povijest</h2><ul class="timeline">
        ${events.map((e) => `<li><b>${h(EVENT_KIND[e.kind])}</b>${e.test_type ? ": " + h(e.test_type) : ""}${e.note ? `<div>${h(e.note)}</div>` : ""}<div class="t">${fmtTs(e.ts)} · ${h(e.user_name || "?")}</div></li>`).join("")}
      </ul></div>
      `, true);
    wireFileCounters();
    const reload = (msg) => { flash(msg); viewCap(code).catch(showError); };

    if (open) {
      onSubmit($("#fTest"), async (fd, f) => {
        const test = (fd.get("test_other") || "").trim() || fd.get("test_type");
        if (!test) throw new Error("Odaberite vrstu ispitivanja.");
        if (!tests.some((t) => t.name === test)) await API.addTestType(test);
        const ev = await API.addEvent(cap.id, "pokus", test, fd.get("note"));
        await uploadAll(cap.id, cap.code, ev, f.querySelector("input[type=file]"), "ostalo");
        if (cap.status === "zaprimljen") await API.updateCap(cap.id, { status: "u_ispitivanju" });
        reload(`Upisano: ${test}.`);
      });
      onSubmit($("#fFin"), async (fd, f) => {
        const d = fd.get("disposition");
        if (!confirm(`Zaključiti ${cap.code}: ${DISPOSITION[d]}?`)) return;
        const loc = (fd.get("location") || "").trim(), note = (fd.get("note") || "").trim();
        await API.updateCap(cap.id, { status: "zavrsen", disposition: d, disposition_date: today(), location: loc });
        const ev = await API.addEvent(cap.id, "zavrsetak", null, DISPOSITION[d] + (loc ? ` — lokacija: ${loc}` : "") + (note ? `. ${note}` : ""));
        await uploadAll(cap.id, cap.code, ev, f.querySelector("input[type=file]"), "ostalo");
        reload(`${cap.code}: ${DISPOSITION[d]}.`);
      });
    } else {
      onSubmit($("#fReopen"), async () => {
        if (!confirm("Poništiti završni korak?")) return;
        await API.updateCap(cap.id, { status: "u_ispitivanju", disposition: null, disposition_date: null });
        await API.addEvent(cap.id, "izmjena", null, "Završni korak poništen");
        reload("Završni korak poništen.");
      });
    }
    onSubmit($("#fNote"), async (fd, f) => {
      const inp = f.querySelector("input[type=file]");
      if (!(fd.get("note") || "").trim() && !inp.files.length) throw new Error("Upišite napomenu ili dodajte sliku.");
      const ev = await API.addEvent(cap.id, "napomena", null, fd.get("note"));
      await uploadAll(cap.id, cap.code, ev, inp, "ostalo");
      reload("Dodano.");
    });
  }

  // ------------------------------------------------------------------ uređivanje (ispravak krivog unosa)
  const EDIT_LABELS = { project_id: "Projekt", arrival_date: "Datum dolaska", manufacturer: "Proizvođač", cap_type: "Tip",
    serial_no: "Ser. br.", cap_text: "C", volt_text: "U", volt_kind: "AC/DC", frequency_hz: "f [Hz]", extra: "Ostalo",
    location: "Lokacija", disposition: "Završni korak", disposition_date: "Datum završetka" };

  async function viewEdit(code) {
    code = code.toUpperCase();
    const [cap, projects] = await Promise.all([API.cap(code), API.projects()]);
    if (!cap) { page(`<div class="card">Kondenzator ${h(code)} ne postoji.</div>`, true); return; }
    const done = cap.status === "zavrsen";
    page(`<h1><span class="code">${h(cap.code)}</span> — izmjena podataka</h1>
      <form class="card" id="f">
        <p class="muted small">Ispravite krivo upisane podatke. Izmjena se bilježi u povijesti (što je promijenjeno, tko i kada).</p>
        <label>Projekt</label><select name="project_id">${projects.map((p) => `<option value="${p.id}" ${p.id === cap.project_id ? "selected" : ""}>${h(p.name)}</option>`).join("")}</select>
        <label>Datum dolaska</label>${dateIn("arrival_date", cap.arrival_date)}
        <h2 style="margin-top:18px">Natpisna pločica</h2>
        ${nameplateFields(cap)}
        <label>Lokacija</label><input name="location" value="${h(cap.location)}">
        ${done ? `<h2 style="margin-top:18px">Završni korak</h2>
          <div class="row"><div><label>Vrsta</label><select name="disposition">${Object.entries(DISPOSITION).map(([k, v]) => `<option value="${k}" ${k === cap.disposition ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div><label>Datum</label>${dateIn("disposition_date", cap.disposition_date)}</div></div>` : ""}
        <label>Razlog izmjene (neobavezno)</label><input name="reason" placeholder="npr. krivo očitan napon">
        <div class="row" style="margin-top:14px"><a class="btn sec" href="#/k/${h(cap.code)}">Odustani</a><button>Spremi izmjene</button></div>
      </form>`, true);
    onSubmit($("#f"), async (fd) => {
      const upd = { project_id: Number(fd.get("project_id")), arrival_date: fd.get("arrival_date") || null,
        location: (fd.get("location") || "").trim(), ...nameplateFromForm(fd) };
      if (done) { upd.disposition = fd.get("disposition"); upd.disposition_date = fd.get("disposition_date") || cap.disposition_date; }
      const pname = (id) => (projects.find((p) => p.id === id) || {}).name || "";
      const show = (k, v) => (k === "project_id" ? pname(v) : k === "disposition" ? DISPOSITION[v] || "" : v == null || v === "" ? "—" : String(v));
      const changes = Object.keys(EDIT_LABELS).filter((k) => k in upd && String(upd[k] ?? "") !== String(cap[k] ?? ""))
        .map((k) => `${EDIT_LABELS[k]}: ${show(k, cap[k])} → ${show(k, upd[k])}`);
      if (!changes.length) { flash("Nije bilo promjena.", "ok"); return go("#/k/" + cap.code); }
      await API.updateCap(cap.id, upd);
      const reason = (fd.get("reason") || "").trim();
      await API.addEvent(cap.id, "izmjena", null, changes.join("; ") + (reason ? ` (razlog: ${reason})` : ""));
      flash("Izmjene spremljene.");
      go("#/k/" + cap.code);
    });
  }

  // ------------------------------------------------------------------ zaprimanje
  async function viewRegister(code, cap) {
    const projects = await API.projects("otvoreni");
    page(`<h1><span class="code">${h(code)}</span> — zaprimanje</h1>
      <form class="card" id="f">
        <label>Projekt</label><select name="project_id"><option value="">— odaberi —</option>
          ${projects.map((p) => `<option value="${p.id}" ${cap && cap.project_id === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}</select>
        <label>…ili novi projekt</label><input name="new_project" placeholder="npr. PROBA1">
        <label>Datum dolaska</label>${dateIn("arrival_date", today())}
        <label>Fotografija natpisne pločice</label>${photoInput("plate", true)}
        <div id="ocrbox" class="ocrbox" hidden><div id="previews" class="photos"></div><div id="ocrmsg" class="ocrmsg" hidden></div></div>
        <details id="npdet" style="margin-top:14px" open><summary>Podaci s natpisne pločice</summary>${nameplateFields(null)}</details>
        <label class="confirm" id="confirmwrap" hidden><input type="checkbox" id="confirm"> Provjerio/la sam podatke prema pločici</label>
        <label>Napomena</label><textarea name="note" placeholder="stanje pri dolasku, ambalaža…"></textarea>
        <button class="big">Zaprimi kondenzator</button></form>`, true);
    wireFileCounters();
    const form = $("#f"), plate = $("#plate");
    let ocrText = "", ocrFilled = false, run = 0;

    plate.addEventListener("change", async () => {
      const files = [...plate.files];
      $("#previews").innerHTML = "";
      files.forEach((f) => { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.target = "_blank"; const im = document.createElement("img"); im.src = a.href; a.appendChild(im); $("#previews").appendChild(a); });
      $("#ocrbox").hidden = !files.length;
      if (!K.OCR || !files.length) return;
      const my = ++run, msg = $("#ocrmsg");
      msg.hidden = false; msg.className = "ocrmsg busy"; msg.textContent = "Čitam natpisnu pločicu…";
      try {
        const images = [];
        for (const f of files.slice(0, 3)) images.push(await toB64(await shrink(f, 1600)));
        const r = await API.ocr(images);
        if (my !== run) return;
        if (!r || !r.ok) throw new Error((r && r.error) || "bez odgovora");
        let n = 0;
        for (const [k, v] of Object.entries(r.fields || {})) {
          const el = form.elements[k];
          if (!el || !v) continue;
          if (el.tagName !== "SELECT" && el.value && !el.classList.contains("ocr")) continue; // ne gazi ručni unos
          if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
          el.value = v; el.classList.add("ocr"); n++;
        }
        ocrFilled = n > 0; ocrText = r.raw || "";
        $("#confirmwrap").hidden = !ocrFilled;
        msg.className = "ocrmsg " + (ocrFilled ? "ok" : "err");
        msg.innerHTML = ocrFilled ? `<b>Očitano ${n} polja.</b> Usporedite žuta polja sa slikom i ispravite ako treba.`
          : "Na slici nisu prepoznati podaci — upišite ručno ili slikajte ponovno (bliže, bez odsjaja).";
        if (r.notes) { const d = document.createElement("div"); d.className = "small"; d.textContent = "⚠ " + r.notes; msg.appendChild(d); }
      } catch (e) {
        msg.className = "ocrmsg err"; msg.textContent = "Očitavanje nije uspjelo (" + e.message + "). Upišite podatke ručno.";
      }
    });
    form.addEventListener("input", (e) => e.target.classList.remove("ocr"));

    onSubmit(form, async (fd) => {
      if (ocrFilled && !$("#confirm").checked) {
        $("#confirmwrap").scrollIntoView({ block: "center" });
        $("#confirmwrap").classList.add("shake"); setTimeout(() => $("#confirmwrap").classList.remove("shake"), 600);
        return;
      }
      const newName = (fd.get("new_project") || "").trim();
      const pid = newName ? await API.createProject({ name: newName }) : Number(fd.get("project_id")) || null;
      if (!pid) throw new Error("Odaberite ili upišite projekt.");
      const id = await API.saveCap(code, { project_id: pid, status: "zaprimljen", arrival_date: fd.get("arrival_date") || today(),
        ...nameplateFromForm(fd), ocr_text: ocrFilled ? ocrText : null });
      let note = (fd.get("note") || "").trim();
      if (ocrFilled) note = (note ? note + " · " : "") + "Podaci s pločice očitani automatski i provjereni.";
      const ev = await API.addEvent(id, "dolazak", null, note);
      await uploadAll(id, code, ev, plate, "plocica");
      flash(`${code} zaprimljen.`);
      viewCap(code).catch(showError);
    });
  }

  // ------------------------------------------------------------------ projekti
  // boja/stanje projekta: fakturiran > završen > u ispitivanju > nije započet
  const PSTATE = { novi: "Nije započet", tijek: "U ispitivanju", gotov: "Završen", fakt: "Fakturiran" };
  function projState(p) {
    if (p.invoiced) return "fakt";
    if (p.closed || (+p.n > 0 && +p.n_zav === +p.n)) return "gotov";
    if (+p.n_isp > 0 || +p.n_zav > 0) return "tijek";
    return "novi";
  }
  const ppill = (p) => { const st = projState(p); return `<span class="ps ps-${st}">${PSTATE[st]}</span>`; };
  const legend = () => `<div class="legend">${Object.entries(PSTATE).map(([k, v]) => `<span class="ps ps-${k}">${v}</span>`).join("")}</div>`;

  async function viewDashboard() {
    const show = params().get("show") || "otvoreni";
    const [rows, tot] = await Promise.all([API.projects(show === "svi" ? null : show), API.statusCounts()]);
    const yes = (b, t) => `<span class="pill ${b ? "yes" : "no"}">${b ? h(t || "da") : "ne"}</span>`;
    page(`<div class="stats">${Object.entries(STATUS).map(([k, v]) => `<a class="stat" href="${k === "rezerviran" ? "#/naljepnice" : "#/kondenzatori?status=" + k}"><b>${tot[k]}</b><span>${v}</span></a>`).join("")}</div>
      <div class="tabs">${[["otvoreni", "Otvoreni"], ["zakljuceni", "Zaključeni"], ["nefakturirani", "Zaključeni, nefakturirani"], ["svi", "Svi"]]
        .map(([k, v]) => `<a class="${show === k ? "on" : ""}" href="#/?show=${k}">${v}</a>`).join("")}</div>
      <div class="tablewrap"><table>
        <tr><th>Projekt</th><th>Stanje</th><th>Naručitelj</th><th class="hide-m">Nalog</th><th>Kom.</th><th>Zaprim.</th><th>Ispit.</th><th>Završ.</th><th class="hide-m">Prvi dolazak</th><th>Zaključen</th><th>Fakturiran</th></tr>
        ${rows.map((r) => `<tr class="pr pr-${projState(r)}"><td><a href="#/p/${r.id}"><b>${h(r.name)}</b></a></td><td>${ppill(r)}</td><td>${h(r.client)}</td><td class="hide-m">${h(r.order_no)}</td>
          <td class="num">${r.n}${+r.n_rez ? ` <span class="muted small">(+${r.n_rez} nalj.)</span>` : ""}</td><td class="num">${r.n_zap}</td><td class="num">${r.n_isp}</td><td class="num">${r.n_zav}</td>
          <td class="hide-m">${fmtD(r.first_arrival)}</td><td>${yes(r.closed, fmtD(r.closed_date))}</td><td>${yes(r.invoiced, r.invoice_no || fmtD(r.invoice_date))}</td></tr>`).join("")
          || `<tr><td colspan="11" class="muted">Nema projekata.</td></tr>`}
      </table></div>${legend()}
      <form class="card" id="f" style="margin-top:14px"><h2>Novi projekt</h2>
        <div class="row"><input name="name" placeholder="Naziv (npr. PROBA1)" required><input name="client" placeholder="Naručitelj"><input name="order_no" placeholder="Broj naloga/ponude"><button class="u">Dodaj</button></div></form>`);
    onSubmit($("#f"), async (fd) => {
      const id = await API.createProject({ name: fd.get("name").trim(), client: fd.get("client").trim(), order_no: fd.get("order_no").trim() });
      go("#/p/" + id);
    });
  }

  async function viewProject(id) {
    const [p, caps] = await Promise.all([API.project(id), API.caps({ project: id })]);
    if (!p) { page(`<div class="card">Projekt ne postoji.</div>`); return; }
    const urls = await API.signedUrls(caps.map((c) => c.photo));
    const adm = API.isAdmin();
    const dis = adm ? "" : "disabled";
    page(`<h1>${h(p.name)} ${ppill(p)}</h1>
      <form class="card" id="f">
        <div class="row"><div><label>Naziv</label><input name="name" value="${h(p.name)}" required></div>
          <div><label>Naručitelj</label><input name="client" value="${h(p.client)}"></div>
          <div><label>Broj naloga / ponude</label><input name="order_no" value="${h(p.order_no)}"></div></div>
        <div class="row"><div><label><input type="checkbox" name="closed" style="width:auto" ${p.closed ? "checked" : ""}> Zaključen</label>${dateIn("closed_date", p.closed_date)}</div>
          <div><label><input type="checkbox" name="invoiced" style="width:auto" ${p.invoiced ? "checked" : ""} ${dis}> Fakturiran</label>${dateIn("invoice_date", p.invoice_date, dis)}</div>
          <div><label>Broj računa</label><input name="invoice_no" value="${h(p.invoice_no)}" ${dis}></div></div>
        ${adm ? "" : `<p class="muted small">Fakturiranje označava administrator.</p>`}
        <label>Bilješke</label><textarea name="notes">${h(p.notes)}</textarea>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button>Spremi projekt</button>
          <a class="btn sec" href="#/kondenzatori?project=${p.id}">Filtriraj / izvoz</a>
          <a class="btn sec" href="#" id="xls">Excel</a>
          <a class="btn sec" href="#/ispis?project=${p.id}">Ponovno ispiši naljepnice</a></div></form>
      ${capTable(caps, urls, false)}
      ${!adm ? "" : `<details class="card danger-zone" style="margin-top:14px"><summary>Brisanje projekta</summary>
        <p>Trajno briše projekt <b>${h(p.name)}</b> i <b>sve njegove kondenzatore (${caps.length})</b> s poviješću i fotografijama. Ne može se poništiti.</p>
        <p class="muted small">Prije brisanja po potrebi preuzmite podatke gumbom „Excel” gore.</p>
        <form id="fDel"><label>Za potvrdu upišite naziv projekta</label><div class="row"><input name="confirm" autocomplete="off" placeholder="${h(p.name)}"><button class="danger u" style="flex:0 0 auto">Obriši projekt</button></div></form>
      </details>`}`);
    onSubmit($("#f"), async (fd) => {
      const closed = !!fd.get("closed"), invoiced = !!fd.get("invoiced");
      const upd = {
        name: fd.get("name").trim(), client: fd.get("client").trim(), order_no: fd.get("order_no").trim(), notes: fd.get("notes").trim(),
        closed, closed_date: closed ? fd.get("closed_date") || p.closed_date || today() : null,
      };
      if (adm) Object.assign(upd, { invoiced, invoice_date: invoiced ? fd.get("invoice_date") || p.invoice_date || today() : null, invoice_no: (fd.get("invoice_no") || "").trim() });
      await API.updateProject(p.id, upd);
      flash("Projekt spremljen."); viewProject(id).catch(showError);
    });
    $("#xls").onclick = (e) => { e.preventDefault(); exportXlsx(caps, `${p.name}_kondenzatori`); };
    if (adm) onSubmit($("#fDel"), async (fd) => {
      if ((fd.get("confirm") || "").trim() !== p.name) throw new Error("Upisani naziv se ne podudara s nazivom projekta.");
      if (!confirm(`Trajno obrisati projekt ${p.name} i ${caps.length} kondenzatora?`)) return;
      await API.deleteProject(p.id);
      flash(`Projekt ${p.name} je obrisan.`);
      go("#/?show=svi");
    });
  }

  function capTable(rows, urls, withProject) {
    return `<div class="tablewrap"><table>
      <tr>${urls ? "<th></th>" : ""}<th>Kod</th>${withProject ? "<th>Projekt</th>" : ""}<th>Status</th><th>Dolazak</th><th>Proizvođač / tip</th><th>Ser. br.</th><th>C</th><th>U</th><th>f</th><th>Ispitivanja</th><th>Završni korak</th>${withProject ? "<th>Fakt.</th>" : ""}</tr>
      ${rows.map((c) => `<tr>${urls ? `<td>${c.photo && urls[c.photo] ? `<img class="thumb" src="${h(urls[c.photo])}" loading="lazy">` : ""}</td>` : ""}
        <td><a class="code" href="#/k/${h(c.code)}">${h(c.code)}</a></td>${withProject ? `<td><a href="#/p/${c.project_id}">${h(c.project_name)}</a></td>` : ""}
        <td>${pill(c.status)}</td><td class="nw">${fmtD(c.arrival_date)}</td><td>${h([c.manufacturer, c.cap_type].filter(Boolean).join(" "))}</td><td>${h(c.serial_no)}</td>
        <td class="num">${h(fmtCap(c.capacitance_uf))}</td><td class="num">${h(fmtVolt(c.voltage_v))} ${h(c.volt_kind)}</td><td class="num">${c.frequency_hz != null ? h(c.frequency_hz + " Hz") : ""}</td><td>${h(c.tests)}</td>
        <td>${c.disposition ? `${h(DISPOSITION[c.disposition])} <span class="muted small">${fmtD(c.disposition_date)}${c.location ? " · " + h(c.location) : ""}</span>` : ""}</td>
        ${withProject ? `<td>${c.project_invoiced ? '<span class="pill yes">da</span>' : ""}</td>` : ""}</tr>`).join("")
        || `<tr><td colspan="12" class="muted">Nema kondenzatora.</td></tr>`}
    </table></div>`;
  }

  // ------------------------------------------------------------------ popis s filtrima
  async function viewCaps() {
    const a = Object.fromEntries(params());
    const cu = CAP_UNITS[a.cu || "µF"] || 1;
    const f = { project: a.project, status: a.status, disposition: a.disposition, test: a.test, q: a.q,
      cmin: num(a.cmin) == null ? null : num(a.cmin) * cu * (1 - 1e-9), cmax: num(a.cmax) == null ? null : num(a.cmax) * cu * (1 + 1e-9),
      umin: num(a.umin), umax: num(a.umax) };
    const [rows, projects, tests] = await Promise.all([API.caps(f), API.projects(), API.testTypes(true)]);
    const opt = (list, cur) => list.map(([v, t]) => `<option value="${h(v)}" ${String(cur || "") === String(v) ? "selected" : ""}>${h(t)}</option>`).join("");
    page(`<h1>Kondenzatori <span class="muted small">(${rows.length})</span></h1>
      <form class="card" id="f"><div class="filters">
        <div><label>Traži</label><input name="q" value="${h(a.q)}" placeholder="kod, proizvođač, ser. br.…"></div>
        <div><label>Projekt</label><select name="project"><option value="">svi</option>${opt(projects.map((p) => [p.id, p.name]), a.project)}</select></div>
        <div><label>Status</label><select name="status"><option value="">svi</option>${opt(Object.entries(STATUS), a.status)}</select></div>
        <div><label>Završni korak</label><select name="disposition"><option value="">svi</option>${opt(Object.entries(DISPOSITION), a.disposition)}</select></div>
        <div><label>Ispitivanje</label><select name="test"><option value="">sva</option>${opt(tests.map((t) => [t.name, t.name]), a.test)}</select></div>
        <div><label>C od – do</label><div class="row"><input name="cmin" value="${h(a.cmin)}"><input name="cmax" value="${h(a.cmax)}">
          <select name="cu" style="flex:0 0 70px">${opt(Object.keys(CAP_UNITS).map((u) => [u, u]), a.cu || "µF")}</select></div></div>
        <div><label>U od – do [V]</label><div class="row"><input name="umin" value="${h(a.umin)}"><input name="umax" value="${h(a.umax)}"></div></div>
        <div><button>Filtriraj</button> <a class="btn sec" href="#/kondenzatori">Očisti</a></div></div>
        <div style="margin-top:10px"><a href="#" id="xls">⬇ Excel</a> · <a href="#" id="csv">⬇ CSV</a> ·
          <a href="#/ispis?codes=${rows.map((r) => r.code).join(",")}">🏷 Naljepnice za prikazane</a></div></form>
      ${capTable(rows, null, true)}`);
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const p = new URLSearchParams();
      for (const [k, v] of new FormData(e.target)) if (v && !(k === "cu" && v === "µF")) p.set(k, v);
      go("#/kondenzatori?" + p.toString());
    };
    $("#xls").onclick = (e) => { e.preventDefault(); exportXlsx(rows, "kondenzatori"); };
    $("#csv").onclick = (e) => { e.preventDefault(); exportCsv(rows); };
  }

  // ------------------------------------------------------------------ izvoz
  const EXPORT_COLS = [["Kod", "code"], ["Projekt", "project_name"], ["Status", (r) => STATUS[r.status]], ["Datum dolaska", (r) => fmtD(r.arrival_date)],
    ["Proizvođač", "manufacturer"], ["Tip", "cap_type"], ["Serijski br.", "serial_no"], ["C [µF]", "capacitance_uf"], ["C (upisano)", "cap_text"],
    ["U [V]", "voltage_v"], ["U (upisano)", "volt_text"], ["AC/DC", "volt_kind"], ["f [Hz]", "frequency_hz"], ["Ostalo s pločice", "extra"], ["Ispitivanja", "tests"],
    ["Završni korak", (r) => DISPOSITION[r.disposition] || ""], ["Datum završetka", (r) => fmtD(r.disposition_date)], ["Lokacija", "location"],
    ["Projekt fakturiran", (r) => (r.project_invoiced ? "da" : "ne")]];
  const PROJ_COLS = [["Projekt", "name"], ["Naručitelj", "client"], ["Nalog/ponuda", "order_no"], ["Komada", "n"], ["Završeno", "n_zav"],
    ["Zaključen", (r) => (r.closed ? "da" : "ne")], ["Datum zaključenja", (r) => fmtD(r.closed_date)], ["Fakturiran", (r) => (r.invoiced ? "da" : "ne")],
    ["Broj računa", "invoice_no"], ["Datum fakture", (r) => fmtD(r.invoice_date)], ["Bilješke", "notes"]];
  const EV_COLS = [["Vrijeme", (r) => fmtTs(r.ts)], ["Kod", "code"], ["Projekt", "project_name"], ["Događaj", (r) => EVENT_KIND[r.kind]],
    ["Ispitivanje", "test_type"], ["Napomena", "note"], ["Upisao", "user_name"]];
  const aoa = (cols, rows) => [cols.map((c) => c[0]), ...rows.map((r) => cols.map(([, k]) => { const v = typeof k === "function" ? k(r) : r[k]; return v == null ? "" : v; }))];
  function sheet(wb, name, cols, rows) {
    const ws = XLSX.utils.aoa_to_sheet(aoa(cols, rows));
    ws["!cols"] = cols.map((c, i) => ({ wch: Math.min(45, Math.max(10, ...aoa(cols, rows).map((r) => String(r[i]).length + 2))) }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  function exportXlsx(rows, name) {
    const wb = XLSX.utils.book_new(); sheet(wb, "Kondenzatori", EXPORT_COLS, rows);
    XLSX.writeFile(wb, `${name}_${stamp()}.xlsx`);
  }
  async function exportAll() {
    const [caps, projects, events] = await Promise.all([API.caps({}), API.projects(), API.allEvents()]);
    const wb = XLSX.utils.book_new();
    sheet(wb, "Kondenzatori", EXPORT_COLS, caps); sheet(wb, "Projekti", PROJ_COLS, projects); sheet(wb, "Povijest", EV_COLS, events);
    XLSX.writeFile(wb, `kondenzatori_sve_${stamp()}.xlsx`);
  }
  function exportCsv(rows) {
    const esc = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = "﻿" + aoa(EXPORT_COLS, rows).map((r) => r.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `kondenzatori_${stamp()}.csv`; a.click();
  }

  // ------------------------------------------------------------------ naljepnice (Avery L4773 / L7159: A4, 3 × 8, 63,5 × 33,9 mm)
  const SHEET = { cols: 3, rows: 8, w: 63.5, h: 33.9, left: 7.25, top: 12.9, pitchX: 66.0, pitchY: 33.9 };
  const PER_SHEET = SHEET.cols * SHEET.rows;
  function calib() {
    try { const c = JSON.parse(localStorage.getItem("kond_kalibracija") || "{}"); return { dx: +c.dx || 0, dy: +c.dy || 0 }; }
    catch (e) { return { dx: 0, dy: 0 }; }
  }
  function saveCalib(c) { try { localStorage.setItem("kond_kalibracija", JSON.stringify(c)); } catch (e) { /* nije važno */ } }

  async function viewLabels() {
    const unused = await API.unusedLabels();
    const c = calib();
    page(`<h1>Naljepnice</h1>
      <form class="card" id="f"><h2>Nove naljepnice</h2>
        <p class="muted">Brojevi se dodjeljuju unaprijed, bez projekta. Projekt se odabire pri zaprimanju, kad skenirate naljepnicu na kondenzatoru.</p>
        <div class="row"><div><label>Broj naljepnica</label><input name="count" type="number" min="1" max="480" value="${PER_SHEET}"></div>
        <div><label>Počni od mjesta na arku (1–${PER_SHEET})</label><input name="start" type="number" min="1" max="${PER_SHEET}" value="1"></div></div>
        <p class="muted small">Arak Avery L4773 / L7159: ${PER_SHEET} naljepnica (3 × 8), 63,5 × 33,9 mm. Mjesta se broje s lijeva na desno, odozgo prema dolje — za djelomično iskorišten arak upišite prvo slobodno mjesto.</p>
        <button class="big">Dodijeli brojeve i ispiši</button></form>

      <div class="card"><h2>Neiskorištene naljepnice <span class="muted small">(${unused.length})</span></h2>
        ${unused.length ? `<p class="small" style="font-family:ui-monospace,Consolas,monospace;line-height:1.7">${unused.map((u) => h(u.code)).join(" · ")}</p>
          <a class="btn sec" href="#/ispis?codes=${unused.map((u) => u.code).join(",")}">Ponovno ispiši neiskorištene</a>`
        : `<p class="muted">Sve ispisane naljepnice su iskorištene.</p>`}</div>

      <form class="card" id="fCal"><h2>Podešavanje pisača</h2>
        <p class="muted small">Ako ispis nije točno na naljepnicama: ispišite probni arak na običan papir, prislonite ga na arak naljepnica prema svjetlu i upišite pomak. Pozitivno = udesno / prema dolje. Pamti se na ovom računalu.</p>
        <div class="row"><div><label>Pomak vodoravno [mm]</label><input name="dx" type="number" step="0.1" value="${c.dx}"></div>
        <div><label>Pomak okomito [mm]</label><input name="dy" type="number" step="0.1" value="${c.dy}"></div></div>
        <div class="row" style="margin-top:12px"><button class="sec">Spremi pomak</button><a class="btn sec" href="#/ispis?probe=1">Probni arak (okviri)</a></div></form>
      <p class="muted small">U prozoru za ispis odaberite <b>A4</b>, mjerilo <b>100 % / Stvarna veličina</b> i margine <b>Nema</b>.</p>`, true);
    onSubmit($("#f"), async (fd) => {
      const n = Math.max(1, Math.min(480, parseInt(fd.get("count"), 10) || 1));
      const st = Math.max(1, Math.min(PER_SHEET, parseInt(fd.get("start"), 10) || 1));
      const codes = await API.reserveCodes(null, n);
      go(`#/ispis?codes=${codes.join(",")}&start=${st}`);
    });
    onSubmit($("#fCal"), async (fd) => { saveCalib({ dx: num(fd.get("dx")) || 0, dy: num(fd.get("dy")) || 0 }); flash("Pomak spremljen."); viewLabels().catch(showError); });
  }

  function qrSvg(text) {
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 16, scalable: true }); // margin = 4 modula (tiha zona)
  }

  async function viewPrint() {
    const p = params();
    const probe = p.get("probe") === "1";
    let start = Math.max(1, Math.min(PER_SHEET, parseInt(p.get("start"), 10) || 1));
    let items = [];
    if (probe) { items = Array.from({ length: PER_SHEET }, (_, i) => ({ probe: i + 1 })); start = 1; }
    else if (p.get("project")) items = (await API.caps({ project: p.get("project") })).map((c) => ({ code: c.code, project: c.project_name }));
    else {
      const codes = (p.get("codes") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const known = Object.fromEntries((await API.capsByCodes(codes)).map((c) => [c.code, c.project_name]));
      items = codes.map((c) => ({ code: c, project: known[c] || "" }));
    }
    const slots = Array(start - 1).fill(null).concat(items);
    const pages = [];
    for (let i = 0; i < slots.length; i += PER_SHEET) pages.push(slots.slice(i, i + PER_SHEET));
    const { dx, dy } = calib();
    const lab = (it, i) => {
      const col = i % SHEET.cols, row = Math.floor(i / SHEET.cols);
      const pos = `left:${(SHEET.left + col * SHEET.pitchX + dx).toFixed(2)}mm;top:${(SHEET.top + row * SHEET.pitchY + dy).toFixed(2)}mm;width:${SHEET.w}mm;height:${SHEET.h}mm`;
      if (!it) return `<div class="al empty" style="${pos}"></div>`;
      if (it.probe) return `<div class="al probe" style="${pos}"><div class="t" style="margin:auto;text-align:center"><b>${it.probe}</b><span class="org">PROBNI ISPIS — okvir = rub naljepnice</span></div></div>`;
      return `<div class="al${probe ? " probe" : ""}" style="${pos}">
        <div class="qr">${qrSvg(qrUrl(it.code))}</div>
        <div class="t"><b>${h(it.code)}</b><span class="org">KONČAR INSTITUT · LRS</span>${it.project ? `<span class="prj">${h(it.project)}</span>` : `<span class="line">Projekt:</span>`}</div></div>`;
    };
    document.body.className = "print";
    app.innerHTML = `<style>@page{size:A4;margin:0}</style>
      <div class="pbar">${probe ? "Probni arak" : `${items.length} naljepnica`} · ${pages.length} ${pages.length === 1 ? "arak" : "arka"} · Avery L4773 (3 × 8)
        ${!probe && start > 1 ? ` · od mjesta ${start}` : ""}${dx || dy ? ` · pomak ${dx}/${dy} mm` : ""}
        <button id="pr">Ispiši</button><a href="#/naljepnice">← natrag</a>
        <span class="small" style="color:#9fb3d1">A4 · mjerilo 100 % · margine: nema</span></div>
      ${pages.map((pg) => `<div class="a4">${pg.map(lab).join("")}</div>`).join("")}`;
    $("#pr").onclick = () => print();
  }

  // ------------------------------------------------------------------ korisnici (samo administrator)
  function genPassword() {
    const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint32Array(10));
    return Array.from(r, (x) => a[x % a.length]).join("");
  }
  async function viewUsers() {
    if (!API.isAdmin()) { page(`<div class="card">Ova stranica je samo za administratore.</div>`, true); return; }
    const users = (await API.users("list")).users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "hr"));
    const created = sessionStorage.getItem("noviKorisnik"); sessionStorage.removeItem("noviKorisnik");
    const nc = created ? JSON.parse(created) : null;
    page(`<h1>Korisnici <span class="muted small">(${users.length})</span></h1>
      ${nc ? `<div class="card" style="border-color:#22a052"><h2>✅ Račun je otvoren</h2><p>Pošaljite kolegi ove podatke:</p>
        <pre id="cred" style="white-space:pre-wrap;background:#f6f7f9;padding:10px;border-radius:8px">Aplikacija: ${h(baseUrl())}
E-mail: ${h(nc.email)}
Privremena lozinka: ${h(nc.password)}
Nakon prve prijave: Postavke → upisati ime i promijeniti lozinku.</pre>
        <button class="sec" id="copy">Kopiraj</button></div>` : ""}
      <form class="card" id="fNew"><h2>Novi korisnik</h2>
        <div class="row"><div><label>Ime i prezime</label><input name="name" required></div><div><label>E-mail</label><input name="email" type="email" required autocomplete="off"></div></div>
        <label>Privremena lozinka</label><div class="row"><input name="password" value="${genPassword()}" minlength="8" required autocomplete="off"><button type="button" class="sec u" id="gen" style="flex:0 0 auto">Nova</button></div>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="admin" style="width:auto"> Administrator (može upravljati korisnicima, brisati projekte i označavati fakturiranje)</label>
        <button class="big">Otvori račun</button></form>
      <div class="tablewrap"><table>
        <tr><th>Ime</th><th>E-mail</th><th>Uloga</th><th>Zadnja prijava</th><th>Status</th><th></th></tr>
        ${users.map((u) => `<tr data-id="${h(u.id)}"><td><b>${h(u.name || "—")}</b>${u.me ? ' <span class="muted small">(vi)</span>' : ""}</td><td>${h(u.email)}</td>
          <td>${u.admin ? '<span class="ps ps-fakt">administrator</span>' : "korisnik"}</td><td class="nw">${u.last_sign_in_at ? fmtTs(u.last_sign_in_at) : '<span class="muted">nikad</span>'}</td>
          <td>${u.blocked ? '<span class="pill" style="background:var(--errbg);color:var(--err)">blokiran</span>' : '<span class="pill yes">aktivan</span>'}</td>
          <td style="white-space:nowrap">${u.me ? "" : `<select class="act" style="width:auto;padding:6px">
            <option value="">Radnja…</option><option value="password">Nova privremena lozinka</option><option value="name">Promijeni ime</option>
            <option value="admin">${u.admin ? "Ukloni administratora" : "Postavi za administratora"}</option>
            <option value="block">${u.blocked ? "Odblokiraj" : "Blokiraj pristup"}</option><option value="delete">Obriši račun</option></select>`}</td></tr>`).join("")}
      </table></div>
      <p class="muted small" style="margin-top:10px">Brisanjem računa unosi tog korisnika ostaju u povijesti s njegovim imenom. Blokiranje je privremeno i može se poništiti.</p>`);
    if (nc) $("#copy").onclick = () => navigator.clipboard.writeText($("#cred").textContent).then(() => { $("#copy").textContent = "Kopirano ✓"; });
    $("#gen").onclick = () => { $("#fNew").password.value = genPassword(); };
    onSubmit($("#fNew"), async (fd) => {
      const body = { name: fd.get("name").trim(), email: fd.get("email").trim(), password: fd.get("password"), admin: !!fd.get("admin") };
      await API.users("create", body);
      sessionStorage.setItem("noviKorisnik", JSON.stringify({ email: body.email, password: body.password }));
      viewUsers().catch(showError);
    });
    $$("select.act").forEach((sel) => sel.onchange = async () => {
      const tr = sel.closest("tr"), u = users.find((x) => x.id === tr.dataset.id), act = sel.value;
      sel.value = "";
      try {
        if (act === "password") {
          const pw = prompt(`Nova privremena lozinka za ${u.email} (min. 8 znakova):`, genPassword());
          if (!pw) return;
          await API.users("password", { id: u.id, password: pw });
          sessionStorage.setItem("noviKorisnik", JSON.stringify({ email: u.email, password: pw }));
        } else if (act === "name") {
          const n = prompt(`Ime i prezime za ${u.email}:`, u.name || ""); if (n == null) return;
          await API.users("name", { id: u.id, name: n });
        } else if (act === "admin") {
          if (!confirm(u.admin ? `Ukloniti administratorska prava korisniku ${u.email}?` : `Dati administratorska prava korisniku ${u.email}?`)) return;
          await API.users("admin", { id: u.id, admin: !u.admin });
        } else if (act === "block") {
          if (!confirm(u.blocked ? `Odblokirati ${u.email}?` : `Blokirati pristup za ${u.email}?`)) return;
          await API.users("block", { id: u.id, blocked: !u.blocked });
        } else if (act === "delete") {
          if (!confirm(`Trajno obrisati račun ${u.email}? Njegovi unosi ostaju u povijesti.`)) return;
          await API.users("delete", { id: u.id });
        } else return;
        if (act !== "password") flash("Spremljeno.");
        viewUsers().catch(showError);
      } catch (e) { showError(e); }
    });
  }

  // ------------------------------------------------------------------ postavke
  async function viewSettings() {
    const tests = await API.testTypes(true);
    const me = API.me();
    page(`<h1>Postavke</h1>
      <div class="card"><h2>Moj račun</h2><p class="muted small">${h(me.email)}${API.isAdmin() ? ` · <span class="pill yes">administrator</span> · <a href="#/korisnici">Korisnici</a>` : ""}</p>
        <form id="fName"><label>Ime koje se prikazuje uz unose</label><div class="row"><input name="name" value="${h(me.name)}" required><button class="u">Spremi</button></div></form>
        <p style="margin-top:12px"><a class="btn sec" href="#/lozinka">Promijeni lozinku</a> <button class="sec" id="out">Odjava</button></p></div>
      <div class="card"><h2>Vrste ispitivanja</h2><p class="muted small">Nude se kao gumbi na mobitelu. Isključene ostaju u povijesti.</p>
        <table>${tests.map((t) => `<tr><td>${h(t.name)}</td><td style="width:1%"><button class="${t.active ? "sec" : "danger"}" data-t="${t.id}" data-a="${t.active ? 0 : 1}">${t.active ? "aktivno" : "isključeno"}</button></td></tr>`).join("")}</table>
        <form id="fAdd" style="margin-top:10px"><div class="row"><input name="name" placeholder="Nova vrsta ispitivanja" required><button class="u">Dodaj</button></div></form></div>
      <div class="card"><h2>Sigurnosna kopija</h2><p class="muted small">Preuzmite sve podatke (kondenzatori, projekti, povijest) u Excel i spremite u OneDrive mapu — preporuka jednom tjedno.</p>
        <button id="all">⬇ Preuzmi sve u Excel</button></div>
      <div class="card"><h2>QR kodovi</h2><p class="small">Naljepnice vode na: <code>${h(qrUrl("K00001"))}</code></p>
        <div style="width:160px">${qrSvg(qrUrl("TEST"))}</div><p class="muted small">Testni kod — skeniran mobitelom treba otvoriti aplikaciju.</p></div>`, true);
    onSubmit($("#fName"), async (fd) => { await API.setName(fd.get("name").trim()); flash("Ime spremljeno."); viewSettings().catch(showError); });
    onSubmit($("#fAdd"), async (fd) => { await API.addTestType(fd.get("name").trim()); viewSettings().catch(showError); });
    $$("button[data-t]").forEach((b) => (b.onclick = async () => { await API.setTestType(Number(b.dataset.t), b.dataset.a === "1"); viewSettings().catch(showError); }));
    $("#out").onclick = async () => { await API.signOut(); go("#/login"); };
    $("#all").onclick = () => exportAll().catch(showError);
  }

  // ------------------------------------------------------------------ usmjeravanje
  async function route() {
    const path = (location.hash.replace(/^#/, "").split("?")[0]) || "/";
    if (!API.configured) return viewSetup();
    if (path === "/login") return viewLogin();
    if (!API.me()) { sessionStorage.setItem("afterLogin", location.hash || "#/"); return viewLogin(); }
    let m;
    try {
      if (path === "/") await viewDashboard();
      else if ((m = path.match(/^\/k\/([^/]+)\/uredi$/))) await viewEdit(decodeURIComponent(m[1]));
      else if ((m = path.match(/^\/k\/(.+)$/))) {
        if (decodeURIComponent(m[1]).toUpperCase() === "TEST") { flash("QR kod radi — mobitel je otvorio aplikaciju."); return go("#/skeniraj"); }
        await viewCap(decodeURIComponent(m[1]));
      }
      else if ((m = path.match(/^\/p\/(\d+)$/))) await viewProject(Number(m[1]));
      else if (path === "/kondenzatori") await viewCaps();
      else if (path === "/naljepnice") await viewLabels();
      else if (path === "/ispis") await viewPrint();
      else if (path === "/skeniraj") await viewScan();
      else if (path === "/postavke") await viewSettings();
      else if (path === "/korisnici") await viewUsers();
      else if (path === "/lozinka") viewSetPassword();
      else go("#/");
    } catch (err) {
      page(`<div class="card"><h2>Nešto nije u redu</h2><p>${h(err.message || err)}</p>
        <p class="muted small">Ako se ovo ponavlja: provjerite internetsku vezu. Na besplatnom Supabase planu projekt se uspava nakon 7 dana neaktivnosti — administrator ga budi u Supabase sučelju (Restore).</p>
        <button onclick="location.reload()">Pokušaj ponovno</button></div>`, true);
      console.error(err);
    }
  }

  async function start() {
    // poveznice iz e-maila (poziv / nova lozinka) nose ?type=… ili #…type=…
    const hashType = new URLSearchParams(location.hash.replace(/^#/, "")).get("type");
    const qs = new URLSearchParams(location.search);
    const code = qs.get("k");
    if (!API.configured) return viewSetup();
    try { await API.session(); } catch (e) { console.error(e); }
    if (code) { history.replaceState(null, "", location.pathname + "#/k/" + encodeURIComponent(code.toUpperCase())); }
    else if ((hashType === "invite" || hashType === "recovery") && API.me()) { history.replaceState(null, "", location.pathname + "#/lozinka"); }
    else if (/access_token=/.test(location.hash)) { history.replaceState(null, "", location.pathname + "#/"); }
    window.addEventListener("hashchange", route);
    route();
  }
  start();
})();
