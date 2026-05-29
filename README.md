# Flappy Prof 🐦🇶🇨

Le jeu le plus québécois de la classe — un mélange Flappy Bird + Jetpack Joyride pour le cours
de français. Kuş, sınıfın profesörünün karikatürü; araya Fransızca gramer soruları (poutine
kapısı) girer, doğru cevap kalkan kazandırır, sonunda canlı bir leaderboard ile sınıf yarışır.

## Tech stack
- **Phaser 3** + **TypeScript** + **Vite**
- **Supabase** (Postgres leaderboard + Realtime)
- Mobil öncelikli, dokunmatik; masaüstünde de oynanır.

## Geliştirme (development)
```bash
npm install
npm run dev      # http://localhost:5173  (aynı WiFi için: --host zaten açık)
npm run build    # tsc --noEmit && vite build  → dist/
```

## Ortam değişkenleri (environment variables)
`.env.example`'ı `.env` olarak kopyala ve doldur:
```
VITE_SUPABASE_URL=https://<proje>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable veya anon key>
```
- `VITE_` ön ekli değişkenler **build sırasında** bundle'a gömülür (client'ta görünür — anon/publishable key bunun için güvenli).
- ⚠️ `service_role` / secret anahtarları ASLA buraya koyma.
- **Deploy ederken (Vercel/Netlify) bu iki değişkeni hosting panelinde de tanımla**, yoksa
  buluttaki build leaderboard'a bağlanamaz (`.env` repoya gitmez, `.gitignore`'da).

## Supabase tablosu (tek seferlik SQL)
`src/systems/Net.ts` dosyasının başındaki yorum bloğundaki SQL'i Supabase SQL editöründe çalıştır
(tablo + RLS: anon yalnızca select+insert). Realtime'ı `scores` tablosu için aç.

## Proje yapısı
`src/scenes/` (Boot, Preload, Menu, Game, Quiz, GameOver, Leaderboard, Pause) ve
`src/systems/` (Rng, QuestionManager, Audio* , Net) — ayrıntılar `CLAUDE.md`'de (tek doğruluk
kaynağı / yol haritası).

## Notlar
- `public/questions.json` = gramer bankası (authored content, **değiştirilmez**).
- Oyundaki tüm görünen metin Fransızca; kod/değişken adları İngilizce.
