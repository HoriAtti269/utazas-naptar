// =====================================================================
//  UTAZÁSTERVEZŐ – telepíthető app (GitHub Pages)
//  Az adat a Google Táblázatból jön az Apps Script API-n keresztül.
// =====================================================================

// ===== BEÁLLÍTÁS: az Apps Script telepítés címe (…/exec) =====
const API_URL = 'https://script.google.com/macros/s/AKfycbywqF3CINu8JN1tgAf_jT77-DmzH0JdASOaq1eoDQxcofBioJNVEhuMBgKsp-HWrp9V/exec';
const ALAP_IDOZONA = 'Europe/Budapest';

// Service worker regisztrálása (telepíthetőség, offline mód)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const startDateInput = document.getElementById('startDate');
    const gridContainer = document.getElementById('grid-container');
    const detailContainer = document.getElementById('detail-container');
    const backBtn = document.getElementById('backBtn');
    const detailTitle = document.getElementById('detail-title');
    const detailTableBody = document.getElementById('detailTableBody');
    const sheetSelector = document.getElementById('sheetSelector');
    const statusBar = document.getElementById('statusBar');

    const modal = document.getElementById('taskModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const mainAddBtn = document.getElementById('mainAddBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const taskForm = document.getElementById('taskForm');
    const modalTitle = document.getElementById('modalTitle');
    const eventIdInput = document.getElementById('eventId');
    const taskDatumInput = document.getElementById('taskDatum');

    const newTripBtn = document.getElementById('newTripBtn');
    const newTripModal = document.getElementById('newTripModal');
    const closeNewTripModalBtn = document.getElementById('closeNewTripModalBtn');
    const newTripForm = document.getElementById('newTripForm');
    const newTripNameInput = document.getElementById('newTripName');

    const inputs = {
        varos: document.getElementById('taskVaros'),
        tipus: document.getElementById('taskTipus'),
        idopont: document.getElementById('taskIdopont'),
        megnevezes: document.getElementById('taskMegnevezes'),
        reszletek: document.getElementById('taskReszletek'),
        utvonal: document.getElementById('taskUtvonal'),
        intezendo: document.getElementById('taskIntezendo'),
        fizetesElore: document.getElementById('taskFizetesElore'),
        fizetesHelyszinen: document.getElementById('taskFizetesHelyszinen'),
        koltseg: document.getElementById('taskKoltseg')
    };

    let tasksData = {};
    let varosIdozonak = {};
    let currentSelectedDate = null;
    let currentDisplayDate = '';

    let customTypeColors = {};
    let customColorIndex = 0;
    const maxCustomColors = 5;

    // =================================================================
    //  SEGÉDFÜGGVÉNYEK
    // =================================================================

    // HTML-escape: idézőjel, < > & nem rontja el a megjelenítést
    function esc(szoveg) {
        return String(szoveg ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Csak http(s) linket engedünk kattinthatónak
    function biztonsagosUrl(url) {
        const u = String(url || '').trim();
        return /^https?:\/\//i.test(u) ? u : '';
    }

    // "9:00", "09:00", "06:00 - 10:45" → percek az első időponttól; nincs idő → null
    function idoPercben(idopont) {
        const m = String(idopont || '').match(/(\d{1,2})[:.](\d{2})/);
        if (!m) return null;
        const h = Number(m[1]), p = Number(m[2]);
        if (h > 23 || p > 59) return null;
        return h * 60 + p;
    }

    function vanIdopont(event) {
        return idoPercben(event.idopont) !== null;
    }

    // "2026-11-04" → helyi Date (UTC-eltolás nélkül, így Amerikában sem csúszik el)
    function datumbol(str) {
        const p = str.split('-').map(Number);
        return new Date(p[0], p[1] - 1, p[2]);
    }

    function formatLocalDate(dateObj) {
        const year = dateObj.getFullYear();
        const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
        const day = ("0" + dateObj.getDate()).slice(-2);
        return year + "-" + month + "-" + day;
    }

    function getMonday(d) {
        const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = date.getDay();
        date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        return date;
    }

    function getSunday(d) {
        const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = date.getDay();
        date.setDate(date.getDate() + (day === 0 ? 0 : 7 - day));
        return date;
    }

    function getTypeClass(tipus, prefix) {
        if (!tipus) return `${prefix}-program`;
        const normalized = tipus.trim();

        if (normalized === 'Szálloda') return `${prefix}-szalloda`;
        if (normalized === 'Repülés') return `${prefix}-repules`;
        if (normalized === 'Program') return `${prefix}-program`;
        if (normalized === 'Étterem') return `${prefix}-etterem`;

        if (!customTypeColors[normalized]) {
            if (customColorIndex < maxCustomColors) {
                customColorIndex++;
                customTypeColors[normalized] = `custom-${customColorIndex}`;
            } else {
                customTypeColors[normalized] = 'custom-default';
            }
        }
        return `${prefix}-${customTypeColors[normalized]}`;
    }

    function allapot(szoveg, tipus = '') {
        if (!szoveg) {
            statusBar.classList.add('hidden');
            return;
        }
        statusBar.textContent = szoveg;
        statusBar.className = `status ${tipus}`;
    }

    // =================================================================
    //  KOMMUNIKÁCIÓ AZ APPS SCRIPTTEL + OFFLINE MÁSOLAT
    // =================================================================

    // text/plain típussal küldjük, így nincs CORS előkérés
    function api(action, adat = {}) {
        return fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(Object.assign({ action }, adat))
        })
            .then(r => {
                if (!r.ok) throw new Error('Szerverhiba (' + r.status + ')');
                return r.json();
            })
            .then(v => {
                if (!v || v.success === false) throw new Error((v && v.error) || 'Ismeretlen hiba');
                return v;
            });
    }

    function cacheMentes(kulcs, ertek) {
        try { localStorage.setItem('utazas_' + kulcs, JSON.stringify({ ido: Date.now(), ertek })); } catch (e) { }
    }

    function cacheOlvasas(kulcs) {
        try { return JSON.parse(localStorage.getItem('utazas_' + kulcs)); } catch (e) { return null; }
    }

    function adatokBeallitasa(adatok) {
        tasksData = (adatok && adatok.tasks) || {};
        varosIdozonak = (adatok && adatok.idozonak) || {};
    }

    // Író művelet után a szerver a friss adatot is visszaküldi
    function frissitesValaszbol(valasz) {
        cacheMentes('adatok_' + sheetSelector.value, valasz.adatok);
        adatokBeallitasa(valasz.adatok);
        if (!detailContainer.classList.contains('hidden')) renderDetailTable();
        if (startDateInput.value) generateBtn.click();
    }

    // =================================================================
    //  UTAZÁSOK (MUNKALAPOK) BETÖLTÉSE
    // =================================================================

    function loadSheetNames(selectSheet = null) {
        api('lapok')
            .then(v => {
                cacheMentes('lapok', v.lapok);
                lapokMegjelenitese(v.lapok, selectSheet);
            })
            .catch(() => {
                const c = cacheOlvasas('lapok');
                if (c && c.ertek) {
                    lapokMegjelenitese(c.ertek, selectSheet);
                } else {
                    gridContainer.innerHTML = '<p class="welcome-msg">Nem sikerült csatlakozni, és még nincs elmentett adat ezen az eszközön. Ellenőrizd az internetet!</p>';
                }
            });
    }

    function lapokMegjelenitese(names, selectSheet) {
        sheetSelector.innerHTML = '';
        names.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.innerText = name;
            sheetSelector.appendChild(option);
        });
        if (names.length > 0) {
            const valasztott = (selectSheet && names.includes(selectSheet)) ? selectSheet : names[0];
            sheetSelector.value = valasztott;
            loadTasksForSheet(valasztott);
        }
    }

    loadSheetNames();

    sheetSelector.addEventListener('change', (e) => {
        if (e.target.value) loadTasksForSheet(e.target.value);
    });

    function loadTasksForSheet(sheetName) {
        detailContainer.classList.add('hidden');
        gridContainer.classList.remove('hidden');
        gridContainer.innerHTML = '<p class="welcome-msg">Adatok betöltése a táblázatból...</p>';

        api('adatok', { lap: sheetName })
            .then(v => {
                cacheMentes('adatok_' + sheetName, v.adatok);
                adatokBeallitasa(v.adatok);
                allapot('');
                betoltveUzenet();
            })
            .catch(err => {
                const c = cacheOlvasas('adatok_' + sheetName);
                if (c && c.ertek) {
                    adatokBeallitasa(c.ertek);
                    const ido = new Date(c.ido).toLocaleString('hu-HU');
                    allapot(`📴 Nincs kapcsolat – a ${ido}-kor mentett állapotot látod. Szerkeszteni csak online lehet.`, 'offline');
                    betoltveUzenet();
                } else {
                    gridContainer.innerHTML = `<p class="welcome-msg">Hiba a betöltéskor: ${esc(err.message)}</p>`;
                }
            });
    }

    function betoltveUzenet() {
        gridContainer.innerHTML = '<p class="welcome-msg">Munkalap sikeresen betöltve! Kérlek, add meg az indulás napját, majd kattints a "Tervező generálása" gombra!</p>';
        if (startDateInput.value) generateBtn.click();
    }

    // =================================================================
    //  NAPI SORREND
    //  – van kézi sorrend (M oszlop): az számít
    //  – nincs: a régi szabály (városblokk, szálloda elöl, időpontosak, a többi)
    //  – az időpontos programok MINDIG időrendben maradnak a saját helyeiken
    // =================================================================

    function regiSorrend(events) {
        const blocks = [];
        let currentBlock = [];
        let currentCity = (events[0].varos || "").trim().toUpperCase();

        events.forEach(event => {
            const eventCity = (event.varos || "").trim().toUpperCase();
            if (eventCity !== currentCity && eventCity !== "") {
                blocks.push(currentBlock);
                currentBlock = [];
                currentCity = eventCity;
            }
            currentBlock.push(event);
        });
        if (currentBlock.length > 0) blocks.push(currentBlock);

        let eredmeny = [];
        blocks.forEach(items => {
            items.sort((a, b) => {
                const hotelA = (a.tipus === 'Szálloda') ? 1 : 0;
                const hotelB = (b.tipus === 'Szálloda') ? 1 : 0;
                if (hotelA !== hotelB) return hotelB - hotelA;
                const idoA = idoPercben(a.idopont), idoB = idoPercben(b.idopont);
                if (idoA !== null && idoB !== null && idoA !== idoB) return idoA - idoB;
                if ((idoA !== null) !== (idoB !== null)) return (idoA !== null) ? -1 : 1;
                return a.rowNum - b.rowNum;
            });
            eredmeny = eredmeny.concat(items);
        });
        return eredmeny;
    }

    function napiSorrend(events) {
        if (!events || events.length === 0) return [];
        const vanKezi = events.some(e => e.sorrend !== null && e.sorrend !== undefined);
        let lista;
        if (vanKezi) {
            lista = [...events].sort((a, b) => {
                const sa = (a.sorrend === null || a.sorrend === undefined) ? Infinity : a.sorrend;
                const sb = (b.sorrend === null || b.sorrend === undefined) ? Infinity : b.sorrend;
                if (sa !== sb) return sa - sb;
                return a.rowNum - b.rowNum;
            });
        } else {
            lista = regiSorrend([...events]);
        }

        const eredetiHely = new Map();
        lista.forEach((e, i) => eredetiHely.set(e, i));
        const helyek = [], idosek = [];
        lista.forEach((e, i) => {
            if (vanIdopont(e)) { helyek.push(i); idosek.push(e); }
        });
        idosek.sort((a, b) => (idoPercben(a.idopont) - idoPercben(b.idopont)) || (eredetiHely.get(a) - eredetiHely.get(b)));
        helyek.forEach((h, k) => { lista[h] = idosek[k]; });
        return lista;
    }

    // Két szomszéd csak akkor cserélhető, ha nem mindkettő időpontos
    function athelyezheto(a, b) {
        return !!a && !!b && !(vanIdopont(a) && vanIdopont(b));
    }

    // =================================================================
    //  RÁCS (TELJES UTAZÁS) NÉZET
    // =================================================================

    generateBtn.addEventListener('click', () => {
        if (!startDateInput.value) return alert("Kérlek válassz indulási dátumot!");
        if (!sheetSelector.value) return alert("Kérlek várj, amíg a munkalapok betöltenek!");

        const isGridHidden = gridContainer.classList.contains('hidden');
        gridContainer.innerHTML = '';

        const startMonday = getMonday(datumbol(startDateInput.value));

        // Az utolsó programos nap hetének vasárnapjáig (szöveges összehasonlítás, időzóna-független)
        const dateKeys = Object.keys(tasksData).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
        const maxDateStr = dateKeys.length ? dateKeys.reduce((a, b) => a > b ? a : b) : null;

        let endSunday = getSunday(startMonday);
        if (maxDateStr && maxDateStr >= formatLocalDate(startMonday)) {
            endSunday = getSunday(datumbol(maxDateStr));
        }

        const diffDays = Math.round((endSunday - startMonday) / 86400000) + 1;
        const napokSzama = (isNaN(diffDays) || diffDays <= 0) ? 7 : diffDays;

        gridContainer.className = 'grid-layout';
        if (isGridHidden) gridContainer.classList.add('hidden');

        const maiNap = formatLocalDate(new Date());

        for (let i = 0; i < napokSzama; i++) {
            const currentDate = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + i);
            const dateString = formatLocalDate(currentDate);
            const displayDate = currentDate.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });

            const card = document.createElement('div');
            card.className = 'card';
            card.dataset.date = dateString;

            const header = document.createElement('div');
            header.className = 'card-header';
            header.textContent = displayDate;

            // Mai nap kiemelése
            if (dateString === maiNap) {
                card.classList.add('ma');
                const cimke = document.createElement('span');
                cimke.className = 'ma-cimke';
                cimke.textContent = 'MA';
                header.prepend(cimke);
            }

            const content = document.createElement('div');
            content.className = 'card-content';
            content.id = `content-${dateString}`;

            card.appendChild(header);
            card.appendChild(content);
            gridContainer.appendChild(card);

            updateGridCard(dateString);
            card.addEventListener('click', () => openDetailView(dateString, displayDate));
        }
    });

    function updateGridCard(dateString) {
        const contentBox = document.getElementById(`content-${dateString}`);
        if (!contentBox) return;
        contentBox.innerHTML = '';

        const sortedEvents = napiSorrend(tasksData[dateString] || []);
        let lastRenderedCity = "";

        sortedEvents.forEach(event => {
            const currentCity = (event.varos || "").trim().toUpperCase();
            if (currentCity !== "" && currentCity !== lastRenderedCity) {
                const cityBadge = document.createElement('div');
                cityBadge.className = 'task-badge badge-varos';
                cityBadge.textContent = currentCity;
                contentBox.appendChild(cityBadge);
                lastRenderedCity = currentCity;
            }

            if (!event.megnevezés) return;
            const badge = document.createElement('div');
            badge.className = `task-badge ${getTypeClass(event.tipus, 'badge')}`;
            badge.textContent = event.megnevezés;
            badge.title = event.megnevezés;
            contentBox.appendChild(badge);
        });
    }

    // =================================================================
    //  NAPI NÉZET
    // =================================================================

    function openDetailView(dateString, displayDate) {
        currentSelectedDate = dateString;
        currentDisplayDate = displayDate;
        gridContainer.classList.add('hidden');
        detailContainer.classList.remove('hidden');
        detailTitle.textContent = displayDate;
        renderDetailTable();
        window.scrollTo(0, 0);
    }

    backBtn.addEventListener('click', () => {
        detailContainer.classList.add('hidden');
        gridContainer.classList.remove('hidden');
    });

    // Térkép: link, szöveg, vagy automatikus Google + Apple kereső gomb
    function terkepHtml(event) {
        const url = biztonsagosUrl(event.utvonal);
        if (url) {
            return `<div class="link-sor"><a href="${esc(url)}" target="_blank" rel="noopener" class="maps-link">🗺️ Térkép / Link</a></div>`;
        }
        if (event.utvonal && event.utvonal.trim() !== "") {
            return `<div class="link-sor"><span class="utvonal-szoveg">🗺️ ${esc(event.utvonal)}</span></div>`;
        }
        const kereses = [event.megnevezés, event.varos].filter(s => s && s.trim()).join(', ');
        if (!kereses) return '';
        const q = encodeURIComponent(kereses);
        return `<div class="link-sor">` +
            `<a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener" class="maps-link">🗺️ Google</a>` +
            `<a href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener" class="maps-link">🍎 Térkép</a>` +
            `</div>`;
    }

    // Naptár: iPhone (.ics a szerverről) és Google Naptár link
    function naptarHtml(event) {
        if (!event.id) return '';
        const icsUrl = `${API_URL}?action=ics&lap=${encodeURIComponent(sheetSelector.value)}&id=${encodeURIComponent(event.id)}`;
        return `<div class="link-sor">` +
            `<a href="${esc(icsUrl)}" target="_blank" rel="noopener" class="naptar-link" title="Hozzáadás az iPhone naptárhoz">📅 iPhone naptár</a>` +
            `<a href="${esc(googleNaptarLink(event, currentSelectedDate))}" target="_blank" rel="noopener" class="naptar-link" title="Hozzáadás a Google Naptárhoz">📅 Google Naptár</a>` +
            `</div>`;
    }

    function renderDetailTable() {
        detailTableBody.innerHTML = '';
        const rawEvents = tasksData[currentSelectedDate] || [];

        if (rawEvents.length === 0) {
            detailTableBody.innerHTML = '<tr><td colspan="7" class="ures-nap">Nincs még program felvéve erre a napra.</td></tr>';
            return;
        }

        const sortedEvents = napiSorrend(rawEvents);

        sortedEvents.forEach((event, index) => {
            const tr = document.createElement('tr');
            tr.className = getTypeClass(event.tipus, 'tr');

            const felOk = index > 0 && athelyezheto(event, sortedEvents[index - 1]);
            const leOk = index < sortedEvents.length - 1 && athelyezheto(event, sortedEvents[index + 1]);

            tr.innerHTML =
                `<td>` +
                    `<span class="table-meta">${esc(event.tipus)}</span>` +
                    `<strong>${esc(event.idopont || '--:--')}</strong>` +
                `</td>` +
                `<td>` +
                    `<span class="table-meta varos">${esc(event.varos)}</span>` +
                    `<span class="table-title">${esc(event.megnevezés)}</span>` +
                    (event.reszletek ? `<span class="table-desc">${esc(event.reszletek)}</span>` : '') +
                    terkepHtml(event) +
                    naptarHtml(event) +
                `</td>` +
                `<td class="cell-intezendo" data-label="Intézendő">${esc(event.intezendo)}</td>` +
                `<td data-label="Fizetés előre">${esc(event.fizetesElore)}</td>` +
                `<td data-label="Fizetés helyszínen">${esc(event.fizetesHelyszinen)}</td>` +
                `<td class="cell-koltseg" data-label="Költség">${esc(event.koltseg)}</td>` +
                `<td>` +
                    `<div class="btn-actions">` +
                        `<button class="btn-edit" data-id="${esc(event.id)}">Módosítás</button>` +
                        `<button class="btn-delete" data-id="${esc(event.id)}">Törlés</button>` +
                        `<span class="elvalaszto"></span>` +
                        `<button class="btn-move btn-move-up ${felOk ? '' : 'rejtett'}" data-index="${index}" title="Mozgatás fel">⬆️</button>` +
                        `<button class="btn-move btn-move-down ${leOk ? '' : 'rejtett'}" data-index="${index}" title="Mozgatás le">⬇️</button>` +
                    `</div>` +
                `</td>`;
            detailTableBody.appendChild(tr);
        });

        detailTableBody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => openEditModal(e.currentTarget.dataset.id));
        });
        detailTableBody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => deleteEvent(e.currentTarget.dataset.id));
        });
        detailTableBody.querySelectorAll('.btn-move-up:not(.rejtett)').forEach(btn => {
            btn.addEventListener('click', (e) => moveEvent(parseInt(e.currentTarget.dataset.index, 10), -1));
        });
        detailTableBody.querySelectorAll('.btn-move-down:not(.rejtett)').forEach(btn => {
            btn.addEventListener('click', (e) => moveEvent(parseInt(e.currentTarget.dataset.index, 10), 1));
        });
    }

    function keresesIdAlapjan(id) {
        return (tasksData[currentSelectedDate] || []).find(e => e.id === id) || null;
    }

    function moveEvent(index, irany) {
        const lista = napiSorrend(tasksData[currentSelectedDate] || []);
        const cel = index + irany;
        if (cel < 0 || cel >= lista.length || !athelyezheto(lista[index], lista[cel])) return;

        [lista[index], lista[cel]] = [lista[cel], lista[index]];
        const ids = lista.map(e => e.id);
        if (ids.some(id => !id)) return alert('Hiányzó azonosító – frissítsd az oldalt!');

        detailTableBody.innerHTML = '<tr><td colspan="7" class="folyamatban">Sorrend frissítése a háttérben... ⏳</td></tr>';

        api('mozgatas', { lap: sheetSelector.value, datum: currentSelectedDate, ids })
            .then(frissitesValaszbol)
            .catch(err => {
                alert('Hiba a mozgatáskor: ' + err.message);
                renderDetailTable();
            });
    }

    // =================================================================
    //  NAPTÁR LINK (Google) – a város időzónájával a Beállítások lapról
    // =================================================================

    function naptarCim(event) {
        return (event.tipus && event.tipus !== 'Program') ? `${event.tipus}: ${event.megnevezés}` : event.megnevezés;
    }

    function naptarLeiras(event) {
        const r = [];
        if (event.reszletek) r.push('Részletek: ' + event.reszletek);
        if (event.intezendo) r.push('Intézendő: ' + event.intezendo);
        if (event.utvonal) r.push('Útvonal: ' + event.utvonal);
        return r.join('\n');
    }

    function utcFormatum(d) {
        const k = n => ('0' + n).slice(-2);
        return d.getUTCFullYear() + k(d.getUTCMonth() + 1) + k(d.getUTCDate()) + 'T' +
            k(d.getUTCHours()) + k(d.getUTCMinutes()) + '00';
    }

    // "15:00" → 1 órás; "07:30 - 14:00" → idősáv; ha a vége korábbi, másnapra esik
    function idoIntervallum(idopont, datum) {
        const talalatok = String(idopont || '').match(/\d{1,2}[:.]\d{2}/g);
        if (!talalatok) return null;
        const [ev, ho, nap] = datum.split('-').map(Number);
        const reszek = s => s.split(/[:.]/).map(Number);
        const [kh, kp] = reszek(talalatok[0]);
        if (kh > 23 || kp > 59) return null;
        const kezd = new Date(Date.UTC(ev, ho - 1, nap, kh, kp));
        let veg;
        if (talalatok[1]) {
            const [vh, vp] = reszek(talalatok[1]);
            veg = new Date(Date.UTC(ev, ho - 1, nap, vh, vp));
        } else {
            veg = new Date(kezd.getTime() + 3600000);
        }
        if (veg <= kezd) veg = new Date(veg.getTime() + 86400000);
        return { kezd: utcFormatum(kezd), veg: utcFormatum(veg) };
    }

    function googleNaptarLink(event, datum) {
        const tz = varosIdozonak[(event.varos || '').trim().toUpperCase()] || ALAP_IDOZONA;
        const ido = idoIntervallum(event.idopont, datum);
        let dates;
        if (ido) {
            dates = `${ido.kezd}/${ido.veg}`;
        } else {
            const [ev, ho, nap] = datum.split('-').map(Number);
            dates = datum.replace(/-/g, '') + '/' + utcFormatum(new Date(Date.UTC(ev, ho - 1, nap + 1))).substring(0, 8);
        }
        const helyszin = [event.varos, biztonsagosUrl(event.utvonal) ? '' : event.utvonal].filter(s => s && s.trim()).join(', ');
        const params = new URLSearchParams({
            action: 'TEMPLATE',
            text: naptarCim(event),
            dates: dates,
            ctz: tz,
            details: naptarLeiras(event),
            location: helyszin
        });
        return 'https://calendar.google.com/calendar/render?' + params.toString();
    }

    // =================================================================
    //  ŰRLAP: ÚJ / MÓDOSÍTÁS / TÖRLÉS
    // =================================================================

    mainAddBtn.addEventListener('click', () => {
        taskForm.reset();
        eventIdInput.value = "";
        modalTitle.innerText = "Új program / Új nap felvétele";
        taskDatumInput.value = "";
        taskDatumInput.readOnly = false;
        modal.classList.remove('hidden');
    });

    openModalBtn.addEventListener('click', () => {
        taskForm.reset();
        eventIdInput.value = "";
        modalTitle.innerText = "Új program hozzáadása";
        taskDatumInput.value = currentSelectedDate;
        taskDatumInput.readOnly = true;

        const events = tasksData[currentSelectedDate] || [];
        if (events.length > 0 && events[0].varos) {
            inputs.varos.value = events[0].varos;
        }
        modal.classList.remove('hidden');
    });

    function openEditModal(id) {
        const event = keresesIdAlapjan(id);
        if (!event) return alert('A program nem található – frissítsd az oldalt!');

        taskForm.reset();
        eventIdInput.value = event.id;
        modalTitle.innerText = "Program szerkesztése";
        taskDatumInput.value = currentSelectedDate;
        taskDatumInput.readOnly = true;

        inputs.varos.value = event.varos || "";
        inputs.tipus.value = event.tipus || "Program";
        inputs.idopont.value = event.idopont || "";
        inputs.megnevezes.value = event.megnevezés || "";
        inputs.reszletek.value = event.reszletek || "";
        inputs.utvonal.value = event.utvonal || "";
        inputs.intezendo.value = event.intezendo || "";
        inputs.fizetesElore.value = event.fizetesElore || "";
        inputs.fizetesHelyszinen.value = event.fizetesHelyszinen || "";
        inputs.koltseg.value = event.koltseg || "";

        modal.classList.remove('hidden');
    }

    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));

    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const targetDate = taskDatumInput.value;
        const submitBtn = taskForm.querySelector('button[type="submit"]');
        submitBtn.innerText = 'Mentés folyamatban...';
        submitBtn.disabled = true;

        const eventData = {
            id: eventIdInput.value || null,
            datum: targetDate,
            varos: inputs.varos.value,
            tipus: inputs.tipus.value,
            idopont: inputs.idopont.value,
            megnevezés: inputs.megnevezes.value,
            reszletek: inputs.reszletek.value,
            utvonal: inputs.utvonal.value,
            intezendo: inputs.intezendo.value,
            fizetesElore: inputs.fizetesElore.value,
            fizetesHelyszinen: inputs.fizetesHelyszinen.value,
            koltseg: inputs.koltseg.value
        };

        api('mentes', { lap: sheetSelector.value, event: eventData })
            .then(valasz => {
                if (!detailContainer.classList.contains('hidden')) currentSelectedDate = targetDate;
                frissitesValaszbol(valasz);
                modal.classList.add('hidden');
            })
            .catch(err => alert("Hiba történt a mentéskor: " + err.message))
            .finally(() => {
                submitBtn.innerText = 'Mentés a táblázatba';
                submitBtn.disabled = false;
            });
    });

    function deleteEvent(id) {
        const event = keresesIdAlapjan(id);
        if (!event) return;
        if (!confirm(`Biztosan törölni szeretnéd a(z) "${event.megnevezés}" programot?`)) return;

        gridContainer.innerHTML = '<p class="welcome-msg">Törlés folyamatban...</p>';
        api('torles', { lap: sheetSelector.value, id })
            .then(valasz => {
                frissitesValaszbol(valasz);
                backBtn.click();
            })
            .catch(err => {
                alert("Hiba történt a törléskor: " + err.message);
                if (startDateInput.value) generateBtn.click();
            });
    }

    // =================================================================
    //  ÚJ UTAZÁS
    // =================================================================

    newTripBtn.addEventListener('click', () => {
        newTripForm.reset();
        newTripModal.classList.remove('hidden');
    });

    closeNewTripModalBtn.addEventListener('click', () => {
        newTripModal.classList.add('hidden');
    });

    newTripForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const submitBtn = newTripForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        const newTripName = newTripNameInput.value.trim();

        submitBtn.innerText = 'Létrehozás... ⏳';
        submitBtn.disabled = true;

        api('ujUtazas', { nev: newTripName })
            .then(response => {
                newTripModal.classList.add('hidden');
                gridContainer.innerHTML = '<p class="welcome-msg">Vadonatúj utazás sikeresen létrehozva! Kezdődhet a tervezés!</p>';
                startDateInput.value = "";
                loadSheetNames(response.sheetName);
            })
            .catch(err => alert("Hiba: " + err.message))
            .finally(() => {
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            });
    });
});
