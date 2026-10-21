// Edge Function: avisa por push a los agentes del grupo asignado a un punto de control.
// El cliente la llama justo después de registrar el punto: { point_id }.
// Secretos requeridos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los provee Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TYPE_LABELS: Record<string, string> = {
    reten: 'Retén policial',
    accidente: 'Accidente',
    congestion: 'Congestión',
    obra_vial: 'Obra vial',
    semaforo_danado: 'Semáforo dañado',
    otro: 'Otro',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No autorizado' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);
    const user = userData.user;

    let pointId: string | undefined;
    try {
        ({ point_id: pointId } = await req.json());
    } catch {
        return json({ error: 'Solicitud inválida' }, 400);
    }
    if (!pointId) return json({ error: 'Falta point_id' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: point, error: pointError } = await admin
        .from('control_points')
        .select('id, type, severity, description, district, reported_by, assigned_group_id, notified_at')
        .eq('id', pointId)
        .single();
    if (pointError || !point) return json({ error: 'Punto no encontrado' }, 404);

    // Solo quien registró el punto puede disparar el aviso, y una sola vez
    if (point.reported_by !== user.id) return json({ error: 'No autorizado' }, 403);
    if (!point.assigned_group_id) return json({ sent: 0, reason: 'sin grupo asignado' });
    if (point.notified_at) return json({ sent: 0, reason: 'ya notificado' });

    await admin.from('control_points').update({ notified_at: new Date().toISOString() }).eq('id', point.id);

    const { data: members } = await admin
        .from('profiles')
        .select('id')
        .eq('group_id', point.assigned_group_id)
        .in('role', ['agente', 'admin'])
        .neq('id', user.id);
    const memberIds = (members ?? []).map((m) => m.id);
    if (!memberIds.length) return json({ sent: 0, reason: 'el grupo no tiene otros agentes' });

    const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('user_id', memberIds);
    if (!subs?.length) return json({ sent: 0, reason: 'nadie tiene notificaciones activadas' });

    const { data: group } = await admin.from('agent_groups').select('name').eq('id', point.assigned_group_id).single();

    webpush.setVapidDetails(
        Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
        Deno.env.get('VAPID_PUBLIC_KEY')!,
        Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const label = TYPE_LABELS[point.type] ?? 'Punto de control';
    const payload = JSON.stringify({
        title: `Nuevo punto asignado: ${label}`,
        body: [group?.name ? `Grupo ${group.name}` : null, point.district, point.description].filter(Boolean).join(' · ')
            || 'Abre el mapa para ver el detalle.',
        tag: `cp-${point.id}`,
        url: '/mapa/map.html',
    });

    let sent = 0;
    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
                { TTL: 60 * 60 },
            );
            sent++;
        } catch (err) {
            // 404/410: la suscripción ya no existe (app desinstalada o permiso revocado)
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
                await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            } else {
                console.error('Error enviando push:', status, (err as Error).message);
            }
        }
    }));

    return json({ sent, total: subs.length });
});
