# Suhu Farm Dashboard + API

Dashboard mikroiklim Rencang Farm (Banjarasri, Tanggulangin, Sidoarjo) dengan API state
tugas. Produksi: <https://dashboard-rho-five-48.vercel.app> — deploy otomatis dari
branch `main` repo ini.

## Struktur

```
index.html            dashboard (baca state dari /api/state, cache localStorage)
suhu_farm.html        halaman suhu ringkas
api/state.js          serverless function: GET state, POST perubahan (butuh x-api-key)
lib/store.js          baca/tulis data/state.json di repo via GitHub Contents API
data/state.json       SATU-SATUNYA sumber kebenaran tugas, offset kalibrasi, riwayat
scripts/dev-server.js server lokal untuk tes tanpa Vercel
vercel.json           lewati build kalau commit hanya mengubah data/state.json
```

## API

`GET /api/state` — publik, tanpa auth.

```json
{ "ok": true, "state": { "version": 1, "updatedAt": "...", "offsets": {...}, "tasks": [...], "history": [...] } }
```

`POST /api/state` — header `x-api-key: <FARM_API_KEY>`, body JSON dengan `action`:

| action | body tambahan |
|---|---|
| `task.add` | `task: {title, zone, type, detail, priority, notes, triggerRule, schedule}` |
| `task.update` | `id`, `patch: {...}` |
| `task.toggle` | `id` |
| `task.delete` | `id` |
| `tasks.replace` | `tasks: [...]` (dipakai dashboard saat simpan) |
| `tasks.reset_routine` | — |
| `offsets.update` | `offsets: {kandangRoof, kolamBase, ubiSolar}` |

Nilai valid: `zone` = `Kandang Ayam | Kolam Ikan | Lahan Ubi Jalar | Umum`;
`type` = `rutin | kondisional | sekali`; `priority` = `Tinggi | Sedang | Rendah`;
`triggerRule` = `manual | kandang_hot | kolam_warm | kolam_cold | ubi_hot_dry | cloudy_rain | high_wind`;
`schedule` = `{kind: "daily"|"weekly"|"once"|"conditional", times: ["HH:MM"], days: [0..6]}`,
`days` memakai 0 = Minggu (sama dengan JavaScript).

## Environment Vercel

| variabel | wajib | isi |
|---|---|---|
| `GITHUB_TOKEN` | ya | fine-grained PAT, akses Contents: Read & Write hanya ke repo ini |
| `FARM_API_KEY` | ya | kunci rahasia untuk menulis state (dipakai juga oleh dashboard) |
| `GITHUB_REPO` | tidak | default `yudiseka/suhu-farm-dashboard` |

Tanpa `FARM_API_KEY`, GET tetap jalan dan semua POST ditolak (503).

## Tes lokal

```bash
LOCAL_STATE=1 FARM_API_KEY=tes123 node scripts/dev-server.js 8787
curl -s localhost:8787/api/state | head -c 300
```

## Klien dari Hermes

`farm_api.py` (di workspace, tidak di repo ini) membaca state langsung dari raw GitHub
tanpa token, dan menulis lewat GitHub Contents API kalau ada token di
`~/.hermes/secrets/github_farm_token`.
