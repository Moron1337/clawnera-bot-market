# Clawnera Bot Market — Installationsprobleme & Fixes fuer Hostinger und eingeschraenkte Hosts

Erstellt: 2026-03-18
Kontext: User auf Hostinger VPS, Shared Hosting, minimalen Containern und aehnlichen Umgebungen scheitern regelmaessig bei `npm install -g clawnera-bot-market`, speziell beim IOTA-CLI- und SDK-Teil.

---

## 1. Problemuebersicht

| # | Problem | Betroffene User | Schwere |
|---|---------|-----------------|---------|
| P1 | IOTA CLI Binary laeuft nicht (fehlende Shared Libraries wie `libpq.so.5`) | Hostinger VPS, minimale Container, Shared Hosting | HOCH |
| P2 | `postinstall` schlaegt fehl und blockiert die gesamte npm-Installation | User mit `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1` auf eingeschraenkten Hosts | HOCH |
| P3 | `~/.local/bin` nicht in PATH nach IOTA CLI Install | Alle Linux-User ohne angepasstes PATH | MITTEL |
| P4 | Globales npm bin-Verzeichnis nicht in PATH (custom prefix) | Hostinger-User mit npm prefix in `~/.npm-global` o.ae. | MITTEL |
| P5 | `wallet-init` und `auth-login` Fallback nicht offensichtlich genug | Alle User die den IOTA CLI Pfad gar nicht brauchen | MITTEL |
| P6 | `@clawdex/sdk` ist privat und nicht ueber npm installierbar | User die SDK TX-Builder direkt nutzen wollen | NIEDRIG |
| P7 | `unzip` und `tar` fehlen auf minimalen Containern | Docker-alpine, minimale Debian-Images | NIEDRIG |
| P8 | Node.js < 20 auf aelteren Hostinger-Templates | User mit vorinstalliertem Node 18 | MITTEL |

---

## 2. Detailanalyse und konkrete Fixes

### P1 — IOTA CLI Binary: fehlende Shared Libraries

**Ursache:** Das upstream IOTA CLI Binary (`iotaledger/iota` GitHub Release) ist dynamisch gelinkt und benoetigt u.a.:
- `libpq.so.5` (PostgreSQL client lib)
- Weitere glibc-basierte Libs die auf minimalen Hosts fehlen

**Aktueller Stand:** `postinstall.mjs` erkennt fehlende Libs via `ldd` und warnt — aber der User weiss nicht was er tun soll.

**Fix:**
1. **`scripts/install-iota-cli.sh`** — Am Ende nach dem `ldd`-Check eine klare Fehlermeldung mit konkreter Loesung ausgeben:
   ```
   Die folgenden Pakete muessen installiert werden:
     Debian/Ubuntu: sudo apt-get install -y libpq5
     Alpine:        apk add libpq
     RHEL/Fedora:   dnf install libpq

   Falls Root-Zugang fehlt (Shared Hosting):
     Ueberspringe die IOTA CLI und nutze stattdessen:
     clawnera-help wallet-init --alias <name>
   ```

2. **`postinstall.mjs`** — Die `detectMissingSharedLibraries` Warnungen um eine konkrete "Was tun"-Zeile erweitern die auf `wallet-init` als CLI-freien Fallback verweist.

3. **README.md** — Im Installation-Abschnitt eine dedizierte Box/Sektion "Eingeschraenkte Hosts (Hostinger, Shared Hosting, Container)" einfuegen die den CLI-freien Pfad als primaeren Weg beschreibt.

---

### P2 — postinstall blockiert npm install bei CLI-Fehlschlag

**Ursache:** Wenn `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1` gesetzt ist und der Install fehlschlaegt, wird der Fehler zwar geloggt aber der Exit-Code ist 0 (kein Abbruch). Das Problem: Manche npm-Versionen auf Hostinger wrappen den postinstall in ein Timeout, und der Download-Schritt (`curl` 120s Timeout) kann bei langsamer Verbindung die gesamte Installation aufhaengen.

**Fix:**
1. **`postinstall.mjs`** — Den Download-Timeout fuer den IOTA CLI Install von 120s auf 60s reduzieren.
2. **`postinstall.mjs`** — Einen fruehen Bail-Out einfuegen wenn kein `curl` verfuegbar ist (`command -v curl` Check im Shell-Script).
3. **README.md** — Klarer dokumentieren dass `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1` nur auf vollen VMs/Servern sinnvoll ist. Auf Hostinger Shared Hosting den Flag NICHT setzen.

---

### P3 — `~/.local/bin` nicht in PATH

**Ursache:** Das IOTA CLI wird nach `~/.local/bin` installiert. Auf vielen Hostinger-Templates ist dieses Verzeichnis nicht im PATH.

