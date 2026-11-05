# Praćenje kondenzatora

Web-aplikacija za praćenje uzoraka kondenzatora kroz laboratorij, od zaprimanja do teardowna, zbrinjavanja ili spremanja. Svaki uzorak ima QR naljepnicu.

- **Sučelje** je statička stranica na GitHub Pagesu: `https://alanmileticzg-oss.github.io/kondenzatori/`
- **Podaci** (baza i fotografije) su u Supabaseu. Prijava je e-mailom i lozinkom.
- Radi na mobitelu i računalu, s bilo koje mreže (Wi-Fi ili mobilni podaci). Ne treba nikakva instalacija.

## Kako se radi

1. **Naljepnice:** *Naljepnice* → projekt + broj komada → ispis. Brojevi su K00001, K00002 i dalje.
2. **Zaprimanje:** skenirate QR kamerom mobitela → slikate natpisnu pločicu i upišete (ili provjerite očitane) podatke.
3. **Ispitivanje:** skenirate → odaberete pokus (OVT, …), dodate napomenu i slike.
4. **Završni korak:** skenirate → teardown, zbrinjavanje ili spremanje (s lokacijom).
5. **Pregled na računalu:** projekti (zaključeno, fakturirano), popis s filtrima (C, U, status, pokus), izvoz u Excel.

## Postavljanje (jednokratno)

### 1. Supabase (baza)

1. supabase.com → *New project*. Ime `kondenzatori`, regija *Central EU (Frankfurt)*, plan *Free*.
2. **SQL Editor** → *New query* → zalijepite cijeli `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email:** isključite *Allow new users to sign up*. Tako račune otvara samo administrator.
4. **Authentication → URL Configuration:**
   - *Site URL* = `https://alanmileticzg-oss.github.io/kondenzatori/`
   - isto dodajte i u *Redirect URLs*
5. **Project Settings → API:** kopirajte *Project URL* i *anon public* ključ u `config.js`.

### 2. Korisnici

*Authentication → Users → Add user*:

- **Invite user:** kolega dobije e-mail, klikne poveznicu i sam postavi lozinku i ime.
- **Create new user:** sami upišete e-mail i lozinku i označite *Auto Confirm User*.

### 3. GitHub Pages

Spremište `kondenzatori` → *Settings → Pages* → *Deploy from a branch* → `main` / `(root)`. Za minutu-dvije stranica je na gornjoj adresi.

### 4. Očitavanje pločice (neobavezno)

1. Supabase → **Edge Functions** → *Deploy a new function* → *Via Editor*. Naziv `ocr`, sadržaj iz `supabase/functions/ocr/index.ts`.
   U *Settings* funkcije isključite **Verify JWT with legacy secret**. Projekt potpisuje prijave novim ključem (ECC), a funkcija prijavu provjerava sama.
2. **Edge Functions → Secrets:** dodajte `ANTHROPIC_API_KEY` (ključ s console.anthropic.com). Po želji dodajte i `OCR_MODEL`: zadano je `claude-sonnet-5-5`, a `claude-haiku-5-5` je jeftiniji.
3. U `config.js` postavite `OCR: true`.

Cijena je otprilike 0,5–1 cent po slici. Fotografija se šalje Anthropicu na obradu.

## Važno znati

- **Besplatni Supabase plan:**
  - ograničen prostor: otprilike 500 MB baze i 1 GB slika (≈ 3000+ fotografija smanjenih na ~300 kB);
  - projekt se **uspava nakon 7 dana bez korištenja**. Budi se u Supabase sučelju (*Restore project*), a podaci ostaju;
  - nema automatskih sigurnosnih kopija. Zato **jednom tjedno** idite na *Postavke → Preuzmi sve u Excel* i spremite datoteku u OneDrive mapu.
  - Točna ograničenja provjerite na supabase.com/pricing.
- **Spremište na GitHubu je javno** (besplatni Pages). Vidljiv je samo programski kod.
  - Podaci i slike nisu javni. Bez prijave se ne može ništa pročitati ni upisati (pravila *Row Level Security* u bazi).
  - `anon` ključ u `config.js` smije biti javan. **Nikada** ne upisujte `service_role` ključ.
- QR kodovi vode na `…/kondenzatori/?k=K00001`. Ako se adresa stranice promijeni, naljepnice treba ponovno ispisati.

## Datoteke

| | |
|---|---|
| `index.html`, `js/app.js`, `css/style.css` | sučelje |
| `js/api.js` | komunikacija sa Supabaseom |
| `config.js` | adresa i ključ baze, uključivanje očitavanja |
| `lib/` | supabase-js 2.118.0, qrcode-generator 1.4.4, SheetJS 0.18.5 |
| `supabase/schema.sql` | tablice, pravila pristupa, pohrana slika |
| `supabase/functions/ocr/` | očitavanje pločice (Claude API) |
