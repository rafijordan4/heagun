# Heagun — GitHub upload pack

File frontend diletakkan langsung di root repository sesuai permintaan:

- `index.html` — halaman utama
- `style.css` — tampilan
- `script.js` — interaksi game
- `.nojekyll` — menonaktifkan pemrosesan Jekyll
- `server.js`, `package.json`, `schema.sql`, `.env.example` — backend Node.js dan skema database PostgreSQL

## Penting sebelum deploy

**GitHub Pages hanya menjalankan file statis.** Halaman bisa dipublikasikan dari root, tetapi login/daftar, penyimpanan skor ke database, leaderboard online, dan pertandingan 1v1 membutuhkan backend Node.js yang berjalan di hosting server. File `server.js` saat ini memakai PostgreSQL melalui `DATABASE_URL`, bukan Turso. Jangan memasukkan token database atau `JWT_SECRET` ke `index.html`, `style.css`, atau `script.js`.

Untuk menjalankan backend di hosting Node.js: gunakan Node.js 20+, instal dependensi dengan `npm install`, isi variabel rahasia berdasarkan `.env.example`, jalankan `schema.sql` pada PostgreSQL, lalu `npm start`. Atur `JWT_SECRET` menjadi rahasia acak panjang (minimal 32 karakter) dan `DATABASE_URL` ke connection string PostgreSQL.

Jika memakai GitHub Pages saja, buka **Settings → Pages → Deploy from a branch → main → /(root) → Save**. GitHub Pages tidak menjalankan backend.
