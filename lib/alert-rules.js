'use strict';

/**
 * Engine aturan peringatan & rekomendasi Rencang Farm.
 * Ruleset disimpan di data/state.json (backend), dievaluasi di browser terhadap
 * data cuaca real-time. Bisa dipakai di Node (API) maupun browser (script tag).
 *
 * Kondisi (when):
 *   { metric, op, value }        op: >= <= > < == != is_null is_not_null
 *   { metric, op: "between", value: [min, max] }
 *   { all: [kondisi, ...] }      AND
 *   { any: [kondisi, ...] }      OR
 *
 * Template teks: {kandang} {kolam} {ubi} {banjarasri} {rh} {wind} {cloud}
 *                 {precip} {rainPast3} {rainNext3} {weatherLabel} {hour} {feels}
 */

const TONES = ['ok', 'info', 'warning', 'danger', 'rain'];
const METRICS = [
  'kandang', 'kolam', 'ubi', 'banjarasri', 'feels', 'rh', 'wind', 'cloud',
  'precip', 'weatherCode', 'rainPast3', 'rainNext3', 'hujanAktif',
  'weatherLabel', 'hour'
];
const OPS = ['>=', '<=', '>', '<', '==', '!=', 'between', 'is_null', 'is_not_null'];

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function str(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultAlertRules() {
  return {
    version: 1,
    maxAlerts: 8,
    rules: [
      // Kandang Ayam
      {
        id: 'kandang_panas', zone: 'Kandang Ayam', order: 10, enabled: true, tone: 'warning',
        when: { metric: 'kandang', op: '>=', value: 34.5 },
        title: 'Kandang Ayam Panas ({kandang}°C)',
        desc: 'Radiasi atap fiber tinggi. Pastikan sirkulasi depan-belakang tidak terhalang & tambah air minum.'
      },
      {
        id: 'kandang_stabil', zone: 'Kandang Ayam', order: 11, enabled: true, tone: 'ok',
        when: { metric: 'kandang', op: '<', value: 34.5 },
        title: 'Sirkulasi Kandang Stabil ({kandang}°C)',
        desc: 'Hembusan angin {wind} km/j membantu membuang panas atap fiber secara alami.'
      },
      // Suhu Terasa (apparent temperature — yang dirasakan kulit, bukan suhu udara naungan)
      {
        id: 'terasa_panas', zone: 'Umum', order: 15, enabled: true, tone: 'danger',
        when: { metric: 'feels', op: '>=', value: 35 },
        title: 'Suhu Terasa Tinggi ({feels}°C)',
        desc: 'Suhu udara {banjarasri}°C terasa {feels}°C karena kelembapan {rh}%. Tunda kerja fisik berat 12.00–15.00, perbanyak minum, cek air minum ayam & aerasi kolam.'
      },
      {
        id: 'terasa_aman', zone: 'Umum', order: 16, enabled: true, tone: 'info',
        when: { metric: 'feels', op: '<', value: 35 },
        title: 'Suhu Terasa Masih Aman ({feels}°C)',
        desc: 'Suhu udara {banjarasri}°C, terasa {feels}°C. Tetap pantau saat radiasi matahari meningkat siang hari.'
      },
      // Kolam Ikan
      {
        id: 'kolam_optimal', zone: 'Kolam Ikan', order: 20, enabled: true, tone: 'ok',
        when: { metric: 'kolam', op: 'between', value: [27, 31] },
        title: 'Jendela Pakan Ikan Optimal ({kolam}°C)',
        desc: 'Metabolisme ikan aktif di suhu air 27–31°C. Pemberian pakan dapat dilakukan normal.'
      },
      {
        id: 'kolam_panas', zone: 'Kolam Ikan', order: 21, enabled: true, tone: 'warning',
        when: { metric: 'kolam', op: '>', value: 31 },
        title: 'Air Kolam Menghangat ({kolam}°C)',
        desc: 'Akumulasi panas matahari jam 09–15. Nyalakan aerasi lebih kuat untuk menjaga oksigen terlarut.'
      },
      {
        id: 'kolam_sejuk', zone: 'Kolam Ikan', order: 22, enabled: true, tone: 'info',
        when: { metric: 'kolam', op: '<', value: 27 },
        title: 'Suhu Air Kolam Sejuk ({kolam}°C)',
        desc: 'Dinding 2m menahan panas berlebih; kurangi porsi pakan jika suhu air di bawah 26°C.'
      },
      // Lahan Ubi Jalar
      {
        id: 'ubi_evapotranspirasi', zone: 'Lahan Ubi Jalar', order: 30, enabled: true, tone: 'danger',
        when: { all: [{ metric: 'ubi', op: '>=', value: 34 }, { metric: 'rh', op: '<', value: 60 }] },
        title: 'Evapotranspirasi Ubi Jalar Tinggi ({ubi}°C)',
        desc: 'Lahan terbuka terpapar matahari penuh & RH {rh}%. Jadwalkan penyiraman sore hari agar umbi tetap lembap.'
      },
      {
        id: 'ubi_kondusif', zone: 'Lahan Ubi Jalar', order: 31, enabled: true, tone: 'ok',
        when: { any: [{ metric: 'ubi', op: '<', value: 34 }, { metric: 'rh', op: '>=', value: 60 }] },
        title: 'Lahan Ubi Jalar Kondusif ({ubi}°C)',
        desc: 'Fotosintesis kanopi terbuka berjalan optimal dengan kelembapan udara {rh}%.' 
      },
      // Hujan
      {
        id: 'hujan_offline', zone: 'Umum', order: 40, enabled: true, tone: 'info',
        when: { metric: 'precip', op: 'is_null' },
        title: 'Data Hujan Tidak Tersedia (Offline)',
        desc: 'Tidak dapat memastikan hujan. Periksa koneksi dan klik Refresh Data.'
      },
      {
        id: 'hujan_aktif', zone: 'Umum', order: 41, enabled: true, tone: 'rain',
        when: { metric: 'hujanAktif', op: '==', value: 1 },
        title: 'Hujan Terdeteksi — {weatherLabel} ({precip} mm/jam)',
        desc: 'Hujan aktif di Banjarasri. Tunda penyiraman ubi & pakan ikan; cek talang air kandang dan aerasi kolam.'
      },
      {
        id: 'hujan_baru', zone: 'Umum', order: 42, enabled: true, tone: 'rain',
        when: { all: [{ metric: 'hujanAktif', op: '==', value: 0 }, { metric: 'rainPast3', op: '>', value: 0 }] },
        title: 'Baru Saja Hujan — {rainPast3} mm/3 jam',
        desc: 'Hujan sudah reda sekarang ({weatherLabel}). Cek talang air kandang, drainase bedengan ubi, dan pastikan aerasi kolam tetap jalan.'
      },
      {
        id: 'tidak_hujan', zone: 'Umum', order: 43, enabled: true, tone: 'ok',
        when: { all: [
          { metric: 'precip', op: 'is_not_null' },
          { metric: 'hujanAktif', op: '==', value: 0 },
          { metric: 'rainPast3', op: '<=', value: 0 }
        ] },
        title: 'Tidak Hujan — {weatherLabel}',
        desc: 'Curah hujan {precip} mm/jam. Peluang hujan 3 jam ke depan {rainNext3}%.'
      }
    ]
  };
}

function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.all) || Array.isArray(raw.any)) {
    const key = Array.isArray(raw.all) ? 'all' : 'any';
    const parts = raw[key].slice(0, 10).map(normalizeCondition).filter(Boolean);
    return parts.length ? { [key]: parts } : null;
  }
  if (!METRICS.includes(raw.metric) || !OPS.includes(raw.op)) return null;
  const cond = { metric: raw.metric, op: raw.op };
  if (raw.op === 'between') {
    if (!Array.isArray(raw.value) || raw.value.length < 2) return null;
    const lo = num(raw.value[0]);
    const hi = num(raw.value[1]);
    if (lo === null || hi === null || lo > hi) return null;
    cond.value = [lo, hi];
  } else if (raw.op !== 'is_null' && raw.op !== 'is_not_null') {
    const v = num(raw.value);
    if (v === null) return null;
    cond.value = v;
  }
  return cond;
}

