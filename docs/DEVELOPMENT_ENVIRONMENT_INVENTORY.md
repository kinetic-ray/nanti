Nanti — PC Development Setup Baseline
Checklist untuk menyiapkan PC baru dengan lingkungan pengembangan seperti proyek Nanti.
Tech Stack Nanti
- Frontend: React 19, TypeScript 5.9, Vite 7, CSS.
- Backend: Node.js, Express 5, Zod 4.
- Database: MySQL atau MariaDB, Prisma 7.
- Testing: Vitest, Supertest, Playwright dengan Chrome/Chromium, axe-core.
- Login opsional: Google dan Apple melalui OpenID Connect.
Versi dependency lengkap tersedia di package.json.
Skill yang Terpasang
Skill bawaan repository
- frontend-design
- hexagonal-typescript
- security-best-practices
- vercel-react-best-practices
- web-design-guidelines
GitNexus bawaan repository
- gitnexus-cli
- gitnexus-debugging
- gitnexus-exploring
- gitnexus-guide
- gitnexus-impact-analysis
- gitnexus-refactoring
GitNexus global tambahan
- gitnexus-lfg
- gitnexus-pdg-query
- gitnexus-plan
- gitnexus-review
- gitnexus-taint-analysis
- gitnexus-work
Skill bawaan Codex
- imagegen
- openai-docs
- skill-creator
- skill-installer
- review-agent — ditemukan di disk, tetapi ketersediaannya dalam sesi belum terverifikasi.
Skill plugin
Google Drive, Google Docs, Google Sheets, Google Slides, Sites, Visualize, Work Pets, dan Plugin Management.

Inventaris lengkap lokal: docs/DEVELOPMENT_ENVIRONMENT_INVENTORY.md.
Urutan Setup di PC Baru
1. Instal prasyarat: Git, Node.js + npm, serta MySQL/MariaDB. Repository mensyaratkan Node.js 22.12+; PC referensi menggunakan Node.js 26.13.1.
2. Siapkan editor: Instal VS Code dan ekstensi Codex. Konfigurasikan GitNexus jika ingin menjalankan pemeriksaan kode sesuai workflow repository.
3. Siapkan repository: Untuk melanjutkan Nanti, clone repository; skill dalam .agents/skills akan ikut terbawa. Untuk proyek baru, salin skill yang diperlukan ke .agents/skills proyek tersebut.
4. Siapkan aplikasi: Buat database kosong, jalankan npm ci, salin .env.example menjadi .env, lalu isi DATABASE_URL dan SESSION_SECRET.
5. Jalankan migrasi dan aplikasi: Jalankan npm run db:migrate, lalu npm run dev.
6. Buka aplikasi: Kunjungi http://127.0.0.1:5173.
Contoh perintah setup
git clone https://github.com/kinetic-ray/nanti.git
cd nanti
npm.cmd ci
Copy-Item .env.example .env
# Isi DATABASE_URL dan SESSION_SECRET di .env terlebih dahulu.
npm.cmd run db:migrate
npm.cmd run dev
Catatan: Perintah di atas mengasumsikan MySQL/MariaDB sudah berjalan dan database kosong sudah dibuat. Jangan commit .env atau kredensial ke Git.

Referensi
- Repository Nanti
- Panduan setup lokal (README.md)
- Skills repository
- Inventaris lokal: docs/DEVELOPMENT_ENVIRONMENT_INVENTORY.md