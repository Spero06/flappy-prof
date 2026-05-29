# Flappy Prof — Proje Yol Haritası & Claude Code Handoff

> Bu dosya projenin tek doğruluk kaynağı (single source of truth). Claude Code bu dosyayı
> proje context'i olarak okur. Bölüm 11'deki prompt'ları sırayla yapıştırarak ilerle.
> Dil notu: açıklamalar Türkçe, oyunda **görünen tüm içerik Fransızca** olmak zorunda.
> Kod, değişken adları, dosya yolları İngilizce/kod.

---

## 1. Vizyon & Konsept

Fransızca sınıfı için yapılan, **Flappy Bird + Jetpack Joyride** karışımı bir web oyunu.
Ana komedi kancası: oyundaki kuş, sınıfın profesörünün karikatürü; profun kendi sesiyle
kaydettiği Québécois kalıpları (her kanat çırpışında nazal "benn", her engeli geçişte
"voyons donc" vb.) oyunun her anına serpiştirilmiş. Araya gramer soruları (poutine ikonu)
girer; doğru cevap kalkan + puan kazandırır. Sonunda canlı bir leaderboard ile sınıf
yarışır. İki mod: tek kişilik ve aynı parkurda "hayalet" çok oyunculu.

Tasarım ilkeleri: çok zor olmasın, çabuk sıkmasın, Fransızca + profun komik sesleri ön
planda, mobil uyumlu, rekabetçi.

---

## 2. Teknoloji Yığını (Tech Stack)

- **Oyun motoru:** Phaser 3 (önerilen sürüm: en güncel 3.x)
- **Dil:** TypeScript (tercih — hata payını düşürür). JavaScript da kabul.
- **Build:** Vite
- **Backend:** Supabase (Postgres = kalıcı leaderboard, Realtime = canlı tablo + hayalet pozisyonları)
- **Ses:** Web Audio API (Phaser Sound üstünden veya doğrudan AudioContext) — `playbackRate` kontrolü için
- **Deploy:** Vercel veya Netlify (statik frontend, ücretsiz). Supabase ayrı host.
- **Hedef:** Mobil öncelikli, dokunmatik; masaüstünde de oynanır.

---

## 3. Repo Yapısı (önerilen)

```
flappy-prof/
  public/
    questions.json        # GRAMER BANKASI — Umut tarafından üretildi, ELLE DEĞİŞTİRME
    audio.json            # ses manifesti (event -> dosya listesi)
    audio/                # profun ses klipleri (.mp3/.ogg) + placeholder
    sprites/              # kuş, engeller, power-up ikonları, arka plan
  src/
    main.ts               # Phaser config + sahne kaydı
    scenes/
      BootScene.ts
      PreloadScene.ts
      MenuScene.ts
      LobbyScene.ts       # çok oyunculu (Faz 6)
      GameScene.ts
      QuizScene.ts        # overlay (Faz 4)
      GameOverScene.ts
      LeaderboardScene.ts # (Faz 5)
    systems/
      AudioManager.ts     # klip yükleme, event->ses, playbackRate
      QuestionManager.ts  # questions.json yükle, filtrele, karıştır, tekrar engelle
      Rng.ts              # seed'li rastgele (multiplayer adaleti)
      Net.ts              # Supabase client + realtime helpers
    config.ts             # sabitler (fizik, hız, gap, power-up süreleri)
  .env                    # SUPABASE_URL, SUPABASE_ANON_KEY (commit ETME)
  index.html
  package.json
```

---

## 4. Oyun Tasarımı (Game Design)

### 4.1 Çekirdek döngü
- Kuş ekranda yatay sabit (~%25 x), dikeyde fizik (yer çekimi).
- Kanat çırpma (flap): yukarı doğru ani hız (impulse). Her flap'te "benn" sesi.
- Engeller sağdan sola akar; aralarındaki boşluktan (gap) geçilir.
- Bir engel çifti başarıyla geçilince: +1 puan + "voyons donc" sesi.
- Çarpışma (engel veya zemin/tavan) → ölüm (kalkan/invincible yoksa).

