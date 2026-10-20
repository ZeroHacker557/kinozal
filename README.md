# Kino Zal — 3D kinoteatrda birga tomosha

Brauzerdagi 3D kino zal: xona egasi ekranini katta ekranga ulashadi, do'stlar zalda yurib,
o'rindiq tanlab o'tirishadi va mikrofonda gaplashib birga tomosha qilishadi.

## Holat

| Bosqich | Holat |
|---|---|
| 0. Loyiha tuzilmasi | ✅ |
| 1. Detallashgan zal, yurish, to'qnashuv, chiroq tugmasi (lokal) | ✅ |
| 2. Multiplayer (xona yaratish/kod bilan kirish, nickname, sinxronizatsiya) | ✅ |
| 3. Realistik avatarlar (Rocketbox, mocap animatsiyalar, bosh harakati) | ✅ |
| 4. Chiroq tugmasi hammaga sinxron, "faqat ega" sozlamasi | ✅ |
| 5. Fazoviy ovozli suhbat (LiveKit), mikrofon (M), ovoz sozlamalari | ✅ |
| 6. Ekran ulashish (zal ekrani, jonli ekran nuri, stereo kino ovozi, to'liq ekran V) | ✅ |
| 7. Ruxsatlar (presenter, kick, mute) | ⏳ |
| 8. O'rindiqqa o'tirish (E), harakatlar (Q), fonar (F) | ✅ |
| 9. Polish, optimizatsiya, deploy | ⏳ |

## Ishga tushirish

Uch terminalda (ovoz kerak bo'lmasa birinchisi shart emas):

```bash
D:\dev-tools\livekit\livekit-server.exe --dev --bind 127.0.0.1
```

```bash
node --watch server/src/index.ts
```

```bash
node node_modules/vite/bin/vite.js client
```

So'ng brauzerda http://localhost:5173 ni oching. Xona yaratilgach havola (`?room=KOD`) do'stlarga yuboriladi.

Ovoz sozlamasi loyiha ildizidagi `.env` faylida (namuna: `.env.example`). `.env` bo'lmasa ovoz o'chiq,
qolgan hammasi ishlaydi. `.env` o'zgarsa serverni qayta ishga tushiring (`--watch` uni kuzatmaydi).

Server testlari: `node server/test/smoke.ts` (server ishlab turishi kerak).
Sinov boti: `node server/test/bot.ts <XONA> <buyruq.json>` — fayldagi holatni (joy, poza, o'rindiq) yuborib turadi.

## Deploy (Render)

Bitta bepul veb-servis sayt va o'yin serverini birga beradi; sozlamalar `render.yaml` da
(build: `npm ci && npm run build`, start: `node server/src/index.ts`, healthcheck: `/health`).
Render -> New -> Blueprint -> shu repo; Render LiveKit Cloud kalitlarini so'raydi:
`LIVEKIT_URL` (`wss://....livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
Bepul tarifda 15 daqiqa kirilmasa servis uxlaydi — keyingi birinchi ochilish ~50 soniya.
(`railway.json` — Railway'ga o'tilsa shu sozlama tayyor.)

## Ovoz qanday ishlaydi

- O'yin serveri har kirishda LiveKit tokenini (JWT, `server/src/voice.ts`) beradi; identity = player id,
  shuning uchun ovoz avatarga to'g'ridan-to'g'ri bog'lanadi. Token faqat mikrofon yuborishga ruxsat beradi.
- Xonada bir o'zingiz bo'lsangiz LiveKit'ga ulanilmaydi; yolg'iz qolinsa 20 soniyadan keyin uziladi —
  bepul tarifdagi daqiqalar tejaladi.
- Har bir do'stning ovozi Web Audio orqali uning avatari boshidan chiqadi (HRTF): yo'nalish aniq,
  masofa ovozni yumshoq pasaytiradi (3 m — 100%, 20 m — ~30%).
- Mikrofon kirishda yoqiq, `M` bilan o'chiriladi. `Esc` menyusida mikrofon tanlash, umumiy va har bir
  kishining ovoz balandligi (nickname bo'yicha saqlanadi).
- Mikrofon faqat `https` yoki `localhost` da ishlaydi (brauzer talabi).

**Sinash (dev):** ikkinchi tabni `?lite=1` bilan oching — 3D sahnasiz, faqat tarmoq va ovoz.
Konsolda `__debug.tone(440)` mikrofon o'rniga ohang yuboradi, `__debug.voice()` holatni,
`__debug.stereo()` chap/o'ng kanal darajasini ko'rsatadi.

## Ekran ulashish qanday ishlaydi

- Hozircha faqat xona egasi ulashadi (`RoomInfo.presenterId`). Egasi chiqib ketsa yangi egaga
  huquq LiveKit API orqali qayta ulanishsiz beriladi (`setSharePermission`, `server/src/voice.ts`).
- `Esc` → "Ekran" bo'limi: sifat (1080p / 720p) va "Ekranni ulashish". Kino uchun brauzer tabini yoki
  butun ekranni tanlab, "ovozni ham ulashish"ni belgilang.
- 1080p ~3 Mbit/s (simulcast: 720p, 360p qatlamlari), 720p ~1.5 Mbit/s. Trafik: 1080p ~1.4 GB/soat har bir
  tomoshabinga — LiveKit bepul tarifida (50 GB/oy) 8 kishi bilan oyiga ~2 ta 2 soatlik kino.
- Video zal ekraniga cho'zilmasdan (letterbox) chiqadi; tasvirning o'rtacha rangi zalni, avatarlarni va
  proyektor nurini jonli yoritadi.
- Kino ovozi toza stereo (fazoviy emas), `Esc` menyusida alohida "Kino ovozi" balandligi.
- `V` — videoni 2D'da butun ekranda ko'rish (3D chizish to'xtaydi, videokarta bo'shaydi), yana `V` — zalga qaytish.
- 3D ishga tushmasa (WebGL / xotira yetmadi) ilova o'chmaydi: xabar chiqadi, ovoz va `V` ishlayveradi.

**Sinash (dev):** `__debug.screenTest()` haqiqiy ekran o'rniga harakatlanuvchi tasvir va stereo ohang
(chap 330 Hz, o'ng 550 Hz) yuboradi, `__debug.screenStop()` to'xtatadi, `__debug.screen()` holatni ko'rsatadi.

## Avatarlar

Microsoft Rocketbox (MIT litsenziya) — 8 ta realistik personaj va mocap animatsiyalar.
Xom fayllar `tools/fetch-rocketbox.mjs` bilan yuklanadi (~800 MB, git'ga kirmaydi),
web formatiga `assets-src/blender/avatars_build.py` o'tkazadi (`client/public/avatars`).

> Bu kompyuterda tizim `npm`'i buzilgan, shuning uchun portable npm ishlatiladi:
> `D:\dev-tools\bin\npm.cmd install`

## Zalni qayta qurish (Blender)

Zal geometriyasi to'liq kod orqali yaratiladi (`assets-src/blender/`), yorug'lik esa Cycles'da
oldindan pishiriladi (lightmap). Portable Blender: `D:\dev-tools\blender`.

```bash
powershell -ExecutionPolicy Bypass -File tools/build-hall.ps1
```

- `-Fast` — tezkor past sifatli bake (sinov uchun)
- `-NoBake` — faqat geometriya

| Fayl | Vazifasi |
|---|---|
| `assets-src/blender/layout.py` | Zal o'lchamlari, qatorlar, eshik va tugma joylari |
| `assets-src/blender/hall_build.py` | Geometriya, materiallar, chiroqlar, eksport |
| `assets-src/blender/seat.py` | O'rindiq modeli |
| `assets-src/blender/hall_bake.py` | Lightmap (house / base / screen) va o'rindiq AO pishirish |
| `tools/fetch-textures.mjs` | Poly Haven (CC0) texturalarini yuklash |

## Yoritish qanday ishlaydi

Sahnada realtime chiroq yo'q — hammasi pishirilgan va uch qatlamdan yig'iladi:

```
yorug'lik = base + house × chiroq_darajasi + screen × ekran_rangi
```

- **house** — zal chiroqlari (devordagi tugma bilan silliq o'chadi/yonadi)
- **base** — doim yonadigan: zina LED'lari, EXIT, xira devor chiroqlari
- **screen** — ekrandan tushadigan nur; ekrandagi tasvirning o'rtacha rangiga ko'paytiriladi

O'rindiqlar va boshqa dinamik obyektlar shu lightmap'lardan olingan "probe" qiymatlar bilan
yoritiladi, shuning uchun ular zal bilan bir xil ko'rinadi va kuchsiz videokartada ham tez ishlaydi.

## Boshqaruv

`W A S D` yurish · `Shift` tez yurish · sichqoncha qarash · `E` o'rindiqqa o'tirish/turish, chiroq tugmasi ·
`F` qo'l fonari · `M` mikrofon · `V` to'liq ekran · `Q` (bosib turing) harakatlar g'ildiragi yoki `1`–`9` · `0` harakatni to'xtatish · `Esc` menyu