/** Sanitasi ruleset dari backend/API. Selalu mengembalikan ruleset yang valid. */
function normalizeAlertRules(raw) {
  const fallback = defaultAlertRules();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) return fallback;
  const seen = new Set();
  const rules = [];
  for (const item of raw.rules.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const id = str(item.id, 60) || `rule-${rules.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const when = normalizeCondition(item.when);
    if (!when) continue;
    const order = num(item.order);
    rules.push({
      id,
      zone: str(item.zone, 40) || 'Umum',
      order: order === null ? 99 : Math.max(-999, Math.min(999, order)),
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      tone: TONES.includes(item.tone) ? item.tone : 'info',
      when,
      title: str(item.title, 160) || id,
      desc: str(item.desc, 400)
    });
  }
  if (!rules.length) return fallback;
  const max = num(raw.maxAlerts);
  return {
    version: 1,
    maxAlerts: max === null ? 8 : Math.max(1, Math.min(20, Math.round(max))),
    rules
  };
}

function testCondition(cond, ctx) {
  if (!cond) return false;
  if (cond.all) return cond.all.every((c) => testCondition(c, ctx));
  if (cond.any) return cond.any.some((c) => testCondition(c, ctx));
  const actual = ctx[cond.metric];
  if (cond.op === 'is_null') return actual === null || actual === undefined;
  if (cond.op === 'is_not_null') return actual !== null && actual !== undefined;
  if (actual === null || actual === undefined) return false;
  if (typeof actual === 'string') {
    if (cond.op === '==') return actual === String(cond.value);
    if (cond.op === '!=') return actual !== String(cond.value);
    return false;
  }
  const a = Number(actual);
  switch (cond.op) {
    case '>=': return a >= cond.value;
    case '<=': return a <= cond.value;
    case '>': return a > cond.value;
    case '<': return a < cond.value;
    case '==': return a === cond.value;
    case '!=': return a !== cond.value;
    case 'between': return a >= cond.value[0] && a <= cond.value[1];
    default: return false;
  }
}

function fmt(metric, value) {
  if (value === null || value === undefined) return 'tidak tersedia';
  if (metric === 'weatherLabel') return String(value);
  if (metric === 'hour') return String(value);
  if (metric === 'rh' || metric === 'wind' || metric === 'cloud' || metric === 'weatherCode') {
    return String(Math.round(Number(value)));
  }
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : String(value);
}

function renderTemplate(text, ctx) {
  return String(text).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (m, key) => {
    return METRICS.includes(key) ? fmt(key, ctx[key]) : m;
  });
}

/**
 * Evaluasi ruleset terhadap konteks cuaca.
 * ctx: { kandang, kolam, ubi, banjarasri, feels, rh, wind, cloud, precip,
 *        rainPast3, rainNext3, hujanAktif, weatherLabel, hour }
 */
function evaluate(ruleset, ctx) {
  const rs = normalizeAlertRules(ruleset);
  return rs.rules
    .filter((r) => r.enabled && testCondition(r.when, ctx))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, rs.maxAlerts)
    .map((r) => ({
      id: r.id,
      zone: r.zone,
      tone: r.tone,
      title: renderTemplate(r.title, ctx),
      desc: renderTemplate(r.desc, ctx)
    }));
}

const api = { defaultAlertRules, normalizeAlertRules, testCondition, evaluate, METRICS, OPS, TONES };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.RencangAlertRules = api;