### 4.2 Kontroller & mobil
- Dokunma / mouse tıklama / Space = flap.
- Phaser Scale: `Phaser.Scale.FIT` veya `RESIZE`, `autoCenter`. Tüm fizik değerleri ekran
  yüksekliğine göre normalize edilmeli (farklı telefonlarda aynı his).
- `devicePixelRatio` dikkate al (retina'da bulanıklık olmasın).

### 4.3 Engeller & seed (ADALET İÇİN KRİTİK)
- Engel dizilimi (gap konumu, power-up yerleşimi) **seed'li RNG** ile üretilir (`Rng.ts`).
- Solo modda seed rastgele.
- **Çok oyunculu modda lobi herkese AYNI seed'i dağıtır** → herkes birebir aynı parkurda
  yarışır. Bu olmazsa "benimki daha zordu" tartışması çıkar.
- Engeller Québec temalı görseller olabilir: poutine kuleleri, sirop d'érable şişeleri,
  hokey sopaları, kar yığınları (görsel; mekanik aynı).

### 4.4 Puanlama
- Her engel = +1.
- Doğru quiz cevabı = bonus (örn. +5) + kalkan.
- Opsiyonel combo: arka arkaya çarpışmasız geçişlerde çarpan. (Nice-to-have.)

### 4.5 Power-up'lar (havada beliren toplanabilir ikonlar)
| İkon | Etki | Ses davranışı |
|------|------|----------------|
| 🍟 Poutine | Oyunu durdur, gramer sorusu sor (Bölüm 6). Doğru → kalkan + bonus puan. Yanlış → ödül yok (CEZA YOK). | quiz_correct / quiz_wrong klibi |
| ⏰ Horloge | Slow-mo: birkaç saniye her şey yavaşlar (fizik + engel hızı + spawn). | TÜM sesler `playbackRate` düşer → derin/pes "voyooons doooonc" (komedi) |
| ⭐ / 🦫 Étoile/Castor | Invincible: birkaç saniye engellerden geçilir. | sesler `playbackRate` artar → ince/hızlı (chipmunk) |

- Süreler `config.ts`'te: örn. slowmo 5 sn, invincible 4 sn. Görsel geri bildirim şart
  (ekran tonu, kuş etrafında parıltı, kalan süre çubuğu).

### 4.6 Kalkan (shield)
- Bir çarpışmayı emer (tek kullanımlık). Aktifken kuşun etrafında görünür bir halka.
- Birden fazla kalkan biriktirilebilir mi? Öneri: maksimum 1 (basit ve dengeli).

---

## 5. Ses Sistemi

### 5.1 Mimari
- Tüm klipler başta `AudioBuffer` olarak preload edilir (gecikme olmasın).
- İlk kullanıcı etkileşiminde `AudioContext` unlock edilir (mobil autoplay politikası).
- `audio.json` manifesti event → dosya listesini tutar; kod her event için listeden
  **rastgele bir klip** seçer (tekdüzelik olmasın). questions.json mantığının ses versiyonu.

`public/audio.json` örnek şema:
```json
{
  "flap":         ["audio/flap_01.mp3", "audio/flap_02.mp3"],
  "pass":         ["audio/pass_01.mp3", "audio/pass_02.mp3"],
  "quiz_start":   ["audio/quiz_start_01.mp3"],
  "quiz_correct": ["audio/quiz_correct_01.mp3", "audio/quiz_correct_02.mp3"],
  "quiz_wrong":   ["audio/quiz_wrong_01.mp3"],
  "shield":       ["audio/shield_01.mp3"],
  "slowmo":       ["audio/slowmo_01.mp3"],
  "invincible":   ["audio/invincible_01.mp3"],
  "milestone":    ["audio/milestone_01.mp3"],
  "gameover":     ["audio/gameover_01.mp3"]
}
```

### 5.2 Yavaşlatma & hızlandırma efekti
- Slow-mo aktifken çalan/yeni klipler `source.playbackRate.value = 0.6` gibi.
- Invincible'da `playbackRate.value = 1.5` gibi.
- Web Audio'da `playbackRate` hem hızı hem pitch'i değiştirir — bu İSTENEN efekt
  (pes/ince komedi). Pitch'i sabit tutmaya çalışma.

### 5.3 Profun kaydedeceği klipler (asset listesi — profa ver)
Aşağıdaki olaylar için kısa klipler. Prof doğal konuşsun; istediği kadar varyant
kaydedebilir (kod listeden rastgele seçer). Dosya adları `audio.json`'a eklenir.

- **flap** (çok sık çalar — kısa olmalı): nazal "benn" / "bien"
- **pass** (engel geçişi): "voyons donc", "ben voyons", "là là"
- **quiz_start**: "une petite question !"
- **quiz_correct**: "c'est en plein ça !", "exact !", "bravo !"
- **quiz_wrong**: "ben non...", "voyons donc..." (hayal kırıklığı tonu)
- **shield**: "protégé !"
- **slowmo**: "on relaxe, là", "tranquille"
- **invincible**: "envoye donc !", "let's go !"
- **milestone** (her 10 puanda): "continue, c'est bon ça !"
- **gameover**: "bon, c'est fini là", "voyons donc..."
- (opsiyonel komik): kibar sacre'lar — "tabarouette !", "tabarslaque !" (gerçek sacre yerine
  sınıf için güvenli ve daha komik). Near-miss / çarpışmada kullanılabilir.

