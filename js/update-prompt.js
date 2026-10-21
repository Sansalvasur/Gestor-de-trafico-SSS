/* =============================================
   Gestor de Tráfico - Aviso de nueva versión
   Cuando se publican cambios, el service worker nuevo queda en espera y se
   muestra un aviso para actualizar. Al aceptar, se activa y la página se recarga.
   ============================================= */

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .update-banner {
            position: fixed;
            left: 50%;
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            transform: translateX(-50%);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 12px;
            width: calc(100% - 32px);
            max-width: 420px;
            padding: 12px 14px;
            background: #1e3a8a;
            color: white;
            border-radius: 14px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            font-family: 'Inter', sans-serif;
            font-size: 14px;
        }
        .update-banner span { flex: 1; }
        .update-banner button {
            border: none;
            border-radius: 8px;
            padding: 8px 12px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
        }
        .update-banner .update-banner-go { background: white; color: #1e3a8a; }
        .update-banner .update-banner-later { background: transparent; color: #bfdbfe; }
    `;
    document.head.appendChild(style);
}

function showUpdateBanner(waitingWorker) {
    if (document.getElementById('update-banner')) return;
    injectStyles();
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
        <span>Hay una nueva versión disponible.</span>
        <button type="button" class="update-banner-later">Luego</button>
        <button type="button" class="update-banner-go">Actualizar</button>
    `;
    banner.querySelector('.update-banner-later').addEventListener('click', () => banner.remove());
    banner.querySelector('.update-banner-go').addEventListener('click', () => {
        banner.querySelector('.update-banner-go').textContent = 'Actualizando...';
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(banner);
}

function watchRegistration(registration) {
    // Ya había una versión nueva esperando (por ejemplo, se descargó en una visita anterior)
    if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting);
    }
    registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
            // Con "controller" es una actualización; sin él es la primera instalación (no se avisa)
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner(installing);
            }
        });
    });
    const check = () => registration.update().catch(() => {});
    setInterval(check, CHECK_INTERVAL_MS);
    // Al volver a la app (apps instaladas que quedan abiertas días en segundo plano)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
    });
    check();
}

if ('serviceWorker' in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Solo recarga si el usuario aceptó actualizar (evita recargas en la primera instalación)
        if (reloading || !document.getElementById('update-banner')) return;
        reloading = true;
        window.location.reload();
    });
    // El registro lo hace cada página; aquí se espera a que exista
    navigator.serviceWorker.ready.then(watchRegistration).catch(() => {});
}
