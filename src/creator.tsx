import { useLocale, LanguagePicker } from './locale.js';
import './creator.css';

export function CreatorLanding() {
  const { language } = useLocale();
  const id = language === 'id';
  return <div className="creator-page">
    <header className="creator-header">
      <a className="creator-logo" href="/" aria-label="Nanti home">nanti<span>.</span><small>CREATOR</small></a>
      <nav aria-label={id ? 'Navigasi kreator' : 'Creator navigation'}><a href="#manifesto">{id ? 'Tentang' : 'About'}</a><a href="#cara-kerja">{id ? 'Cara kerja' : 'How it works'}</a><a href="/creator/demo">{id ? 'Etalase contoh' : 'Sample storefront'}</a></nav>
      <div className="creator-header-actions"><LanguagePicker /><a className="creator-back" href="/creator/studio">{id ? 'Buka studio' : 'Open studio'} <span aria-hidden="true">↗</span></a></div>
    </header>
    <main>
      <section className="creator-hero" aria-labelledby="creator-title">
        <div className="creator-hero-meta"><span>NANTI CREATOR / 001</span><span>{id ? 'RUANG UNTUK SELERA YANG PUNYA CERITA' : 'A SPACE FOR TASTE WITH A STORY'}</span><span>2026 — ∞</span></div>
        <div className="creator-hero-copy">
          <p className="creator-eyebrow"><span className="creator-dot" aria-hidden="true"/> {id ? 'BUKAN SEKADAR LINK DI BIO' : 'MORE THAN A LINK IN BIO'}</p>
          <h1 id="creator-title">{id ? <>Selera itu<br/><em>punya</em> tempat<span className="creator-period">.</span></> : <>Good taste<br/><em>deserves</em> a place<span className="creator-period">.</span></>}</h1>
          <div className="creator-hero-bottom"><p>{id ? 'Dari barang kecil yang selalu kamu pakai sampai satu set outfit buat liburan. Bukan daftar link. Ini dunia pilihanmu.' : 'From the little things you use every day to a whole vacation outfit. Not a list of links. A world of your own picks.'}</p><div className="creator-hero-actions"><a className="creator-primary" href="/creator/studio">{id ? 'Rancang etalasemu' : 'Design your storefront'} <span aria-hidden="true">↗</span></a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat hasilnya' : 'See the example'} <span aria-hidden="true">↗</span></a></div></div>
        </div>
        <div className="creator-hero-index" aria-hidden="true">N<span>°</span>01</div>
        <div className="creator-hero-footer"><span>{id ? 'KONSEP PRODUK / DALAM PENGEMBANGAN' : 'PRODUCT CONCEPT / IN DEVELOPMENT'}</span><a href="#manifesto">{id ? 'GESER UNTUK JELAJAH' : 'SCROLL TO EXPLORE'} ↓</a></div>
      </section>

      <section id="manifesto" className="creator-manifesto">
        <div className="creator-manifesto-label"><span>01 / THE IDEA</span><span>↘</span></div>
        <div><p className="creator-overline">{id ? 'KURASI, BUKAN KATALOG' : 'CURATION, NOT A CATALOG'}</p><h2>{id ? <>Orang datang karena <i>seleramu.</i><br/>Bukan karena seratus tombol beli.</> : <>They come for <i>your taste.</i><br/>Not a hundred buy buttons.</>}</h2><p>{id ? 'Beri konteks pada setiap rekomendasi. Satukan produk yang saling melengkapi. Biar audiens tahu kenapa sesuatu layak dipilih.' : 'Give each recommendation a point of view. Bring complementary products together. Show your audience why something is worth choosing.'}</p></div>
      </section>

      <section className="creator-showcase" aria-labelledby="creator-showcase-title">
        <div className="creator-showcase-head"><span>02 / IN PRACTICE</span><h2 id="creator-showcase-title">{id ? <>Satu unggahan.<br/><em>Satu tujuan.</em></> : <>One post.<br/><em>One destination.</em></>}</h2><p>{id ? 'Contoh perjalanan dari caption Instagram menuju pilihan produk yang tepat.' : 'An example of the journey from an Instagram caption to the right product.'}</p></div>
        <div className="creator-story-grid">
          <article className="creator-story creator-story-social"><div className="creator-story-top"><span>01 / SOCIAL POST</span><span>↗</span></div><div className="creator-story-visual"><span className="creator-story-sun"/><span className="creator-story-horizon"/><strong>OFF<br/>DUTY.</strong><small>SUMMER EDIT — 03</small></div><div className="creator-story-caption"><strong>@studio.sore</strong><p>{id ? 'Set main ke pantai sudah aku kumpulin. Cari “Etalase 3” atau kode PRD-003 di link bio ☀' : 'My beach-day picks are all together. Search “Showcase 3” or PRD-003 in my bio ☀'}</p></div></article>
          <div className="creator-story-arrow" aria-hidden="true">↗</div>
          <article className="creator-story creator-story-store"><div className="creator-story-top"><span>02 / CREATOR STOREFRONT</span><span>nanti.</span></div><div className="creator-story-store-inner"><span className="creator-store-kicker">STUDIO SORE / CURATED FINDS</span><h3>{id ? 'Temukan yang kamu lihat.' : 'Find what caught your eye.'}</h3><div className="creator-store-search"><span aria-hidden="true">⌕</span><span>Etalase 3</span><span>↵</span></div><div className="creator-store-results"><span>{id ? 'HASIL PENCARIAN' : 'SEARCH RESULTS'}</span><strong>03 / {id ? 'SET MAIN KE PANTAI' : 'BEACH DAY EDIT'}</strong></div><div className="creator-store-products"><div><span className="creator-product-art creator-product-one">✳</span><small>PRD-003</small><strong>{id ? 'Pilihan pantai' : 'Beach essential'}</strong></div><div><span className="creator-product-art creator-product-two">◒</span><small>PRD-004</small><strong>{id ? 'Pelengkap gaya' : 'The finishing touch'}</strong></div></div></div><a href="/creator/demo">{id ? 'Jelajahi demo sebenarnya' : 'Explore the actual demo'} ↗</a></article>
        </div>
        <p className="creator-showcase-note">{id ? '* Ilustrasi alur penggunaan. Konten dan produk masih contoh; publikasi kreator belum tersedia.' : '* Illustrative journey. Content and products are samples; creator publishing is not yet available.'}</p>
      </section>

      <section id="cara-kerja" className="creator-process">
        <div className="creator-process-title"><span>03 / THE PROCESS</span><h2>{id ? <>Pilih.<br/>Susun.<br/><em>Bagikan.</em></> : <>Pick.<br/>Arrange.<br/><em>Share.</em></>}</h2></div>
        <div className="creator-process-list">
          <article><span>01</span><div><h3>{id ? 'Temukan barangnya' : 'Find your picks'}</h3><p>{id ? 'Kumpulkan produk yang benar-benar ingin kamu rekomendasikan.' : 'Gather products you genuinely want to recommend.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>02</span><div><h3>{id ? 'Beri sudut pandang' : 'Give them a point of view'}</h3><p>{id ? 'Buat koleksi berdasarkan cerita, suasana, atau kebutuhan.' : 'Build collections around stories, moods, or needs.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>03</span><div><h3>{id ? 'Biar mudah ditemukan' : 'Make them easy to find'}</h3><p>{id ? 'Audiens mencari nama koleksi, nomor etalase, atau kode produk.' : 'Your audience searches by collection name, showcase number, or product code.'}</p></div><span aria-hidden="true">↗</span></article>
        </div>
      </section>

      <section className="creator-end"><span>04 / YOUR SPACE</span><h2>{id ? <>Link boleh sama.<br/><em>Rasa jangan.</em></> : <>Same links.<br/><em>Different taste.</em></>}</h2><p>{id ? 'Coba bentuk halaman yang terasa seperti kamu. Design Studio tersedia sebagai sandbox; fitur publikasi dan afiliasi masih dikembangkan.' : 'Shape a page that feels like you. Design Studio is available as a sandbox; publishing and affiliate features are still in development.'}</p><div><a className="creator-primary" href="/creator/studio">{id ? 'Masuk Design Studio' : 'Enter Design Studio'} ↗</a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat etalase demo' : 'View demo storefront'} ↗</a></div></section>
    </main>
    <footer className="creator-footer"><span>nanti<span className="creator-purple">.</span> creator</span><span>© 2026 NANTI / {id ? 'MASIH DALAM PENGEMBANGAN' : 'WORK IN PROGRESS'}</span><a href="/">{id ? 'KEMBALI KE NANTI' : 'BACK TO NANTI'} ↗</a></footer>
  </div>;
}