### 5.4 Placeholder stratejisi
- Prof klipleri gelene kadar `speechSynthesis` (Web Speech API, `lang='fr-CA'`) ile geçici
  ses üret. Aynı event mantığını kullan; klipler gelince sadece `audio.json` + dosyalar
  değişir, kod aynı kalır. Böylece oyun her fazda oynanır kalır.

---

## 6. Soru Sistemi (Quiz)

- Kaynak: `public/questions.json` (ZATEN HAZIR, 183 soru, Umut üretti). **Claude Code soru
  ÜRETMEZ**, sadece yükler/kullanır.
- Şema (her obje):
  ```json
  {
    "id": "subj-001",
    "topic": "subjonctif_present",
    "difficulty": "facile|moyen|difficile",
    "sentence": "Il faut que tu _____ tes devoirs ce soir.",
    "options": ["fais", "fasses", "feras", "faisais"],
    "answer": "fasses",
    "explanation": "..."
  }
  ```
- `answer` = doğru kelimenin kendisi (index değil). Bu yüzden şıkları **karıştırırken**
  (her seferinde doğru farklı yerde olsun) `answer` string'iyle eşleştirerek doğruyu takip et.
- **Tekrar engelleme:** bir koşu (run) boyunca görülen `id`'leri sakla; banka bitene kadar
  aynı soru gelmez. Banka biterse seen listesini sıfırla.
- **Zorluk artışı:** skor düşükken `facile`, yükseldikçe `moyen`, en yüksekte `difficile`
  (défi) ağırlığı artsın. Eşik değerleri `config.ts`'te.
- **Quiz akışı:** poutine toplanınca oyunu duraklat → `QuizScene` overlay aç → cümle + 4 büyük
  dokunmatik şık + (cevaptan sonra) kısa `explanation` göster → doğru = kalkan + bonus + ses,
  yanlış = ödül yok + ses → kısa gecikme → oyuna devam. Quiz bir öğrenme anı; aceleye getirme
  ama oyunu da fazla kesme (örn. 1.5 sn açıklama gösterimi).
- Tüm quiz metni Fransızca (zaten dosyada öyle).

---

## 7. Sahneler (Phaser Scenes)

