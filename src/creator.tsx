import { useLocale } from './locale.js';
import { LanguagePicker } from './locale.js';
import './creator.css';

export function CreatorLanding() {
  const { language } = useLocale();
  const id = language === 'id';
  return <div className="creator-page">
    <header className="creator-header">
      <a className="creator-logo" href="/" aria-label="Nanti home">nanti<span>.</span><small>kreator</small></a>
      <nav aria-label={id ? 'Navigasi kreator' : 'Creator navigation'}>
        <a href="#cara-kerja">{id ? 'Cara kerja' : 'How it works'}</a>
        <a href="#fitur">{id ? 'Fitur' : 'Features'}</a>
      </nav>
      <div className="creator-header-actions"><LanguagePicker /><a className="creator-back" href="/">{id ? 'Ke Nanti' : 'Back to Nanti'} <span aria-hidden="true">↗</span></a></div>
    </header>
    <main>
      <section className="creator-hero" aria-labelledby="creator-title">
        <div className="creator-hero-copy">
          <span className="creator-eyebrow"><span aria-hidden="true" className="creator-dot" /> {id ? 'SEGERA HADIR · NANTI KREATOR' : 'COMING SOON · NANTI CREATOR'}</span>
          <h1 id="creator-title">{id ? <>Rekomendasi kamu.<br /><em>Satu tempat.</em></> : <>Your picks.<br /><em>One place.</em></>}</h1>
          <p>{id ? 'Kumpulkan produk favorit, susun rekomendasi yang enak dilihat, lalu bagikan satu halaman ke audiensmu.' : 'Collect your favorite products, curate a beautiful list, and share one page with your audience.'}</p>
          <div className="creator-hero-actions">
            <a className="creator-primary" href="#cara-kerja">{id ? 'Lihat konsepnya' : 'Explore the concept'} <span aria-hidden="true">↗</span></a>
            <a className="creator-secondary" href="/account">{id ? 'Akun Nanti' : 'Nanti account'}</a>
          </div>
          <p className="creator-fineprint">{id ? 'Ini pratinjau konsep. Belum tersedia pendaftaran atau publikasi halaman kreator.' : 'This is a concept preview. Creator registration and publishing are not available yet.'}</p>
        </div>
        <div className="creator-preview" aria-label={id ? 'Pratinjau tampilan halaman kreator' : 'Creator page layout preview'}>
          <div className="creator-preview-top"><span className="creator-preview-avatar" aria-hidden="true">n.</span><span className="creator-preview-handle">@yourname</span><span className="creator-preview-menu" aria-hidden="true">•••</span></div>
          <div className="creator-preview-heading">{id ? 'Pilihan favoritku' : 'My favorite finds'}<small>{id ? 'Satu halaman untuk semua rekomendasi.' : 'One page for every recommendation.'}</small></div>
          <div className="creator-preview-tabs"><span>{id ? 'Semua' : 'All'}</span><span>Style</span><span>Desk setup</span></div>
          <div className="creator-preview-grid">
            <div className="creator-preview-card"><div className="creator-preview-art creator-art-one"><span aria-hidden="true">✳</span></div><strong>{id ? 'Pilihan harian' : 'Everyday pick'}</strong><small>{id ? 'Produk contoh' : 'Sample product'}</small></div>
            <div className="creator-preview-card"><div className="creator-preview-art creator-art-two"><span aria-hidden="true">◒</span></div><strong>{id ? 'Favorit minggu ini' : 'Weekly favorite'}</strong><small>{id ? 'Produk contoh' : 'Sample product'}</small></div>
          </div>
          <div className="creator-preview-bottom">{id ? 'Dibuat dengan nanti.' : 'Made with nanti.'} <span>↗</span></div>
        </div>
      </section>
      <section id="cara-kerja" className="creator-section creator-process">
        <div className="creator-section-intro"><span className="creator-kicker">01 / {id ? 'CARA KERJA' : 'HOW IT WORKS'}</span><h2>{id ? 'Dari rekomendasi ke halaman yang bisa dibagikan.' : 'From a recommendation to a shareable page.'}</h2></div>
        <div className="creator-steps">
          <article><span>01</span><h3>{id ? 'Simpan produk' : 'Save products'}</h3><p>{id ? 'Kumpulkan link produk yang ingin kamu rekomendasikan.' : 'Collect the product links you want to recommend.'}</p></article>
          <article><span>02</span><h3>{id ? 'Kurasi pilihan' : 'Curate your picks'}</h3><p>{id ? 'Kelompokkan pilihan berdasarkan tema atau kebutuhan audiens.' : 'Group your picks around themes your audience cares about.'}</p></article>
          <article><span>03</span><h3>{id ? 'Bagikan halaman' : 'Share your page'}</h3><p>{id ? 'Satu link untuk memperkenalkan semua pilihanmu.' : 'One link to introduce all your picks.'}</p></article>
        </div>
      </section>
      <section id="fitur" className="creator-section creator-features">
        <span className="creator-kicker">02 / {id ? 'DALAM RENCANA' : 'ON THE ROADMAP'}</span>
        <h2>{id ? 'Dibuat untuk cara kamu berbagi.' : 'Made for how you share.'}</h2>
        <div className="creator-feature-grid">
          <article><span aria-hidden="true">↗</span><h3>{id ? 'Halaman personal' : 'Personal page'}</h3><p>{id ? 'Identitas dan rekomendasi dalam satu tautan.' : 'Your identity and recommendations in one link.'}</p></article>
          <article><span aria-hidden="true">▦</span><h3>{id ? 'Koleksi tematik' : 'Curated collections'}</h3><p>{id ? 'Susun produk menurut kategori dan cerita.' : 'Organize products by category and story.'}</p></article>
          <article><span aria-hidden="true">◎</span><h3>{id ? 'Tautan afiliasi' : 'Affiliate links'}</h3><p>{id ? 'Rencana dukungan tautan afiliasi sesuai izin platform.' : 'Planned affiliate links subject to platform permissions.'}</p></article>
        </div>
      </section>
      <section className="creator-end"><span className="creator-kicker">{id ? 'MASIH DALAM PENGEMBANGAN' : 'IN DEVELOPMENT'}</span><h2>{id ? 'Pilihan bagus layak punya tempat sendiri.' : 'Good picks deserve their own place.'}</h2><p>{id ? 'Nanti Kreator sedang disiapkan. Sementara itu, kamu bisa menyimpan wishlist di Nanti.' : 'Nanti Creator is being prepared. In the meantime, save your wishlist in Nanti.'}</p><a className="creator-primary" href="/">{id ? 'Buka Nanti' : 'Open Nanti'} <span aria-hidden="true">↗</span></a></section>
    </main>
    <footer className="creator-footer"><span>nanti<span className="creator-purple">.</span> kreator</span><span>© 2026 Nanti · {id ? 'Pratinjau konsep' : 'Concept preview'}</span></footer>
  </div>;
}
