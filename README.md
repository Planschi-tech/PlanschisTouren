# PlanschisTouren

Ein persönliches Tampermonkey-Userscript für Bergsteiger. Es sammelt beim Surfen
auf **bergsteigen.com** die Metadaten der Touren, die du selbst öffnest, lässt dich
eigene Touren ergänzen, merkt sich pro Tour einen **„Bereits gemacht"-Status** und
zeigt alles auf einer **interaktiven Karte**. Der komplette Datenbestand ist als
**XML-Datei** exportier- und importierbar – ideal für Backup, Umzug auf einen
anderen Rechner oder Versionierung.

Alles läuft ausschließlich **lokal im Browser**. Es gibt keinen Server, keine
Anmeldung und keine Übertragung deiner Daten an Dritte.

---

## Inhalt

- [Installation](#installation)
- [Schnellstart](#schnellstart)
  - [Tour von bergsteigen.com erfassen](#1-tour-von-bergsteigencom-erfassen)
  - [Eigene Tour manuell hinzufügen](#2-eigene-tour-manuell-hinzufügen)
  - [Als erledigt markieren](#3-als-erledigt-markieren)
  - [Karte, Filter & Suche](#4-karte-filter--suche)
  - [XML exportieren / importieren](#5-xml-exportieren--importieren)
- [Datenformat (XML)](#datenformat-xml)
- [Wie werden die Daten gespeichert?](#wie-werden-die-daten-gespeichert)
- [Rechtliche Grenzen & Fairness](#rechtliche-grenzen--fairness)
- [Fehlerbehebung (FAQ)](#fehlerbehebung-faq)

---

## Installation

1. **Tampermonkey installieren** (kostenlose Browser-Erweiterung) für deinen Browser:
   - [Chrome / Edge / Brave](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)

   > Hinweis für **Chrome/Edge**: Damit Userscripts laufen, muss der
   > **Entwicklermodus** in `chrome://extensions` (bzw. `edge://extensions`)
   > aktiviert sein.

2. **Skript installieren** – eine der beiden Varianten:
   - **Datei:** `planschistouren.user.js` in Tampermonkey öffnen
     (Tampermonkey-Icon → *Dashboard* → Tab *Dienstprogramme* → *Datei importieren*,
     oder die Datei einfach per Drag-&-Drop ins Dashboard ziehen). Alternativ die
     Datei per `file://…/planschistouren.user.js` im Browser öffnen – Tampermonkey bietet
     die Installation an.
   - **Neues Skript einfügen:** Tampermonkey → *Neues Skript erstellen*, den
     kompletten Inhalt von `planschistouren.user.js` einfügen und mit `Strg+S` speichern.

3. Fertig. Beim ersten Öffnen der Karte lädt Tampermonkey die Kartenbibliothek
   **Leaflet** einmalig nach (danach funktioniert die Karte auch offline; nur die
   Kartenkacheln selbst brauchen Internet).

---

## Schnellstart

Nach der Installation stehen dir zwei Bedienwege zur Verfügung:

- **Schwebender Button** unten rechts auf jeder bergsteigen.com-Tourenseite.
- **Tampermonkey-Menü** (Klick aufs Tampermonkey-Icon, während du auf
  bergsteigen.com bist):
  - `📍 Diese Tour erfassen`
  - `➕ Tour manuell hinzufügen`
  - `🗺 Karte öffnen`
  - `📤 Als XML exportieren`
  - `📥 XML importieren`
  - `🗑 Alle Touren löschen`

### 1. Tour von bergsteigen.com erfassen

1. Öffne eine beliebige Tourenseite, z. B.
   `https://www.bergsteigen.com/touren/klettern/fuer-andi-leonhardstein/`.
2. Klicke unten rechts auf **„📍 Zur Tourenliste hinzufügen"**.
3. Das Skript liest automatisch aus der Seite:
   Name, Schwierigkeitsgrad, Tourtyp (aus der URL), Region/Gebirge, Berg,
   die **Koordinaten des Ausgangspunkts** (aus dem Google-Maps-Anfahrtslink) und –
   falls vorhanden – den **GPX-Link**.
4. Ein Formular öffnet sich, in dem du alle Felder **prüfen und korrigieren** kannst.
   Konnte etwas nicht erkannt werden, erscheint ein Hinweis
   („Konnte nicht alles automatisch erkennen – bitte prüfen/ergänzen"). Ergänze die
   fehlenden Felder von Hand.
5. Mit **Speichern** wird die Tour in deine lokale Liste übernommen.

> Wird dieselbe Tour später erneut erfasst, erkennt PlanschisTouren das an der `id`
> (abgeleitet aus der URL) und bietet ein **Aktualisieren** an – deine Notizen und
> der Erledigt-Status bleiben dabei erhalten.

### 2. Eigene Tour manuell hinzufügen

Für Touren aus anderen Quellen oder eigene Erstbegehungen – **unabhängig von
bergsteigen.com**:

- Tampermonkey-Menü → **`➕ Tour manuell hinzufügen`**, oder in der Kartenansicht
  oben auf **„➕ Manuell"**.
- Fülle das Formular aus (Name ist Pflicht; Koordinaten bitte entweder **beide**
  angeben oder beide leer lassen). Touren ohne Koordinaten erscheinen in der Liste,
  aber nicht als Marker auf der Karte.

### 3. Als erledigt markieren

Jede Tour hat einen `done`-Status und ein optionales `doneDate`. Umschalten kannst du ihn:

- **Im Kartenpopup:** Marker anklicken → Häkchen **„erledigt"** setzen. Ist noch kein
  Datum gesetzt, wird automatisch das heutige eingetragen.
- **Im Formular:** beim Bearbeiten einer Tour (Popup → *Bearbeiten*) das Feld
  „Bereits gemacht" und das Datum setzen.

Auf der Karte werden erledigte Touren durch einen **umrandeten (hohlen) Gipfel mit
Häkchen** dargestellt, offene durch einen **gefüllten Gipfel**. In der Liste sind
erledigte Touren abgeschwächt und mit ✓ markiert.

### 4. Karte, Filter & Suche

- Öffnen über Tampermonkey-Menü **`🗺 Karte öffnen`** oder den **„🗺 Karte"**-Button
  unten rechts. Die Karte öffnet sich als Vollbild-Overlay (mit `Esc` oder **✕**
  schließen).
- **Marker** sind farbige Punkte, eingefärbt nach Schwierigkeit:
  🟢 leicht (1–4) · 🟡 mittel (5–6) · 🔴 schwer (7+) · ⚪ ohne Gradangabe.
  Erledigte Touren erscheinen als heller Punkt mit farbigem Ring und Häkchen.
- **Kartenhintergrund** umschaltbar zwischen **OpenTopoMap** und **OpenStreetMap**
  (oben rechts).
- **Filter** in der Seitenleiste: Tourtyp, Region, Status (offen/erledigt),
  Schwierigkeitsstufen (Checkboxen) und eine **Textsuche** über Name, Region, Berg,
  Grad, Typ und Notizen.
- **Klick auf einen Listeneintrag** zoomt zum Marker und öffnet die Detailansicht mit
  Notizen, Links (Originalseite, GPX) sowie Buttons für *Erledigt*, *Bearbeiten* und
  *Löschen*.

### 5. XML exportieren / importieren

- **Export:** Karte → **„📤 XML export"** (oder Menü `📤 Als XML exportieren`). Es wird
  eine Datei `planschistouren-JJJJ-MM-TT.xml` mit deinem **kompletten** Datenbestand
  heruntergeladen.
- **Import:** Karte → **„📥 XML import"** (oder Menü `📥 XML importieren`), Datei
  auswählen. Die Touren werden mit dem bestehenden Bestand **zusammengeführt**:
  - Neue Touren werden hinzugefügt.
  - Identische Touren werden übersprungen.
  - Bei **Konflikten** (gleiche Tour, andere Inhalte – erkannt anhand `id` bzw.
    `link`+`name`/Koordinaten) fragt PlanschisTouren nach:
    **Behalten**, **Beide behalten** oder **Überschreiben** – auf Wunsch
    „für alle weiteren Konflikte übernehmen".

**Umzug auf einen anderen Rechner:** dort PlanschisTouren installieren, die exportierte
`.xml` importieren – fertig.

---

## Datenformat (XML)

Die Exportdatei ist bewusst gut lesbar und versionierbar (z. B. in Git):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<planschistouren version="1.1" exportedAt="2026-07-07T12:00:00Z">
  <tour id="bs-fuer-andi-leonhardstein">
    <name>Für Andi - Leonhardstein</name>
    <lat>47.6225</lat>
    <lng>11.7133</lng>
    <grade>6 / 6-</grade>
    <type>Klettern</type>
    <region>Bayerische Voralpen</region>
    <mountain>Leonhardstein</mountain>
    <notes>Gute Alternative zur Flora Bohra bei Andrang.</notes>
    <link>https://www.bergsteigen.com/touren/klettern/fuer-andi-leonhardstein/</link>
    <gpxLink>https://www.bergsteigen.com/fileadmin/.../track.gpx</gpxLink>
    <source>bergsteigen.com</source>
    <addedAt>2026-07-07T10:00:00Z</addedAt>
    <done>false</done>
    <doneDate></doneDate>
  </tour>
  <tour id="manual-1720000000000">
    <name>Eigene Erstbegehung Musterwand</name>
    <lat>47.5000</lat>
    <lng>11.5000</lng>
    <grade>V</grade>
    <type>Mehrseillänge</type>
    <region>Karwendel</region>
    <mountain></mountain>
    <notes>Nicht auf bergsteigen.com gelistet.</notes>
    <link></link>
    <gpxLink></gpxLink>
    <source>manual</source>
    <addedAt>2026-07-07T10:05:00Z</addedAt>
    <done>true</done>
    <doneDate>2026-06-15</doneDate>
  </tour>
</planschistouren>
```

> Import-Kompatibilität: Ältere Backups mit `<gratlinie>…</gratlinie>` als
> Wurzelelement werden weiterhin problemlos eingelesen.

**Feldübersicht**

| Feld       | Bedeutung |
|------------|-----------|
| `id`       | Eindeutige ID. Für bergsteigen.com-Touren `bs-<slug-aus-url>`, für eigene `manual-<zeit>`. |
| `name`     | Name der Tour (Pflichtfeld). |
| `lat`,`lng`| Koordinaten des Ausgangspunkts (Dezimalgrad). Leer = kein Kartenmarker. |
| `grade`    | Schwierigkeitsgrad als Text (z. B. `VI (Stelle VI-)`, `6 / 6-`, `ZS+`, `C/D`). |
| `type`     | Tourtyp (Klettern, Mehrseillänge, Klettersteig, Hochtour, Skitour, …). |
| `region`   | Region/Gebirge. |
| `mountain` | Berg. |
| `notes`    | Deine eigenen Notizen. |
| `link`     | Link zur Originalseite (bei bergsteigen.com immer gesetzt). |
| `gpxLink`  | Optionaler GPX-Download-Link. |
| `source`   | `bergsteigen.com`, `manual` oder `import`. |
| `addedAt`  | Zeitpunkt des Hinzufügens (ISO-8601). |
| `done`     | `true`/`false` – bereits gemacht? |
| `doneDate` | Datum der Begehung (`JJJJ-MM-TT`), optional. |

---

## Wie werden die Daten gespeichert?

- **Live-Zustand:** intern im Tampermonkey-Speicher (`GM_setValue`/`GM_getValue`) als
  JSON, damit alles ohne Klick sofort funktioniert.
- **Portabel:** über **Export/Import** als vollständige XML-Datei (siehe oben). Die
  XML-Datei ist die „Umzugs-/Backup-Form" deines Datenbestands.

Nichts verlässt jemals deinen Rechner, außer du lädst die XML-Datei bewusst herunter.

---

## Rechtliche Grenzen & Fairness

PlanschisTouren ist ein **persönliches Werkzeug**, kein Scraper für Massendaten. Bitte
respektiere das – auch zu deinem eigenen Schutz:

- **Kein automatisches Crawling.** Verarbeitet werden ausschließlich Seiten, die du
  **selbst aktiv öffnest** und per Button erfasst.
- **Nur Metadaten.** Gespeichert werden lediglich strukturierte Metadaten (Name,
  Grad, Koordinaten, Typ, Region, Berg, Links). **Keine** Tourenbeschreibungen,
  Fotos oder Topos von bergsteigen.com – diese sind laut deren AGB
  urheberrechtlich geschützt. Der **Link zur Originalseite** wird immer
  mitgespeichert, damit du Beschreibung, Fotos und Topo dort abrufen kannst.
- **Lokal & privat.** Alle Daten bleiben im Browser bzw. in deiner selbst
  heruntergeladenen XML-Datei. Keine Weitergabe an Dritte.

Die Kartenkacheln stammen von **OpenStreetMap** und **OpenTopoMap** – nutze sie im
Rahmen ihrer üblichen, maßvollen Nutzungsbedingungen (persönlicher Gebrauch).

---

## Fehlerbehebung (FAQ)

**Der Button erscheint nicht.**
Prüfe, dass Tampermonkey aktiv ist und das Skript aktiviert ist. Der große Button
„📍 Zur Tourenliste hinzufügen" erscheint nur auf **Tourendetailseiten**
(`…/touren/<kategorie>/<tour>/`). Auf der Startseite gibt es nur die kleinen
Buttons „🗺 Karte" und „➕". In Chrome/Edge muss der **Entwicklermodus** aktiv sein.

**„Konnte nicht alles automatisch erkennen".**
bergsteigen.com kann seine Seitenstruktur ändern. PlanschisTouren zeigt dann, was es
gefunden hat, und du ergänzt den Rest im Formular von Hand – gespeichert wird
trotzdem sauber.

**Die Karte bleibt grau / lädt keine Kacheln.**
Kartenkacheln brauchen Internet. Falls dein Netzwerk OpenStreetMap/OpenTopoMap
blockt, wechsle oben rechts den Kartenhintergrund. Bereits gespeicherte Touren und
Marker funktionieren auch ohne Kacheln.

**Ich habe aus Versehen alles gelöscht.**
Deshalb regelmäßig **exportieren**. Über `📥 XML importieren` holst du einen früheren
Stand zurück.

**Umzug/Backup.**
`📤 Als XML exportieren` auf dem alten Rechner, Datei sichern, auf dem neuen Rechner
`📥 XML importieren`.

---

*PlanschisTouren · lokales, quelloffenes Userscript · Berg heil! ⛰*