- **BootScene:** temel ayarlar, scale config.
- **PreloadScene:** sprite + ses + `questions.json` + `audio.json` yükle, yükleme çubuğu.
- **MenuScene:** başlık, "Jouer (solo)" / "Multijoueur" / pseudo girişi.
- **LobbyScene:** (Faz 6) oda kodu, katılanlar, senkron geri sayım.
- **GameScene:** çekirdek oyun döngüsü, power-up, kalkan, HUD (skor + kalkan).
- **QuizScene:** (Faz 4) GameScene üstüne overlay; açıkken GameScene duraklı.
- **GameOverScene:** skor özeti, skoru gönder, "Rejouer".
- **LeaderboardScene:** (Faz 5) canlı top 15.

---

## 8. İki Mod

### 8.1 Solo
- Rastgele seed, kendi koşun, ölünce skor leaderboard'a yazılır. Standart akış.

### 8.2 Çok oyunculu (hayalet / ghost)
- "Gerçek senkron multiplayer" DEĞİL — çok daha basit ve sağlam:
  - Oyuncular birbirine çarpmaz, kimse kimseyi öldürmez. Herkes kendi koşusunu oynar.
  - Lobide oda kodu (örn. sınıf kodu) ile aynı Realtime kanalına girilir.
  - Host (veya ilk giren) bir **seed** üretir, kanaldan herkese yayar → aynı parkur.
  - Senkron başlangıç: 3-2-1 geri sayım kanaldan tetiklenir.
  - Her oyuncu pozisyonunu (y, alive, score) **~12 Hz** broadcast eder (DB'ye YAZMA, ephemeral).
  - Diğer oyuncular ekranda **düşük opaklıkta hayalet** çizilir; senin avatarın hepsinin
    üstünde tam görünür. Hayaletler görmeyi engellemez (yarı saydam, çarpışmasız).
- Bu mod en ağır parça; **en sona** (Faz 6) bırakıldı. Önce solo + leaderboard tam çalışsın.

---

## 9. Supabase (Backend)

### 9.1 Şema (kalıcı leaderboard)
```sql
create table public.scores (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  player_name  text not null check (char_length(player_name) <= 24),
  score        int  not null check (score >= 0),
  mode         text not null default 'solo' check (mode in ('solo','multi')),
  room_code    text
);
create index scores_score_idx on public.scores (score desc);
```

### 9.2 Realtime
- **Leaderboard canlı güncelleme:** `scores` tablosuna Realtime (postgres_changes) abone ol;
  yeni satır gelince tabloyu güncelle.
- **Hayalet pozisyonları (Faz 6):** Supabase Realtime **Broadcast** kanalı kullan (DB'ye
  yazmadan ephemeral mesaj). Oda kodu = kanal adı. Seed + geri sayım + pozisyonlar bu kanaldan.

### 9.3 Güvenlik notları
- RLS açık tut. Anon kullanıcıya: `scores` üzerinde `insert` ve `select` izni; `update/delete`
  YOK. (Sınıf oyunu için yeterli; ağır anti-cheat gereksiz.)
- `.env` commit edilmez. Anon key client'ta görünür (normaldir), ama service key ASLA client'ta
  olmaz.
- Pseudo girişi: maks 24 karakter, temel sanitizasyon (XSS'e karşı render'da escape).

---

## 10. Fazlı İnşa Planı (her faz oynanır/teslim edilebilir)

> Kural: her fazı bitir, çalıştığını gör, sonra diğerine geç. Aceleyle ileri fazlara atlama.

- **Faz 0 — İskelet:** Vite + Phaser 3 (+TS). Boot/Preload/Menu sahneleri. Mobil+masaüstü
  full-screen render, tıklama log'lanıyor. Deploy hattı (Vercel/Netlify) ayakta.
  *DoD:* boş GameScene telefonda ve masaüstünde düzgün ölçekleniyor.
- **Faz 1 — Çekirdek döngü:** kuş fiziği, flap, seed'li engeller, çarpışma→game over, skor.
  Geçici ses (speechSynthesis/beep). *DoD:* solo oynanır döngü, skor artıyor, restart var.
- **Faz 2 — Ses sistemi:** `AudioManager`, `audio.json` manifesti, AudioContext unlock,
  flap→benn / pass→voyons donc / gameover. Placeholder TTS ile başla. *DoD:* sesler event'lerde
  çalıyor; `public/audio/` + `audio.json` değişince kod değişmeden klip değişiyor.
- **Faz 3 — Power-up'lar:** horloge (slow-mo + ses playbackRate↓), étoile/castor (invincible +
  playbackRate↑). Görsel geri bildirim, süre çubuğu. *DoD:* her power-up çalışıyor, sesli efekt
  hissediliyor.
