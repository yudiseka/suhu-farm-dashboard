'use strict';

/**
 * Penyimpanan state dashboard: data/state.json di repo GitHub.
 * Mode lokal (LOCAL_STATE=1) dipakai untuk tes tanpa menyentuh GitHub.
 */

const fs = require('fs');
const path = require('path');

const REPO = process.env.GITHUB_REPO || 'yudiseka/suhu-farm-dashboard';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'data/state.json';
const TOKEN = process.env.GITHUB_TOKEN || '';
const LOCAL = process.env.LOCAL_STATE === '1';
const LOCAL_FILE = path.join(__dirname, '..', FILE_PATH);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emptyState() {
  return {
    version: 1,
    updatedAt: null,
    updatedBy: 'init',
    farm: {
      name: 'Rencang Farm',
      coords: { lat: -7.5075, lon: 112.7578 },
      location: 'Desa Banjarasri, Kec. Tanggulangin, Sidoarjo',
      timezone: 'Asia/Jakarta'
    },
    offsets: { kandangRoof: 4.5, kolamBase: -1.8, ubiSolar: 3.2 },
    tasks: [],
    history: []
  };
}

function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    offsets: { ...base.offsets, ...(raw.offsets || {}) },
    farm: { ...base.farm, ...(raw.farm || {}) },
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    history: Array.isArray(raw.history) ? raw.history : []
  };
}

async function readState() {
  if (LOCAL) {
    try {
      return normalize(JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')));
    } catch (e) {
      return emptyState();
    }
  }
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE_PATH}?t=${Date.now()}`;
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (res.status === 404) return emptyState();
  if (!res.ok) throw new Error(`Gagal membaca state: HTTP ${res.status}`);
  return normalize(await res.json());
}

async function currentSha() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gagal cek SHA: HTTP ${res.status}`);
  const json = await res.json();
  return json.sha;
}

async function writeState(state) {
  const now = new Date().toISOString();
  const next = { ...state, version: state.version || 1, updatedAt: now };
  const body = JSON.stringify(next, null, 2) + '\n';

  if (LOCAL) {
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, body);
    return { mode: 'local', updatedAt: now, bytes: body.length };
  }

  if (!TOKEN) throw new Error('GITHUB_TOKEN belum diset di environment');
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const sha = await currentSha();
    const payload = {
      message: `state: ${state.updatedBy || 'api'} ${now}`,
      content: Buffer.from(body, 'utf8').toString('base64'),
      branch: BRANCH
    };
    if (sha) payload.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const json = await res.json();
      return { mode: 'github', commit: json.commit && json.commit.sha, updatedAt: now, bytes: body.length };
    }
    if (res.status === 409 || res.status === 422) {
      await sleep(250 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    throw new Error(`Gagal menulis state: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  throw new Error('Konflik tulis state: gagal setelah 4 percobaan');
}

module.exports = { readState, writeState, normalize, emptyState, REPO, BRANCH, FILE_PATH };