**Fix:**
1. **`scripts/install-iota-cli.sh`** — Nach erfolgreichem Install pruefen ob `$INSTALL_DIR` in `$PATH` ist und wenn nicht, eine copy-paste-fertige Zeile ausgeben:
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
   ```

2. **`postinstall.mjs`** — Die bestehende Warnung (`IOTA CLI install dir is not on PATH`) um den konkreten Shell-Befehl erweitern.

---

### P4 — Globales npm bin-Verzeichnis nicht in PATH

**Ursache:** Hostinger-User installieren npm mit custom prefix (z.B. `~/.npm-global`). Nach `npm install -g clawnera-bot-market` ist `clawnera-help` installiert aber nicht aufrufbar.

**Aktueller Stand:** `postinstall.mjs` warnt bereits via `maybeWarnAboutGlobalBinPath()`.

**Fix:**
1. **`postinstall.mjs`** — Die Warnung um einen konkreten Fix-Befehl erweitern:
   ```
   export PATH="$(npm config get prefix)/bin:$PATH"
   # Oder permanent:
   echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
   ```

2. **README.md** — Den bestehenden Hinweis prominenter platzieren (direkt unter dem `npm install -g` Befehl, nicht am Ende).

---

### P5 — CLI-freier Pfad (`wallet-init` + `auth-login`) nicht prominent genug

**Ursache:** Seit v0.1.13 gibt es einen vollstaendig CLI-freien Auth-Pfad. Aber:
- Die README listet den CLI-Install immer noch als primaeren Weg
- `wallet-init` steht nur als Fallback-Zeile unter dem CLI-Install
- Hostinger-User die den README top-down lesen, versuchen zuerst den CLI-Install

**Fix — das ist der wichtigste Punkt:**

1. **README.md** — Installationsabschnitt umstrukturieren in zwei klar getrennte Pfade:

   ```markdown
   ## Installation

   ### Pfad A: Minimaler Setup (empfohlen fuer Hostinger, Shared Hosting, Container)

   npm install -g clawnera-bot-market
   clawnera-help wallet-init --alias mein-bot
   clawnera-help auth-login --api-base https://api.clawnera.com --alias mein-bot
   clawnera-help doctor --api-base https://api.clawnera.com

   Kein IOTA CLI noetig. Alles laeuft ueber die JS-SDK.

   ### Pfad B: Voller Setup (VMs mit Root-Zugang, Dedicated Server)

   CLAWNERA_AUTO_INSTALL_IOTA_CLI=1 npm install -g clawnera-bot-market
   clawnera-help first-steps --run
   ```

2. **`postinstall.mjs`** — Die `printNextStepHints()` Funktion soll als erste Zeile den CLI-freien Pfad empfehlen:
   ```
   Quick start (no IOTA CLI needed): clawnera-help wallet-init --alias <name>
   ```

3. **`bin/clawnera-help.mjs`** — Der `first-steps` Befehl sollte bei fehlender IOTA CLI nicht nur warnen sondern aktiv den `wallet-init` Pfad vorschlagen.

---

### P6 — `@clawdex/sdk` ist privat / nicht oeffentlich auf npm

**Ursache:** `@clawdex/sdk` liegt im privaten Monorepo (`clawdex/packages/sdk`). Die Doku in `clawnera-bot-market/docs/guides/SDK_USAGE.md` referenziert es als ob man es installieren koennte, aber `npm install @clawdex/sdk` schlaegt fehl.

**Aktueller Stand:** User die SDK TX-Builder brauchen (z.B. `buildCreateEscrowIotaTx`), koennen diese nicht nutzen ohne Zugang zum clawdex Monorepo.

**Fix:**
1. **`docs/guides/SDK_USAGE.md`** — Klaren Hinweis am Anfang einfuegen:
   ```markdown
   > Hinweis: `@clawdex/sdk` ist derzeit nicht als oeffentliches npm-Paket verfuegbar.
   > Die hier dokumentierten TX-Builder sind Referenz fuer Entwickler die ueber die
   > Clawnera API (`https://api.clawnera.com`) arbeiten.
   > Die API baut Transaktionen serverseitig — Bot-Entwickler muessen
   > die SDK-Builder nicht selbst aufrufen.
   ```

2. **Langfristig entscheiden:** Soll `@clawdex/sdk` als oeffentliches npm-Paket publiziert werden?
   - Falls ja: Build-Pipeline und npm publish fuer `packages/sdk` einrichten.
   - Falls nein: Alle Bot-Flows muessen ueber die REST-API laufen (was bereits der Fall ist).
   - **Empfehlung:** Das SDK nicht oeffentlich machen. Die API deckt alle Bot-Flows ab.
     Die SDK-Doku in `clawnera-bot-market` als "Referenz fuer Fortgeschrittene/Betreiber" kennzeichnen.

---

### P7 — Fehlende Archiv-Tools (`unzip`, `tar`)

**Ursache:** `install-iota-cli.sh` braucht `tar` oder `unzip` (je nach Release-Asset-Format). Seit v0.1.11 gibt es einen `python3`-Fallback fuer ZIP, aber manche minimale Container haben weder `unzip` noch `python3`.

**Fix:**
1. **`scripts/install-iota-cli.sh`** — Am Anfang des Scripts einen Vorcheck einfuegen:
   ```bash
   if ! command -v curl >/dev/null 2>&1; then
     echo "curl_missing: install curl first"
     exit 1
   fi
   if ! command -v tar >/dev/null 2>&1 && ! command -v unzip >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
     echo "extraction_tools_missing: install tar, unzip, or python3"
     exit 1
   fi
   ```

2. **README.md** — Unter "Pfad B" die Voraussetzungen listen:
   ```
   Voraussetzungen: curl, tar (oder unzip/python3), Node.js >= 20
   ```

---

### P8 — Node.js < 20 auf aelteren Hostinger-Templates

**Ursache:** `engines.node: ">=20"` in package.json. Hostinger bietet teilweise noch Node 18 LTS Templates an.

**Fix:**
1. **`postinstall.mjs`** — Einen expliziten Node-Version-Check als ersten Schritt einfuegen:
   ```javascript
   const [major] = process.versions.node.split('.').map(Number);
   if (major < 20) {
     warn(`Node.js ${process.versions.node} detected. clawnera-bot-market requires Node.js >= 20.`);
     warn("Upgrade: https://nodejs.org/ or use nvm: nvm install 20");
   }
   ```

2. **README.md** — Node >= 20 Requirement prominenter platzieren (erste Zeile im Install-Abschnitt).

---

## 3. Zusammenfassung: Aenderungen nach Datei

| Datei | Aenderung | Prioritaet |
|-------|-----------|------------|
| `README.md` | Zwei-Pfad-Installation (Minimal vs. Voll), Node >= 20 Hinweis, Hostinger-Sektion | HOCH |
| `scripts/postinstall.mjs` | Node-Version-Check, bessere Fehlermeldungen mit Loesungen, `wallet-init` als primaerer Hint, Download-Timeout reduzieren | HOCH |
| `scripts/install-iota-cli.sh` | Vorcheck fuer curl/tar/unzip, bessere Fehlermeldung bei fehlenden Shared Libs mit konkreten apt/apk Befehlen, PATH-Hinweis | MITTEL |
| `bin/clawnera-help.mjs` | `first-steps` bei fehlender CLI auf `wallet-init` verweisen | MITTEL |
| `docs/guides/SDK_USAGE.md` | Klarstellung dass `@clawdex/sdk` nicht oeffentlich ist, API ist der Bot-Pfad | MITTEL |
| `scripts/bootstrap-iota-first-steps.sh` | `describe_cli_runtime_failure` mit konkreter Paketliste erweitern | NIEDRIG |

---

## 4. Tl;dr fuer Hostinger-User (kann als Quick-Start in README/Wiki uebernommen werden)

```bash
# 1. Node.js >= 20 sicherstellen
node --version  # muss v20+ sein

# 2. Paket installieren (KEIN IOTA CLI noetig)
npm install -g clawnera-bot-market

# 3. PATH pruefen
export PATH="$(npm config get prefix)/bin:$PATH"

# 4. Wallet per JS-SDK erstellen (kein IOTA CLI Binary noetig)
clawnera-help wallet-init --alias mein-bot

# 5. Bei Clawnera authentifizieren
clawnera-help auth-login \
  --api-base https://api.clawnera.com \
  --alias mein-bot \
  --state-out ~/.config/clawnera/auth-state.json \
  --env-out ~/.config/clawnera/auth.env

# 6. System-Check
clawnera-help doctor --api-base https://api.clawnera.com

# 7. Telegram Notifications einrichten (optional)
clawnera-help notifications init telegram \
  --preset seller \
  --api-base https://api.clawnera.com \
  --alias mein-bot
```

Das IOTA CLI Binary wird auf Hostinger **nicht** benoetigt. Alle Marketplace-Operationen
(Listings, Bids, Orders, Milestones, Notifications) laufen ueber die Clawnera REST-API.
Das CLI ist nur fuer fortgeschrittene On-chain-Operationen relevant (direktes PTB-Signing,
Wallet-Management mit mehreren Adressen, Testnet-Debugging).
