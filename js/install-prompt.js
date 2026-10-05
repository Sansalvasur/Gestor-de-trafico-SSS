/* =============================================
   Gestor de Tráfico - Aviso de instalación de la app (PWA)
   En teléfono o tablet, si la app no está instalada, avisa cada vez que se inicia.
   ============================================= */

// Se marca al responder el aviso: evita repetirlo al pasar del login al mapa
// dentro del mismo inicio. Al cerrar y volver a abrir el navegador, vuelve a salir.
const ANSWERED_KEY = 'vgt-install-prompt-answered';
let deferredInstallPrompt = null;

// La app instalada se abre en modo "standalone" (sin barra del navegador)
function isRunningInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || window.navigator.standalone === true; // iOS
}

function isIos() {
    // iPadOS se identifica como Mac: se distingue por tener pantalla táctil
    return /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isPhoneOrTablet() {
    if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
    return isIos() || /Android|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent);
}

function wasAnswered() {
    try {
        return sessionStorage.getItem(ANSWERED_KEY) === '1';
    } catch (error) {
        return false;
    }
}

function markAnswered() {
    try {
        sessionStorage.setItem(ANSWERED_KEY, '1');
    } catch (error) {
        // Sin almacenamiento (modo privado): el aviso simplemente volverá a salir
    }
}

function closeInstallPrompt() {
    markAnswered();
    const backdrop = document.getElementById('install-prompt-backdrop');
    if (backdrop) backdrop.remove();
}

function getStepsHtml() {
    if (isIos()) {
        return `
            <ol class="install-prompt-steps">
                <li>Abre esta página en <b>Safari</b>.</li>
                <li>Toca el botón <b>Compartir</b> <i class="fas fa-arrow-up-from-bracket"></i>.</li>
                <li>Elige <b>Agregar a inicio</b>.</li>
            </ol>`;
    }
    return `
        <ol class="install-prompt-steps">
            <li>Abre el menú del navegador <i class="fas fa-ellipsis-vertical"></i>.</li>
            <li>Elige <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>.</li>
        </ol>`;
}

// Si el navegador ofrece instalación directa mostramos el botón; si no, los pasos manuales
function renderInstallAction() {
    const actionEl = document.getElementById('install-prompt-action');
    if (!actionEl) return;
    if (deferredInstallPrompt) {
        actionEl.innerHTML = `
            <button type="button" class="cp-btn cp-btn-primary" id="install-prompt-install-btn">
                <i class="fas fa-download"></i> Instalar ahora
            </button>`;
        document.getElementById('install-prompt-install-btn').addEventListener('click', installApp);
    } else {
        actionEl.innerHTML = getStepsHtml();
    }
}

async function installApp() {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null; // el navegador solo permite usarlo una vez
    promptEvent.prompt();
    await promptEvent.userChoice;
    closeInstallPrompt();
}

function showInstallPrompt() {
    if (document.getElementById('install-prompt-backdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'install-prompt-backdrop';
    backdrop.className = 'install-prompt-backdrop';
    backdrop.innerHTML = `
        <div class="install-prompt" role="alertdialog" aria-modal="true" aria-labelledby="install-prompt-title">
            <img src="/icons/icon-192.png" alt="" class="install-prompt-icon">
            <h3 id="install-prompt-title">Instala la app en este dispositivo</h3>
            <p>El Visor de Gestión de Tráfico no está instalado. Instálalo para abrirlo desde la pantalla de inicio, a pantalla completa y más rápido.</p>
            <div id="install-prompt-action"></div>
            <button type="button" class="cp-btn cp-btn-secondary" id="install-prompt-dismiss-btn">Ahora no</button>
        </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('install-prompt-dismiss-btn').addEventListener('click', closeInstallPrompt);
    renderInstallAction();
}

// Chrome/Edge en Android avisan con este evento que la app se puede instalar
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    renderInstallAction();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeInstallPrompt();
});

function initInstallPrompt() {
    if (isRunningInstalled() || !isPhoneOrTablet() || wasAnswered()) return;
    // Pequeña espera: da tiempo a que el navegador ofrezca la instalación directa
    setTimeout(showInstallPrompt, 800);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInstallPrompt);
} else {
    initInstallPrompt();
}
