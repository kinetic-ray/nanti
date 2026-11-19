import { useLocale } from './locale.js';
import './creator.css';

export function CreatorLanding() {
  const { language, setLanguage } = useLocale();
  const id = language === 'id';
  return <div className="creator-page">
    <header className="creator-header">
      <a className="creator-logo" href="/" aria-label="Nanti home">nanti<span>.</span><small>CREATOR</small></a>
      <nav aria-label={id ? 'Navigasi kreator' : 'Creator navigation'}><a href="#manifesto">{id ? 'Tentang' : 'About'}</a><a href="#cara-kerja">{id ? 'Cara kerja' : 'How it works'}</a><a href="/creator/demo">{id ? 'Etalase contoh' : 'Sample storefront'}</a></nav>
      <div className="creator-header-actions"><button className="creator-language-toggle" type="button" onClick={() => setLanguage(id ? 'en' : 'id')} aria-label={id ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'} title={id ? 'English' : 'Bahasa Indonesia'}>{id ? 'EN' : 'ID'}</button><a className="creator-back" href="/">{id ? 'Ke Nanti' : 'Open Nanti'} <span aria-hidden="true">↗</span></a></div>
    </header>
    <main>
      <section className="creator-hero" aria-labelledby="creator-title">
        <div className="creator-hero-meta"><span>NANTI CREATOR</span><span>{id ? 'LINK PRODUK, KOLEKSI, DAN ETALASE' : 'PRODUCT LINKS, COLLECTIONS, AND STOREFRONTS'}</span><span>NANTI / CREATOR</span></div>
        <div className="creator-hero-copy">
          <p className="creator-eyebrow"><span className="creator-dot" aria-hidden="true"/> {id ? 'SEMUA LINK PRODUKMU, LEBIH MUDAH DICARI' : 'MAKE EVERY PRODUCT LINK EASY TO FIND'}</p>
          <h1 id="creator-title">{id ? <>Semua link.<br/><em>Satu etalase</em><span className="creator-period">.</span></> : <>Every link.<br/><em>One storefront</em><span className="creator-period">.</span></>}</h1>
          <div className="creator-hero-bottom"><p>{id ? 'Kumpulkan link produk afiliasi dalam satu halaman. Kelompokkan per koleksi agar pengikutmu bisa mencari produk dari postingan Instagram tanpa membuka satu per satu link.' : 'Keep your affiliate product links on one page. Organize them into collections so followers can find products from your Instagram posts without opening links one by one.'}</p><div className="creator-hero-actions"><a className="creator-primary" href="/creator/studio">{id ? 'Rancang etalasemu' : 'Design your storefront'} <span aria-hidden="true">↗</span></a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat contoh etalase' : 'View sample storefront'} <span aria-hidden="true">↗</span></a></div></div>
        </div>
        <div className="creator-hero-index" aria-hidden="true">n<span>.</span></div>
        <div className="creator-hero-footer"><span>{id ? 'KONSEP PRODUK / DALAM PENGEMBANGAN' : 'PRODUCT CONCEPT / IN DEVELOPMENT'}</span><a href="#manifesto">{id ? 'GESER UNTUK JELAJAH' : 'SCROLL TO EXPLORE'} ↓</a></div>
      </section>

      <section id="manifesto" className="creator-manifesto">
        <div className="creator-manifesto-label"><span>THE IDEA</span><span>↘</span></div>
        <div><p className="creator-overline">{id ? 'KENAPA PERLU ETALASE?' : 'WHY A STOREFRONT?'}</p><h2>{id ? <>Satu postingan.<br/><i>Banyak produk.</i><br/>Tetap mudah dicari.</> : <>One post.<br/><i>Many products.</i><br/>Easy to find.</>}</h2><p>{id ? 'Misalnya kamu membagikan outfit liburan. Simpan semua barangnya dalam satu koleksi, lalu tulis nama koleksi atau kode produk di caption. Pengikut tinggal cari di etalasemu.' : 'Sharing a vacation outfit? Put every item in one collection and add the collection name or product code to your caption. Followers can search your storefront directly.'}</p></div>
      </section>

      <section className="creator-showcase" aria-labelledby="creator-showcase-title">
        <div className="creator-showcase-head"><span>IN PRACTICE</span><h2 id="creator-showcase-title">{id ? <>Dari caption.<br/><em>Langsung ketemu.</em></> : <>From caption.<br/><em>To the right product.</em></>}</h2><p>{id ? 'Pengikut melihat kode produk di Instagram, mengetiknya di kolom pencarian, lalu menemukan barang yang dimaksud.' : 'Followers see a product code on Instagram, enter it in search, and find the item they came for.'}</p></div>
        <div className="creator-story-grid">
          <article className="creator-story creator-story-social"><div className="creator-story-top"><span>INSTAGRAM</span><span>↗</span></div><div className="creator-story-visual"><span className="creator-story-sun"/><span className="creator-story-horizon"/><strong>OFF<br/>DUTY.</strong><small>SUMMER EDIT — 03</small></div><div className="creator-story-caption"><strong>@studio.sore</strong><p>{id ? 'Set main ke pantai sudah aku kumpulin. Cari “Etalase 3” atau kode PRD-003 di link bio ☀' : 'My beach-day picks are all together. Search “Showcase 3” or PRD-003 in my bio ☀'}</p></div></article>
          <div className="creator-story-arrow" aria-hidden="true">↗</div>
          <article className="creator-story creator-story-store"><div className="creator-story-top"><span>CREATOR STOREFRONT</span><span>nanti.</span></div><div className="creator-story-store-inner"><span className="creator-store-kicker">STUDIO SORE / CURATED FINDS</span><h3>{id ? 'Temukan yang kamu lihat.' : 'Find what caught your eye.'}</h3><div className="creator-store-search"><span aria-hidden="true">⌕</span><span>Etalase 3</span><span>↵</span></div><div className="creator-store-results"><span>{id ? 'HASIL PENCARIAN' : 'SEARCH RESULTS'}</span><strong>{id ? 'SET MAIN KE PANTAI' : 'BEACH DAY EDIT'}</strong></div><div className="creator-store-products"><div><span className="creator-product-art creator-product-one">✳</span><small>PRD-003</small><strong>{id ? 'Pilihan pantai' : 'Beach essential'}</strong></div><div><span className="creator-product-art creator-product-two">◒</span><small>PRD-004</small><strong>{id ? 'Pelengkap gaya' : 'The finishing touch'}</strong></div></div></div><a href="/creator/demo">{id ? 'Jelajahi demo sebenarnya' : 'Explore the actual demo'} ↗</a></article>
        </div>
        <p className="creator-showcase-note">{id ? '* Ilustrasi alur penggunaan. Konten dan produk masih contoh; publikasi kreator belum tersedia.' : '* Illustrative journey. Content and products are samples; creator publishing is not yet available.'}</p>
      </section>

      <section id="cara-kerja" className="creator-process">
        <div className="creator-process-title"><span>HOW IT WORKS</span><h2>{id ? <>Pilih.<br/>Susun.<br/><em>Bagikan.</em></> : <>Pick.<br/>Arrange.<br/><em>Share.</em></>}</h2></div>
        <div className="creator-process-list">
          <article><span>01</span><div><h3>{id ? 'Temukan barangnya' : 'Find your picks'}</h3><p>{id ? 'Kumpulkan produk yang benar-benar ingin kamu rekomendasikan.' : 'Gather products you genuinely want to recommend.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>02</span><div><h3>{id ? 'Beri sudut pandang' : 'Give them a point of view'}</h3><p>{id ? 'Buat koleksi berdasarkan cerita, suasana, atau kebutuhan.' : 'Build collections around stories, moods, or needs.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>03</span><div><h3>{id ? 'Biar mudah ditemukan' : 'Make them easy to find'}</h3><p>{id ? 'Audiens mencari nama koleksi, nomor etalase, atau kode produk.' : 'Your audience searches by collection name, showcase number, or product code.'}</p></div><span aria-hidden="true">↗</span></article>
        </div>
      </section>

      <section className="creator-end"><span>YOUR SPACE</span><h2>{id ? <>Link produk rapi.<br/><em>Gampang dicari.</em></> : <>Organized links.<br/><em>Easy to find.</em></>}</h2><p>{id ? 'Coba atur tampilan etalasemu lewat Design Studio. Saat ini masih berupa pratinjau; publikasi halaman dan integrasi afiliasi belum tersedia.' : 'Try arranging your storefront in Design Studio. This is still a preview; publishing and affiliate integrations are not available yet.'}</p><div><a className="creator-primary" href="/creator/studio">{id ? 'Masuk Design Studio' : 'Enter Design Studio'} ↗</a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat etalase demo' : 'View demo storefront'} ↗</a></div></section>
    </main>
    <footer className="creator-footer"><span>nanti<span className="creator-purple">.</span> creator</span><span>© 2026 NANTI / {id ? 'MASIH DALAM PENGEMBANGAN' : 'WORK IN PROGRESS'}</span><a href="/">{id ? 'KEMBALI KE NANTI' : 'BACK TO NANTI'} ↗</a></footer>
  </div>;
}
