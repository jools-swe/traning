# Träning

En snorenkel träningsapp för telefonen. Du trycker på Starta och kör.

- Det finns två pass under kugghjulet, och du väljer vilket som körs när du trycker Starta:
  - **AMRAP complex**: kettlebellövningar med 10 reps var. Tiden är 15, 20 eller 30 min med en timer som löper hela passet. Du trycker när en övning är klar. Rundor räknas och sparas, och rekord hålls per tid.
  - **Eget pass**: uppvärmning och övningar med set, reps eller tid, vikt och vila.
- Animerade streckgubbar visar rörelsen för row, goblet squat, push ups, curl, swing och thruster. Gubben väljs efter övningens namn, så det fungerar även i Eget pass.
- Repsövningar: du trycker var som helst på skärmen när du är klar. Med ‹ ångrar du ett feltryck.
- Tidsövningar och vila: stor nedräkning med pip vid 3-2-1. Tryck på skärmen för att pausa.
- Skärmen hålls vaken under passet och appen fungerar offline.
- All data ligger i telefonen. Inga konton, ingen spårning och inga externa beroenden.

## Filer

```
index.html             vyerna (start, pass, klart, inställningar)
style.css              utseende – färgerna ligger överst i :root
app.js                 all logik
figures.js             streckgubbarna (två ställningar per övning)
sw.js                  offline-stöd (service worker)
manifest.webmanifest   gör att den beter sig som en app på hemskärmen
icons/                 appikoner
```

---

## 1. Engångsfix: git och GitHub

**Installera git** (Mac): `xcode-select --install` i Terminal. På Windows installerar du från git-scm.com.

**Säkra kontot**
1. Slå på tvåstegsverifiering under GitHub → Settings → Password and authentication.
2. Dölj din e-post. Gå till Settings → Emails och kryssa i *Keep my email addresses private* och *Block command line pushes that expose my email*. Där visas också en adress av typen `12345+användarnamn@users.noreply.github.com`. Använd den i git, annars hamnar din riktiga e-post i varje commit, och den är publik.

**Berätta för git vem du är** (görs en gång per dator):
```bash
git config --global user.name "Ditt Namn"
git config --global user.email "12345+användarnamn@users.noreply.github.com"
git config --global init.defaultBranch main
```

**Logga in från terminalen**. Enklast är GitHub CLI (`brew install gh` på Mac):
```bash
gh auth login        # välj GitHub.com → HTTPS → logga in med webbläsaren
```
Det ersätter lösenord och tokens som du annars måste hantera själv.

## 2. Lägg upp projektet

```bash
cd sökväg/till/traning
git init
git add .
git commit -m "Första versionen"
gh repo create traning --public --source=. --push
```

Utan `gh`: skapa ett tomt repo på github.com och kör sedan:
```bash
git remote add origin https://github.com/ANVÄNDARNAMN/traning.git
git push -u origin main
```

## 3. Slå på GitHub Pages

1. I repot: **Settings → Pages**.
2. Under *Source* väljer du **Deploy from a branch**, sedan branch **main** och mapp **/ (root)**. Spara.
3. Kryssa i **Enforce HTTPS**.
4. Efter någon minut ligger appen på `https://ANVÄNDARNAMN.github.io/traning/`.

## 4. In i iPhonen

1. Öppna adressen i **Safari**.
2. Tryck på dela-knappen och välj **Lägg till på hemskärmen**.
3. Starta alltid från ikonen och ställ in ditt pass där. Hemskärmsappen och Safari har separata data.

---

## Vardagsflödet: ändra, committa, pusha

```bash
git status                 # vad har ändrats?
git diff                   # exakt vad har ändrats?
git add .                  # lägg allt i nästa commit (eller: git add app.js)
git commit -m "Längre pip när vilan är slut"
git push
```

Tips:
- **Små commits** med ett syfte var. Skriv meddelandet som en instruktion, till exempel "Lägg till paus", "Fixa dubbeltryck" eller "Mörkare bakgrund".
- **Testa lokalt först:** kör `python3 -m http.server 8000` i mappen och öppna `http://localhost:8000`. Från telefonen på samma wifi använder du `http://DATORNS-IP:8000`. Utan HTTPS fungerar inte offline-läget eller funktionen som håller skärmen vaken, men utseende och flöde kan du testa.
- **Ångra:** `git restore fil` slänger ändringar som inte är committade. `git log --oneline` visar historiken.
- **Större experiment** gör du i en gren: `git switch -c ny-grej`. Om det blir bra kör du `git switch main` och sedan `git merge ny-grej`.

**Uppdateringar på telefonen:** appen visar först den sparade versionen och hämtar sedan den nya i bakgrunden. Efter en push öppnar du appen, stänger den helt och öppnar den igen. Om något verkar fastna, höj `CACHE`-versionen i `sw.js` (t.ex. `traning-v2`) och pusha.

---

## Säkerhet: vad som är gjort

- **Inga externa beroenden.** Inga CDN:er, typsnitt, analysverktyg eller npm-paket, så det finns ingen leveranskedja att attackera.
- **Content Security Policy** i `index.html`. Bara filer från sajten själv får laddas och köras. Inget inline-script och inga anrop till andra servrar.
- **Ingen HTML från data.** Allt användarinnehåll skrivs in som ren text (`textContent`), aldrig som HTML (`innerHTML`). Det stänger dörren för XSS.
- **Import valideras.** Max 100 kB, okända fält kastas, siffror begränsas till rimliga intervall och namn kortas till 40 tecken.
- **`no-referrer`.** Inga adresser läcker vidare.
- **Service workern** cachar bara egna filer inom appens egen sökväg.
- **Inget hemligt i repot.** Repot är publikt (gratis Pages kräver det), men det finns inget att läcka. Ditt pass ligger i telefonen och exporterade backupfiler ignoreras av `.gitignore`.

Bra att veta: alla dina Pages-sajter delar adressen `ANVÄNDARNAMN.github.io`. Lägger du upp andra projekt där kan de tekniskt sett läsa den här appens lagrade data. Det spelar ingen roll så länge allt är ditt eget, men lägg aldrig upp kod du inte litar på under samma konto. GitHub Pages låter dig inte sätta egna HTTP-headers, så CSP ligger som meta-tagg. Det räcker gott för en app utan backend.
