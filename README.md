# Suhu Farm Dashboard + API

Dashboard mikroiklim Rencang Farm (Banjarasri, Tanggulangin, Sidoarjo).
Produksi: <https://dashboard-rho-five-48.vercel.app> — deploy otomatis dari
branch `main` repo ini.

## Struktur

```
index.html            dashboard (baca state dari /api/state, cache localStorage)
api/state.js          serverless function: GET state, POST perubahan (butuh x-api-key)
api/bmkg.js           proxy server-side BMKG (CORS): prakiraan 3 hari & peringatan dini
lib/store.js          baca/tulis data/state.json di repo via GitHub Contents API
data/state.json       sumber kebenaran: offset kalibrasi, alertRules, riwayat
lib/alert-rules.js    evaluator aturan peringatan di browser
scripts/dev-server.js server lokal untuk tes tanpa Vercel
vercel.json           lewati build kalau commit hanya mengubah data/state.json
```

## Fitur yang aktif

- **Monitoring 4 zona**: Banjarasri (makro), Kandang Ayam, Kolam Ikan, Lahan Ubi Jalar.
- **Prakiraan BMKG 3 hari** — suhu, curah hujan, kelembapan, angin per periode 3 jam;
  tarik tiap 3 jam lewat `/api/bmkg?kind=forecast`; kode adm4 `35.15.06.2008`.
- **Peringatan dini BMKG** — status kecamatan Tanggulangin; tarik tiap 2 jam lewat
  `/api/bmkg?kind=nowcast`.
- **Kalender Siraman & Pupuk** — jadwal 3 hari untuk ubi & kolam, dihitung dari
  prakiraan hujan BMKG. Hujan > 0 mm → tunda siram/pupuk ubi, kurangi pelet ikan.
  Tanpa sensor.
- **Peringatan otomatis** — aturan dari `data/state.json`, bisa diubah tanpa deploy UI.

Fitur "Tugas Farm" (task harian/kondisional) **sudah dihapus** dari UI dan tidak
lagi dipakai. Fitur harga komoditas tidak diimplementasikan.

## API

`GET /api/state` — publik, tanpa auth.

```json
{ "ok": true, "state": { "version": 1, "updatedAt": "...", "offsets": {...}, "alertRules": {...}, "history": [...] } }
```

`POST /api/state` — header `x-api-key: *** body JSON dengan `action`:

| action | body tambahan |
|---|---|
| `offsets.update` | `offsets: {kandangRoof, kolamBase, ubiSolar}` |
| `alerts.rules_set` | `rules: {...}` |
| `alerts.rule_update` | `id`, `patch: {enabled,title,desc,tone}` |
| `alerts.rules_reset` | — |

`GET /api/bmkg?kind=forecast|nowcast` — proxy publik, tanpa auth.

## Deteksi Hujan (real-time)

Dashboard menarik `current.precipitation`, `current.rain`, `current.showers` dan
`current.weather_code` dari Open-Meteo.

- Indikator hujan ada di kartu **Cuaca & Angin Lokal** (baris "Hujan: ...").
- Aturan hujan: `precipitation > 0 mm/jam` **atau** `weather_code >= 51` → hujan.
- Kode WMO 0–3 = tidak hujan; 51+ = gerimis/hujan; 95+ = badai.
- Refresh cuaca tiap **15 menit**.
- Mode offline: curah hujan ditandai `null` → tampil "tidak diketahui", **tidak mengarang angka**.

## Aturan Peringatan & Rekomendasi (backend)

Aturan disimpan di `data/state.json` → `alertRules` dan dilayani lewat
`GET /api/state`. Browser mengevaluasinya dengan `lib/alert-rules.js`.

```json
{
  "id": "kandang_panas", "zone": "Kandang Ayam", "order": 10,
  "enabled": true, "tone": "warning",
  "when": { "metric": "kandang", "op": ">=", "value": 34.5 },
  "title": "Kandang Ayam Panas ({kandang}°C)",
  "desc": "Radiasi atap fiber tinggi. Pastikan sirkulasi depan-belakang tidak terhalang."
}
```

- `when` bisa `all` (AND), `any` (OR), atau kondisi tunggal.
- `op`: `>= <= > < == != between is_null is_not_null`.
- `metric`: `kandang kolam ubi banjarasri rh wind cloud precip weatherCode
  rainPast3 rainNext3 hujanAktif weatherLabel hour`.
- `tone`: `ok info warning danger rain`. Template `{namaMetric}` diisi otomatis.

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
curl -s localhost:8787/api/bmkg?kind=forecast | head -c 300
```
