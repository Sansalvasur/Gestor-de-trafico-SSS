// Edge Function: recuerda por push a los agentes cuya ubicación en vivo dejó de actualizarse
// (cerraron la app o se cortó el GPS sin pulsar "dejar de compartir").
// La invoca un trabajo programado (pg_cron) cada minuto con la cabecera x-cron-secret.
// Secretos requeridos: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Desplegar con "Verify JWT" desactivado: la autenticación es el secreto de arriba.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const STALE_AFTER_MS = 3 * 60 * 1000;     // sin actualizar por más de 3 min = se cortó
const REMIND_WINDOW_MS = 120 * 60 * 1000; // no insistir con cortes de hace más de 2 h
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = Date.now();

    // Ubicaciones abandonadas hace más de un día: se limpian
    await admin.from('agent_locations').delete().lt('updated_at', new Date(now - CLEANUP_AFTER_MS).toISOString());

    const { data: stale, error } = await admin
        .from('agent_locations')
        .select('user_id, updated_at, reminder_sent_at')
        .lt('updated_at', new Date(now - STALE_AFTER_MS).toISOString())
        .gt('updated_at', new Date(now - REMIND_WINDOW_MS).toISOString());
    if (error) {
        console.error('Error al leer ubicaciones:', error.message);
        return json({ error: 'Error al leer ubicaciones' }, 500);
    }

    // Un solo recordatorio por corte: se vuelve a avisar solo si el agente reanuda y se corta otra vez
    const pending = (stale ?? []).filter((row) => !row.reminder_sent_at || row.reminder_sent_at < row.updated_at);
    if (!pending.length) return json({ reminded: 0 });

    const userIds = pending.map((row) => row.user_id);
    const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth, user_id')
        .in('user_id', userIds);

    webpush.setVapidDetails(
        Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
        Deno.env.get('VAPID_PUBLIC_KEY')!,
        Deno.env.get('VAPID_PRIVATE_KEY')!,
    );
    const payload = JSON.stringify({
        title: 'Tu ubicación dejó de compartirse',
        body: 'Toca para abrir la app y reanudar el seguimiento.',
        tag: 'location-reminder',
        url: '/mapa/map.html',
    });

    let sent = 0;
    await Promise.all((subs ?? []).map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
                { TTL: 10 * 60 },
            );
            sent++;
        } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
                await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            } else {
                console.error('Error enviando recordatorio:', status, (err as Error).message);
            }
        }
    }));

    // Se marca aunque no tenga dispositivos suscritos, para no reintentar cada minuto
    await admin.from('agent_locations').update({ reminder_sent_at: new Date().toISOString() }).in('user_id', userIds);

    return json({ reminded: userIds.length, sent });
});