- **Faz 4 — Quiz + kalkan:** poutine→`QuizScene`, `QuestionManager` (yükle, zorluk skora bağlı,
  şık karıştır, görülen id tekrar etmez), doğru=kalkan+bonus, yanlış=ödülsüz. Kalkan tek vuruş emer.
  *DoD:* bir koşuda soru tekrarı yok, kalkan çalışıyor, her şey Fransızca.
- **Faz 5 — Leaderboard:** Supabase `scores`, game over'da pseudo→insert→top 15, Realtime canlı
  güncelleme. *DoD:* skorlar kalıcı, tablo cihazlar arası canlı güncelleniyor.
- **Faz 6 — Çok oyunculu (hayalet):** lobi + oda kodu, senkron geri sayım, seed yayını, ~12Hz
  pozisyon broadcast, yarı saydam hayaletler, kendi avatarın üstte. *DoD:* 2+ cihaz aynı
  parkurda, birbirini hayalet olarak görüyor, bağımsız koşu, sonda ortak leaderboard.
- **Faz 7 — Cila:** partikül/ekran sarsıntısı/juice, mobil test, profun GERÇEK ses kliplerini
  entegre et, son deploy. *DoD:* sınıfta oynanmaya hazır.

---

## 11. Claude Code'a yapıştırılacak başlangıç prompt'ları

> Her fazın başında ilgili prompt'u Claude Code'a yapıştır. Tümü `CLAUDE.md`'ye (bu dosya)
> atıfta bulunur. İngilizce yazıldı (coding agent için sağlam); istersen Türkçeleştir.

