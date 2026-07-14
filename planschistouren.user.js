// ==UserScript==
// @name         PlanschisTouren
// @namespace    https://github.com/planschistouren/planschistouren
// @version      1.2.0
// @description  Sammelt Bergtouren von bergsteigen.com, erlaubt eigene Touren, speichert einen Erledigt-Status und zeigt alles auf einer interaktiven Karte. Kompletter Datenbestand als XML exportier-/importierbar. Rein lokal, kein Backend.
// @author       PlanschisTouren
// @license      MIT
// @match        https://www.bergsteigen.com/touren/*/*
// @match        https://bergsteigen.com/touren/*/*
// @match        https://www.bergsteigen.com/
// @match        https://bergsteigen.com/
// @icon         https://www.bergsteigen.com/favicon.ico
// @run-at       document-idle
// @noframes
// @require      https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
// @resource     LEAFLET_CSS https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_download
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==

/*
 * PlanschisTouren — persönliches Werkzeug für Bergsteiger.
 *
 * WICHTIG (rechtlich / fair use):
 *  - Es werden ausschließlich strukturierte Metadaten gespeichert (Name, Grad,
 *    Koordinaten, Typ, Region, Berg, Links). KEINE Tourenbeschreibungen, Fotos
 *    oder Topos von bergsteigen.com – diese sind laut AGB urheberrechtlich
 *    geschützt. Der Link zur Originalseite wird immer mitgespeichert.
 *  - Es findet KEIN automatisches Crawling statt. Verarbeitet werden nur Seiten,
 *    die der Nutzer selbst aktiv öffnet und per Button erfasst.
 *  - Alle Daten bleiben lokal (Tampermonkey-Storage bzw. selbst heruntergeladene
 *    XML-Datei). Keine Übertragung an Dritte.
 */

/* global L, GM_setValue, GM_getValue, GM_registerMenuCommand, GM_download,
          GM_getResourceText, GM_addStyle */

