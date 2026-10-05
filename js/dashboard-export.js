/* =============================================
   Gestor de Tráfico - Exportar el dashboard a Excel (.xlsx)
   Genera un libro con una hoja por tabla y las gráficas como imágenes.
   ============================================= */

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const COLOR_REPORTED = '#2563eb';
const COLOR_RESOLVED = '#d97706';
const CHART_WIDTH = 720;
const CHART_HEIGHT = 380;
let excelJsLoadPromise = null;

// ExcelJS pesa ~1 MB: solo se descarga la primera vez que alguien exporta
function loadExcelJs() {
    if (window.ExcelJS) return Promise.resolve();
    if (excelJsLoadPromise) return excelJsLoadPromise;
    excelJsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = EXCELJS_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            excelJsLoadPromise = null;
            reject(new Error('No se pudo cargar la librería de Excel.'));
        };
        document.head.appendChild(script);
    });
    return excelJsLoadPromise;
}

function roundMinutes(minutes) {
    return minutes == null ? null : Math.round(minutes * 10) / 10;
}

function percent(part, total) {
    return total ? part / total : null;
}

// Fecha "YYYY-MM-DD" -> Date en UTC (ExcelJS escribe las fechas en UTC)
function isoDayToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function shortDay(iso) {
    return isoDayToDate(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------- Gráficas (se dibujan en un canvas y se insertan como PNG) ----------

function createChartCanvas(title) {
    const scale = 2; // doble resolución para que no se vea borrosa en Excel
    const canvas = document.createElement('canvas');
    canvas.width = CHART_WIDTH * scale;
    canvas.height = CHART_HEIGHT * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CHART_WIDTH, CHART_HEIGHT);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 16px Arial';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 20, 16);
    return { canvas, ctx };
}

function drawLegend(ctx, y) {
    ctx.font = '12px Arial';
    ctx.textBaseline = 'middle';
    let x = 20;
    [['Recibidos', COLOR_REPORTED], ['Atendidos', COLOR_RESOLVED]].forEach(([label, color]) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 5, 10, 10);
        ctx.fillStyle = '#374151';
        ctx.fillText(label, x + 15, y);
        x += 15 + ctx.measureText(label).width + 20;
    });
}

// Escala "bonita" para el eje: devuelve el tope y el paso entre líneas
function niceScale(maxValue) {
    const max = Math.max(1, maxValue);
    const rough = max / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = Math.max(1, [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= rough));
    return { top: Math.ceil(max / step) * step, step };
}

function drawTypeChart(rows) {
    const { canvas, ctx } = createChartCanvas('Reportes por tipo');
    drawLegend(ctx, 52);
    const left = 150, right = CHART_WIDTH - 50, top = 76, bottom = CHART_HEIGHT - 20;
    const { top: axisMax } = niceScale(Math.max(...rows.map(r => r.reported)));
    const band = (bottom - top) / rows.length;
    const barH = Math.min(14, (band - 10) / 2);
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => {
        const center = top + band * i + band / 2;
        ctx.fillStyle = '#374151';
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(row.label, left - 10, center);
        ctx.textAlign = 'left';
        [[row.reported, COLOR_REPORTED, center - barH - 1], [row.resolved, COLOR_RESOLVED, center + 1]].forEach(([value, color, y]) => {
            const width = Math.max(1, ((right - left) * value) / axisMax);
            ctx.fillStyle = color;
            ctx.fillRect(left, y, width, barH);
            ctx.fillStyle = '#374151';
            ctx.font = '11px Arial';
            ctx.fillText(String(value), left + width + 5, y + barH / 2);
        });
    });
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.stroke();
    return canvas.toDataURL('image/png');
}

function drawDailyChart(days) {
    const { canvas, ctx } = createChartCanvas('Recibidos y atendidos por día');
    drawLegend(ctx, 52);
    const left = 50, right = CHART_WIDTH - 20, top = 80, bottom = CHART_HEIGHT - 40;
    const { top: axisMax, step } = niceScale(Math.max(...days.map(d => Math.max(d.reported, d.resolved))));
    ctx.font = '11px Arial';
    ctx.lineWidth = 1;
    for (let value = 0; value <= axisMax; value += step) {
        const y = bottom - ((bottom - top) * value) / axisMax;
        ctx.strokeStyle = value === 0 ? '#9ca3af' : '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), left - 8, y);
    }
    const band = (right - left) / days.length;
    const barW = Math.max(1, Math.min(12, (band - 3) / 2));
    const labelEvery = Math.ceil(days.length / 10);
    days.forEach((day, i) => {
        const center = left + band * i + band / 2;
        [[day.reported, COLOR_REPORTED, center - barW], [day.resolved, COLOR_RESOLVED, center]].forEach(([value, color, x]) => {
            const height = ((bottom - top) * value) / axisMax;
            ctx.fillStyle = color;
            ctx.fillRect(x, bottom - height, barW, height);
        });
        if (i % labelEvery === 0) {
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(shortDay(day.day), center, bottom + 8);
        }
    });
    return canvas.toDataURL('image/png');
}

// ---------- Libro de Excel ----------

function addTableSheet(workbook, name, columns, rows) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map(col => ({ header: col.header, key: col.key, width: col.width, style: col.numFmt ? { numFmt: col.numFmt } : {} }));
    rows.forEach(row => sheet.addRow(row));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    header.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return sheet;
}

