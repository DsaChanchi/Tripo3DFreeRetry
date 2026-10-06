// ==UserScript==
// @name         Tripo Studio Free Retry Manager
// @namespace    https://studio.tripo3d.ai/
// @author       DsaChanchi - Troyano
// @description  Escanea modelos de Tripo Studio y procesa Free Retry en varias iteraciones.
// @match        https://studio.tripo3d.ai/workspace/generate*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // CONFIGURACIÓN
    // ============================================================

    const UI_ID = 'tripo-backup-manager';

    // ============================================================
    // CONFIGURACIÓN DE ESCANEO
    // ============================================================

    const SCAN_CONFIG = {
        scrollWait: 1200,
        maxRounds: 400,
        stableRounds: 8,
        logEvery: 10
    };

    const LOAD_CONFIG = {
        modelLoadTimeout: 60000,
        afterModelClickWait: 1200
    };

    // ============================================================
    // CONFIGURACIÓN DE RETRY
    // ============================================================

    const RETRY_CONFIG = {

        // Configuración de espera
        clickWait: 10000,

        // Configuración de concurrencia
        maxConcurrent: 10,

        // Tiempo máximo de una generación
        generationTimeout: 120000,

        // Frecuencia de comprobación
        pollInterval: 1000,

        // Tiempo máximo de carga
        retryButtonTimeout: 60000,

        // Espera después de abrir un modelo
        afterModelClickWait: 1200,

        // Número de iteraciones
        iterations: 3,

        // Intervalo de comprobación del popup
        popupCheckInterval: 500,

        // Tiempo de espera después de cerrar popup
        popupCloseWait: 700
    };

    // ============================================================
    // ESTADO
    // ============================================================

    let models = [];

    // Lista de candidatos.
    // Se reutiliza en todas las iteraciones.
    let retryModels = [];

    // Procesos activos.
    let activeRetries = [];

    let backupRunning = false;
    let pauseRequested = false;
    let stopRequested = false;
    let assetsPanel = null;

    // Estado de candidatos.
    let retryScanDone = false;

    // Iteración actual.
    let currentIteration = 0;

    // ============================================================
    // UTILIDADES
    // ============================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function visible(el) {
        if (!el) return false;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function log(message) {

        const textarea =
            document.getElementById(UI_ID + '-log');

        const time =
            new Date().toLocaleTimeString();

        const line =
            `[${time}] ${message}`;

        if (textarea) {
            textarea.value += line + '\n';
            textarea.scrollTop =
                textarea.scrollHeight;
        }

        console.log(line);
    }

    function setState(text) {

        const el =
            document.getElementById(
                UI_ID + '-state'
            );

        if (el) {
            el.textContent = text;
        }
    }

    function setModelCount(count) {

        const el =
            document.getElementById(
                UI_ID + '-models'
            );

        if (el) {
            el.textContent = count;
        }
    }

    function waitForElement(
        predicate,
        timeout,
        interval = 100
    ) {

        return new Promise(resolve => {

            const start = Date.now();

            const check = () => {

                let result = null;

                try {
                    result = predicate();
                } catch (error) {
                    console.warn(
                        'waitForElement:',
                        error
                    );
                }

                if (result) {
                    resolve(result);
                    return;
                }

                if (
                    Date.now() - start >=
                    timeout
                ) {
                    resolve(null);
                    return;
                }

                setTimeout(
                    check,
                    interval
                );
            };

            check();
        });
    }

    // ============================================================
    // UI
    // ============================================================

    function createUI() {

        if (
            document.getElementById(UI_ID)
        ) {
            return;
        }

        const panel =
            document.createElement('div');

        panel.id = UI_ID;

        panel.innerHTML = `
            <style>
                #${UI_ID} {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 460px;
                    z-index: 2147483647;
                    background: #171717;
                    color: #fff;
                    border: 1px solid #444;
                    border-radius: 10px;
                    box-shadow: 0 10px 40px rgba(0,0,0,.5);
                    font-family: Arial, sans-serif;
                    font-size: 13px;
                    overflow: hidden;
                }

                #${UI_ID}.minimized {
                    width: 260px;
                }

                #${UI_ID}.minimized .tb-body {
                    display: none;
                }

                #${UI_ID}.hidden {
                    display: none;
                }

                #${UI_ID} .tb-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    background: #222;
                    cursor: move;
                    user-select: none;
                }

                #${UI_ID} .tb-title {
                    font-weight: bold;
                }

                #${UI_ID} .tb-version {
                    opacity: .55;
                    font-size: 11px;
                    margin-left: 5px;
                }

                #${UI_ID} .tb-header-buttons {
                    display: flex;
                    gap: 5px;
                }

                #${UI_ID} button {
                    border: 1px solid #555;
                    background: #2b2b2b;
                    color: white;
                    border-radius: 5px;
                    padding: 6px 9px;
                    cursor: pointer;
                }

                #${UI_ID} button:hover:not(:disabled) {
                    background: #3b3b3b;
                }

                #${UI_ID} button:disabled {
                    opacity: .45;
                    cursor: default;
                }

                #${UI_ID} .tb-body {
                    padding: 10px;
                }

                #${UI_ID} .tb-stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    margin-bottom: 10px;
                }

                #${UI_ID} .tb-stat {
                    background: #202020;
                    padding: 8px;
                    border-radius: 6px;
                }

                #${UI_ID} .tb-stat-label {
                    opacity: .6;
                    font-size: 11px;
                }

                #${UI_ID} .tb-stat-value {
                    font-weight: bold;
                    margin-top: 3px;
                }

                #${UI_ID} .tb-buttons {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                    margin-bottom: 10px;
                }

                #${UI_ID} textarea {
                    width: 100%;
                    height: 320px;
                    box-sizing: border-box;
                    resize: vertical;
                    background: #0f0f0f;
                    color: #ddd;
                    border: 1px solid #444;
                    border-radius: 6px;
                    padding: 8px;
                    font-family: monospace;
                    font-size: 11px;
                }

                #${UI_ID}-restore {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 2147483647;
                    display: none;
                }
            </style>

            <div class="tb-header" id="${UI_ID}-drag">

                <div>
                    <span class="tb-title">
                        Tripo Free Retry
                    </span>
                </div>

                <div class="tb-header-buttons">

                    <button
                        id="${UI_ID}-min"
                        title="Minimizar"
                    >−</button>

                    <button
                        id="${UI_ID}-hide"
                        title="Ocultar panel"
                    >×</button>

                </div>
            </div>

            <div class="tb-body">

                <div class="tb-stats">

                    <div class="tb-stat">
                        <div class="tb-stat-label">
                            Modelos / candidatos
                        </div>

                        <div
                            class="tb-stat-value"
                            id="${UI_ID}-models"
                        >
                            0
                        </div>
                    </div>

                    <div class="tb-stat">
                        <div class="tb-stat-label">
                            Estado
                        </div>

                        <div
                            class="tb-stat-value"
                            id="${UI_ID}-state"
                        >
                            Preparado
                        </div>
                    </div>

                </div>

                <div class="tb-buttons">

                    <button id="${UI_ID}-scan">
                        Escanear modelos
                    </button>

                    <button id="${UI_ID}-start">
                        Iniciar Free Retry
                    </button>

                    <button
                        id="${UI_ID}-pause"
                        disabled
                    >
                        Pausar
                    </button>

                    <button
                        id="${UI_ID}-stop"
                        disabled
                    >
                        Detener
                    </button>

                    <button id="${UI_ID}-copy">
                        Copiar log
                    </button>

                    <button id="${UI_ID}-clear">
                        Limpiar log
                    </button>

                    <button id="${UI_ID}-reset">
                        Reset
                    </button>

                </div>

                <textarea
                    id="${UI_ID}-log"
                    readonly
                ></textarea>

            </div>
        `;

        const restore =
            document.createElement('button');

        restore.id =
            UI_ID + '-restore';

        restore.textContent =
            'Mostrar Tripo Free Retry';

        document.body.appendChild(panel);
        document.body.appendChild(restore);

        document
            .getElementById(UI_ID + '-min')
            .addEventListener(
                'click',
                () => {
                    panel.classList.toggle(
                        'minimized'
                    );
                }
            );

        document
            .getElementById(UI_ID + '-hide')
            .addEventListener(
                'click',
                () => {
                    panel.classList.add(
                        'hidden'
                    );

                    restore.style.display =
                        'block';
                }
            );

        restore.addEventListener(
            'click',
            () => {
                panel.classList.remove(
                    'hidden'
                );

                restore.style.display =
                    'none';
            }
        );

        document
            .getElementById(UI_ID + '-scan')
            .addEventListener(
                'click',
                scanModels
            );

        document
            .getElementById(UI_ID + '-start')
            .addEventListener(
                'click',
                startBackup
            );

        document
            .getElementById(UI_ID + '-pause')
            .addEventListener(
                'click',
                () => {

                    if (!backupRunning) {
                        return;
                    }

                    pauseRequested =
                        !pauseRequested;

                    const btn =
                        document.getElementById(
                            UI_ID + '-pause'
                        );

                    if (pauseRequested) {

                        btn.textContent =
                            'Reanudar';

                        setState(
                            'Pausado'
                        );

                        log(
                            '⏸ Proceso pausado.'
                        );

                    } else {

                        btn.textContent =
                            'Pausar';

                        setState(
                            `Ejecutando · Iteración ${currentIteration}/${RETRY_CONFIG.iterations}`
                        );

                        log(
                            '▶ Proceso reanudado.'
                        );
                    }
                }
            );

        document
            .getElementById(UI_ID + '-stop')
            .addEventListener(
                'click',
                () => {

                    if (!backupRunning) {
                        return;
                    }

                    stopRequested = true;
                    pauseRequested = false;

                    setState(
                        'Deteniendo...'
                    );

                    log(
                        '⛔ Solicitud de detención recibida.'
                    );
                }
            );

        document
            .getElementById(UI_ID + '-copy')
            .addEventListener(
                'click',
                async () => {

                    const textarea =
                        document.getElementById(
                            UI_ID + '-log'
                        );

                    try {

                        await navigator.clipboard.writeText(
                            textarea.value
                        );

                    } catch {

                        textarea.select();

                        document.execCommand(
                            'copy'
                        );
                    }

                    log(
                        '✓ Log copiado al portapapeles.'
                    );
                }
            );

        document
            .getElementById(UI_ID + '-clear')
            .addEventListener(
                'click',
                () => {

                    document.getElementById(
                        UI_ID + '-log'
                    ).value = '';
                }
            );

        document
            .getElementById(UI_ID + '-reset')
            .addEventListener(
                'click',
                () => {

                    models = [];
                    retryModels = [];
                    activeRetries = [];

                    retryScanDone = false;
                    currentIteration = 0;

                    pauseRequested = false;
                    stopRequested = false;
                    backupRunning = false;

                    setModelCount(0);

                    setState(
                        'Preparado'
                    );

                    setBackupButtons(
                        false
                    );

                    const pause =
                        document.getElementById(
                            UI_ID + '-pause'
                        );

                    if (pause) {
                        pause.textContent =
                            'Pausar';
                    }

                    log(
                        'Reset completado.'
                    );
                }
            );

        makeDraggable(
            panel,
            document.getElementById(
                UI_ID + '-drag'
            )
        );
    }

    function makeDraggable(
        panel,
        handle
    ) {

        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener(
            'mousedown',
            e => {

                if (
                    e.target.closest(
                        'button'
                    )
                ) {
                    return;
                }

                dragging = true;

                const rect =
                    panel.getBoundingClientRect();

                offsetX =
                    e.clientX -
                    rect.left;

                offsetY =
                    e.clientY -
                    rect.top;

                panel.style.right =
                    'auto';

                panel.style.bottom =
                    'auto';

                panel.style.left =
                    rect.left + 'px';

                panel.style.top =
                    rect.top + 'px';
            }
        );

        document.addEventListener(
            'mousemove',
            e => {

                if (!dragging) {
                    return;
                }

                panel.style.left =
                    Math.max(
                        0,
                        Math.min(
                            window.innerWidth -
                            panel.offsetWidth,
                            e.clientX -
                            offsetX
                        )
                    ) + 'px';

                panel.style.top =
                    Math.max(
                        0,
                        Math.min(
                            window.innerHeight -
                            panel.offsetHeight,
                            e.clientY -
                            offsetY
                        )
                    ) + 'px';
            }
        );

        document.addEventListener(
            'mouseup',
            () => {
                dragging = false;
            }
        );
    }

    function setBackupButtons(
        running
    ) {

        const scan =
            document.getElementById(
                UI_ID + '-scan'
            );

        const start =
            document.getElementById(
                UI_ID + '-start'
            );

        const pause =
            document.getElementById(
                UI_ID + '-pause'
            );

        const stop =
            document.getElementById(
                UI_ID + '-stop'
            );

        if (scan) {
            scan.disabled = running;
        }

        if (start) {
            start.disabled = running;
        }

        if (pause) {
            pause.disabled = !running;
        }

        if (stop) {
            stop.disabled = !running;
        }
    }

    // ============================================================
    // ESCÁNER
    // ============================================================

    function findAssetsPanel() {

        const candidates = [
            ...document.querySelectorAll(
                'div, section, aside'
            )
        ];

        let best = null;
        let bestScore = -Infinity;

        for (const el of candidates) {

            if (!visible(el)) {
                continue;
            }

            const text =
                normalizeText(
                    el.innerText
                );

            if (
                !/upload\s+3d\s+model/i.test(
                    text
                )
            ) {
                continue;
            }

            const rect =
                el.getBoundingClientRect();

            const scrollable =
                el.scrollHeight >
                el.clientHeight + 100;

            if (!scrollable) {
                continue;
            }

            let score = 0;

            if (
                rect.left >
                window.innerWidth * 0.45
            ) {
                score += 10;
            }

            if (
                rect.width <
                window.innerWidth * 0.55
            ) {
                score += 5;
            }

            if (
                el.scrollHeight > 1000
            ) {
                score += 10;
            }

            if (rect.height > 300) {
                score += 5;
            }

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }

    function getAssetsPanel() {

        if (
            assetsPanel &&
            document.contains(
                assetsPanel
            )
        ) {
            return assetsPanel;
        }

        assetsPanel =
            findAssetsPanel();

        return assetsPanel;
    }

    function getCardName(card) {

        if (!card) {
            return '';
        }

        const title =
            card.getAttribute(
                'title'
            );

        if (title) {
            return normalizeText(
                title
            );
        }

        const aria =
            card.getAttribute(
                'aria-label'
            );

        if (aria) {
            return normalizeText(
                aria
            );
        }

        const img =
            card.querySelector(
                'img[alt]'
            );

        if (img?.alt) {
            return normalizeText(
                img.alt
            );
        }

        const lines =
            String(
                card.innerText || ''
            )
                .split('\n')
                .map(normalizeText)
                .filter(Boolean);

        return lines[0] || '';
    }

    function getThumbnail(card) {

        if (!card) {
            return null;
        }

        const img =
            card.querySelector(
                'img'
            );

        if (!img) {
            return null;
        }

        return (
            img.currentSrc ||
            img.src ||
            img.getAttribute(
                'src'
            ) ||
            img.getAttribute(
                'data-src'
            ) ||
            null
        );
    }

    function normalizeThumbnail(src) {

        if (!src) {
            return '';
        }

        return String(src)
            .replace(/\?.*$/, '')
            .trim();
    }

    function getCardFingerprint(card) {

        const name =
            getCardName(card);

        const thumb =
            normalizeThumbnail(
                getThumbnail(card)
            );

        return `${name}|||${thumb}`;
    }

    function getAssetCardFromElement(
        el
    ) {

        let current = el;

        for (
            let i = 0;
            i < 7 &&
            current;
            i++
        ) {

            if (
                current.nodeType !==
                1
            ) {
                break;
            }

            const rect =
                current.getBoundingClientRect();

            if (
                rect.width >= 80 &&
                rect.height >= 60 &&
                current.querySelector?.(
                    'img'
                )
            ) {

                const name =
                    getCardName(
                        current
                    );

                if (name) {
                    return current;
                }
            }

            current =
                current.parentElement;
        }

        return null;
    }

    function collectVisibleAssets(
        panel,
        map
    ) {

        const elements =
            panel.querySelectorAll(
                'img, button, a, [role="button"], [role="option"], div'
            );

        for (const el of elements) {

            const card =
                getAssetCardFromElement(
                    el
                );

            if (!card) continue;
            if (!visible(card)) continue;

            const name =
                getCardName(card);

            if (!name) continue;

            const fingerprint =
                getCardFingerprint(
                    card
                );

            if (!fingerprint) continue;

            if (
                !map.has(fingerprint)
            ) {

                map.set(
                    fingerprint,
                    {
                        fingerprint,
                        name,
                        thumbnail:
                            getThumbnail(
                                card
                            ),
                        element: card
                    }
                );
            }
        }
    }

    // ============================================================
    // SCAN MODELS
    // ============================================================

    async function scanModels() {

        if (backupRunning) {
            return;
        }

        stopRequested = false;

        // Un nuevo escaneo reinicia los candidatos.
        retryModels = [];
        retryScanDone = false;
        activeRetries = [];

        setState(
            'Escaneando...'
        );

        log(
            'Iniciando escaneo de modelos...'
        );

        const panel =
            getAssetsPanel();

        if (!panel) {

            log(
                '✗ No se encontró el panel de Assets.'
            );

            setState(
                'Error'
            );

            return;
        }

        const map = new Map();

        let lastSize = 0;
        let stableRounds = 0;
        let lastScrollTop = -1;

        panel.scrollTop = 0;

        await sleep(
            SCAN_CONFIG.scrollWait
        );

        for (
            let round = 0;
            round <
            SCAN_CONFIG.maxRounds;
            round++
        ) {

            if (stopRequested) {

                log(
                    '⛔ Escaneo detenido.'
                );

                break;
            }

            collectVisibleAssets(
                panel,
                map
            );

            const currentSize =
                map.size;

            if (
                currentSize ===
                lastSize
            ) {
                stableRounds++;
            } else {
                stableRounds = 0;
                lastSize =
                    currentSize;
            }

            const maxScroll =
                Math.max(
                    0,
                    panel.scrollHeight -
                    panel.clientHeight
                );

            const atBottom =
                panel.scrollTop >=
                maxScroll - 5;

            if (
                round %
                SCAN_CONFIG.logEvery ===
                0
            ) {

                log(
                    `Escaneo ronda ${
                        round + 1
                    }: ${
                        currentSize
                    } modelos`
                );
            }

            if (
                atBottom &&
                stableRounds >=
                SCAN_CONFIG.stableRounds
            ) {
                break;
            }

            const step =
                Math.max(
                    300,
                    Math.floor(
                        panel.clientHeight *
                        0.8
                    )
                );

            const before =
                panel.scrollTop;

            panel.scrollTop =
                Math.min(
                    maxScroll,
                    before + step
                );

            await sleep(
                SCAN_CONFIG.scrollWait
            );

            if (
                panel.scrollTop ===
                    lastScrollTop &&
                !atBottom
            ) {

                await sleep(
                    SCAN_CONFIG.scrollWait
                );
            }

            lastScrollTop =
                panel.scrollTop;

            collectVisibleAssets(
                panel,
                map
            );
        }

        collectVisibleAssets(
            panel,
            map
        );

        models =
            [...map.values()];

        setModelCount(
            models.length
        );

        panel.scrollTop = 0;

        setState(
            models.length
                ? 'Preparado'
                : 'Sin modelos'
        );

        log(
            `✓ Escaneo completado: ${
                models.length
            } modelos encontrados.`
        );
    }

    // ============================================================
    // PAUSA
    // ============================================================

    async function waitWhilePaused() {

        while (
            pauseRequested &&
            !stopRequested
        ) {

            // Gestión de elementos emergentes.
            closeSubscriptionPopup();

            await sleep(300);
        }
    }

    // ============================================================
    // POPUP DE SUSCRIPCIÓN / LÍMITE DE 10
    // ============================================================

    /*
     * Gestión de diálogos relacionados con límites o suscripción.
     */

    function getVisibleSubscriptionDialogs() {

        const all =
            [
                ...document.querySelectorAll(
                    '[role="dialog"], [aria-modal="true"], .reka-dialog-content, [data-state="open"]'
                )
            ];

        return all.filter(el => {

            if (!visible(el)) {
                return false;
            }

            const text =
                normalizeText(
                    el.innerText
                ).toLowerCase();

            if (!text) {
                return false;
            }

            return (
                /subscription/.test(text) ||
                /subscribe/.test(text) ||
                /upgrade/.test(text) ||
                /plan/.test(text) ||
                /free\s*retry/.test(text) ||
                /concurrent/.test(text) ||
                /limit/.test(text) ||
                /credits?/.test(text) ||
                /generat(ion|e).*limit/.test(text)
            );
        });
    }

    function getPopupCloseButton(dialog) {

        if (!dialog) {
            return null;
        }

        const buttons =
            [
                ...dialog.querySelectorAll(
                    'button, [role="button"]'
                )
            ].filter(visible);

        // Buscar botones de cierre.
        const ariaClose =
            buttons.find(button => {

                const label =
                    (
                        button.getAttribute('aria-label') ||
                        button.getAttribute('title') ||
                        ''
                    ).toLowerCase();

                return (
                    /close/.test(label) ||
                    /cerrar/.test(label) ||
                    /dismiss/.test(label) ||
                    /cancel/.test(label)
                );
            });

        if (ariaClose) {
            return ariaClose;
        }

        // Buscar botones con texto de cierre.
        const textClose =
            buttons.find(button => {

                const text =
                    normalizeText(
                        button.innerText
                    ).toLowerCase();

                return (
                    text === '×' ||
                    text === 'x' ||
                    text === 'close' ||
                    text === 'cerrar' ||
                    text === 'cancel' ||
                    text === 'cancelar' ||
                    text === 'not now' ||
                    text === 'maybe later' ||
                    text === 'no thanks' ||
                    text === 'later'
                );
            });

        if (textClose) {
            return textClose;
        }

        // Buscar botones de icono.
        const iconButtons =
            buttons.filter(button => {

                const text =
                    normalizeText(
                        button.innerText
                    );

                return (
                    !text &&
                    (
                        button.querySelector(
                            'svg'
                        ) ||
                        button.querySelector(
                            '[class*="close"]'
                        ) ||
                        button.querySelector(
                            '[class*="x-"]'
                        )
                    )
                );
            });

        if (iconButtons.length) {

            return iconButtons[
                iconButtons.length - 1
            ];
        }

        return null;
    }

    function closeSubscriptionPopup() {

        const dialogs =
            getVisibleSubscriptionDialogs();

        if (!dialogs.length) {
            return false;
        }

        let closed = false;

        for (const dialog of dialogs) {

            const button =
                getPopupCloseButton(
                    dialog
                );

            if (button) {

                try {

                    log(
                        '🧹 Popup de suscripción/límite detectado. Cerrándolo...'
                    );

                    button.click();

                    closed = true;

                } catch (error) {

                    console.warn(
                        'No se pudo pulsar botón de cierre:',
                        error
                    );
                }
            }
        }

        /*
         * También se intenta cerrar con Escape.
         */
        if (closed) {

            try {

                document.dispatchEvent(
                    new KeyboardEvent(
                        'keydown',
                        {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            which: 27,
                            bubbles: true
                        }
                    )
                );

            } catch {}
        }

        return closed;
    }

    async function ensureSubscriptionPopupClosed() {

        let closedSomething = false;

        for (
            let i = 0;
            i < 3;
            i++
        ) {

            const closed =
                closeSubscriptionPopup();

            if (closed) {
                closedSomething = true;
                await sleep(
                    RETRY_CONFIG.popupCloseWait
                );
            } else {
                break;
            }
        }

        return closedSomething;
    }

    // ============================================================
    // FREE RETRY
    // ============================================================

    function findFreeRetryButton() {

        const buttons =
            [
                ...document.querySelectorAll(
                    'button[data-trace="studio.workspace_generate.free_retry_button"]'
                )
            ];

        return (
            buttons.find(
                button =>
                    visible(button) &&
                    !button.disabled
            ) || null
        );
    }

    function getFreeRetryInfo(
        button
    ) {

        if (!button) {
            return null;
        }

        const text =
            normalizeText(
                button.innerText
            );

        let params = {};

        try {

            params =
                JSON.parse(
                    button.getAttribute(
                        'data-trace-params'
                    ) || '{}'
                );

        } catch {
            params = {};
        }

        const match =
            text.match(
                /Free\s+Retry\s*\(\s*[×x](\d+)\s*\)/i
            );

        const retries =
            match
                ? Number(match[1])
                : 0;

        return {
            button,
            text,
            retries,
            projectId:
                params.project_id ||
                null,
            limit:
                params.limit ||
                null
        };
    }

    function findExportButton() {

        const buttons =
            [
                ...document.querySelectorAll(
                    'button[data-trace-key="studio.workspace_generate.try_export_button"]'
                )
            ].filter(visible);

        return (
            buttons.find(
                button =>
                    normalizeText(
                        button.innerText
                    ) === 'Export'
            ) ||
            buttons[0] ||
            null
        );
    }

    async function waitForModelReadyOrRetry(
        timeout
    ) {

        const start =
            Date.now();

        let lastLog = 0;

        while (
            Date.now() - start <
            timeout
        ) {

            if (stopRequested) {

                return {
                    stopped: true
                };
            }

            // Gestión del popup.
            closeSubscriptionPopup();

            const retry =
                findFreeRetryButton();

            if (retry) {

                const info =
                    getFreeRetryInfo(
                        retry
                    );

                if (
                    info &&
                    info.retries > 0
                ) {
                    return {
                        retry: info
                    };
                }
            }

            const exportButton =
                findExportButton();

            if (exportButton) {

                return {
                    retry: null,
                    modelReady: true
                };
            }

            const elapsed =
                Math.floor(
                    (
                        Date.now() -
                        start
                    ) / 1000
                );

            if (
                elapsed >= lastLog + 10
            ) {

                log(
                    `Esperando carga del modelo... ${elapsed}s`
                );

                lastLog = elapsed;
            }

            await sleep(250);
        }

        return {
            retry: null,
            modelReady: false,
            timeout: true
        };
    }

    // ============================================================
    // LOCALIZAR TARJETA
    // ============================================================

    function findModelCard(
        model
    ) {

        const panel =
            getAssetsPanel();

        if (!panel) {
            return null;
        }

        const modelId =
            model?.name ||
            String(
                model?.fingerprint || ''
            ).split('|||')[0];

        const exactHref =
            `/workspace/generate/${modelId}`;

        const exact =
            [
                ...panel.querySelectorAll(
                    'a[href]'
                )
            ].find(
                a =>
                    a.getAttribute(
                        'href'
                    ) === exactHref
            );

        if (exact) {
            return exact;
        }

        const elements =
            panel.querySelectorAll(
                'img, button, a, [role="button"], [role="option"], div'
            );

        for (const el of elements) {

            const card =
                getAssetCardFromElement(
                    el
                );

            if (!card) continue;

            if (
                getCardFingerprint(
                    card
                ) === model.fingerprint
            ) {
                return card;
            }
        }

        return null;
    }

    async function clickModelCard(
        model
    ) {

        const target =
            findModelCard(model);

        if (!target) {

            throw new Error(
                'No se encontró la tarjeta real del modelo.'
            );
        }

        const href =
            target.getAttribute(
                'href'
            );

        log(
            `Modelo objetivo: A href=${
                href || '(sin href)'
            }`
        );

        if (
            target.tagName !== 'A' ||
            !href ||
            !href.startsWith(
                '/workspace/generate/'
            )
        ) {

            throw new Error(
                'La tarjeta localizada no es el enlace real /workspace/generate/<id>.'
            );
        }

        target.scrollIntoView({
            behavior: 'instant',
            block: 'center'
        });

        await sleep(300);

        target.click();

        await sleep(
            RETRY_CONFIG.afterModelClickWait
        );
    }

    // ============================================================
    // ABRIR MODELO PARA COMPROBAR RETRY
    // ============================================================

    async function openModelForRetry(
        model,
        modelIndex,
        total
    ) {

        await ensureSubscriptionPopupClosed();

        log(
            `🔍 Comprobando ${
                modelIndex + 1
            }/${total}: ${
                model.name || '(sin nombre)'
            }`
        );

        await clickModelCard(
            model
        );

        const result =
            await waitForModelReadyOrRetry(
                RETRY_CONFIG.retryButtonTimeout
            );

        if (result.stopped) {

            throw new Error(
                'Proceso detenido por el usuario.'
            );
        }

        if (
            result.retry
        ) {

            const info =
                result.retry;

            log(
                `🎯 FREE RETRY ENCONTRADO: ${
                    info.text
                }`
            );

            log(
                `   Project ID: ${
                    info.projectId ||
                    '(no disponible)'
                }`
            );

            log(
                `   Retries disponibles: ${
                    info.retries
                }`
            );

            return info;
        }

        if (result.modelReady) {

            log(
                '   — Sin Free Retry.'
            );

            return null;
        }

        log(
            '   ⚠ No se pudo confirmar Free Retry antes del timeout.'
        );

        return null;
    }

    // ============================================================
    // ESCANEAR CANDIDATOS FREE RETRY
    // ============================================================

    async function scanFreeRetryModels() {

        if (!models.length) {

            log(
                '✗ No hay modelos escaneados.'
            );

            return false;
        }

        retryModels = [];
        activeRetries = [];

        setState(
            'Buscando Free Retry...'
        );

        log(
            '============================================================'
        );

        log(
            `🔎 INICIANDO BÚSQUEDA DE FREE RETRY EN ${
                models.length
            } MODELOS`
        );

        log(
            'El listado no contiene el botón Free Retry.'
        );

        log(
            'Se abrirá cada modelo una vez para comprobarlo.'
        );

        log(
            '============================================================'
        );

        for (
            let i = 0;
            i < models.length;
            i++
        ) {

            if (stopRequested) {

                log(
                    '⛔ Búsqueda de candidatos detenida.'
                );

                return false;
            }

            await waitWhilePaused();

            await ensureSubscriptionPopupClosed();

            const model =
                models[i];

            try {

                const info =
                    await openModelForRetry(
                        model,
                        i,
                        models.length
                    );

                if (info) {

                    retryModels.push({
                        ...model,

                        projectId:
                            info.projectId,

                        retries:
                            info.retries,

                        retryText:
                            info.text
                    });

                    log(
                        `   ✓ CANDIDATO #${
                            retryModels.length
                        } GUARDADO`
                    );
                }

            } catch (error) {

                log(
                    `   ✗ Error comprobando modelo: ${
                        error.message ||
                        error
                    }`
                );

                if (stopRequested) {
                    return false;
                }
            }
        }

        retryScanDone = true;

        log(
            '============================================================'
        );

        log(
            `✓ BÚSQUEDA TERMINADA`
        );

        log(
            `Modelos escaneados: ${
                models.length
            }`
        );

        log(
            `Modelos con Free Retry: ${
                retryModels.length
            }`
        );

        if (!retryModels.length) {

            setState(
                'Sin Free Retry'
            );

            log(
                'No se encontró ningún modelo con Free Retry.'
            );

            return false;
        }

        setModelCount(
            retryModels.length
        );

        log(
            'La lista de candidatos queda guardada para TODAS las iteraciones.'
        );

        retryModels.forEach(
            (model, index) => {

                log(
                    `CANDIDATO ${
                        index + 1
                    }: ${
                        model.name
                    } | ${
                        model.retryText
                    } | project_id=${
                        model.projectId ||
                        '?'
                    }`
                );
            }
        );

        return true;
    }

    // ============================================================
    // CONTROL DE PROCESOS ACTIVOS
    // ============================================================

    function cleanupActiveRetries() {

        const now =
            Date.now();

        activeRetries =
            activeRetries.filter(
                job =>
                    now - job.startedAt <
                    RETRY_CONFIG.generationTimeout
            );
    }

    function getActiveRetryCount() {

        cleanupActiveRetries();

        return activeRetries.length;
    }

    function getOldestActiveRetry() {

        cleanupActiveRetries();

        if (!activeRetries.length) {
            return null;
        }

        return activeRetries.reduce(
            (oldest, current) =>
                current.startedAt <
                oldest.startedAt
                    ? current
                    : oldest
        );
    }

    // ============================================================
    // ESPERAR HUECO
    // ============================================================

    async function waitForFreeSlot() {

        let lastStatus = 0;

        while (!stopRequested) {

            await waitWhilePaused();

            if (stopRequested) {
                return false;
            }

            // Comprobación periódica del popup.
            await ensureSubscriptionPopupClosed();

            cleanupActiveRetries();

            const active =
                activeRetries.length;

            if (
                active <
                RETRY_CONFIG.maxConcurrent
            ) {

                return true;
            }

            const oldest =
                getOldestActiveRetry();

            if (!oldest) {
                return true;
            }

            const elapsed =
                Date.now() -
                oldest.startedAt;

            const remaining =
                Math.max(
                    0,
                    RETRY_CONFIG.generationTimeout -
                    elapsed
                );

            const now =
                Date.now();

            if (
                now - lastStatus >= 5000
            ) {

                log(
                    `⏳ Límite ${
                        RETRY_CONFIG.maxConcurrent
                    }/${
                        RETRY_CONFIG.maxConcurrent
                    }. Esperando hueco. Aproximadamente ${
                        Math.ceil(
                            remaining / 1000
                        )
                    }s.`
                );

                lastStatus = now;
            }

            /*
             * Comprobación periódica.
             */

            await sleep(
                Math.min(
                    RETRY_CONFIG.pollInterval,
                    Math.max(
                        250,
                        remaining
                    )
                )
            );
        }

        return false;
    }

    // ============================================================
    // EJECUTAR UN FREE RETRY
    // ============================================================

    async function executeFreeRetry(
        model,
        index,
        total
    ) {

        if (stopRequested) {
            return false;
        }

        await waitWhilePaused();

        await ensureSubscriptionPopupClosed();

        log(
            `------------------------------------------------------------`
        );

        log(
            `🚀 RETRY ${
                index + 1
            }/${total} · ITERACIÓN ${
                currentIteration
            }/${
                RETRY_CONFIG.iterations
            }`
        );

        log(
            `Modelo: ${
                model.name
            }`
        );

        if (model.projectId) {

            log(
                `Project ID: ${
                    model.projectId
                }`
            );
        }

        /*
         * Procesamiento del candidato actual.
         *
         * No se vuelve a escanear la lista completa.
         */

        const currentRetry =
            await openModelForRetry(
                model,
                index,
                total
            );

        if (!currentRetry) {

            log(
                '⚠ Este modelo ya no tiene Free Retry. Se omite en esta iteración.'
            );

            return false;
        }

        log(
            `🎯 Botón detectado: ${
                currentRetry.text
            }`
        );

        log(
            `Retries disponibles antes del click: ${
                currentRetry.retries
            }`
        );

        if (
            !currentRetry.button ||
            currentRetry.button.disabled
        ) {

            log(
                '⚠ El botón no está disponible.'
            );

            return false;
        }

        /*
         * Comprobación final antes del click.
         */

        await ensureSubscriptionPopupClosed();

        if (stopRequested) {
            return false;
        }

        const job = {
            model,
            projectId:
                currentRetry.projectId ||
                model.projectId ||
                null,
            startedAt:
                Date.now(),
            retriesBefore:
                currentRetry.retries,
            iteration:
                currentIteration
        };

        log(
            '🖱 Pulsando Free Retry...'
        );

        currentRetry.button.scrollIntoView({
            behavior: 'instant',
            block: 'center'
        });

        await sleep(200);

        /*
         * Registro del proceso después del click.
         */

        currentRetry.button.click();

        activeRetries.push(job);

        /*
         * Espera inicial.
         */

        await sleep(400);

        const popupWasClosed =
            await ensureSubscriptionPopupClosed();

        /*
         * Comprobación del popup.
         */

        if (popupWasClosed) {

            log(
                '⚠ Tripo mostró el popup de suscripción/límite. Se intentó cerrar automáticamente.'
            );
        }

        const active =
            getActiveRetryCount();

        log(
            `✓ Free Retry pulsado. Procesos activos aproximados: ${
                active
            }/${RETRY_CONFIG.maxConcurrent}`
        );

        log(
            `⏱ Esperando ${
                RETRY_CONFIG.clickWait / 1000
            }s antes de pasar al siguiente modelo...`
        );

        let remaining =
            RETRY_CONFIG.clickWait;

        while (
            remaining > 0
        ) {

            if (stopRequested) {
                return true;
            }

            await waitWhilePaused();

            if (stopRequested) {
                return true;
            }

            await ensureSubscriptionPopupClosed();

            const chunk =
                Math.min(
                    500,
                    remaining
                );

            await sleep(chunk);

            remaining -= chunk;
        }

        cleanupActiveRetries();

        log(
            `✓ 10s completados. Siguiente candidato.`
        );

        return true;
    }

    // ============================================================
    // ESPERAR A QUE ACABEN TODOS LOS ACTIVOS
    // ============================================================

    async function waitForAllActiveRetries() {

        cleanupActiveRetries();

        while (
            activeRetries.length &&
            !stopRequested
        ) {

            await waitWhilePaused();

            if (stopRequested) {
                break;
            }

            await ensureSubscriptionPopupClosed();

            cleanupActiveRetries();

            if (!activeRetries.length) {
                break;
            }

            const oldest =
                getOldestActiveRetry();

            let remaining = 0;

            if (oldest) {

                const elapsed =
                    Date.now() -
                    oldest.startedAt;

                remaining =
                    Math.max(
                        0,
                        RETRY_CONFIG.generationTimeout -
                        elapsed
                    );
            }

            log(
                `⏳ ${activeRetries.length} procesos activos. Próxima liberación estimada en ${
                    Math.ceil(
                        remaining / 1000
                    )
                }s.`
            );

            await sleep(
                RETRY_CONFIG.pollInterval
            );
        }

        cleanupActiveRetries();
    }

    // ============================================================
    // PROCESAR UNA ITERACIÓN
    // ============================================================

    async function processRetryIteration(
        iteration
    ) {

        currentIteration =
            iteration;

        log(
            '============================================================'
        );

        log(
            `🚀 INICIANDO ITERACIÓN ${
                iteration
            }/${
                RETRY_CONFIG.iterations
            }`
        );

        log(
            `Candidatos almacenados: ${
                retryModels.length
            }`
        );

        log(
            'No se volverán a escanear los 801 modelos.'
        );

        log(
            '============================================================'
        );

        let launched = 0;
        let skipped = 0;

        for (
            let i = 0;
            i < retryModels.length;
            i++
        ) {

            if (stopRequested) {
                break;
            }

            await waitWhilePaused();

            if (stopRequested) {
                break;
            }

            await ensureSubscriptionPopupClosed();

            /*
             * Esperar a que haya disponibilidad.
             */

            const slot =
                await waitForFreeSlot();

            if (!slot) {
                break;
            }

            cleanupActiveRetries();

            log(
                `📊 Activos antes del siguiente click: ${
                    activeRetries.length
                }/${
                    RETRY_CONFIG.maxConcurrent
                }`
            );

            const model =
                retryModels[i];

            try {

                const success =
                    await executeFreeRetry(
                        model,
                        i,
                        retryModels.length
                    );

                if (success) {

                    launched++;

                } else {

                    skipped++;
                }

            } catch (error) {

                log(
                    `✗ Error procesando ${
                        model.name
                    }: ${
                        error.message ||
                        error
                    }`
                );

                skipped++;

                if (stopRequested) {
                    break;
                }
            }
        }

        if (stopRequested) {

            log(
                `⛔ Iteración ${
                    iteration
                } detenida por el usuario.`
            );

            return {
                launched,
                skipped,
                stopped: true
            };
        }

        /*
         * Esperar antes de la siguiente iteración.
         */

        if (
            iteration <
            RETRY_CONFIG.iterations
        ) {

            cleanupActiveRetries();

            if (activeRetries.length) {

                log(
                    `⏳ La iteración ${
                        iteration
                    } terminó de lanzar modelos, pero quedan ${
                        activeRetries.length
                    } procesos activos.`
                );

                log(
                    'Esperando antes de comenzar la siguiente iteración...'
                );

                await waitForAllActiveRetries();
            }

            if (stopRequested) {

                return {
                    launched,
                    skipped,
                    stopped: true
                };
            }
        }

        log(
            `✓ ITERACIÓN ${
                iteration
            } FINALIZADA`
        );

        log(
            `   Ejecutados: ${
                launched
            }`
        );

        log(
            `   Omitidos: ${
                skipped
            }`
        );

        return {
            launched,
            skipped,
            stopped: false
        };
    }

    // ============================================================
    // PROCESAR TODAS LAS ITERACIONES
    // ============================================================

    async function processAllIterations() {

        let totalLaunched = 0;
        let totalSkipped = 0;

        for (
            let iteration = 1;
            iteration <=
            RETRY_CONFIG.iterations;
            iteration++
        ) {

            if (stopRequested) {
                break;
            }

            currentIteration =
                iteration;

            setState(
                `Iteración ${iteration}/${RETRY_CONFIG.iterations}`
            );

            const result =
                await processRetryIteration(
                    iteration
                );

            totalLaunched +=
                result.launched;

            totalSkipped +=
                result.skipped;

            if (result.stopped) {
                break;
            }

            /*
             * La lista de candidatos permanece intacta.
             */

            if (
                iteration <
                RETRY_CONFIG.iterations
            ) {

                log(
                    '============================================================'
                );

                log(
                    `🔄 PREPARANDO ITERACIÓN ${
                        iteration + 1
                    }/${
                        RETRY_CONFIG.iterations
                    }`
                );

                log(
                    '✓ Se reutilizará la misma lista de candidatos.'
                );

                log(
                    '✓ No se volverán a escanear los 801 modelos.'
                );

                log(
                    '============================================================'
                );

                setState(
                    `Preparando iteración ${iteration + 1}/${RETRY_CONFIG.iterations}`
                );

                await sleep(500);
            }
        }

        return {
            totalLaunched,
            totalSkipped,
            stopped: stopRequested
        };
    }

    // ============================================================
    // INICIO DEL PROCESO
    // ============================================================

    async function startBackup() {

        if (backupRunning) {
            return;
        }

        if (!models.length) {

            log(
                '✗ Primero debes pulsar "Escanear modelos".'
            );

            setState(
                'Sin modelos'
            );

            return;
        }

        backupRunning = true;

        pauseRequested = false;
        stopRequested = false;

        /*
         * Mantener la lista de candidatos existente.
         */

        activeRetries = [];

        setBackupButtons(true);

        setState(
            'Preparando...'
        );

        log(
            '============================================================'
        );

        log(
            '🚀 INICIO DEL PROCESO FREE RETRY'
        );

        log(
            `Modelos escaneados: ${
                models.length
            }`
        );

        log(
            `Iteraciones configuradas: ${
                RETRY_CONFIG.iterations
            }`
        );

        log(
            'No se realizará ningún Export.'
        );

        log(
            'No se descargará ningún archivo.'
        );

        log(
            '============================================================'
        );

        try {

            /*
             * Primera fase.
             */

            if (
                !retryScanDone ||
                !retryModels.length
            ) {

                log(
                    '🔎 No existe todavía una lista de candidatos. Buscándolos...'
                );

                const found =
                    await scanFreeRetryModels();

                if (
                    !found ||
                    stopRequested
                ) {

                    if (stopRequested) {

                        setState(
                            'Detenido'
                        );

                        log(
                            '⛔ Proceso detenido.'
                        );

                    } else {

                        setState(
                            'Sin candidatos'
                        );
                    }

                    return;
                }

            } else {

                /*
                 * Reutilizar la lista existente.
                 */

                log(
                    `✓ Reutilizando lista guardada de ${
                        retryModels.length
                    } candidatos Free Retry.`
                );

                log(
                    '✓ No se realizará un nuevo escaneo de los 801 modelos.'
                );
            }

            if (stopRequested) {

                setState(
                    'Detenido'
                );

                return;
            }

            /*
             * Segunda fase.
             */

            setState(
                `Procesando iteración 1/${RETRY_CONFIG.iterations}`
            );

            const result =
                await processAllIterations();

            if (result.stopped) {

                setState(
                    'Detenido'
                );

                log(
                    '⛔ PROCESO DETENIDO POR EL USUARIO.'
                );

                return;
            }

            /*
             * Finalización del proceso.
             */

            cleanupActiveRetries();

            log(
                '============================================================'
            );

            log(
                '🎉 TODAS LAS ITERACIONES COMPLETADAS'
            );

            log(
                `Total Free Retry ejecutados: ${
                    result.totalLaunched
                }`
            );

            log(
                `Total omitidos: ${
                    result.totalSkipped
                }`
            );

            log(
                `Procesos todavía activos en Tripo: ${
                    activeRetries.length
                }`
            );

            log(
                `Iteraciones realizadas: ${
                    RETRY_CONFIG.iterations
                }/${
                    RETRY_CONFIG.iterations
                }`
            );

            log(
                '============================================================'
            );

            setState(
                'Completado'
            );

        } catch (error) {

            setState(
                'Error'
            );

            log(
                `✗ Error general: ${
                    error.message ||
                    error
                }`
            );

        } finally {

            backupRunning = false;

            setBackupButtons(
                false
            );

            const pause =
                document.getElementById(
                    UI_ID + '-pause'
                );

            if (pause) {
                pause.textContent =
                    'Pausar';
            }

            pauseRequested = false;
        }
    }

    // ============================================================
    // INICIO
    // ============================================================

    createUI();

    log(
        'Tripo Free Retry Manager cargado.'
    );

    log(
        'Selector Free Retry confirmado: button[data-trace="studio.workspace_generate.free_retry_button"]'
    );

    log(
        `Iteraciones configuradas: ${RETRY_CONFIG.iterations}`
    );

})();