(function () {
  'use strict';

  // =========================================================================
  //  0. Konstanten / Design-Tokens
  // =========================================================================
  const APP = 'PlanschisTouren';
  const STORE_KEY = 'planschistouren_tours_v1';
  const OLD_STORE_KEYS = ['gratlinie_tours_v1']; // Altbestände zum automatischen Migrieren
  const XML_ROOT = 'planschistouren';
  const XML_ROOTS_ACCEPTED = ['planschistouren', 'gratlinie']; // Import akzeptiert auch alte Dateien
  const XML_VERSION = '1.1';

  // Feldreihenfolge des XML-Schemas (auch für Serialisierung genutzt)
  const XML_FIELDS = [
    'name', 'lat', 'lng', 'grade', 'type', 'region', 'mountain',
    'notes', 'link', 'gpxLink', 'source', 'addedAt', 'done', 'doneDate'
  ];

  // Schwierigkeits-Stufen -> Farbe (leicht 1–4, mittel 5–6, schwer ab 7)
  const TIERS = {
    green: { key: 'green', color: '#15803d', label: 'leicht (1–4)' },
    amber: { key: 'amber', color: '#b45309', label: 'mittel (5–6)' },
    red:   { key: 'red',   color: '#dc2626', label: 'schwer (7+)' },
    grey:  { key: 'grey',  color: '#6b7280', label: 'ohne Gradangabe' }
  };

  // Auswahlvorschläge für das Typ-Feld
  const TYPE_SUGGESTIONS = [
    'Klettern', 'Mehrseillänge', 'Klettergarten', 'Klettersteig',
    'Hochtour', 'Skitour', 'Eisklettern', 'Bergtour', 'Wanderung', 'Sonstiges'
  ];

  // =========================================================================
  //  1. kleine Helfer
  // =========================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const nowIso = () => new Date().toISOString();

  const uid = () =>
    Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  // Whitespace zusammenfassen, trimmen, optionalen Doppelpunkt am Ende entfernen
  const clean = (s) =>
    String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();

  const absUrl = (href) => {
    try { return new URL(href, location.origin).href; } catch (e) { return href || ''; }
  };

  const isFiniteNum = (n) => typeof n === 'number' && isFinite(n);

  const parseNum = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  };

  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  // =========================================================================
  //  2. Datenmodell / Storage-Layer
  // =========================================================================
  //  Interner Live-Zustand liegt als JSON in GM_setValue/GM_getValue (schnell,
  //  kein XML-Parsing bei jedem Seitenaufruf). XML ist das portable Export-/
  //  Importformat (siehe Abschnitt 3).

  function normalizeTour(t) {
    const o = {
      id: (t.id && String(t.id).trim()) || ('manual-' + Date.now() + '-' + uid()),
      name: clean(t.name || ''),
      lat: isFiniteNum(t.lat) ? t.lat : parseNum(t.lat),
      lng: isFiniteNum(t.lng) ? t.lng : parseNum(t.lng),
      grade: clean(t.grade || ''),
      type: clean(t.type || ''),
      region: clean(t.region || ''),
      mountain: clean(t.mountain || ''),
      notes: (t.notes == null ? '' : String(t.notes)).trim(),
      link: (t.link || '').trim(),
      gpxLink: (t.gpxLink || '').trim(),
      source: (t.source || 'manual').trim(),
      addedAt: t.addedAt || nowIso(),
      done: t.done === true || t.done === 'true' || t.done === 1,
      doneDate: (t.doneDate || '').trim()
    };
    return o;
  }

  // Einmalige Übernahme früher gespeicherter Daten (z.B. aus der Zeit als das
  // Skript noch anders hieß), damit beim Umbenennen nichts verloren geht.
  function migrateStore() {
    try {
      const cur = GM_getValue(STORE_KEY, null);
      if (cur != null) return;
      for (const oldKey of OLD_STORE_KEYS) {
        const old = GM_getValue(oldKey, null);
        if (old != null) { GM_setValue(STORE_KEY, old); return; }
      }
    } catch (e) { /* ignore */ }
  }

  function loadTours() {
    let raw;
    try {
      raw = GM_getValue(STORE_KEY, null);
      if (raw == null) {
        // Fallback: evtl. noch nicht migrierte Altbestände direkt lesen
        for (const oldKey of OLD_STORE_KEYS) {
          const old = GM_getValue(oldKey, null);
          if (old != null) { raw = old; break; }
        }
      }
    } catch (e) { raw = null; }
    if (raw == null) raw = '[]';
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    return arr.map(normalizeTour);
  }

  function saveTours(arr) {
    const data = JSON.stringify(arr.map(normalizeTour));
    try { GM_setValue(STORE_KEY, data); }
    catch (e) { console.error('[' + APP + '] Speichern fehlgeschlagen', e); }
  }

  function getTour(id) { return loadTours().find((t) => t.id === id) || null; }

  // Eintrag einfügen oder ersetzen (per id). Gibt gespeicherte Liste zurück.
  function upsertTour(tour) {
    const arr = loadTours();
    const t = normalizeTour(tour);
    const i = arr.findIndex((x) => x.id === t.id);
    if (i >= 0) arr[i] = t; else arr.push(t);
    saveTours(arr);
    return arr;
  }

  function deleteTour(id) {
    const arr = loadTours().filter((t) => t.id !== id);
    saveTours(arr);
    return arr;
  }

  // =========================================================================
  //  3. XML-Serialisierung / -Deserialisierung
  // =========================================================================
  function xmlEscape(s, isAttr) {
    let out = String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (isAttr) out = out.replace(/"/g, '&quot;');
    return out;
  }

  function toursToXml(tours) {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<' + XML_ROOT + ' version="' + XML_VERSION + '" exportedAt="' + nowIso() + '">');
    for (const t of tours) {
      lines.push('  <tour id="' + xmlEscape(t.id, true) + '">');
      for (const f of XML_FIELDS) {
        let v = t[f];
        if (f === 'done') v = t.done ? 'true' : 'false';
        if (v == null) v = '';
        lines.push('    <' + f + '>' + xmlEscape(v) + '</' + f + '>');
      }
      lines.push('  </tour>');
    }
    lines.push('</' + XML_ROOT + '>');
    return lines.join('\n');
  }

  // Gibt { tours: [...] } oder { error: '...' } zurück.
  function xmlToTours(xmlStr) {
    let doc;
    try { doc = new DOMParser().parseFromString(xmlStr, 'application/xml'); }
    catch (e) { return { error: 'XML konnte nicht gelesen werden.' }; }

    const perr = doc.querySelector('parsererror');
    if (perr) {
      return { error: 'Ungültiges XML: ' + clean(perr.textContent).slice(0, 180) };
    }
    const tourEls = $$('tour', doc);
    if (!tourEls.length && !doc.querySelector(XML_ROOTS_ACCEPTED.join(','))) {
      return { error: 'Keine <' + XML_ROOT + '>/<tour>-Struktur gefunden.' };
    }

    const tours = tourEls.map((el) => {
      const get = (name) => {
        const c = el.querySelector(name);
        return c ? c.textContent : '';
      };
      return normalizeTour({
        id: el.getAttribute('id') || ('import-' + uid()),
        name: get('name'),
        lat: get('lat'),
        lng: get('lng'),
        grade: get('grade'),
        type: get('type'),
        region: get('region'),
        mountain: get('mountain'),
        notes: get('notes'),
        link: get('link'),
        gpxLink: get('gpxLink'),
        source: get('source') || 'import',
        addedAt: get('addedAt') || nowIso(),
        done: /^(true|1|yes|ja)$/i.test(clean(get('done'))),
        doneDate: get('doneDate')
      });
    });
    return { tours };
  }

  // =========================================================================
  //  4. Export / Import
  // =========================================================================
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'application/xml') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Primär: klassischer <a download> (funktioniert zuverlässig mit Blob-URLs).
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      cleanup();
      return;
    } catch (e) { /* fällt auf GM_download zurück */ }

    if (typeof GM_download === 'function') {
      try {
        GM_download({ url, name: filename, saveAs: true, onerror: cleanup, ontimeout: cleanup, onload: cleanup });
        return;
      } catch (e) { /* ignore */ }
    }
    cleanup();
    toast('Download nicht möglich – bitte Berechtigungen prüfen.', 'error');
  }

  function exportXml() {
    const tours = loadTours();
    if (!tours.length) {
      toast('Noch keine Touren zum Exportieren vorhanden.', 'error');
      return;
    }
    const xml = toursToXml(tours);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText('planschistouren-' + stamp + '.xml', xml, 'application/xml');
    toast(tours.length + ' Tour(en) als XML exportiert.', 'ok');
  }

  // true, wenn beide Einträge inhaltlich als "dieselbe Tour" gelten
  function sameTour(a, b) {
    if (a.id && b.id && a.id === b.id) return true;
    if (a.link && b.link && a.link.replace(/\/+$/, '') === b.link.replace(/\/+$/, '')) return true;
    const near = (x, y) => x != null && y != null && Math.abs(x - y) < 0.0005;
    if (a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase()) {
      if ((a.lat == null && a.lng == null) || (near(a.lat, b.lat) && near(a.lng, b.lng))) return true;
    }
    return false;
  }

  function toursIdentical(a, b) {
    return XML_FIELDS.every((f) => String(a[f] == null ? '' : a[f]) === String(b[f] == null ? '' : b[f]));
  }

  function importXmlFlow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml,application/xml,text/xml';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => runImport(String(reader.result || ''));
      reader.onerror = () => toast('Datei konnte nicht gelesen werden.', 'error');
      reader.readAsText(file, 'UTF-8');
    });
    document.body.appendChild(input);
    input.click();
  }

  async function runImport(xmlStr) {
    const res = xmlToTours(xmlStr);
    if (res.error) { toast(res.error, 'error'); return; }
    if (!res.tours.length) { toast('Die Datei enthält keine Touren.', 'error'); return; }

    let cur = loadTours();
    let added = 0, updated = 0, kept = 0;
    let applyAll = null; // gemerkte Entscheidung "für alle anwenden"

    for (const inc of res.tours) {
      const existing = cur.find((t) => sameTour(t, inc));
      if (!existing) { cur.push(inc); added++; continue; }
      if (toursIdentical(existing, inc)) { kept++; continue; }

      let action = applyAll;
      if (!action) {
        const choice = await conflictDialog(existing, inc);
        action = choice.action;
        if (choice.all) applyAll = action;
      }
      if (action === 'overwrite') {
        Object.assign(existing, inc, { id: existing.id }); // id des Bestands beibehalten
        updated++;
      } else if (action === 'both') {
        inc.id = inc.id + '-imp-' + uid();
        cur.push(inc);
        added++;
      } else { // 'keep'
        kept++;
      }
    }

    saveTours(cur);
    toast('Import: +' + added + ' neu · ' + updated + ' aktualisiert · ' + kept + ' behalten', 'ok');
    updateFabBadge();
    if (mapState.open) rebuildMapData();
  }

  // =========================================================================
  //  5. Scraping von bergsteigen.com
  // =========================================================================
  function isTourDetailPage() {
    // /touren/<kategorie>/<slug>/  (mind. zwei Segmente nach "touren")
    const segs = location.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('touren');
    return i >= 0 && segs.length >= i + 3 && !!$('h1');
  }

  function tourSlug() {
    const segs = location.pathname.split('/').filter(Boolean);
    return segs[segs.length - 1] || segs[segs.length - 2] || '';
  }

  // Wert aus dem stabilen ".itemWrap > .itemLabel + .itemValue"-Muster lesen
  function itemValueByLabel(re) {
    const wraps = $$('.itemWrap, .scalaItem, .itemInfoWrap');
    for (const w of wraps) {
      const lab = w.querySelector('.itemLabel');
      if (lab && re.test(clean(lab.textContent))) {
        const val = w.querySelector('.itemValue');
        if (val && clean(val.textContent)) return clean(val.textContent);
      }
    }
    // Fallback: allgemeine dt/dd- oder th/td-Paare
    for (const dt of $$('dt, th')) {
      if (re.test(clean(dt.textContent))) {
        const dd = dt.nextElementSibling;
        if (dd && clean(dd.textContent)) return clean(dd.textContent);
      }
    }
    return '';
  }

  function scrapeName() {
    const h1 = $$('h1').map((h) => clean(h.textContent)).find(Boolean);
    if (h1) return h1;
    const og = $('meta[property="og:title"]');
    if (og) return clean(og.getAttribute('content')).replace(/\s*\|\s*Bergsteigen\.com.*$/i, '');
    return '';
  }

  function scrapeGrade() {
    // Strategie 1: Wrapper mit data-tip="Schwierigkeit" -> .iconInfoValue
    let el = $('[data-tip="Schwierigkeit"] .iconInfoValue');
    // Strategie 2: .iconInfoLabel "Schwierigkeit" -> Geschwister-.iconInfoValue
    if (!el) {
      for (const l of $$('.iconInfoLabel')) {
        if (/schwierigkeit/i.test(l.textContent)) {
          el = l.parentElement && l.parentElement.querySelector('.iconInfoValue');
          if (el) break;
        }
      }
    }
    if (el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('br').forEach((b) => b.replaceWith(' / '));
      let g = clean(clone.textContent).replace(/\s*\/\s*\/\s*/g, ' / ').replace(/^\/\s*|\s*\/$/g, '');
      if (g) return g.trim();
    }
    // Strategie 3: itemLabel "Schwierigkeit"
    return itemValueByLabel(/schwierigkeit|schwierigkeitsgrad|^diff/i);
  }

  function scrapeType() {
    const segs = location.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('touren');
    const cat = (i >= 0 && segs[i + 1]) ? segs[i + 1] : '';
    const map = {
      klettern: 'Klettern', klettersteig: 'Klettersteig',
      hochtour: 'Hochtour', hochtouren: 'Hochtour',
      skitour: 'Skitour', skitouren: 'Skitour',
      eisklettern: 'Eisklettern', klettergarten: 'Klettergarten',
      mehrseillaengen: 'Mehrseillänge', wandern: 'Wanderung',
      bergtour: 'Bergtour', bergtouren: 'Bergtour'
    };
    if (cat) {
      const key = cat.toLowerCase();
      if (map[key]) return map[key];
      return key.charAt(0).toUpperCase() + key.slice(1);
    }
    // Fallback: vorletztes Breadcrumb-Element
    const crumbs = $$('#clickpath [itemprop="name"], .breadcrumb a, nav[aria-label] a').map((a) => clean(a.textContent));
    if (crumbs.length >= 2) return crumbs[crumbs.length - 2] || crumbs[1] || '';
    return '';
  }

  function scrapeCoords() {
    // 1) Google-Maps-Anfahrtslink (…/maps/dir//LAT,LNG/…) in Anchors
    for (const a of $$('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!/google\.[a-z.]+\/maps/i.test(href)) continue;
      let m = href.match(/\/dir\/\/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) ||
              href.match(/[@?](-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
      if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    }
    // 2) Notfalls das gesamte HTML durchsuchen (z.B. eingebettete iframes/Skripte)
    const html = document.documentElement.innerHTML;
    let m = html.match(/\/maps\/dir\/\/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) ||
            html.match(/\/maps\/[^"'<>]*@(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  }

  function scrapeGpx() {
    const a = $$('a[href]').find((x) => /\.gpx(\?.*)?$/i.test(x.getAttribute('href') || ''));
    return a ? absUrl(a.getAttribute('href')) : '';
  }

  function scrapeSourceUrl() {
    const og = $('meta[property="og:url"]');
    if (og && og.getAttribute('content')) return clean(og.getAttribute('content'));
    return location.origin + location.pathname;
  }

  // Liefert { tour, warnings: [] }
  function scrapeCurrentPage() {
    const warnings = [];
    const name = scrapeName();
    const coords = scrapeCoords();
    const region = itemValueByLabel(/^gebirge/i) || itemValueByLabel(/^regionen?/i);
    const mountain = itemValueByLabel(/^berg$|^berge$|^gipfel/i);
    const grade = scrapeGrade();
    const gpx = scrapeGpx();

    if (!name) warnings.push('Name (H1) nicht gefunden.');
    if (!coords) warnings.push('Keine Koordinaten im Google-Maps-Anfahrtslink gefunden.');
    if (!grade) warnings.push('Schwierigkeitsgrad nicht erkannt.');

    const slug = tourSlug();
    const tour = normalizeTour({
      id: slug ? 'bs-' + slug : 'bs-' + uid(),
      name,
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      grade,
      type: scrapeType(),
      region,
      mountain,
      notes: '',
      link: scrapeSourceUrl(),
      gpxLink: gpx,
      source: 'bergsteigen.com',
      addedAt: nowIso(),
      done: false,
      doneDate: ''
    });
    return { tour, warnings };
  }

  function scrapeFlow() {
    if (!isTourDetailPage()) {
      toast('Diese Funktion bitte auf einer Tourenseite (…/touren/…) nutzen.', 'error');
      return;
    }
    const { tour, warnings } = scrapeCurrentPage();
    const existing = getTour(tour.id);
    if (existing) {
      // bereits erfasst -> vorhandene Werte übernehmen, damit Notizen/Erledigt erhalten bleiben
      tour.notes = existing.notes;
      tour.done = existing.done;
      tour.doneDate = existing.doneDate;
      tour.addedAt = existing.addedAt;
    }
    openTourForm(tour, {
      mode: existing ? 'update' : 'scrape',
      warnings
    });
  }

  // =========================================================================
  //  6. Schwierigkeitsgrad -> Farbstufe
  // =========================================================================
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  const SAC_SKI = { L: 1, WS: 2, ZS: 3, S: 4, SS: 5, AS: 6, EX: 7 };
  const KS_LETTER = { A: 1, B: 2, C: 3, D: 5, E: 6, F: 7 }; // Klettersteig A–F

  function gradeNumber(grade) {
    if (!grade) return null;
    const s = grade.toUpperCase();
    const nums = [];

    // arabische Zahlen (UIAA/Französisch), Höhenangaben (>12) ignorieren
    (s.match(/\d{1,2}/g) || []).forEach((n) => { const v = +n; if (v >= 1 && v <= 12) nums.push(v); });

    // römische Zahlen
    (s.match(/\b(?:XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g) || []).forEach((r) => nums.push(ROMAN[r]));

    // SAC-Skitourenskala
    for (const k of Object.keys(SAC_SKI)) {
      if (new RegExp('\\b' + k + '[+-]?\\b').test(s)) nums.push(SAC_SKI[k]);
    }
    // Klettersteig-Buchstaben (nur wenn keine Zahl gefunden)
    if (!nums.length) {
      (s.match(/\b[A-F]\b/g) || []).forEach((c) => { if (KS_LETTER[c]) nums.push(KS_LETTER[c]); });
    }
    if (!nums.length) return null;
    return Math.max.apply(null, nums);
  }

  function gradeTier(grade) {
    const n = gradeNumber(grade);
    if (n == null) return TIERS.grey;
    if (n <= 4) return TIERS.green;
    if (n <= 6) return TIERS.amber;
    return TIERS.red;
  }

  // =========================================================================
  //  7. Basis-Styles + generische UI-Bausteine (Toast, Modal, Dialoge)
  // =========================================================================
  function addStyle(css) {
    if (typeof GM_addStyle === 'function') {
      try { return GM_addStyle(css); } catch (e) { /* ignore */ }
    }
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  }

  let stylesInjected = false;
  function ensureBaseStyles() {
    if (stylesInjected) return;
    // Reine System-Schriften (kein externer Google-Fonts-Request) -> schlicht & offline
    addStyle(BASE_CSS);
    stylesInjected = true; // erst nach erfolgreichem Injizieren setzen
  }

  // Kurze Statusmeldung unten
  function toast(msg, kind) {
    ensureBaseStyles();
    let host = $('#gl-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'gl-toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'gl-toast ' + (kind === 'error' ? 'gl-toast-error' : kind === 'ok' ? 'gl-toast-ok' : '');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('gl-in'));
    setTimeout(() => {
      el.classList.remove('gl-in');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 5200 : 3200);
  }

  // Generisches, vom Seiten-Design abgeschottetes Modal.
  // Gibt { root, box, close } zurück.
  function createModal(opts) {
    ensureBaseStyles();
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'gl-scope gl-modal-backdrop';

    const box = document.createElement('div');
    box.className = 'gl-modal' + (opts.wide ? ' gl-modal-wide' : '');
    root.appendChild(box);

    function close() {
      root.classList.remove('gl-in');
      setTimeout(() => root.remove(), 180);
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape' && opts.closeOnEsc !== false) { e.stopPropagation(); close(); }
    }
    if (opts.closeOnBackdrop !== false) {
      root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    }
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('gl-in'));
    return { root, box, close };
  }

  // Konflikt-Dialog beim Import. Promise -> { action:'overwrite'|'keep'|'both', all:boolean }
  function conflictDialog(existing, incoming) {
    return new Promise((resolve) => {
      const m = createModal({ closeOnBackdrop: false, closeOnEsc: false });
      const summary = (t) =>
        '<div class="gl-conf-card">' +
          '<div class="gl-badge gl-mono">' + esc(t.grade || '–') + '</div>' +
          '<div><strong>' + esc(t.name || '(ohne Name)') + '</strong>' +
          '<div class="gl-muted gl-small">' + esc([t.type, t.region].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="gl-muted gl-small">' + (t.done ? '✓ erledigt' : 'offen') + (t.doneDate ? ' · ' + esc(t.doneDate) : '') + '</div>' +
          '</div></div>';

      m.box.innerHTML =
        '<h2 class="gl-h">Konflikt beim Import</h2>' +
        '<p class="gl-muted">Diese Tour existiert bereits. Was soll passieren?</p>' +
        '<div class="gl-conf-grid">' +
          '<div><div class="gl-label">Bestehend</div>' + summary(existing) + '</div>' +
          '<div><div class="gl-label">Aus Datei</div>' + summary(incoming) + '</div>' +
        '</div>' +
        '<label class="gl-check"><input type="checkbox" id="gl-conf-all"> Entscheidung für alle weiteren Konflikte übernehmen</label>' +
        '<div class="gl-actions">' +
          '<button class="gl-btn" data-act="keep">Behalten</button>' +
          '<button class="gl-btn" data-act="both">Beide behalten</button>' +
          '<button class="gl-btn gl-btn-primary" data-act="overwrite">Überschreiben</button>' +
        '</div>';

      m.box.querySelectorAll('button[data-act]').forEach((b) => {
        b.addEventListener('click', () => {
          const all = m.box.querySelector('#gl-conf-all').checked;
          m.close();
          resolve({ action: b.getAttribute('data-act'), all });
        });
      });
    });
  }

  function confirmDialog(title, message, okLabel) {
    return new Promise((resolve) => {
      const m = createModal({ closeOnBackdrop: false });
      m.box.innerHTML =
        '<h2 class="gl-h">' + esc(title) + '</h2>' +
        '<p class="gl-muted">' + esc(message) + '</p>' +
        '<div class="gl-actions">' +
          '<button class="gl-btn" data-act="no">Abbrechen</button>' +
          '<button class="gl-btn gl-btn-danger" data-act="yes">' + esc(okLabel || 'OK') + '</button>' +
        '</div>';
      m.box.querySelector('[data-act="no"]').addEventListener('click', () => { m.close(); resolve(false); });
      m.box.querySelector('[data-act="yes"]').addEventListener('click', () => { m.close(); resolve(true); });
    });
  }

  const esc = (s) => xmlEscape(s, false);

  // =========================================================================
  //  8. Tour-Formular (erfassen / manuell / bearbeiten)
  // =========================================================================
  function openTourForm(tour, opts) {
    opts = opts || {};
    const mode = opts.mode || 'manual';
    const t = normalizeTour(tour || {});
    const m = createModal({ closeOnBackdrop: false });

    const titleMap = {
      scrape: '📍 Tour erfassen',
      update: '📍 Tour aktualisieren',
      manual: '➕ Tour manuell hinzufügen',
      edit: '✏️ Tour bearbeiten'
    };

    const warnHtml = (opts.warnings && opts.warnings.length)
      ? '<div class="gl-warn">⚠️ Konnte nicht alles automatisch erkennen – bitte prüfen/ergänzen:<ul>' +
        opts.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>'
      : '';

    const dl = TYPE_SUGGESTIONS.map((x) => '<option value="' + esc(x) + '">').join('');

    m.box.innerHTML =
      '<h2 class="gl-h">' + (titleMap[mode] || titleMap.manual) + '</h2>' +
      warnHtml +
      '<form id="gl-form" autocomplete="off">' +
        field('name', 'Name *', 'text', t.name, 'z. B. Für Andi – Leonhardstein') +
        '<div class="gl-row2">' +
          field('lat', 'Breitengrad (Lat)', 'text', t.lat == null ? '' : t.lat, '47.6225') +
          field('lng', 'Längengrad (Lng)', 'text', t.lng == null ? '' : t.lng, '11.7133') +
        '</div>' +
        '<div class="gl-row2">' +
          field('grade', 'Schwierigkeitsgrad', 'text', t.grade, 'z. B. VI (Stelle VI-) / 6') +
          field('type', 'Typ', 'text', t.type, 'Mehrseillänge', 'gl-types') +
        '</div>' +
        '<datalist id="gl-types">' + dl + '</datalist>' +
        '<div class="gl-row2">' +
          field('region', 'Region / Gebirge', 'text', t.region, 'Bayerische Voralpen') +
          field('mountain', 'Berg', 'text', t.mountain, 'Leonhardstein') +
        '</div>' +
        '<label class="gl-field"><span class="gl-label">Notizen</span>' +
          '<textarea name="notes" rows="3" placeholder="Eigene Notizen (keine kopierten Beschreibungen)">' + esc(t.notes) + '</textarea></label>' +
        field('link', 'Link zur Originalseite', 'text', t.link, 'https://www.bergsteigen.com/…') +
        field('gpxLink', 'GPX-Link (optional)', 'text', t.gpxLink, 'https://…/track.gpx') +
        '<div class="gl-row2">' +
          '<label class="gl-check gl-field"><input type="checkbox" name="done" ' + (t.done ? 'checked' : '') + '> Bereits gemacht</label>' +
          field('doneDate', 'Datum (wann gemacht)', 'date', t.doneDate, '') +
        '</div>' +
        '<div class="gl-actions">' +
          '<button type="button" class="gl-btn" data-act="cancel">Abbrechen</button>' +
          '<button type="submit" class="gl-btn gl-btn-primary">Speichern</button>' +
        '</div>' +
      '</form>';

    function field(name, label, type, value, ph, listId) {
      return '<label class="gl-field"><span class="gl-label">' + esc(label) + '</span>' +
        '<input name="' + name + '" type="' + type + '" value="' + esc(value == null ? '' : value) + '" ' +
        (ph ? 'placeholder="' + esc(ph) + '" ' : '') +
        (listId ? 'list="' + listId + '" ' : '') + '></label>';
    }

    const form = m.box.querySelector('#gl-form');
    m.box.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = clean(fd.get('name'));
      if (!name) { toast('Bitte einen Namen angeben.', 'error'); form.name.focus(); return; }

      const lat = parseNum(fd.get('lat'));
      const lng = parseNum(fd.get('lng'));
      if ((lat == null) !== (lng == null)) {
        toast('Bitte beide Koordinaten (Lat und Lng) angeben – oder beide leer lassen.', 'error');
        return;
      }
      const saved = normalizeTour({
        id: t.id,
        name,
        lat, lng,
        grade: fd.get('grade'),
        type: fd.get('type'),
        region: fd.get('region'),
        mountain: fd.get('mountain'),
        notes: fd.get('notes'),
        link: fd.get('link'),
        gpxLink: fd.get('gpxLink'),
        source: t.source || (mode === 'scrape' || mode === 'update' ? 'bergsteigen.com' : 'manual'),
        addedAt: t.addedAt || nowIso(),
        done: fd.get('done') === 'on',
        doneDate: clean(fd.get('doneDate'))
      });

      upsertTour(saved);
      m.close();
      updateFabBadge();
      toast('„' + saved.name + '" gespeichert.', 'ok');
      if (mapState.open) rebuildMapData();
    });

    setTimeout(() => { try { form.name.focus(); } catch (e) {} }, 60);
  }

  // =========================================================================
  //  9. Schwebender Button (nur auf bergsteigen.com)
  // =========================================================================
  function injectFab() {
    if ($('#gl-fab')) return;
    ensureBaseStyles();
    const wrap = document.createElement('div');
    wrap.id = 'gl-fab';
    wrap.className = 'gl-scope';

    const onDetail = isTourDetailPage();
    wrap.innerHTML =
      (onDetail
        ? '<button class="gl-fab-main" id="gl-fab-add" title="Diese Tour erfassen">📍 Zur Tourenliste hinzufügen</button>'
        : '') +
      '<div class="gl-fab-row">' +
        '<button class="gl-fab-mini" id="gl-fab-map" title="Karte öffnen">🗺 Karte <span class="gl-fab-badge" id="gl-fab-badge"></span></button>' +
        (onDetail ? '' : '<button class="gl-fab-mini" id="gl-fab-manual" title="Tour manuell hinzufügen">➕</button>') +
      '</div>';

    document.body.appendChild(wrap);
    const addBtn = $('#gl-fab-add', wrap);
    if (addBtn) addBtn.addEventListener('click', scrapeFlow);
    $('#gl-fab-map', wrap).addEventListener('click', openMap);
    const manBtn = $('#gl-fab-manual', wrap);
    if (manBtn) manBtn.addEventListener('click', () => openTourForm(null, { mode: 'manual' }));
    updateFabBadge();
  }

  function updateFabBadge() {
    const b = $('#gl-fab-badge');
    if (!b) return;
    const n = loadTours().length;
    b.textContent = n ? String(n) : '';
    b.style.display = n ? '' : 'none';
  }

  // =========================================================================
  //  10. Kartenansicht (Leaflet-Overlay)
  // =========================================================================
  const mapState = { open: false, map: null, layer: null, markers: {}, base: null, ov: null };
  const filterState = { q: '', type: '', region: '', status: 'all', tiers: new Set(['green', 'amber', 'red', 'grey']) };

  function ensureLeafletCss() {
    if ($('#gl-leaflet-css') || $('link[href*="leaflet.css"]')) return;
    let css = null;
    try { if (typeof GM_getResourceText === 'function') css = GM_getResourceText('LEAFLET_CSS'); }
    catch (e) { css = null; }
    if (css) {
      const s = addStyle(css);
      if (s && s.id !== undefined) s.id = 'gl-leaflet-css';
    } else {
      const link = document.createElement('link');
      link.id = 'gl-leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      (document.head || document.documentElement).appendChild(link);
    }
  }

  // Einfacher, robuster Kachel-Layer über das normale <img>-Laden des Browsers.
  // Bewusst KEIN GM_xmlhttpRequest-Fallback: bei gedrosselten Kachel-Servern
  // (z.B. OpenTopoMap → HTTP 429) hätte das pro fehlgeschlagener Kachel einen
  // GM-Request ausgelöst – hunderte davon können den Browser-Tab einfrieren.
  // updateWhenIdle/keepBuffer begrenzen die Zahl gleichzeitiger Anfragen.
  function makeTileLayer(url, opts) {
    return L.tileLayer(url, Object.assign({ updateWhenIdle: true, keepBuffer: 1 }, opts));
  }

  function markerHtml(tour) {
    const c = gradeTier(tour.grade).color;
    if (tour.done) {
      // erledigt: heller Punkt mit farbigem Ring + Häkchen
      return '<svg width="22" height="22" viewBox="0 0 22 22">' +
        '<circle cx="11" cy="11" r="8" fill="#ffffff" stroke="' + c + '" stroke-width="2.5"/>' +
        '<path d="M7 11.3 l2.7 2.7 L15.2 8.3" fill="none" stroke="' + c + '" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    }
    // offen: gefüllter Punkt
    return '<svg width="22" height="22" viewBox="0 0 22 22">' +
      '<circle cx="11" cy="11" r="7" fill="' + c + '" stroke="#ffffff" stroke-width="2.5"/>' +
      '</svg>';
  }

  function markerIcon(tour) {
    return L.divIcon({
      className: 'gl-marker' + (tour.done ? ' gl-marker-done' : ''),
      html: markerHtml(tour),
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -12]
    });
  }

  function openMap() {
    if (mapState.open) { return; }
    ensureBaseStyles();
    ensureLeafletCss();

    if (typeof L === 'undefined' || !L.map) {
      toast('Kartenbibliothek (Leaflet) nicht geladen. Bitte Seite neu laden.', 'error');
      return;
    }

    // evtl. verwaiste Overlays entfernen (Robustheit gegen doppeltes Öffnen)
    $$('#gl-overlay').forEach((e) => e.remove());

    mapState.open = true;
    document.documentElement.style.overflow = 'hidden';

    const ov = document.createElement('div');
    ov.id = 'gl-overlay';
    ov.className = 'gl-scope';
    mapState.ov = ov;
    ov.innerHTML =
      '<header id="gl-topbar">' +
        '<div class="gl-brand"><span class="gl-brand-mark">⛰</span><div>' +
          '<div class="gl-brand-name">PlanschisTouren</div>' +
          '<div class="gl-brand-sub" id="gl-count"></div>' +
        '</div></div>' +
        '<div class="gl-topbar-actions">' +
          '<button class="gl-btn" id="gl-b-manual">➕ Manuell</button>' +
          '<button class="gl-btn" id="gl-b-export">📤 XML export</button>' +
          '<button class="gl-btn" id="gl-b-import">📥 XML import</button>' +
          '<button class="gl-btn gl-btn-ghost" id="gl-b-close" title="Schließen (Esc)">✕</button>' +
        '</div>' +
      '</header>' +
      '<div id="gl-body">' +
        '<aside id="gl-sidebar">' +
          '<div class="gl-search"><input type="search" id="gl-q" placeholder="Suchen: Name, Region, Berg, Notiz…"></div>' +
          '<div class="gl-filters">' +
            '<label class="gl-field"><span class="gl-label">Typ</span><select id="gl-f-type"></select></label>' +
            '<label class="gl-field"><span class="gl-label">Region</span><select id="gl-f-region"></select></label>' +
            '<label class="gl-field"><span class="gl-label">Status</span>' +
              '<select id="gl-f-status"><option value="all">Alle</option><option value="open">Offen</option><option value="done">Erledigt</option></select></label>' +
            '<div class="gl-field"><span class="gl-label">Schwierigkeit</span><div id="gl-f-tiers" class="gl-tiers"></div></div>' +
          '</div>' +
          '<div id="gl-list" class="gl-list"></div>' +
        '</aside>' +
        '<main id="gl-mapwrap"><div id="gl-map"></div></main>' +
      '</div>';

    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('gl-in'));

    // Top-bar-Aktionen
    $('#gl-b-close', ov).addEventListener('click', closeMap);
    $('#gl-b-manual', ov).addEventListener('click', () => openTourForm(null, { mode: 'manual' }));
    $('#gl-b-export', ov).addEventListener('click', exportXml);
    $('#gl-b-import', ov).addEventListener('click', importXmlFlow);

    // Esc schließt die Karte – aber nur, wenn kein Modal (Formular/Dialog) darüber liegt
    const onKey = (e) => {
      if (e.key === 'Escape' && !$('.gl-modal-backdrop')) closeMap();
    };
    document.addEventListener('keydown', onKey, true);
    mapState._onKey = onKey;

    // Karte – in try/catch, damit ein Fehler den Tab niemals blockieren kann
    try {
    const map = L.map($('#gl-map', ov), { zoomControl: true, attributionControl: true });
    mapState.map = map;
    map.setView([47.3, 11.4], 7); // Alpen als Default

    const topo = makeTileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, subdomains: 'abc',
      attribution: 'Kartendaten © OpenStreetMap-Mitwirkende, SRTM | © OpenTopoMap (CC-BY-SA)'
    });
    const osm = makeTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abc',
      attribution: '© OpenStreetMap-Mitwirkende'
    });
    // Standard: OpenStreetMap (großes, schnelles Servernetz). OpenTopoMap ist
    // per Umschalter oben rechts wählbar, drosselt aber deutlich stärker.
    osm.addTo(map);
    mapState.base = { topo, osm, current: osm };
    // collapsed:false -> zeigt die Auswahl direkt, ohne das (in Produktion evtl.
    // fehlende) layers.png-Toggle-Icon der eingebetteten Leaflet-CSS.
    L.control.layers({ 'OpenStreetMap': osm, 'OpenTopoMap': topo }, {}, { position: 'topright', collapsed: false }).addTo(map);

    mapState.layer = L.layerGroup().addTo(map);

    // Filter-Controls verdrahten
    const q = $('#gl-q', ov);
    q.value = filterState.q;
    q.addEventListener('input', debounce(() => { filterState.q = q.value.trim(); renderMap(); }, 180));
    $('#gl-f-type', ov).addEventListener('change', (e) => { filterState.type = e.target.value; renderMap(); });
    $('#gl-f-region', ov).addEventListener('change', (e) => { filterState.region = e.target.value; renderMap(); });
    $('#gl-f-status', ov).addEventListener('change', (e) => { filterState.status = e.target.value; renderMap(); });
    $('#gl-f-status', ov).value = filterState.status;

    // Schwierigkeits-Stufen als Checkboxen
    const tiersHost = $('#gl-f-tiers', ov);
    ['green', 'amber', 'red', 'grey'].forEach((k) => {
      const id = 'gl-tier-' + k;
      const lab = document.createElement('label');
      lab.className = 'gl-tier gl-check';
      lab.innerHTML =
        '<input type="checkbox" id="' + id + '" ' + (filterState.tiers.has(k) ? 'checked' : '') + '>' +
        '<span class="gl-dot" style="background:' + TIERS[k].color + '"></span>' + TIERS[k].label;
      lab.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) filterState.tiers.add(k); else filterState.tiers.delete(k);
        renderMap();
      });
      tiersHost.appendChild(lab);
    });

    rebuildMapData(true);
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);
    } catch (err) {
      console.error('[PlanschisTouren] Karte konnte nicht geöffnet werden:', err);
      toast('Karte konnte nicht geöffnet werden: ' + ((err && err.message) || err), 'error');
      closeMap();
    }
  }

  function closeMap() {
    if (!mapState.open) return;
    mapState.open = false;
    document.documentElement.style.overflow = '';
    if (mapState._onKey) document.removeEventListener('keydown', mapState._onKey, true);
    try { if (mapState.map) mapState.map.remove(); } catch (e) {}
    mapState.map = null; mapState.layer = null; mapState.markers = {}; mapState.ov = null;
    const ov = $('#gl-overlay');
    if (ov) { ov.classList.remove('gl-in'); setTimeout(() => ov.remove(), 180); }
    updateFabBadge();
  }

  // Filter-Optionen (Typ/Region) neu befüllen und Daten rendern
  function rebuildMapData(fit) {
    if (!mapState.open || !mapState.ov) return;
    const ov = mapState.ov;
    const tours = loadTours();

    const fill = (selId, values, cur) => {
      const sel = $('#' + selId, ov);
      if (!sel) return;
      const uniq = Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'));
      sel.innerHTML = '<option value="">Alle</option>' + uniq.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
      if (cur && uniq.includes(cur)) sel.value = cur; else sel.value = '';
    };
    fill('gl-f-type', tours.map((t) => t.type), filterState.type);
    fill('gl-f-region', tours.map((t) => t.region), filterState.region);
    if (!$('#gl-f-type', ov).value) filterState.type = '';
    if (!$('#gl-f-region', ov).value) filterState.region = '';

    renderMap(fit);
  }

  function applyFilters(tours) {
    const f = filterState;
    const q = f.q.toLowerCase();
    return tours.filter((t) => {
      if (f.type && t.type !== f.type) return false;
      if (f.region && t.region !== f.region) return false;
      if (f.status === 'done' && !t.done) return false;
      if (f.status === 'open' && t.done) return false;
      if (!f.tiers.has(gradeTier(t.grade).key)) return false;
      if (q) {
        const hay = [t.name, t.region, t.mountain, t.grade, t.type, t.notes].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderMap(fit) {
    if (!mapState.open) return;
    const all = loadTours();
    const shown = applyFilters(all);

    // Marker
    mapState.layer.clearLayers();
    mapState.markers = {};
    const withCoords = shown.filter((t) => isFiniteNum(t.lat) && isFiniteNum(t.lng));
    withCoords.forEach((t) => {
      const mk = L.marker([t.lat, t.lng], { icon: markerIcon(t) });
      mk.bindPopup(() => popupContent(t), { minWidth: 240, maxWidth: 300, className: 'gl-popup' });
      mk.addTo(mapState.layer);
      mapState.markers[t.id] = mk;
    });

    if (fit && withCoords.length) {
      try { mapState.map.fitBounds(withCoords.map((t) => [t.lat, t.lng]), { padding: [40, 40], maxZoom: 13 }); }
      catch (e) {}
    }

    // Kopfzeile / Zähler
    const cnt = mapState.ov && $('#gl-count', mapState.ov);
    if (cnt) {
      if (!all.length) cnt.textContent = 'Noch keine Touren gespeichert';
      else cnt.textContent = shown.length + ' von ' + all.length + ' Touren' +
        (withCoords.length < shown.length ? ' · ' + (shown.length - withCoords.length) + ' ohne Standort' : '');
    }

    renderList(all, shown);
  }

  function renderList(all, shown) {
    const host = mapState.ov && $('#gl-list', mapState.ov);
    if (!host) return;

    if (!all.length) {
      host.innerHTML =
        '<div class="gl-empty">' +
          '<div class="gl-empty-mark">⛰</div>' +
          '<p><strong>Noch keine Touren gespeichert.</strong></p>' +
          '<p class="gl-muted">Öffne eine Tourenseite auf bergsteigen.com und klicke „📍 Zur Tourenliste hinzufügen" – oder füge über „➕ Manuell" eine eigene Tour hinzu.</p>' +
        '</div>';
      return;
    }
    if (!shown.length) {
      host.innerHTML = '<div class="gl-empty"><p class="gl-muted">Keine Tour passt zu den aktuellen Filtern.</p></div>';
      return;
    }

    host.innerHTML = '';
    shown.slice().sort((a, b) => a.name.localeCompare(b.name, 'de')).forEach((t) => {
      const tier = gradeTier(t.grade);
      const card = document.createElement('div');
      card.className = 'gl-card' + (t.done ? ' gl-card-done' : '');
      card.innerHTML =
        '<div class="gl-card-top">' +
          '<span class="gl-badge gl-mono" style="border-color:' + tier.color + ';color:' + tier.color + '">' + esc(t.grade || '–') + '</span>' +
          '<span class="gl-card-title">' + esc(t.name || '(ohne Name)') + '</span>' +
          (t.done ? '<span class="gl-check-tag" title="erledigt">✓</span>' : '') +
        '</div>' +
        '<div class="gl-card-meta gl-muted">' + esc([t.type, t.region, t.mountain].filter(Boolean).join(' · ') || '—') +
          (!isFiniteNum(t.lat) ? ' · <em>kein Standort</em>' : '') + '</div>';
      card.addEventListener('click', () => focusTour(t));
      host.appendChild(card);
    });
  }

  function focusTour(t) {
    if (isFiniteNum(t.lat) && isFiniteNum(t.lng) && mapState.map) {
      mapState.map.setView([t.lat, t.lng], Math.max(mapState.map.getZoom(), 13), { animate: true });
      const mk = mapState.markers[t.id];
      if (mk) mk.openPopup();
    } else {
      // ohne Koordinaten -> direkt bearbeiten
      openTourForm(t, { mode: 'edit' });
    }
  }

  // Popup-Inhalt als DOM-Element (mit gebundenen Handlern)
  function popupContent(t) {
    const tier = gradeTier(t.grade);
    const el = document.createElement('div');
    el.className = 'gl-pop';
    el.innerHTML =
      '<div class="gl-pop-head">' +
        '<span class="gl-badge gl-mono" style="border-color:' + tier.color + ';color:' + tier.color + '">' + esc(t.grade || '–') + '</span>' +
        '<strong>' + esc(t.name || '(ohne Name)') + '</strong>' +
      '</div>' +
      '<div class="gl-pop-meta gl-muted">' + esc([t.type, t.region, t.mountain].filter(Boolean).join(' · ') || '—') + '</div>' +
      (t.notes ? '<div class="gl-pop-notes">' + esc(t.notes) + '</div>' : '') +
      '<div class="gl-pop-links">' +
        (t.link ? '<a href="' + esc(t.link) + '" target="_blank" rel="noopener">↗ Originalseite</a>' : '') +
        (t.gpxLink ? '<a href="' + esc(t.gpxLink) + '" target="_blank" rel="noopener">⬇ GPX</a>' : '') +
      '</div>' +
      '<label class="gl-check gl-pop-done"><input type="checkbox" ' + (t.done ? 'checked' : '') + '> erledigt' +
        (t.doneDate ? ' <span class="gl-muted">(' + esc(t.doneDate) + ')</span>' : '') + '</label>' +
      '<div class="gl-pop-actions">' +
        '<button class="gl-btn gl-btn-sm" data-act="edit">Bearbeiten</button>' +
        '<button class="gl-btn gl-btn-sm gl-btn-danger" data-act="del">Löschen</button>' +
      '</div>';

    el.querySelector('.gl-pop-done input').addEventListener('change', (e) => {
      const fresh = getTour(t.id) || t;
      fresh.done = e.target.checked;
      if (fresh.done && !fresh.doneDate) fresh.doneDate = new Date().toISOString().slice(0, 10);
      upsertTour(fresh);
      toast(fresh.done ? '„' + fresh.name + '" als erledigt markiert.' : 'Erledigt-Status entfernt.', 'ok');
      renderMap();
    });
    el.querySelector('[data-act="edit"]').addEventListener('click', () => {
      if (mapState.map) mapState.map.closePopup();
      openTourForm(getTour(t.id) || t, { mode: 'edit' });
    });
    el.querySelector('[data-act="del"]').addEventListener('click', async () => {
      const ok = await confirmDialog('Tour löschen?', '„' + (t.name || '') + '" wird dauerhaft aus der lokalen Liste entfernt.', 'Löschen');
      if (!ok) return;
      deleteTour(t.id);
      if (mapState.map) mapState.map.closePopup();
      toast('Tour gelöscht.', 'ok');
      updateFabBadge();
      rebuildMapData();
    });
    return el;
  }

  // =========================================================================
  //  11. Tampermonkey-Menübefehle
  // =========================================================================
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('📍 Diese Tour erfassen', scrapeFlow);
    GM_registerMenuCommand('➕ Tour manuell hinzufügen', () => openTourForm(null, { mode: 'manual' }));
    GM_registerMenuCommand('🗺 Karte öffnen', openMap);
    GM_registerMenuCommand('📤 Als XML exportieren', exportXml);
    GM_registerMenuCommand('📥 XML importieren', importXmlFlow);
    GM_registerMenuCommand('🗑 Alle Touren löschen', async () => {
      const n = loadTours().length;
      if (!n) { toast('Es sind keine Touren gespeichert.', 'error'); return; }
      const ok = await confirmDialog('Alle Touren löschen?',
        'Alle ' + n + ' gespeicherten Touren werden entfernt. Tipp: vorher als XML exportieren!', 'Alle löschen');
      if (!ok) return;
      saveTours([]);
      updateFabBadge();
      if (mapState.open) rebuildMapData();
      toast('Alle Touren gelöscht.', 'ok');
    });
  }

  // =========================================================================
  //  12. Init
  // =========================================================================
  function init() {
    migrateStore(); // Altbestände übernehmen, bevor irgendetwas geladen wird
    registerMenu();
    // Button nur auf bergsteigen.com injizieren (Skript läuft ohnehin nur dort)
    if (/(^|\.)bergsteigen\.com$/i.test(location.hostname)) {
      injectFab();
    }
  }

  // WICHTIG: init() wird erst GANZ AM ENDE aufgerufen (nach der BASE_CSS-Definition
  // unten). ensureBaseStyles() greift auf das const BASE_CSS zu; würde init() hier
  // schon laufen, wäre BASE_CSS noch in der „Temporal Dead Zone" → ReferenceError,
  // der die restliche Skriptausführung (inkl. Styles) abbräche.

  // =========================================================================
  //  13. CSS (eigenes, gekapseltes Design – schlicht & clean, System-Schriften)
  // =========================================================================
  const BASE_CSS = `
  .gl-scope, .gl-scope * { box-sizing: border-box; }
  :root {
    --gl-bg:#f4f4f5; --gl-surface:#ffffff; --gl-surface-2:#fafafa;
    --gl-text:#18181b; --gl-muted:#6b7280; --gl-line:#e4e4e7; --gl-line-2:#d4d4d8;
    --gl-accent:#2563eb; --gl-primary:#18181b; --gl-danger:#dc2626;
    --gl-font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    --gl-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;
    --gl-r:10px; --gl-r-sm:7px;
  }

  /* ---------- Toasts ---------- */
  #gl-toasts { position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
    z-index:2147483646; display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none; }
  .gl-toast { font-family:var(--gl-font); font-size:14px; color:#fff;
    background:#18181b; padding:10px 16px; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.18);
    opacity:0; transform:translateY(10px); transition:.24s; max-width:min(92vw,520px); }
  .gl-toast.gl-in { opacity:1; transform:none; }
  .gl-toast-ok { background:#15803d; }
  .gl-toast-error { background:#b91c1c; }

  /* ---------- Modal ---------- */
  .gl-modal-backdrop { position:fixed; inset:0; z-index:2147483645; background:rgba(24,24,27,.4);
    display:flex; align-items:center; justify-content:center; padding:20px; opacity:0; transition:.15s;
    font-family:var(--gl-font); color:var(--gl-text); }
  .gl-modal-backdrop.gl-in { opacity:1; }
  .gl-modal { background:var(--gl-surface); width:560px; max-width:100%; max-height:90vh; overflow:auto;
    border-radius:14px; border:1px solid var(--gl-line); box-shadow:0 20px 50px rgba(0,0,0,.22); padding:22px 24px; }
  .gl-modal-wide { width:820px; }
  .gl-h { font-weight:650; font-size:19px; letter-spacing:-.01em; margin:0 0 6px; color:var(--gl-text); }
  .gl-muted { color:var(--gl-muted); }
  .gl-small { font-size:12px; }
  .gl-mono { font-family:var(--gl-mono); }

  /* ---------- Formular ---------- */
  #gl-form { display:flex; flex-direction:column; gap:12px; margin-top:14px; }
  .gl-field { display:flex; flex-direction:column; gap:5px; }
  .gl-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .gl-label { font-size:12px; font-weight:500; color:var(--gl-muted); }
  .gl-scope input[type=text], .gl-scope input[type=date], .gl-scope input[type=search],
  .gl-scope textarea, .gl-scope select {
    font-family:var(--gl-font); font-size:14px; color:var(--gl-text); background:var(--gl-surface);
    border:1px solid var(--gl-line-2); border-radius:var(--gl-r-sm); padding:9px 11px; width:100%; outline:none;
    transition:border-color .12s, box-shadow .12s; }
  .gl-scope textarea { resize:vertical; }
  .gl-scope input:focus, .gl-scope textarea:focus, .gl-scope select:focus { border-color:var(--gl-accent); box-shadow:0 0 0 3px rgba(37,99,235,.15); }
  .gl-check { display:flex; align-items:center; gap:8px; font-size:14px; }
  .gl-check input { width:auto; accent-color:var(--gl-accent); }
  .gl-warn { background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:8px; padding:10px 12px; font-size:13px; margin:6px 0; }
  .gl-warn ul { margin:6px 0 0; padding-left:18px; }

  /* ---------- Buttons ---------- */
  .gl-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
  .gl-btn { font-family:var(--gl-font); font-size:14px; font-weight:500; cursor:pointer;
    background:var(--gl-surface); color:var(--gl-text); border:1px solid var(--gl-line-2);
    border-radius:var(--gl-r-sm); padding:8px 14px; transition:.12s; }
  .gl-btn:hover { background:#f4f4f5; border-color:#a1a1aa; }
  .gl-btn-primary { background:var(--gl-primary); border-color:var(--gl-primary); color:#fff; }
  .gl-btn-primary:hover { background:#000; }
  .gl-btn-danger { background:var(--gl-danger); border-color:var(--gl-danger); color:#fff; }
  .gl-btn-danger:hover { background:#b91c1c; }
  .gl-btn-ghost { background:transparent; border-color:transparent; }
  .gl-btn-ghost:hover { background:#f4f4f5; }
  .gl-btn-sm { padding:5px 10px; font-size:13px; }

  /* ---------- Import-Konflikt ---------- */
  .gl-conf-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:12px 0; }
  .gl-conf-card { display:flex; gap:10px; align-items:flex-start; background:var(--gl-surface-2); border:1px solid var(--gl-line); border-radius:8px; padding:10px; }
  .gl-badge { font-family:var(--gl-mono); font-size:12px; font-weight:600; border:1px solid var(--gl-line-2);
    border-radius:6px; padding:2px 7px; white-space:nowrap; color:var(--gl-text); }

  /* ---------- Karten-Overlay ---------- */
  #gl-overlay { position:fixed; inset:0; z-index:2147483640; background:var(--gl-bg);
    display:flex; flex-direction:column; font-family:var(--gl-font); color:var(--gl-text);
    opacity:0; transition:.15s; }
  #gl-overlay.gl-in { opacity:1; }
  #gl-topbar { display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:12px 18px; background:var(--gl-surface); border-bottom:1px solid var(--gl-line); flex:0 0 auto; }
  .gl-brand { display:flex; align-items:center; gap:10px; }
  .gl-brand-mark { font-size:20px; }
  .gl-brand-name { font-weight:650; font-size:17px; letter-spacing:-.01em; line-height:1.1; }
  .gl-brand-sub { font-size:12px; color:var(--gl-muted); margin-top:2px; }
  .gl-topbar-actions { display:flex; gap:8px; flex-wrap:wrap; }

  #gl-body { flex:1 1 auto; display:flex; min-height:0; }
  #gl-sidebar { width:330px; flex:0 0 330px; background:var(--gl-surface); border-right:1px solid var(--gl-line);
    display:flex; flex-direction:column; min-height:0; }
  .gl-search { padding:14px 14px 8px; }
  .gl-filters { padding:4px 14px 14px; display:flex; flex-direction:column; gap:10px; border-bottom:1px solid var(--gl-line); }
  .gl-tiers { display:flex; flex-direction:column; gap:6px; }
  .gl-tier { font-size:13px; color:var(--gl-text); }
  .gl-dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:2px; }

  .gl-list { flex:1 1 auto; overflow:auto; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
  .gl-card { background:var(--gl-surface); border:1px solid var(--gl-line); border-radius:var(--gl-r); padding:10px 12px; cursor:pointer; transition:.12s; }
  .gl-card:hover { border-color:var(--gl-line-2); background:var(--gl-surface-2); }
  .gl-card-done { opacity:.6; }
  .gl-card-top { display:flex; align-items:center; gap:8px; }
  .gl-card-title { font-weight:600; font-size:14px; flex:1; }
  .gl-card-meta { font-size:12px; margin-top:4px; }
  .gl-check-tag { color:#15803d; font-weight:700; }

  #gl-mapwrap { flex:1 1 auto; min-width:0; position:relative; }
  #gl-map { position:absolute; inset:0; background:#e4e4e7; }

  .gl-empty { text-align:center; padding:30px 16px; }
  .gl-empty-mark { font-size:36px; opacity:.35; }

  /* ---------- Leaflet-Controls schlicht angleichen ---------- */
  #gl-overlay .leaflet-control-layers { background:var(--gl-surface); border:1px solid var(--gl-line);
    border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.1); padding:6px 10px;
    font-family:var(--gl-font); font-size:13px; color:var(--gl-text); }
  #gl-overlay .leaflet-control-layers label { margin:2px 0; display:flex; align-items:center; gap:6px; font-weight:500; }
  #gl-overlay .leaflet-bar a { color:var(--gl-text); }
  #gl-overlay .leaflet-control-attribution { background:rgba(255,255,255,.85); font-family:var(--gl-font); }

  /* ---------- Marker + Popup ---------- */
  .gl-marker { background:none; border:none; filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.3)); }
  .gl-popup .leaflet-popup-content-wrapper { background:var(--gl-surface); border-radius:10px; border:1px solid var(--gl-line); box-shadow:0 8px 24px rgba(0,0,0,.16); }
  .gl-popup .leaflet-popup-content { margin:12px 14px; font-family:var(--gl-font); color:var(--gl-text); }
  .gl-popup .leaflet-popup-tip { background:var(--gl-surface); }
  .gl-pop-head { display:flex; gap:8px; align-items:center; margin-bottom:4px; }
  .gl-pop-head strong { font-size:15px; font-weight:650; }
  .gl-pop-meta { font-size:12px; }
  .gl-pop-notes { font-size:13px; margin:8px 0; padding:8px 10px; background:var(--gl-surface-2); border-radius:7px; border:1px solid var(--gl-line); }
  .gl-pop-links { display:flex; gap:12px; margin:8px 0; }
  .gl-pop-links a { color:var(--gl-accent); font-size:13px; text-decoration:none; font-weight:500; }
  .gl-pop-links a:hover { text-decoration:underline; }
  .gl-pop-done { margin:6px 0 10px; }
  .gl-pop-actions { display:flex; gap:8px; }

  /* ---------- Schwebender Button ---------- */
  #gl-fab { position:fixed; right:18px; bottom:18px; z-index:2147483600; display:flex; flex-direction:column; align-items:flex-end; gap:8px; font-family:var(--gl-font); }
  .gl-fab-main { cursor:pointer; background:var(--gl-primary); color:#fff; border:none; border-radius:999px;
    padding:11px 18px; font-size:14px; font-weight:600; box-shadow:0 4px 14px rgba(0,0,0,.2); transition:.12s; }
  .gl-fab-main:hover { background:#000; }
  .gl-fab-row { display:flex; gap:8px; }
  .gl-fab-mini { cursor:pointer; background:var(--gl-surface); color:var(--gl-text); border:1px solid var(--gl-line-2); border-radius:999px;
    padding:8px 14px; font-size:13px; font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,.1); display:flex; align-items:center; gap:6px; transition:.12s; }
  .gl-fab-mini:hover { background:var(--gl-surface-2); border-color:#a1a1aa; }
  .gl-fab-badge { background:var(--gl-primary); color:#fff; border-radius:999px; font-size:11px; font-family:var(--gl-mono);
    min-width:18px; height:18px; padding:0 5px; display:inline-flex; align-items:center; justify-content:center; }

  @media (max-width:720px) {
    #gl-sidebar { width:250px; flex-basis:250px; }
    .gl-row2, .gl-conf-grid { grid-template-columns:1fr; }
  }
  `;

  // ---- Start (nach BASE_CSS, siehe Hinweis oben) ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