function addChartImage(workbook, sheet, dataUrl, col, row) {
    const imageId = workbook.addImage({ base64: dataUrl, extension: 'png' });
    sheet.addImage(imageId, { tl: { col, row }, ext: { width: CHART_WIDTH, height: CHART_HEIGHT } });
}

/**
 * Arma el libro de Excel del dashboard y lo devuelve como ArrayBuffer.
 * @param {object} stats  Respuesta de la función attention_stats
 * @param {object} meta   { fromDate, toDate, typeLabels }
 */
export async function buildDashboardWorkbook(stats, meta) {
    await loadExcelJs();
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'Visor de Gestión de Tráfico';
    workbook.created = new Date();
    const t = stats.totals;

    // --- Resumen ---
    const summary = workbook.addWorksheet('Resumen');
    summary.columns = [{ width: 34 }, { width: 18 }, { width: 30 }];
    summary.addRow(['Atención a reportes - San Salvador Sur']).font = { bold: true, size: 14 };
    summary.addRow(['Período', `${meta.fromDate} a ${meta.toDate}`]);
    summary.addRow(['Generado', new Date().toLocaleString('es-SV')]);
    summary.addRow([]);
    const summaryHeader = summary.addRow(['Indicador', 'Valor', 'Detalle']);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    });
    summary.addRow(['Reportes recibidos', t.reported, 'creados en el período']);
    summary.addRow(['Atendidos', t.resolved, 'de los recibidos en el período']);
    summary.addRow(['% atendidos', percent(t.resolved, t.reported), '']).getCell(2).numFmt = '0%';
    summary.addRow(['Tiempo promedio de atención (min)', roundMinutes(t.avg_minutes), 'desde el reporte hasta que se resolvió']);
    summary.addRow(['Mediana de atención (min)', roundMinutes(t.median_minutes), '']);
    summary.addRow(['Pendientes', t.active, 'siguen activos']);
    summary.addRow(['Expirados sin atender', t.expired, 'vencieron sin que nadie los resolviera']);
    summary.addRow(['Atenciones sin agente registrado', stats.unattributed || 0, 'anteriores al dashboard o cerradas por quien reportó']);

    // --- Por tipo ---
    const typeRows = stats.by_type.map(row => ({
        label: meta.typeLabels[row.type] || row.type,
        reported: row.reported,
        resolved: row.resolved,
        pct: percent(row.resolved, row.reported),
        avg: roundMinutes(row.avg_minutes)
    }));
    const typeSheet = addTableSheet(workbook, 'Por tipo', [
        { header: 'Tipo', key: 'label', width: 22 },
        { header: 'Recibidos', key: 'reported', width: 12 },
        { header: 'Atendidos', key: 'resolved', width: 12 },
        { header: '% atendidos', key: 'pct', width: 13, numFmt: '0%' },
        { header: 'Tiempo prom. (min)', key: 'avg', width: 19 }
    ], typeRows);

    // --- Por día ---
    const daySheet = addTableSheet(workbook, 'Por día', [
        { header: 'Fecha', key: 'date', width: 14, numFmt: 'dd/mm/yyyy' },
        { header: 'Recibidos', key: 'reported', width: 12 },
        { header: 'Atendidos', key: 'resolved', width: 12 }
    ], stats.by_day.map(d => ({ date: isoDayToDate(d.day), reported: d.reported, resolved: d.resolved })));

    // --- Por agente ---
    addTableSheet(workbook, 'Por agente', [
        { header: 'Agente', key: 'name', width: 30 },
        { header: 'Grupo', key: 'group', width: 22 },
        { header: 'Encargado de grupo', key: 'leader', width: 19 },
        { header: 'Atendidos', key: 'resolved', width: 12 },
        { header: 'Tiempo prom. (min)', key: 'avg', width: 19 }
    ], stats.by_agent.map(a => ({
        name: a.name || 'Sin nombre',
        group: a.group_name || '',
        leader: a.is_leader ? 'Sí' : '',
        resolved: a.resolved,
        avg: roundMinutes(a.avg_minutes)
    })));

    // --- Por grupo ---
    addTableSheet(workbook, 'Por grupo', [
        { header: 'Grupo', key: 'name', width: 24 },
        { header: 'Encargado', key: 'leader', width: 30 },
        { header: 'Agentes', key: 'members', width: 10 },
        { header: 'Atendidos', key: 'resolved', width: 12 },
        { header: 'Tiempo prom. (min)', key: 'avg', width: 19 }
    ], stats.by_group.map(g => ({
        name: g.name,
        leader: g.leader_name || 'Sin encargado',
        members: g.members,
        resolved: g.resolved,
        avg: roundMinutes(g.avg_minutes)
    })));

    // --- Gráficas: en su propia hoja y junto a los datos de donde salen ---
    const chartsSheet = workbook.addWorksheet('Gráficas');
    let chartRow = 1;
    if (typeRows.length) {
        const image = drawTypeChart(typeRows);
        addChartImage(workbook, chartsSheet, image, 0, chartRow);
        addChartImage(workbook, typeSheet, image, 6, 1);
        chartRow += 21;
    }
    if (stats.by_day.length) {
        const image = drawDailyChart(stats.by_day);
        addChartImage(workbook, chartsSheet, image, 0, chartRow);
        addChartImage(workbook, daySheet, image, 4, 1);
    }

    return workbook.xlsx.writeBuffer();
}

export async function downloadDashboardExcel(stats, meta) {
    const buffer = await buildDashboardWorkbook(stats, meta);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `atencion-reportes_${meta.fromDate}_a_${meta.toDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
