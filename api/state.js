'use strict';

const crypto = require('crypto');
const { readState, writeState } = require('../lib/store');

const ZONES = ['Kandang Ayam', 'Kolam Ikan', 'Lahan Ubi Jalar', 'Umum'];
const TYPES = ['rutin', 'kondisional', 'sekali'];
const PRIORITIES = ['Tinggi', 'Sedang', 'Rendah'];
const RULES = ['manual', 'kandang_hot', 'kolam_warm', 'kolam_cold', 'ubi_hot_dry', 'ubi_hot_dry_no_rain', 'cloudy_rain', 'hujan', 'high_wind'];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  const expected = process.env.FARM_API_KEY || '';
  if (!expected) return false;
  const given = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Link koneksi sekali pakai: <exp>.<hmac(exp)>, ditandatangani dengan FARM_API_KEY.
// Hanya mengembalikan kunci jika belum kedaluwarsa, jadi tautan yang bocor
// sesudah lewat masa berlaku tidak berguna.
function verifyClaim(claim) {
  const expected = process.env.FARM_API_KEY || '';
  const parts = String(claim || '').split('.');
  if (!expected || parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const good = crypto.createHmac('sha256', expected).update('claim:' + exp).digest('hex').slice(0, 32);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function text(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function sanitizeTask(input, existing = {}) {
  if (!input || typeof input !== 'object') throw new Error('tugas tidak valid');
  const title = text(input.title, 140);
  if (!title) throw new Error('title wajib diisi');

  const type = TYPES.includes(input.type) ? input.type : existing.type || 'rutin';
  const triggerRule = type === 'kondisional'
    ? (RULES.includes(input.triggerRule) ? input.triggerRule : existing.triggerRule || 'manual')
    : 'manual';

  const scheduleRaw = input.schedule === undefined ? existing.schedule : input.schedule;
  let schedule = null;
  if (scheduleRaw && typeof scheduleRaw === 'object') {
    const kind = ['daily', 'weekly', 'once', 'conditional'].includes(scheduleRaw.kind)
      ? scheduleRaw.kind : 'daily';
    const times = Array.isArray(scheduleRaw.times)
      ? scheduleRaw.times.map((t) => text(t, 5)).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      : [];
    const days = Array.isArray(scheduleRaw.days)
      ? scheduleRaw.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    schedule = { kind, times, days };
  }

  const task = {
    id: existing.id || text(input.id, 60) || `task-${Date.now()}`,
    title,
    zone: ZONES.includes(input.zone) ? input.zone : existing.zone || 'Umum',
    type,
    detail: text(input.detail !== undefined ? input.detail : existing.detail, 240),
    triggerRule,
    priority: PRIORITIES.includes(input.priority) ? input.priority : existing.priority || 'Sedang',
    notes: text(input.notes !== undefined ? input.notes : existing.notes, 600),
    completed: typeof input.completed === 'boolean' ? input.completed : Boolean(existing.completed),
    createdAt: existing.createdAt || Number(input.createdAt) || Date.now()
  };
  if (input.completedAt !== undefined ? input.completedAt : existing.completedAt) {
    task.completedAt = input.completedAt !== undefined ? input.completedAt : existing.completedAt;
  }
  if (schedule) task.schedule = schedule;
  return task;
}

function logHistory(state, taskId, action, by) {
  state.history = Array.isArray(state.history) ? state.history : [];
  state.history.unshift({ taskId, action, by, at: new Date().toISOString() });
  state.history = state.history.slice(0, 500);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://local.invalid');
      const claim = url.searchParams.get('claim');
      if (claim) {
        if (!verifyClaim(claim)) return send(res, 403, { ok: false, error: 'Link koneksi tidak valid atau sudah kedaluwarsa' });
        return send(res, 200, { ok: true, key: process.env.FARM_API_KEY });
      }
      const state = await readState();
      return send(res, 200, { ok: true, state });
    }

    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Gunakan GET atau POST' });

    if (!process.env.FARM_API_KEY) {
      return send(res, 503, { ok: false, error: 'FARM_API_KEY belum diset di Vercel' });
    }
    if (!isAuthorized(req)) return send(res, 401, { ok: false, error: 'x-api-key salah atau kosong' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: 'Body bukan JSON valid' }); }
    }
    if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'Body kosong' });

    const action = text(body.action, 40);
    const by = text(body.by, 40) || 'dashboard';
    const state = await readState();
    const tasks = state.tasks || [];
    let result = {};

    switch (action) {
      case 'task.add': {
        const task = sanitizeTask(body.task, {});
        tasks.unshift(task);
        logHistory(state, task.id, 'added', by);
        result = { task };
        break;
      }
      case 'task.update': {
        const idx = tasks.findIndex((t) => t.id === body.id);
        if (idx === -1) return send(res, 404, { ok: false, error: `Tugas ${body.id} tidak ditemukan` });
        tasks[idx] = sanitizeTask({ ...tasks[idx], ...(body.patch || {}) }, tasks[idx]);
        logHistory(state, tasks[idx].id, 'updated', by);
        result = { task: tasks[idx] };
        break;
      }
      case 'task.toggle': {
        const idx = tasks.findIndex((t) => t.id === body.id);
        if (idx === -1) return send(res, 404, { ok: false, error: `Tugas ${body.id} tidak ditemukan` });
        tasks[idx].completed = !tasks[idx].completed;
        tasks[idx].completedAt = tasks[idx].completed ? new Date().toISOString() : null;
        logHistory(state, tasks[idx].id, tasks[idx].completed ? 'done' : 'undone', by);
        result = { task: tasks[idx] };
        break;
      }
      case 'task.delete': {
        const idx = tasks.findIndex((t) => t.id === body.id);
        if (idx === -1) return send(res, 404, { ok: false, error: `Tugas ${body.id} tidak ditemukan` });
        const [removed] = tasks.splice(idx, 1);
        logHistory(state, removed.id, 'deleted', by);
        result = { deleted: removed.id };
        break;
      }
      case 'tasks.replace': {
        if (!Array.isArray(body.tasks)) return send(res, 400, { ok: false, error: 'tasks harus array' });
        const next = body.tasks.map((t) => sanitizeTask(t, {}));
        tasks.length = 0;
        next.forEach((t) => tasks.push(t));
        logHistory(state, '*', 'replaced', by);
        result = { count: tasks.length };
        break;
      }
      case 'tasks.reset_routine': {
        let count = 0;
        tasks.forEach((t) => {
          if (t.type === 'rutin' && t.completed) {
            t.completed = false;
            t.completedAt = null;
            count++;
          }
        });
        logHistory(state, '*', `reset_routine:${count}`, by);
        result = { reset: count };
        break;
      }
      case 'offsets.update': {
        const src = body.offsets || {};
        const next = { ...state.offsets };
        ['kandangRoof', 'kolamBase', 'ubiSolar'].forEach((k) => {
          const n = Number(src[k]);
          if (Number.isFinite(n) && n >= -10 && n <= 10) next[k] = Math.round(n * 10) / 10;
        });
        state.offsets = next;
        logHistory(state, '*', 'offsets', by);
        result = { offsets: next };
        break;
      }
      default:
        return send(res, 400, { ok: false, error: `action tidak dikenal: ${action}` });
    }

    state.tasks = tasks;
    state.updatedBy = by;
    const write = await writeState(state);
    state.updatedAt = write.updatedAt;
    return send(res, 200, { ok: true, ...result, updatedAt: state.updatedAt, write });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err.message || err) });
  }
};
