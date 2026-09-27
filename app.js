<script>
document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const startDateInput = document.getElementById('startDate');
    const gridContainer = document.getElementById('grid-container');
    const detailContainer = document.getElementById('detail-container');
    const backBtn = document.getElementById('backBtn');
    const detailTitle = document.getElementById('detail-title');
    const detailTableBody = document.getElementById('detailTableBody');
    const sheetSelector = document.getElementById('sheetSelector');
    
    const modal = document.getElementById('taskModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const mainAddBtn = document.getElementById('mainAddBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const taskForm = document.getElementById('taskForm');
    const modalTitle = document.getElementById('modalTitle');
    const rowNumInput = document.getElementById('eventRowNum');
    const taskDatumInput = document.getElementById('taskDatum');
    
    const taskInviteEmailsInput = document.getElementById('taskInviteEmails');
    const taskSendInviteCheckbox = document.getElementById('taskSendInvite');
    
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
    let currentSelectedDate = null;
    
    let customTypeColors = {};
    let customColorIndex = 0;
    const maxCustomColors = 5;

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

    function loadSheetNames(selectSheet = null) {
        google.script.run.withSuccessHandler(function(names) {
            sheetSelector.innerHTML = '';
            names.forEach((name) => {
                const option = document.createElement('option');
                option.value = name;
                option.innerText = name;
                sheetSelector.appendChild(option);
            });
            if (names.length > 0) {
                if (selectSheet && names.includes(selectSheet)) {
                    sheetSelector.value = selectSheet;
                    loadTasksForSheet(selectSheet);
                } else {
                    loadTasksForSheet(names[0]);
                }
            }
        }).getSheetNames();
    }

    loadSheetNames();

    sheetSelector.addEventListener('change', (e) => {
        if (e.target.value) loadTasksForSheet(e.target.value);
    });

    function loadTasksForSheet(sheetName) {
        detailContainer.classList.add('hidden');
        gridContainer.classList.remove('hidden');

        gridContainer.innerHTML = '<p class="welcome-msg">Adatok betöltése a táblázatból...</p>';
        google.script.run.withSuccessHandler(function(data) {
            tasksData = data || {};
            gridContainer.innerHTML = '<p class="welcome-msg">Munkalap sikeresen betöltve! Kérlek, add meg az indulás napját, majd kattints a "Tervező generálása" gombra!</p>';
            if (startDateInput.value) generateBtn.click();
        }).getTasksFromSheet(sheetName);
    }

    function formatLocalDate(dateObj) {
        var year = dateObj.getFullYear();
        var month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
        var day = ("0" + dateObj.getDate()).slice(-2);
        return year + "-" + month + "-" + day;
    }

    function getMonday(d) {
        let date = new Date(d);
        if (isNaN(date.getTime())) date = new Date();
        let day = date.getDay();
        let diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    }
    
    function getSunday(d) {
        let date = new Date(d);
        if (isNaN(date.getTime())) date = new Date();
        let day = date.getDay();
        let diff = date.getDate() + (day === 0 ? 0 : 7 - day);
        return new Date(date.setDate(diff));
    }

    function sortEventsIntelligently(events) {
        if (!events || events.length === 0) return [];
        
        let blocks = [];
        let currentBlock = [];
        let currentCity = (events[0].varos || "").trim().toUpperCase();

        events.forEach(event => {
            let eventCity = (event.varos || "").trim().toUpperCase();
            if (eventCity !== currentCity && eventCity !== "") {
                blocks.push({ city: currentCity, items: currentBlock });
                currentBlock = [];
                currentCity = eventCity;
            }
            currentBlock.push(event);
        });
        if (currentBlock.length > 0) {
            blocks.push({ city: currentCity, items: currentBlock });
        }

        let sortedEvents = [];
        blocks.forEach(block => {
            block.items.sort((a, b) => {
                let isHotelA = (a.tipus === 'Szálloda') ? 1 : 0;
                let isHotelB = (b.tipus === 'Szálloda') ? 1 : 0;
                if (isHotelA !== isHotelB) return isHotelB - isHotelA;
                
                let hasTimeA = (a.idopont && a.idopont.trim() !== "") ? 1 : 0;
                let hasTimeB = (b.idopont && b.idopont.trim() !== "") ? 1 : 0;
                
                if (hasTimeA && hasTimeB) {
                    let timeCmp = a.idopont.localeCompare(b.idopont);
                    if (timeCmp !== 0) return timeCmp;
                }
                
                if (hasTimeA !== hasTimeB) return hasTimeB - hasTimeA;
                
                return a.rowNum - b.rowNum;
            });
            sortedEvents = sortedEvents.concat(block.items);
        });

        return sortedEvents;
    }

    generateBtn.addEventListener('click', () => {
        if (!startDateInput.value) return alert("Kérlek válassz indulási dátumot!");
        if (!sheetSelector.value) return alert("Kérlek várj, amíg a munkalapok betöltenek!");
        
        // HIBALHÁRÍTÁS: Megjegyezzük, hogy a rács épp rejtve van-e a napi nézet miatt
        const isGridHidden = gridContainer.classList.contains('hidden');
        
        gridContainer.innerHTML = '';
        const parts = startDateInput.value.split('-');
        const selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const startMonday = getMonday(selectedDate);
        
        let maxDateStr = null;
        let dateKeys = Object.keys(tasksData).filter(key => !isNaN(Date.parse(key)));
        if (dateKeys.length > 0) {
            maxDateStr = dateKeys.reduce((a, b) => a > b ? a : b);
        }
        
        let endSunday;
        if (maxDateStr && new Date(maxDateStr) >= startMonday) {
            endSunday = getSunday(new Date(maxDateStr));
        } else {
            endSunday = getSunday(startMonday);
        }
        
        let diffTime = Math.abs(endSunday - startMonday);
        let diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
        if (isNaN(diffDays) || diffDays <= 0) diffDays = 7;
        
        // Új CSS osztály ráadása úgy, hogy a láthatatlanságot visszarakjuk, ha eddig rejtve volt
        gridContainer.className = `grid-layout layout-${diffDays}`;
        if (isGridHidden) {
            gridContainer.classList.add('hidden');
        }

        for (let i = 0; i < diffDays; i++) {
            let currentDate = new Date(startMonday);
            currentDate.setDate(startMonday.getDate() + i);
            
            const dateString = formatLocalDate(currentDate);
            const options = { month: 'long', day: 'numeric', weekday: 'long' };
            const displayDate = currentDate.toLocaleDateString('hu-HU', options);

            const card = document.createElement('div');
            card.className = 'card';
            card.dataset.date = dateString;

            const header = document.createElement('div');
            header.className = 'card-header';
            header.innerText = displayDate;
            
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
        
        let rawEvents = tasksData[dateString] || [];
        if (rawEvents.length === 0) return;
        
        const sortedEvents = sortEventsIntelligently(rawEvents);
        let lastRenderedCity = "";

        sortedEvents.forEach(event => {
            if (!event) return;
            
            let currentCity = (event.varos || "").trim().toUpperCase();
            if (currentCity !== "" && currentCity !== lastRenderedCity) {
                const cityBadge = document.createElement('div');
                cityBadge.className = 'task-badge badge-varos';
                cityBadge.innerText = currentCity;
                contentBox.appendChild(cityBadge);
                lastRenderedCity = currentCity;
            }

            if (!event.megnevezés) return;
            const badge = document.createElement('div');
            let typeClass = getTypeClass(event.tipus, 'badge');
            
            badge.className = `task-badge ${typeClass}`;
            badge.innerText = event.megnevezés; 
            badge.title = event.megnevezés; 
            contentBox.appendChild(badge);
        });
    }

    function openDetailView(dateString, displayDate) {
        currentSelectedDate = dateString;
        gridContainer.classList.add('hidden');
        detailContainer.classList.remove('hidden');
        detailTitle.innerText = `Részletek: ${displayDate}`;
        renderDetailTable();
    }

    backBtn.addEventListener('click', () => {
        detailContainer.classList.add('hidden');
        gridContainer.classList.remove('hidden');
    });

    function renderDetailTable() {
        detailTableBody.innerHTML = '';
        const rawEvents = tasksData[currentSelectedDate] || [];
        
        if (rawEvents.length === 0) {
            detailTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#7f8c8d; font-style:italic; padding:30px;">Nincs még program felvéve erre a napra.</td></tr>';
            return;
        }

        const sortedEvents = sortEventsIntelligently(rawEvents);

        sortedEvents.forEach((event, index) => {
            const originalIndex = rawEvents.findIndex(e => e.rowNum === event.rowNum);
            const tr = document.createElement('tr');
            tr.className = getTypeClass(event.tipus, 'tr');

            let utvonalHtml = '';
            if (event.utvonal && event.utvonal.trim() !== "") {
                if (event.utvonal.includes('http://') || event.utvonal.includes('https://')) {
                    utvonalHtml = `<br><a href="${event.utvonal}" target="_blank" class="maps-link">🗺️ Térkép / Link</a>`;
                } else {
                    utvonalHtml = `<br><span style="font-size:0.85em; color:#e67e22;">🗺️ ${event.utvonal}</span>`;
                }
            }

            const upStyle = index === 0 ? 'opacity: 0.2; cursor: not-allowed;' : 'cursor: pointer;';
            const downStyle = index === sortedEvents.length - 1 ? 'opacity: 0.2; cursor: not-allowed;' : 'cursor: pointer;';

            tr.innerHTML = `
                <td>
                    <span class="table-meta">${event.tipus}</span>
                    <strong>${event.idopont || '--:--'}</strong>
                </td>
                <td>
                    <span class="table-meta" style="color:#34495e;">${event.varos}</span>
                    <span class="table-title">${event.megnevezés}</span>
                    ${event.reszletek ? `<span class="table-desc">${event.reszletek}</span>` : ''}
                    ${utvonalHtml}
                </td>
                <td style="font-weight: 500; color:#d35400;">${event.intezendo || ''}</td>
                <td>${event.fizetesElore || ''}</td>
                <td>${event.fizetesHelyszinen || ''}</td>
                <td style="font-weight: bold; color:#16a085;">${event.koltseg || ''}</td>
                <td class="btn-actions" style="display: flex; align-items: center; justify-content: flex-start;">
                    <button class="btn-edit" data-index="${originalIndex}">Módosítás</button>
                    <button class="btn-delete" data-index="${originalIndex}">Törlés</button>
                    <span style="border-left: 2px solid #bdc3c7; height: 20px; margin: 0 5px;"></span>
                    <button class="btn-move-up" data-index="${index}" style="background:transparent; border:none; font-size:1.3em; padding:0 3px; ${upStyle}" title="Mozgatás fel">⬆️</button>
                    <button class="btn-move-down" data-index="${index}" style="background:transparent; border:none; font-size:1.3em; padding:0 3px; ${downStyle}" title="Mozgatás le">⬇️</button>
                </td>
            `;
            detailTableBody.appendChild(tr);
        });

        detailTableBody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => openEditModal(e.target.dataset.index));
        });
        detailTableBody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => deleteEvent(e.target.dataset.index));
        });

        detailTableBody.querySelectorAll('.btn-move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                if (idx > 0) moveEvent(idx, idx - 1);
            });
        });
        detailTableBody.querySelectorAll('.btn-move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                if (idx < sortedEvents.length - 1) moveEvent(idx, idx + 1);
            });
        });
    }

    function moveEvent(idx1, idx2) {
        const rawEvents = tasksData[currentSelectedDate] || [];
        const sortedEvents = sortEventsIntelligently(rawEvents);
        
        const event1 = sortedEvents[idx1];
        const event2 = sortedEvents[idx2];
        
        if (!event1 || !event2 || !event1.rowNum || !event2.rowNum) return;
        
        const currentSheet = sheetSelector.value;
        detailTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; font-weight:bold; color:#3498db; font-size:1.1em;">Sorrend frissítése a háttérben... ⏳</td></tr>';
        
        google.script.run.withSuccessHandler(function(response) {
            if (response.success) {
                google.script.run.withSuccessHandler(function(freshData) {
                    tasksData = freshData || {};
                    renderDetailTable();
                    if (startDateInput.value) generateBtn.click(); 
                }).getTasksFromSheet(currentSheet);
            } else {
                alert(response.error);
                renderDetailTable(); 
            }
        }).swapRowsInSheet(event1.rowNum, event2.rowNum, currentSheet);
    }

    mainAddBtn.addEventListener('click', () => {
        taskForm.reset();
        rowNumInput.value = "";
        modalTitle.innerText = "Új program / Új nap felvétele";
        taskDatumInput.value = "";
        taskDatumInput.readOnly = false; 
        taskInviteEmailsInput.value = "";
        taskSendInviteCheckbox.checked = false;
        modal.classList.remove('hidden');
    });

    openModalBtn.addEventListener('click', () => {
        taskForm.reset();
        rowNumInput.value = "";
        modalTitle.innerText = "Új program hozzáadása";
        taskDatumInput.value = currentSelectedDate;
        taskDatumInput.readOnly = true; 
        taskInviteEmailsInput.value = "";
        taskSendInviteCheckbox.checked = false;
        
        const events = tasksData[currentSelectedDate] || [];
        if (events.length > 0 && events[0].varos) {
            inputs.varos.value = events[0].varos;
        }
        modal.classList.remove('hidden');
    });

    function openEditModal(index) {
        taskForm.reset();
        const event = tasksData[currentSelectedDate][index];
        rowNumInput.value = event.rowNum;
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
        
        taskInviteEmailsInput.value = "";
        taskSendInviteCheckbox.checked = false;
        
        modal.classList.remove('hidden');
    }

    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));

    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const currentSheet = sheetSelector.value;
        const targetDate = taskDatumInput.value; 
        const submitBtn = taskForm.querySelector('button[type="submit"]');
        submitBtn.innerText = 'Mentés folyamatban...';
        submitBtn.disabled = true;
        
        const eventData = {
            rowNum: rowNumInput.value ? parseInt(rowNumInput.value) : null,
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
            koltseg: inputs.koltseg.value,
            
            inviteEmails: taskInviteEmailsInput.value,
            sendInvite: taskSendInviteCheckbox.checked
        };

        google.script.run.withSuccessHandler(function(response) {
            if (response.success) {
                google.script.run.withSuccessHandler(function(freshData) {
                    tasksData = freshData || {};
                    if (!detailContainer.classList.contains('hidden')) {
                        currentSelectedDate = targetDate;
                        renderDetailTable();
                    }
                    if (startDateInput.value) generateBtn.click();
                    
                    if (taskSendInviteCheckbox.checked) {
                        if (response.calWarning && response.calWarning !== "") {
                            alert("⚠️ A program MENTVE lett a táblázatba, de a naptárba nem sikerült elküldeni!\n\nOka: " + response.calWarning);
                        } else {
                            alert("✅ A program mentve, és a naptármeghívók is sikeresen kiküldve!");
                        }
                    }
                    
                    modal.classList.add('hidden');
                }).getTasksFromSheet(currentSheet);
            } else {
                alert("Hiba történt a mentéskor: " + response.error);
            }
            submitBtn.innerText = 'Mentés a táblázatba';
            submitBtn.disabled = false;
        }).saveEventToSheet(eventData, currentSheet);
    });

    function deleteEvent(index) {
        const event = tasksData[currentSelectedDate][index];
        if (!event.rowNum) return;
        if (confirm(`Biztosan törölni szeretnéd a(z) "${event.megnevezés}" programot?`)) {
            const currentSheet = sheetSelector.value;
            gridContainer.innerHTML = '<p class="welcome-msg">Törlés folyamatban...</p>';
            
            google.script.run.withSuccessHandler(function(response) {
                if (response.success) {
                    google.script.run.withSuccessHandler(function(freshData) {
                        tasksData = freshData || {};
                        renderDetailTable();
                        if (startDateInput.value) generateBtn.click();
                        backBtn.click(); 
                    }).getTasksFromSheet(currentSheet);
                } else {
                    alert("Hiba történt a törléskor: " + response.error);
                }
            }).deleteEventFromSheet(event.rowNum, currentSheet);
        }
    }

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
        
        google.script.run.withSuccessHandler(function(response) {
            if (response.success) {
                newTripModal.classList.add('hidden');
                gridContainer.innerHTML = '<p class="welcome-msg">Vadonatúj utazás sikeresen létrehozva! Kezdődhet a tervezés!</p>';
                startDateInput.value = ""; 
                loadSheetNames(response.sheetName);
            } else {
                alert("Hiba: " + response.error);
            }
            submitBtn.innerText = originalText;
            submitBtn.disabled = false;
        }).createNewTripSheet(newTripName);
    });
});
</script>
