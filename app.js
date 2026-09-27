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
    let varosOrszagok = {};        // város → országkód (időjáráshoz)
    let utolsoBetoltes = 0;        // mikor jött utoljára friss adat (automatikus frissítéshez)
    let currentSelectedDate = null;
    let currentDisplayDate = '';
    let racsNapjai = [];           // a rács napjai sorrendben: { datum, felirat }

    const ROVID_NAPOK = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

    // ---- Napi lapozó: ◀ cím ▶ (a meglévő cím köré építjük) ----
    const lapozoSor = document.createElement('div');
    lapozoSor.className = 'nap-lapozo';
    const elozoNapBtn = document.createElement('button');
    elozoNapBtn.type = 'button';
    elozoNapBtn.className = 'lapozo-btn';
    elozoNapBtn.textContent = '◀';
    elozoNapBtn.title = 'Előző nap';
    elozoNapBtn.setAttribute('aria-label', 'Előző nap');
    const kovetkezoNapBtn = document.createElement('button');
    kovetkezoNapBtn.type = 'button';
    kovetkezoNapBtn.className = 'lapozo-btn';
    kovetkezoNapBtn.textContent = '▶';
    kovetkezoNapBtn.title = 'Következő nap';
    kovetkezoNapBtn.setAttribute('aria-label', 'Következő nap');
    detailTitle.parentNode.insertBefore(lapozoSor, detailTitle);
    lapozoSor.appendChild(elozoNapBtn);
    lapozoSor.appendChild(detailTitle);
    lapozoSor.appendChild(kovetkezoNapBtn);

    // ---- Telefonos nézetváltó: Naptár / Lista (a telefon megjegyzi) ----
    const MOBIL_SZELESSEG = 800;
    function mobilE() { return window.innerWidth <= MOBIL_SZELESSEG; }

    let naptarNezet = true;
    try { naptarNezet = localStorage.getItem('utazas_nezet') !== 'lista'; } catch (e) { }

    const nezetBtn = document.createElement('button');
    nezetBtn.type = 'button';
    nezetBtn.id = 'nezetValto';
    nezetBtn.className = 'nezet-valto';
    document.querySelector('.controls').appendChild(nezetBtn);

    function nezetAlkalmazasa() {
        const naptar = mobilE() && naptarNezet;
        document.body.classList.toggle('mobil-naptar', naptar);
        document.body.classList.toggle('mobil-lista', mobilE() && !naptarNezet);
        nezetBtn.textContent = naptarNezet ? '☰ Lista nézet' : '▦ Naptár nézet';
    }

    nezetBtn.addEventListener('click', () => {
        naptarNezet = !naptarNezet;
        try { localStorage.setItem('utazas_nezet', naptarNezet ? 'naptar' : 'lista'); } catch (e) { }
        nezetAlkalmazasa();
        racsMeretezese();
    });

    nezetAlkalmazasa();

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

    // text/plain típussal küldjük, így nincs CORS előkérés.
    // Hibás vagy hiányzó családi kódnál bekéri a kódot, és megismétli a kérést.
    function api(action, adat = {}) {
        return apiHivas(action, adat).catch(err => {
            if (!err.kodHiba) throw err;
            return kodBekeres().then(() => api(action, adat));
        });
    }

    function apiHivas(action, adat) {
        return fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(Object.assign({ action, kod: kodOlvasas() }, adat))
        })
            .then(r => {
                if (!r.ok) throw new Error('Szerverhiba (' + r.status + ')');
                return r.json();
            })
            .then(v => {
                if (!v || v.success === false) {
                    const hiba = new Error((v && v.error) || 'Ismeretlen hiba');
                    hiba.kodHiba = !!(v && v.kodHiba);
                    throw hiba;
                }
                return v;
            });
    }

    // =================================================================
    //  CSALÁDI KÓD (eszközönként egyszer kell beírni)
    // =================================================================

    function kodOlvasas() {
        try { return localStorage.getItem('utazas_kod') || ''; } catch (e) { return ''; }
    }

    const kodModal = document.createElement('div');
    kodModal.className = 'modal hidden';
    kodModal.id = 'kodModal';
    kodModal.innerHTML =
        '<div class="modal-content modal-kicsi">' +
            '<h3 class="kis-modal-cim">🔒 Családi kód</h3>' +
            '<p class="kod-szoveg" id="kodSzoveg"></p>' +
            '<form id="kodForm" class="uj-utazas-form">' +
                '<div class="form-group">' +
                    '<label for="kodInput">Kód:</label>' +
                    '<input type="text" id="kodInput" autocomplete="off" autocapitalize="off" spellcheck="false" required>' +
                '</div>' +
                '<button type="submit" class="btn-mentes-zold">Belépés</button>' +
                '<button type="button" id="kodMegseBtn" class="btn-megse">Mégse</button>' +
            '</form>' +
        '</div>';
    document.body.appendChild(kodModal);

    let kodIgeret = null;   // ha több kérés egyszerre kapja a hibát, csak egy ablak nyílik

    function kodBekeres() {
        if (kodIgeret) return kodIgeret;
        const volt = kodOlvasas();
        document.getElementById('kodSzoveg').textContent = volt
            ? 'A kód nem megfelelő (lehet, hogy megváltozott). Kérlek, add meg újra.'
            : 'Az utazástervező védett. Add meg a családi kódot, ezen az eszközön csak egyszer kell.';
        const input = document.getElementById('kodInput');
        input.value = '';
        kodModal.classList.remove('hidden');
        setTimeout(() => input.focus(), 50);

        kodIgeret = new Promise((resolve, reject) => {
            const form = document.getElementById('kodForm');
            const megse = document.getElementById('kodMegseBtn');
            const lezar = () => {
                form.removeEventListener('submit', bekuld);
                megse.removeEventListener('click', megszakit);
                kodModal.classList.add('hidden');
                kodIgeret = null;
            };
            const bekuld = (e) => {
                e.preventDefault();
                try { localStorage.setItem('utazas_kod', input.value.trim()); } catch (err) { }
                lezar();
                resolve();
            };
            const megszakit = () => {
                lezar();
                const hiba = new Error('Családi kód nélkül nem érhető el az utazástervező.');
                hiba.kodMegszakitva = true;
                reject(hiba);
            };
            form.addEventListener('submit', bekuld);
            megse.addEventListener('click', megszakit);
        });
        return kodIgeret;
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
        varosOrszagok = (adatok && adatok.orszagok) || {};
    }

    // Író művelet után a szerver a friss adatot is visszaküldi
    function frissitesValaszbol(valasz) {
        cacheMentes('adatok_' + sheetSelector.value, valasz.adatok);
        adatokBeallitasa(valasz.adatok);
        utolsoBetoltes = Date.now();
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
            .catch((err) => {
                if (err.kodMegszakitva) {
                    gridContainer.innerHTML = '<p class="welcome-msg">🔒 A megnyitáshoz családi kód kell. Frissítsd az oldalt, és add meg a kódot.</p>';
                    return;
                }
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
                utolsoBetoltes = Date.now();
                allapot('');
                betoltveUzenet();
            })
            .catch(err => {
                if (err.kodMegszakitva) {
                    gridContainer.innerHTML = '<p class="welcome-msg">🔒 A megnyitáshoz családi kód kell. Frissítsd az oldalt, és add meg a kódot.</p>';
                    return;
                }
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
        racsNapjai = [];

        for (let i = 0; i < napokSzama; i++) {
            const currentDate = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + i);
            const dateString = formatLocalDate(currentDate);
            const displayDate = currentDate.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
            racsNapjai.push({ datum: dateString, felirat: displayDate });

            const card = document.createElement('div');
            card.className = 'card';
            card.dataset.date = dateString;

            // Hosszú felirat (laptop, lista) és rövid felirat (telefonos naptárnézet)
            const header = document.createElement('div');
            header.className = 'card-header';
            const hosszu = document.createElement('span');
            hosszu.className = 'fejlec-hosszu';
            hosszu.textContent = displayDate;
            const rovid = document.createElement('span');
            rovid.className = 'fejlec-rovid';
            rovid.textContent = `${currentDate.getDate()} ${ROVID_NAPOK[currentDate.getDay()]}`;
            header.appendChild(hosszu);
            header.appendChild(rovid);

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

        racsMeretezese();
        idojarasFrissitese();
    });

    // =================================================================
    //  KÉPERNYŐRE ILLESZTÉS
    //  A teljes utazás görgetés nélkül kifér; ha nagyon hosszú, a kártyák
    //  nem mennek egy minimum alá, és akkor görgetni kell.
    // =================================================================

    const RACS_RES = 15;           // a kártyák közötti hézag (px) laptopon
    const RACS_RES_MOBIL = 4;      // telefonos naptárnézetben
    const MIN_SOR_LAPTOP = 140;
    const MIN_SOR_MOBIL = 90;

    function racsMeretezese() {
        if (gridContainer.classList.contains('hidden') || racsNapjai.length === 0) return;

        // Telefonos listanézetben a kártyák a tartalomhoz nőnek
        if (mobilE() && !naptarNezet) {
            gridContainer.style.gridAutoRows = '';
            return;
        }

        const hetek = Math.ceil(racsNapjai.length / 7);
        const res = mobilE() ? RACS_RES_MOBIL : RACS_RES;
        const also = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        const teteje = gridContainer.getBoundingClientRect().top + window.scrollY;
        const elerheto = window.innerHeight - teteje - also - 4;
        const minimum = mobilE() ? MIN_SOR_MOBIL : MIN_SOR_LAPTOP;
        const sor = Math.max(minimum, Math.floor((elerheto - res * (hetek - 1)) / hetek));
        gridContainer.style.gridAutoRows = sor + 'px';
    }

    let atmeretezesIdozito = null;
    window.addEventListener('resize', () => {
        clearTimeout(atmeretezesIdozito);
        atmeretezesIdozito = setTimeout(() => {
            nezetAlkalmazasa();
            racsMeretezese();
        }, 150);
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
        lapozoFrissitese();
        renderDetailTable();
        napiIdojarasKiirasa();
        window.scrollTo(0, 0);
    }

    backBtn.addEventListener('click', () => {
        detailContainer.classList.add('hidden');
        gridContainer.classList.remove('hidden');
        racsMeretezese();
    });

    // =================================================================
    //  NAPOK KÖZÖTTI LAPOZÁS (◀ ▶ gombok, ujjal húzás, ← → billentyűk)
    //  A rács minden napján végigmegy, az üreseken is.
    // =================================================================

    function aktualisNapIndex() {
        return racsNapjai.findIndex(n => n.datum === currentSelectedDate);
    }

    function lapozoFrissitese() {
        const i = aktualisNapIndex();
        elozoNapBtn.disabled = (i <= 0);
        kovetkezoNapBtn.disabled = (i === -1 || i >= racsNapjai.length - 1);
    }

    function lapozas(irany) {
        if (detailContainer.classList.contains('hidden')) return;
        const i = aktualisNapIndex();
        const cel = racsNapjai[i + irany];
        if (i === -1 || !cel) return;
        openDetailView(cel.datum, cel.felirat);
    }

    elozoNapBtn.addEventListener('click', () => lapozas(-1));
    kovetkezoNapBtn.addEventListener('click', () => lapozas(1));

    // Ujjal húzás a napi nézetben (vízszintes, elég hosszú mozdulat)
    let erintesX = null, erintesY = null;
    detailContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { erintesX = null; return; }
        erintesX = e.touches[0].clientX;
        erintesY = e.touches[0].clientY;
    }, { passive: true });
    detailContainer.addEventListener('touchend', (e) => {
        if (erintesX === null || nyitottAblak()) return;
        const dx = e.changedTouches[0].clientX - erintesX;
        const dy = e.changedTouches[0].clientY - erintesY;
        erintesX = null;
        // Nagyított nézetben nem lapozunk, ott a húzás görgetés
        if (window.visualViewport && window.visualViewport.scale > 1.05) return;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) lapozas(dx < 0 ? 1 : -1);
    }, { passive: true });

    // ← → billentyűk laptopon (nem, ha épp mezőbe írsz vagy nyitva egy ablak)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (nyitottAblak()) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
        lapozas(e.key === 'ArrowRight' ? 1 : -1);
    });

    function nyitottAblak() {
        return !!document.querySelector('.modal:not(.hidden)');
    }

    // =================================================================
    //  AUTOMATIKUS FRISSÍTÉS
    //  Amikor az appot előveszed (vagy visszaváltasz a fülre), csendben
    //  lehúzza a friss adatot. Legfeljebb percenként egyszer.
    // =================================================================

    const FRISSITES_MIN_KOZ = 60 * 1000;

    const frissitveJelzo = document.createElement('div');
    frissitveJelzo.className = 'frissitve-jelzo hidden';
    document.body.appendChild(frissitveJelzo);
    let jelzoIdozito = null;

    function jelzes(szoveg) {
        frissitveJelzo.textContent = szoveg;
        frissitveJelzo.classList.remove('hidden');
        clearTimeout(jelzoIdozito);
        jelzoIdozito = setTimeout(() => frissitveJelzo.classList.add('hidden'), 2500);
    }

    function csendesFrissites() {
        const lap = sheetSelector.value;
        if (!lap || !utolsoBetoltes || Date.now() - utolsoBetoltes < FRISSITES_MIN_KOZ || nyitottAblak()) return;
        utolsoBetoltes = Date.now();

        api('adatok', { lap })
            .then(v => {
                if (sheetSelector.value !== lap) return;
                const valtozott = JSON.stringify(v.adatok) !== JSON.stringify({ tasks: tasksData, idozonak: varosIdozonak, orszagok: varosOrszagok });
                cacheMentes('adatok_' + lap, v.adatok);
                allapot('');
                if (!valtozott) return;
                adatokBeallitasa(v.adatok);
                if (startDateInput.value && racsNapjai.length) generateBtn.click();
                if (!detailContainer.classList.contains('hidden')) {
                    lapozoFrissitese();
                    renderDetailTable();
                }
                jelzes('🔄 Frissítve – közben módosult a terv');
            })
            .catch(() => { /* offline: marad, ami van */ });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') csendesFrissites();
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) csendesFrissites(); });

    // =================================================================
    //  IDŐJÁRÁS (Open-Meteo, ingyenes, kulcs nélkül)
    //  A nap első városának előrejelzése, a következő ~16 napra.
    // =================================================================

    const IDOJARAS_NAPOK = 16;
    const ELOREJELZES_ERVENYES = 3 * 60 * 60 * 1000;      // 3 óra
    const HELY_ERVENYES = 30 * 24 * 60 * 60 * 1000;       // 30 nap

    function idojarasKod(kod) {
        if (kod === 0) return ['☀️', 'Derült'];
        if (kod === 1) return ['🌤️', 'Többnyire derült'];
        if (kod === 2) return ['⛅', 'Részben felhős'];
        if (kod === 3) return ['☁️', 'Borult'];
        if (kod === 45 || kod === 48) return ['🌫️', 'Köd'];
        if (kod >= 51 && kod <= 57) return ['🌦️', 'Szitálás'];
        if (kod >= 61 && kod <= 67) return ['🌧️', 'Eső'];
        if (kod >= 71 && kod <= 77) return ['🌨️', 'Havazás'];
        if (kod >= 80 && kod <= 82) return ['🌦️', 'Zápor'];
        if (kod === 85 || kod === 86) return ['🌨️', 'Hózápor'];
        if (kod >= 95) return ['⛈️', 'Zivatar'];
        return ['🌡️', ''];
    }

    const elorejelzesek = {};   // 'MIAMI|US' → { datum: { kod, max, min } }

    function napElsoVarosa(datum) {
        const e = napiSorrend(tasksData[datum] || []).find(x => (x.varos || '').trim());
        return e ? e.varos.trim() : '';
    }

    function idojarasKulcs(varos) {
        const v = varos.toUpperCase();
        return v + '|' + (varosOrszagok[v] || '');
    }

    async function helyKereses(varos) {
        const orszag = varosOrszagok[varos.toUpperCase()] || '';
        const kulcs = 'hely_' + varos.toUpperCase() + '|' + orszag;
        const c = cacheOlvasas(kulcs);
        if (c && c.ertek && Date.now() - c.ido < HELY_ERVENYES) return c.ertek;

        let url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(varos)}&count=1&language=hu&format=json`;
        if (orszag) url += `&countryCode=${orszag}`;
        const v = await fetch(url).then(r => r.json());
        const t = v && v.results && v.results[0];
        if (!t) return null;
        const hely = { lat: t.latitude, lon: t.longitude };
        cacheMentes(kulcs, hely);
        return hely;
    }

    async function varosElorejelzese(varos) {
        const kulcs = idojarasKulcs(varos);
        if (elorejelzesek[kulcs]) return elorejelzesek[kulcs];
        const c = cacheOlvasas('idojaras_' + kulcs);
        if (c && c.ertek && Date.now() - c.ido < ELOREJELZES_ERVENYES) {
            elorejelzesek[kulcs] = c.ertek;
            return c.ertek;
        }
        const hely = await helyKereses(varos);
        if (!hely) return null;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${hely.lat}&longitude=${hely.lon}` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${IDOJARAS_NAPOK}`;
        const v = await fetch(url).then(r => r.json());
        if (!v || !v.daily || !v.daily.time) return null;
        const napok = {};
        v.daily.time.forEach((d, i) => {
            napok[d] = {
                kod: v.daily.weather_code[i],
                max: Math.round(v.daily.temperature_2m_max[i]),
                min: Math.round(v.daily.temperature_2m_min[i])
            };
        });
        elorejelzesek[kulcs] = napok;
        cacheMentes('idojaras_' + kulcs, napok);
        return napok;
    }

    function napIdojarasa(datum) {
        const varos = napElsoVarosa(datum);
        if (!varos) return null;
        const napok = elorejelzesek[idojarasKulcs(varos)];
        return (napok && napok[datum]) ? Object.assign({ varos }, napok[datum]) : null;
    }

    function idojarasMegjelenitese() {
        racsNapjai.forEach(nap => {
            const kartya = gridContainer.querySelector(`.card[data-date="${nap.datum}"] .card-header`);
            if (!kartya) return;
            let hely = kartya.querySelector('.idojaras');
            const i = napIdojarasa(nap.datum);
            if (!i) { if (hely) hely.remove(); return; }
            if (!hely) {
                hely = document.createElement('span');
                hely.className = 'idojaras';
                kartya.appendChild(hely);
            }
            const [ikon, szoveg] = idojarasKod(i.kod);
            hely.title = `${i.varos}: ${szoveg}, ${i.max}° / ${i.min}°`;
            hely.innerHTML = `${ikon}<span class="ido-fok"> ${i.max}°/${i.min}°</span>`;
        });
        napiIdojarasKiirasa();
    }

    function napiIdojarasKiirasa() {
        if (detailContainer.classList.contains('hidden') || !currentSelectedDate) return;
        const i = napIdojarasa(currentSelectedDate);
        if (!i) { napiIdojaras.classList.add('hidden'); return; }
        const [ikon, szoveg] = idojarasKod(i.kod);
        napiIdojaras.textContent = `${ikon} ${i.varos}: ${szoveg}, max. ${i.max}°, min. ${i.min}°`;
        napiIdojaras.classList.remove('hidden');
    }

    async function idojarasFrissitese() {
        const ma = formatLocalDate(new Date());
        const utolso = new Date();
        utolso.setDate(utolso.getDate() + IDOJARAS_NAPOK - 1);
        const utolsoStr = formatLocalDate(utolso);

        const varosok = new Set();
        racsNapjai.forEach(nap => {
            if (nap.datum < ma || nap.datum > utolsoStr) return;
            const v = napElsoVarosa(nap.datum);
            if (v) varosok.add(v);
        });
        if (varosok.size === 0) { idojarasMegjelenitese(); return; }

        await Promise.all([...varosok].map(v => varosElorejelzese(v).catch(() => null)));
        idojarasMegjelenitese();
    }

    // A napi nézetben a cím alatti időjárás-sor
    const napiIdojaras = document.createElement('div');
    napiIdojaras.className = 'napi-idojaras hidden';
    document.querySelector('.detail-header').after(napiIdojaras);

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
                        `<button class="btn-copy" data-id="${esc(event.id)}" title="Másolás más napra">Másolás</button>` +
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
        detailTableBody.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => openCopyModal(e.currentTarget.dataset.id));
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

    // =================================================================
    //  MÁSOLÁS MÁS NAPRA (az utazás napjai közül választva)
    // =================================================================

    const masolasModal = document.createElement('div');
    masolasModal.className = 'modal hidden';
    masolasModal.id = 'masolasModal';
    masolasModal.innerHTML =
        '<div class="modal-content modal-kicsi">' +
            '<span class="close-btn" id="closeMasolasBtn">×</span>' +
            '<h3 class="kis-modal-cim">Másolás más napra</h3>' +
            '<p class="masolas-program" id="masolasProgram"></p>' +
            '<div class="nap-lista" id="masolasNapok"></div>' +
            '<button type="button" id="masolasMentesBtn" class="btn-mentes-zold">Másolás</button>' +
        '</div>';
    document.body.appendChild(masolasModal);
    const masolasNapok = document.getElementById('masolasNapok');
    const masolasMentesBtn = document.getElementById('masolasMentesBtn');
    let masolandoId = null;

    function openCopyModal(id) {
        const event = keresesIdAlapjan(id);
        if (!event) return alert('A program nem található – frissítsd az oldalt!');
        masolandoId = id;
        document.getElementById('masolasProgram').textContent = event.megnevezés + (event.idopont ? ` (${event.idopont})` : '');
        masolasNapok.innerHTML = '';
        racsNapjai.forEach((nap, i) => {
            if (nap.datum === currentSelectedDate) return;
            const sor = document.createElement('label');
            sor.className = 'nap-sor';
            sor.innerHTML = `<input type="checkbox" id="masolNap${i}" value="${esc(nap.datum)}"> <span>${esc(nap.felirat)}</span>`;
            masolasNapok.appendChild(sor);
        });
        masolasModal.classList.remove('hidden');
    }

    document.getElementById('closeMasolasBtn').addEventListener('click', () => masolasModal.classList.add('hidden'));

    masolasMentesBtn.addEventListener('click', () => {
        const datumok = [...masolasNapok.querySelectorAll('input:checked')].map(c => c.value);
        if (datumok.length === 0) return alert('Jelölj be legalább egy napot!');
        masolasMentesBtn.disabled = true;
        masolasMentesBtn.textContent = 'Másolás folyamatban... ⏳';
        api('masolas', { lap: sheetSelector.value, id: masolandoId, datumok })
            .then(valasz => {
                frissitesValaszbol(valasz);
                masolasModal.classList.add('hidden');
            })
            .catch(err => alert('Hiba a másoláskor: ' + err.message))
            .finally(() => {
                masolasMentesBtn.disabled = false;
                masolasMentesBtn.textContent = 'Másolás';
            });
    });

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
        ejszakakMezoFrissitese();
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
        ejszakakMezoFrissitese();
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

        ejszakakMezoFrissitese();
        modal.classList.remove('hidden');
    }

    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));

    // ---- Éjszakák száma mező (csak Szálloda típusnál látszik) ----
    const ejszakakCsoport = document.createElement('div');
    ejszakakCsoport.className = 'form-group ejszakak-csoport hidden';
    ejszakakCsoport.innerHTML =
        '<label for="taskEjszakak">Éjszakák száma:</label>' +
        '<input type="number" id="taskEjszakak" min="1" max="60" value="1" inputmode="numeric">' +
        '<small class="mezo-sugo">2 vagy több: a következő napokra is létrehozza ugyanezt a szállodát.</small>';
    inputs.idopont.closest('.form-group').after(ejszakakCsoport);
    const ejszakakInput = document.getElementById('taskEjszakak');

    function ejszakakMezoLathato() {
        return !ejszakakCsoport.classList.contains('hidden');
    }

    // Csak új szállodánál; meglévő bejegyzéshez a "Másolás" gomb való (így nem lesz duplikátum)
    function ejszakakMezoFrissitese() {
        const szalloda = inputs.tipus.value.trim().toLowerCase() === 'szálloda';
        ejszakakCsoport.classList.toggle('hidden', !szalloda || !!eventIdInput.value);
    }

    inputs.tipus.addEventListener('input', ejszakakMezoFrissitese);
    inputs.tipus.addEventListener('change', ejszakakMezoFrissitese);

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

        // Szálloda több éjszakára: a további napok dátumai (a kezdőnap után)
        const ejszakak = ejszakakMezoLathato() ? Math.min(60, Math.max(1, parseInt(ejszakakInput.value, 10) || 1)) : 1;
        if (ejszakak > 1 && targetDate) {
            const kezdo = datumbol(targetDate);
            eventData.extraDatumok = [];
            for (let i = 1; i < ejszakak; i++) {
                eventData.extraDatumok.push(formatLocalDate(new Date(kezdo.getFullYear(), kezdo.getMonth(), kezdo.getDate() + i)));
            }
        }

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