**Faz 0:**
```
Read CLAUDE.md fully. Scaffold the project per section 3 using Vite + Phaser 3 + TypeScript.
Implement BootScene, PreloadScene, MenuScene. Configure Phaser.Scale for mobile-first
full-screen with autoCenter and devicePixelRatio handling. Add a minimal MenuScene with a
"Jouer" button and a pseudo text input. Set up a Vercel-ready build. Do NOT build gameplay yet.
Verify it renders full-screen on a 380px-wide viewport and on desktop.
```
**Faz 1:**
```
Implement Faz 1 (core loop) per CLAUDE.md sections 4.1–4.4 and 7 (GameScene).
Use Arcade Physics. Bird at ~25% width with gravity + flap impulse on tap/click/Space.
Obstacles spawn from a seeded RNG (create src/systems/Rng.ts); scroll left; +1 score per pair
passed; collision with obstacle/floor/ceiling → GameOverScene with restart. Normalize all
physics values to screen height. Use a temporary beep or speechSynthesis for flap/pass for now.
```
**Faz 2:**
```
Implement Faz 2 (audio) per CLAUDE.md section 5. Create src/systems/AudioManager.ts that
preloads clips listed in public/audio.json as AudioBuffers, unlocks AudioContext on first
user gesture, and plays a RANDOM clip per event. Wire events: flap, pass, gameover, milestone.
Until real clips exist, generate placeholders with speechSynthesis (lang fr-CA) but keep the
manifest-driven design so swapping files in public/audio + audio.json needs no code change.
Create a starter public/audio.json with the events from section 5.1.
```
**Faz 3:**
```
Implement Faz 3 (power-ups) per CLAUDE.md section 4.5. Spawn collectible icons (horloge,
etoile) along the seeded track. Slow-mo: scale physics time + obstacle/spawn speed for
config-defined seconds AND set audio playbackRate down (~0.6). Invincible: pass through
obstacles for config seconds AND set audio playbackRate up (~1.5) with a visual aura. Add a
remaining-time bar and screen tint feedback. Put durations/rates in src/config.ts.
```
**Faz 4:**
```
Implement Faz 4 (quiz + shield) per CLAUDE.md section 6. Create src/systems/QuestionManager.ts
that loads public/questions.json, filters by difficulty based on current score, shuffles
options while tracking the correct one via the answer string, and never repeats a seen id in
a run. Poutine collectible pauses GameScene and opens QuizScene overlay: French sentence + 4
large touch options + short explanation after answering. Correct = grant shield + bonus +
quiz_correct sound; wrong = no reward + quiz_wrong sound. Shield absorbs one collision with a
visible ring. All UI text stays French.
```
**Faz 5:**
```
Implement Faz 5 (leaderboard) per CLAUDE.md section 9. Add Supabase client in src/systems/
Net.ts using env vars. Create the scores table (provide the SQL to run). On GameOver, insert
{player_name, score, mode:'solo'}. LeaderboardScene shows top 15 by score desc and subscribes
to Realtime postgres_changes to update live. Keep RLS: anon insert+select only. Never expose
the service key.
```
**Faz 6:**
```
Implement Faz 6 (ghost multiplayer) per CLAUDE.md section 8.2. Add LobbyScene with a room code
that joins a Supabase Realtime Broadcast channel named by the code. First member generates a
seed and broadcasts it so everyone shares the same track. Synchronized 3-2-1 countdown via the
channel. Each client broadcasts {y, alive, score} at ~12Hz (no DB writes). Render other players
as low-opacity, collision-free ghosts; own avatar fully visible on top. At end, write scores
with mode:'multi' and room_code, show the shared leaderboard.
```
**Faz 7:**
```
Implement Faz 7 (polish) per CLAUDE.md section 10. Add juice: particles on pass/pickup, screen
shake on hit, smooth tweens, staggered UI reveals. Test on mobile (touch targets, performance,
audio unlock). Replace placeholder speechSynthesis with the professor's real clips by updating
public/audio/ and public/audio.json only. Final production build + deploy.
```

---

## 12. Kapsam Dışı / Sonraya (bilinçli ertelenenler)

- Gerçek senkron (lag-compensated) multiplayer — gerek yok, hayalet yeter.
- Ağır anti-cheat / sunucu tarafı skor doğrulama — sınıf için aşırı.
- Hesap/giriş sistemi — sadece pseudo yeterli.
- Çoklu dil arayüz — oyun zaten Fransızca odaklı.

---

## 13. Kritik Gotcha'lar & Onaylar

- **Mobil ses:** AudioContext mutlaka ilk dokunuşta unlock edilmeli, yoksa ses çalmaz.
- **Adalet:** çok oyunculu modda seed paylaşımı şart (Bölüm 4.3) — yoksa parkurlar farklı olur.
- **questions.json'a dokunma:** içerik kaynağı Umut; Claude Code üretmez/düzenlemez.
- **Prof onayı (iki kalem):** (1) yüzünün/sesinin siteye konmasına "tamam" demesi;
  (2) `questions.json`'a bir göz gezdirmesi (özellikle défi katmanı: accord, conditionnel passé).
- **Performans:** her event'te yeni AudioBuffer decode etme — preload edip tekrar kullan.
- **localStorage:** bu gerçek bir site olduğu için seen-id/pseudo gibi şeyler localStorage'da
  tutulabilir (artifact değil, kısıt yok).

---

*Sıradaki üretim: profun ses klipleri gelince `audio.json` + dosyalar; yeni gramer soruları
gerekirse aynı şemada `questions.json`'a eklenir.*
