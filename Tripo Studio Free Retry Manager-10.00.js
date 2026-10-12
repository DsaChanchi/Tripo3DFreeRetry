// ==UserScript==
// @name         Tripo Studio Free Retry Manager
// @namespace    https://studio.tripo3d.ai/
// @version      10.00
// @author       DsaChanchi - Troyano
// @description  Abre cada modelo, busca Free Retry, lo pulsa si está disponible, espera a Tripo y continúa con el siguiente.
// @match        https://studio.tripo3d.ai/workspace/generate*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // CONFIGURACIÓN
    // ============================================================

    const CONFIG = {
        // Tiempo para que la interfaz responda al abrir un modelo.
        afterOpenWait: 1800,

        // Tiempo máximo para que aparezca Retry o se reconozca
        // que la página del modelo ya está preparada.
        modelReadyTimeout: 25000,

        // Tiempo entre comprobaciones del estado de la página.
        pollInterval: 350,

        // Espera después de pulsar Free Retry.
        // Aumenta este valor si Tripo tarda en reaccionar.
        afterRetryClickWait: 12000,

        // Pausa entre modelos cuando no hay Retry.
        afterSkipWait: 1200,

        // Espera después de cerrar un popup.
        popupCloseWait: 700,

        // Configuración del escaneo de modelos.
        scanScrollWait: 800,
        maxScanRounds: 300,
        stableScanRounds: 5,

        // Evita pulsar un botón que no indique que quedan intentos.
        requireAvailableRetries: true
    };

    const UI_ID = 'tripo-free-retry-manager-v10';

    const RETRY_SELECTOR =
        'button[data-trace="studio.workspace_generate.free_retry_button"]';

    const MODEL_SELECTOR =
        'a[href^="/workspace/generate/"]';

    const EXPORT_SELECTOR =
        'button[data-trace-key="studio.workspace_generate.try_export_button"]';

    // ============================================================
    // ESTADO
    // ============================================================

    let models = [];
    let running = false;
    let paused = false;
    let stopRequested = false;
    let currentIndex = 0;
    let assetsPanel = null;
    let scanRequested = false;

    // ============================================================
    // UTILIDADES
    // ============================================================

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisible(element) {
        if (!element || !element.isConnected) return false;

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0;
    }

    function log(message) {
        const time = new Date().toLocaleTimeString();

        console.log(`[Tripo Free Retry ${time}] ${message}`);

        const output = document.querySelector(
            `#${UI_ID} .tripo-log`
        );

        if (output) {
            const line = document.createElement('div');
            line.textContent = `[${time}] ${message}`;
            output.appendChild(line);

            while (output.children.length > 250) {
                output.removeChild(output.firstChild);
            }

            output.scrollTop = output.scrollHeight;
        }

        updateCounters();
    }

    function setStatus(message) {
        const element = document.querySelector(
            `#${UI_ID} .tripo-status`
        );

        if (element) element.textContent = message;
    }

    function updateCounters() {
        const element = document.querySelector(
            `#${UI_ID} .tripo-count`
        );

        if (element) {
            element.textContent =
                `Modelos: ${models.length} | ` +
                `Posición: ${models.length ? Math.min(currentIndex + 1, models.length) : 0}/${models.length}`;
        }
    }

    async function waitWhilePaused() {
        while (paused && !stopRequested) {
            setStatus('Pausado');
            await sleep(300);
        }

        return !stopRequested;
    }

    // ============================================================
    // LOCALIZACIÓN DEL PANEL ASSETS
    // ============================================================

    function findAssetsPanel() {
        const candidates = [
            ...document.querySelectorAll(
                'aside, nav, section, div'
            )
        ].filter(isVisible);

        // Primero buscamos el panel que contiene el texto
        // característico de la zona donde aparecen los modelos.
        const matching = candidates.filter(element => {
            const text = normalizeText(element.innerText);

            return /upload\s*3d\s*model/i.test(text) &&
                element.querySelector(MODEL_SELECTOR);
        });

        // Preferimos el contenedor más pequeño que incluya
        // tanto la zona de carga como los enlaces de modelos.
        matching.sort((a, b) => {
            const areaA =
                a.getBoundingClientRect().width *
                a.getBoundingClientRect().height;

            const areaB =
                b.getBoundingClientRect().width *
                b.getBoundingClientRect().height;

            return areaA - areaB;
        });

        if (matching.length) return matching[0];

        // Alternativa: localizar el contenedor con más enlaces
        // de modelos y que tenga scroll propio.
        const links = [
            ...document.querySelectorAll(MODEL_SELECTOR)
        ].filter(isVisible);

        if (!links.length) return null;

        let best = null;
        let bestScore = -1;

        for (const link of links) {
            let element = link.parentElement;

            for (let level = 0; element && level < 9; level++) {
                const count =
                    element.querySelectorAll(MODEL_SELECTOR).length;

                const style = getComputedStyle(element);
                const scrollable =
                    /(auto|scroll)/.test(style.overflowY) &&
                    element.scrollHeight > element.clientHeight + 10;

                const score = count + (scrollable ? 1000 : 0);

                if (score > bestScore) {
                    best = element;
                    bestScore = score;
                }

                element = element.parentElement;
            }
        }

        return best;
    }

    function getScrollContainer(element) {
        let current = element;

        while (current && current !== document.body) {
            const style = getComputedStyle(current);

            if (
                /(auto|scroll)/.test(style.overflowY) &&
                current.scrollHeight > current.clientHeight + 10
            ) {
                return current;
            }

            current = current.parentElement;
        }

        return document.scrollingElement || document.documentElement;
    }

    function extractModelName(link) {
        const aria = link.getAttribute('aria-label');
        if (aria) return normalizeText(aria);

        const title = link.getAttribute('title');
        if (title) return normalizeText(title);

        const text = normalizeText(link.innerText);
        if (text) return text.slice(0, 100);

        const image = link.querySelector('img[alt]');
        if (image && image.alt) return normalizeText(image.alt);

        const parts = link.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || 'Modelo sin nombre';
    }

    function getModelHref(link) {
        try {
            const url = new URL(link.href, location.origin);

            if (
                url.origin !== location.origin ||
                !url.pathname.startsWith('/workspace/generate/')
            ) {
                return null;
            }

            return url.pathname + url.search;
        } catch {
            return null;
        }
    }

    // ============================================================
    // ESCANEAR MODELOS
    // ============================================================

    async function scanModels() {
        if (running) {
            log('No se puede escanear mientras el proceso está activo.');
            return;
        }

        setStatus('Buscando modelos...');
        log('Iniciando escaneo de los modelos de Assets.');

        assetsPanel = findAssetsPanel();

        if (!assetsPanel) {
            log('No encuentro el panel Assets ni enlaces de modelos.');
            log('Abre la página donde aparece la lista de modelos y vuelve a escanear.');
            setStatus('No se encontró Assets');
            return;
        }

        const scrollContainer = getScrollContainer(assetsPanel);
        const originalScroll = scrollContainer.scrollTop;

        const found = new Map();
        let stableRounds = 0;
        let lastCount = 0;

        try {
            scrollContainer.scrollTop = 0;
            await sleep(CONFIG.scanScrollWait);

            for (
                let round = 0;
                round < CONFIG.maxScanRounds;
                round++
            ) {
                if (stopRequested) break;

                const links = [
                    ...assetsPanel.querySelectorAll(MODEL_SELECTOR)
                ];

                for (const link of links) {
                    const href = getModelHref(link);
                    if (!href) continue;

                    if (!found.has(href)) {
                        found.set(href, {
                            href,
                            name: extractModelName(link)
                        });
                    }
                }

                if (found.size === lastCount) {
                    stableRounds++;
                } else {
                    stableRounds = 0;
                    lastCount = found.size;
                }

                const maxScroll =
                    scrollContainer.scrollHeight -
                    scrollContainer.clientHeight;

                if (
                    scrollContainer.scrollTop >= maxScroll - 5 &&
                    stableRounds >= CONFIG.stableScanRounds
                ) {
                    break;
                }

                const step = Math.max(
                    300,
                    Math.floor(scrollContainer.clientHeight * 0.75)
                );

                scrollContainer.scrollTop = Math.min(
                    scrollContainer.scrollTop + step,
                    maxScroll
                );

                await sleep(CONFIG.scanScrollWait);
            }
        } finally {
            // Devolvemos el panel a su posición inicial.
            scrollContainer.scrollTop = originalScroll;
        }

        models = [...found.values()];
        currentIndex = 0;
        updateCounters();

        if (!models.length) {
            log('No se han encontrado modelos. Comprueba que Assets esté visible.');
            setStatus('Sin modelos');
            return;
        }

        log(`Escaneo completado: ${models.length} modelos únicos.`);
        log('Se comprobarán uno a uno en el orden encontrado.');
        setStatus(`${models.length} modelos listos`);
    }

    // ============================================================
    // POPUPS Y BOTÓN FREE RETRY
    // ============================================================

    function closeSubscriptionPopup() {
        const dialogs = [
            ...document.querySelectorAll(
                '[role="dialog"], [aria-modal="true"]'
            )
        ].filter(isVisible);

        for (const dialog of dialogs) {
            const text = normalizeText(dialog.innerText);

            if (
                !/subscription|subscribe|upgrade|credits|plan|suscripci[oó]n/i.test(text)
            ) {
                continue;
            }

            const closeButton = [
                ...dialog.querySelectorAll(
                    'button, [role="button"]'
                )
            ].find(button => {
                if (!isVisible(button)) return false;

                const label = normalizeText(
                    button.getAttribute('aria-label') ||
                    button.getAttribute('title') ||
                    button.innerText
                );

                return /close|dismiss|cerrar|×|✕/i.test(label);
            });

            if (closeButton) {
                closeButton.click();
                return true;
            }
        }

        return false;
    }

    function findFreeRetryButton() {
        const buttons = [
            ...document.querySelectorAll(RETRY_SELECTOR)
        ].filter(isVisible);

        return buttons.find(button => !button.disabled) || null;
    }

    function getRetryCount(button) {
        if (!button) return 0;

        const text = normalizeText(
            button.innerText || button.textContent
        );

        // Ejemplos admitidos: Free Retry (×3), Free Retry (x3).
        const match = text.match(
            /Free\s*Retry\s*\(\s*[×x]\s*(\d+)\s*\)/i
        );

        if (match) return Number(match[1]);

        // Si el botón no muestra un contador, se considera disponible
        // si el texto indica Free Retry y está habilitado.
        if (/free\s*retry/i.test(text)) return 1;

        return 0;
    }

    function findExportButton() {
        const byTrace = [
            ...document.querySelectorAll(EXPORT_SELECTOR)
        ].find(isVisible);

        if (byTrace) return byTrace;

        return [
            ...document.querySelectorAll('button')
        ].find(button =>
            isVisible(button) &&
            /^export$/i.test(normalizeText(button.innerText))
        ) || null;
    }

    // ============================================================
    // ABRIR MODELO
    // ============================================================

    function findModelLink(model) {
        // El enlace se vuelve a buscar en el DOM cada vez:
        // no reutilizamos elementos DOM antiguos.
        const links = [
            ...document.querySelectorAll(MODEL_SELECTOR)
        ];

        return links.find(link => {
            const href = getModelHref(link);
            return href === model.href;
        }) || null;
    }

    async function openModel(model) {
        let link = findModelLink(model);

        if (!link) {
            // Si la interfaz ha desmontado temporalmente Assets,
            // esperamos un poco a que vuelva a estar disponible.
            for (let attempt = 0; attempt < 15; attempt++) {
                if (stopRequested) return false;

                await sleep(400);
                link = findModelLink(model);

                if (link) break;
            }
        }

        if (!link) {
            log(`No encuentro el enlace para abrir: ${model.name}`);
            return false;
        }

        link.scrollIntoView({
            behavior: 'auto',
            block: 'center'
        });

        await sleep(250);

        // Evitamos que el clic se pierda por un elemento superpuesto.
        link.click();

        // Espera inicial para que la navegación SPA empiece.
        await sleep(CONFIG.afterOpenWait);

        return true;
    }

    // ============================================================
    // ESPERAR A QUE TRIPO CARGUE EL MODELO
    // ============================================================

    async function waitForModelReady(model) {
        const start = Date.now();
        let loggedWait = 0;

        while (
            Date.now() - start < CONFIG.modelReadyTimeout
        ) {
            if (stopRequested) {
                return { stopped: true };
            }

            if (!(await waitWhilePaused())) {
                return { stopped: true };
            }

            closeSubscriptionPopup();

            // Esperamos a que la URL corresponda al modelo solicitado.
            // Esto ayuda a no pulsar por error un Retry del modelo anterior.
            const currentPath = location.pathname;
            const expectedPath = new URL(
                model.href,
                location.origin
            ).pathname;

            const routeMatches = currentPath === expectedPath;

            if (routeMatches) {
                const retryButton = findFreeRetryButton();

                if (retryButton) {
                    const retries = getRetryCount(retryButton);

                    if (
                        !CONFIG.requireAvailableRetries ||
                        retries > 0
                    ) {
                        return {
                            ready: true,
                            retryButton,
                            retries
                        };
                    }
                }

                // La página del modelo puede estar lista aunque no haya
                // Retry. El botón Export sirve como señal alternativa.
                if (findExportButton()) {
                    return {
                        ready: true,
                        retryButton: null,
                        retries: 0
                    };
                }
            }

            const elapsed = Math.floor(
                (Date.now() - start) / 1000
            );

            if (elapsed >= loggedWait + 5) {
                loggedWait = elapsed;
                log(
                    `Esperando a que cargue "${model.name}" (${elapsed}s)...`
                );
            }

            await sleep(CONFIG.pollInterval);
        }

        return {
            ready: false,
            timeout: true
        };
    }

    // ============================================================
    // PROCESAR UN MODELO
    // ============================================================

    async function processModel(model, index) {
        log('--------------------------------------------------');
        log(`Modelo ${index + 1}/${models.length}: ${model.name}`);
        log(`Abriendo: ${model.href}`);

        const opened = await openModel(model);

        if (stopRequested) return 'stopped';

        if (!opened) {
            log('No se pudo abrir este modelo. Se continúa con el siguiente.');
            await sleep(CONFIG.afterSkipWait);
            return 'skipped';
        }

        const result = await waitForModelReady(model);

        if (result.stopped || stopRequested) {
            return 'stopped';
        }

        if (!result.ready) {
            log(
                `Tiempo agotado esperando "${model.name}". ` +
                'No se ha confirmado Retry; se continúa con el siguiente.'
            );

            await sleep(CONFIG.afterSkipWait);
            return 'timeout';
        }

        // Volvemos a consultar el botón justo antes de pulsarlo.
        // Así no dependemos de un elemento que haya quedado obsoleto.
        const retryButton = findFreeRetryButton();

        if (!retryButton) {
            log(`Sin Free Retry en "${model.name}". Siguiente modelo.`);
            await sleep(CONFIG.afterSkipWait);
            return 'no-retry';
        }

        const retries = getRetryCount(retryButton);

        if (
            CONFIG.requireAvailableRetries &&
            retries <= 0
        ) {
            log(`El botón Retry no indica intentos disponibles en "${model.name}". Se omite.`);
            await sleep(CONFIG.afterSkipWait);
            return 'no-retry';
        }

        log(
            `Free Retry detectado en "${model.name}"` +
            (retries ? ` (intentos indicados: ${retries})` : '') +
            '.'
        );

        // Desplazar el botón a la zona visible y comprobar que sigue activo.
        retryButton.scrollIntoView({
            behavior: 'auto',
            block: 'center'
        });

        await sleep(250);

        if (
            !retryButton.isConnected ||
            retryButton.disabled ||
            !isVisible(retryButton)
        ) {
            log('El botón dejó de estar disponible antes del clic. Se continúa.');
            await sleep(CONFIG.afterSkipWait);
            return 'no-retry';
        }

        // Solo un clic por modelo en esta pasada.
        retryButton.click();

        log(
            `Free Retry pulsado para "${model.name}". ` +
            `Esperando ${CONFIG.afterRetryClickWait / 1000}s para que Tripo reaccione...`
        );

        // Espera prudencial para permitir que Tripo acepte y procese
        // la orden antes de abrir el siguiente modelo.
        const waitEnd = Date.now() + CONFIG.afterRetryClickWait;

        while (Date.now() < waitEnd) {
            if (stopRequested) return 'stopped';

            if (!(await waitWhilePaused())) {
                return 'stopped';
            }

            closeSubscriptionPopup();

            await sleep(300);
        }

        log(`Espera terminada para "${model.name}". Pasando al siguiente.`);
        return 'retried';
    }

    // ============================================================
    // EJECUCIÓN SECUENCIAL
    // ============================================================

    async function startProcess() {
        if (running) {
            log('El proceso ya está en marcha.');
            return;
        }

        if (!models.length) {
            log('Primero pulsa "Escanear modelos".');
            setStatus('Escanea los modelos primero');
            return;
        }

        running = true;
        paused = false;
        stopRequested = false;
        currentIndex = 0;

        setStatus('Procesando modelos...');
        setButtonsState();

        let retried = 0;
        let skipped = 0;
        let timeouts = 0;

        log('========== INICIO DEL PROCESO ==========');
        log(`Total de modelos: ${models.length}`);
        log('Modo secuencial: abrir → detectar Retry → pulsar si existe → esperar → siguiente.');
        log(`Espera tras Retry: ${CONFIG.afterRetryClickWait / 1000}s.`);

        try {
            for (
                currentIndex = 0;
                currentIndex < models.length;
                currentIndex++
            ) {
                if (stopRequested) break;

                if (!(await waitWhilePaused())) break;

                updateCounters();

                let result;

                try {
                    result = await processModel(
                        models[currentIndex],
                        currentIndex
                    );
                } catch (error) {
                    log(
                        `Error en "${models[currentIndex].name}": ` +
                        `${error?.message || error}. Se continúa.`
                    );

                    result = 'error';
                    await sleep(CONFIG.afterSkipWait);
                }

                if (result === 'stopped') break;

                if (result === 'retried') retried++;
                else skipped++;

                if (result === 'timeout') timeouts++;

                updateCounters();
            }
        } finally {
            running = false;
            paused = false;

            setButtonsState();

            if (stopRequested) {
                setStatus('Detenido');
                log('Proceso detenido por el usuario.');
            } else {
                setStatus('Proceso terminado');
                log('========== PROCESO TERMINADO ==========');
            }

            log(`Free Retry pulsados: ${retried}`);
            log(`Modelos omitidos/sin Retry/con error: ${skipped}`);
            log(`Esperas agotadas: ${timeouts}`);
        }
    }

    function pauseProcess() {
        if (!running) return;

        paused = !paused;

        setStatus(paused ? 'Pausado' : 'Procesando modelos...');
        setButtonsState();

        log(paused ? 'Proceso pausado.' : 'Proceso reanudado.');
    }

    function stopProcess() {
        stopRequested = true;
        paused = false;

        setStatus('Deteniendo...');
        log('Solicitud de parada recibida. Se detendrá al salir de la espera actual.');

        setButtonsState();
    }

    // ============================================================
    // INTERFAZ
    // ============================================================

    function setButtonsState() {
        const root = document.getElementById(UI_ID);
        if (!root) return;

        root.querySelector('.tripo-scan').disabled = running;
        root.querySelector('.tripo-start').disabled = running;
        root.querySelector('.tripo-pause').disabled = !running;
        root.querySelector('.tripo-stop').disabled = !running;

        root.querySelector('.tripo-pause').textContent =
            paused ? 'Reanudar' : 'Pausar';
    }

    function createUI() {
        const old = document.getElementById(UI_ID);
        if (old) old.remove();

        const root = document.createElement('div');
        root.id = UI_ID;

        root.innerHTML = `
            <div class="tripo-header">
                <strong>Tripo Free Retry Manager</strong>
                <button class="tripo-minimize" title="Minimizar">−</button>
            </div>
            <div class="tripo-content">
                <div class="tripo-status">Preparado</div>
                <div class="tripo-count">Modelos: 0 | Posición: 0/0</div>
                <div class="tripo-buttons">
                    <button class="tripo-scan">Escanear modelos</button>
                    <button class="tripo-start">Iniciar Free Retry</button>
                    <button class="tripo-pause" disabled>Pausar</button>
                    <button class="tripo-stop" disabled>Detener</button>
                    <button class="tripo-clear">Limpiar registro</button>
                </div>
                <div class="tripo-log"></div>
                <div class="tripo-footnote">
                    Procesamiento secuencial · No exporta ni descarga archivos
                </div>
            </div>
        `;

        const style = document.createElement('style');

        style.textContent = `
            #${UI_ID} {
                position: fixed;
                z-index: 2147483647;
                top: 90px;
                right: 20px;
                width: 370px;
                max-width: calc(100vw - 30px);
                color: #f3f4f6;
                background: #17191f;
                border: 1px solid #4b5563;
                border-radius: 10px;
                box-shadow: 0 8px 30px #0008;
                font: 13px/1.4 Arial, sans-serif;
            }
            #${UI_ID} * { box-sizing: border-box; }
            #${UI_ID} .tripo-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 12px;
                background: #252833;
                border-radius: 10px 10px 0 0;
                cursor: move;
                user-select: none;
            }
            #${UI_ID} button {
                cursor: pointer;
                border: 1px solid #555e70;
                border-radius: 5px;
                padding: 7px 8px;
                color: #fff;
                background: #303746;
                font-size: 12px;
            }
            #${UI_ID} button:hover:not(:disabled) {
                background: #46536b;
            }
            #${UI_ID} button:disabled {
                opacity: .45;
                cursor: not-allowed;
            }
            #${UI_ID} .tripo-minimize {
                padding: 1px 8px;
                font-size: 18px;
            }
            #${UI_ID} .tripo-content { padding: 10px; }
            #${UI_ID} .tripo-status {
                font-weight: bold;
                margin-bottom: 5px;
            }
            #${UI_ID} .tripo-count {
                color: #cbd5e1;
                margin-bottom: 9px;
            }
            #${UI_ID} .tripo-buttons {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
                margin-bottom: 9px;
            }
            #${UI_ID} .tripo-log {
                height: 230px;
                overflow-y: auto;
                background: #0d0f14;
                border: 1px solid #343947;
                border-radius: 5px;
                padding: 7px;
                overflow-wrap: anywhere;
                font-size: 11px;
            }
            #${UI_ID} .tripo-log > div {
                margin-bottom: 5px;
                border-bottom: 1px solid #252833;
                padding-bottom: 3px;
            }
            #${UI_ID} .tripo-footnote {
                margin-top: 8px;
                color: #9ca3af;
                font-size: 10px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(root);

        root.querySelector('.tripo-scan').addEventListener(
            'click',
            scanModels
        );

        root.querySelector('.tripo-start').addEventListener(
            'click',
            startProcess
        );

        root.querySelector('.tripo-pause').addEventListener(
            'click',
            pauseProcess
        );

        root.querySelector('.tripo-stop').addEventListener(
            'click',
            stopProcess
        );

        root.querySelector('.tripo-clear').addEventListener(
            'click',
            () => {
                root.querySelector('.tripo-log').replaceChildren();
                log('Registro limpiado.');
            }
        );

        root.querySelector('.tripo-minimize').addEventListener(
            'click',
            () => {
                const content = root.querySelector('.tripo-content');
                const hidden = content.style.display === 'none';

                content.style.display = hidden ? '' : 'none';
                root.querySelector('.tripo-minimize').textContent =
                    hidden ? '−' : '+';
            }
        );

        // Permitir mover la ventana desde su cabecera.
        const header = root.querySelector('.tripo-header');
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', event => {
            if (event.target.closest('button')) return;

            dragging = true;

            const rect = root.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            root.style.right = 'auto';
            root.style.left = `${rect.left}px`;
            root.style.top = `${rect.top}px`;

            event.preventDefault();
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) return;

            root.style.left = `${Math.max(
                0,
                Math.min(
                    event.clientX - offsetX,
                    window.innerWidth - root.offsetWidth
                )
            )}px`;

            root.style.top = `${Math.max(
                0,
                Math.min(
                    event.clientY - offsetY,
                    window.innerHeight - 40
                )
            )}px`;
        });

        document.addEventListener('mouseup', () => {
            dragging = false;
        });

        setButtonsState();
        updateCounters();
    }

    // ============================================================
    // INICIALIZACIÓN
    // ============================================================

    function init() {
        if (!document.body) {
            setTimeout(init, 500);
            return;
        }

        createUI();

        log('Manager cargado.');
        log('Pulsa "Escanear modelos" y después "Iniciar Free Retry".');
        log(
            `Espera configurada tras Retry: ` +
            `${CONFIG.afterRetryClickWait / 1000} segundos.`
        );
    }

    init();
})();
