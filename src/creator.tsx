import { useEffect } from 'react';
import { useLocale } from './locale.js';
import './creator.css';

export function CreatorLanding() {
  const { language, setLanguage } = useLocale();
  const id = language === 'id';
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('.creator-page [data-reveal]');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach(node => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return <div className="creator-page">
    <header className="creator-header">
      <a className="creator-logo" href="/" aria-label="Nanti home">nanti<span>.</span><small>CREATOR</small></a>
      <nav aria-label={id ? 'Navigasi kreator' : 'Creator navigation'}><a href="#manifesto">{id ? 'Tentang' : 'About'}</a><a href="#cara-kerja">{id ? 'Cara kerja' : 'How it works'}</a><a href="/creator/demo">{id ? 'Etalase contoh' : 'Sample storefront'}</a></nav>
      <div className="creator-header-actions"><button className="creator-language-toggle" type="button" onClick={() => setLanguage(id ? 'en' : 'id')} aria-label={id ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'} title={id ? 'English' : 'Bahasa Indonesia'}>{id ? 'EN' : 'ID'}</button><a className="creator-back" href="/">{id ? 'Ke Nanti' : 'Open Nanti'} <span aria-hidden="true">↗</span></a></div>
    </header>
    <main>
      <section className="creator-hero" aria-labelledby="creator-title">
        <div className="creator-hero-copy">
          <h1 id="creator-title">{id ? <>Semua link.<br/><em>Satu etalase</em><span className="creator-period">.</span></> : <>Every link.<br/><em>One storefront</em><span className="creator-period">.</span></>}</h1>
          <div className="creator-hero-bottom"><p>{id ? 'Pernah ditanya, “Kak, link bajunya mana?” berkali-kali? Taruh semua rekomendasimu di satu tempat. Biar yang lihat kontenmu tinggal cari, bukan scroll chat.' : 'Keep your affiliate product links on one page. Organize them into collections so followers can find products from your Instagram posts without opening links one by one.'}</p><div className="creator-hero-actions"><a className="creator-primary" href="/creator/studio">{id ? 'Coba bikin etalase' : 'Design your storefront'} <span aria-hidden="true">↗</span></a><a className="creator-secondary" href="/creator/demo">{id ? 'Intip contohnya' : 'View sample storefront'} <span aria-hidden="true">↗</span></a></div></div>
        </div>
        <div className="creator-hero-index" aria-hidden="true">n<span>.</span></div>
        <div className="creator-hero-footer"><span>{id ? 'Masih dirancang, tapi sudah bisa dicoba.' : 'A work in progress you can already try.'}</span><a href="#manifesto">{id ? 'Lihat caranya' : 'See how it works'} ↓</a></div>
      </section>

      <section id="manifesto" className="creator-manifesto" data-reveal>
        
        <div><h2>{id ? <>Satu konten.<br/><i>Banyak yang nanya.</i><br/>Satu jawaban.</> : <>One post.<br/><i>Many products.</i><br/>Easy to find.</>}</h2><p>{id ? 'Kamu tinggal bilang, “Cari Set Main ke Pantai di link bio, ya.” Mereka bisa langsung nemuin barangnya tanpa harus tanya satu-satu.' : 'Sharing a vacation outfit? Put every item in one collection and add the collection name or product code to your caption. Followers can search your storefront directly.'}</p></div>
      </section>

      <section className="creator-showcase" aria-labelledby="creator-showcase-title" data-reveal>
        <div className="creator-showcase-head"><h2 id="creator-showcase-title">{id ? <>Dari caption.<br/><em>Ketemu barangnya.</em></> : <>From caption.<br/><em>To the right product.</em></>}</h2><p>{id ? 'Bayangin ada yang lihat postinganmu, suka salah satu barangnya, lalu buka link di bio. Ini alurnya — dari caption sampai barang yang dicari.' : 'Followers see a product code on Instagram, enter it in search, and find the item they came for.'}</p></div>
        <div className="creator-story-grid" data-reveal>
          <article className="creator-story creator-story-social"><div className="creator-story-top"><span>INSTAGRAM</span><span>↗</span></div><div className="creator-story-visual"><span className="creator-story-sun"/><span className="creator-story-horizon"/><strong>OFF<br/>DUTY.</strong><small>SUMMER EDIT — 03</small></div><div className="creator-story-caption"><strong>@studio.sore</strong><p>{id ? 'Banyak yang nanya outfit pantai kemarin ☀ Aku taruh semua di link bio. Ketik “Etalase 3” buat lihat satu setnya, atau cari PRD-003 buat item yang ini.' : 'You asked about my beach outfit ☀ Everything's in my bio. Search “Showcase 3” for the full set, or PRD-003 for that one piece.'}</p></div></article>
          <div className="creator-story-arrow" aria-hidden="true"><span>01</span><span className="creator-story-connector">→</span><span>02</span></div>
          <article className="creator-story creator-story-store"><div className="creator-story-top"><span>{id ? 'LINK DI BIO' : 'LINK IN BIO'}</span><span>nanti.</span></div><div className="creator-story-store-inner"><h3>{id ? 'Yang tadi kamu lihat, ada di sini.' : 'Find what caught your eye.'}</h3><div className="creator-store-search"><span aria-hidden="true">⌕</span><span>Etalase 3</span><span>↵</span></div><div className="creator-store-results"><span>{id ? 'KETEMU NIH' : 'SEARCH RESULTS'}</span><strong>{id ? 'Set Main ke Pantai' : 'BEACH DAY EDIT'}</strong></div><div className="creator-store-products"><div><span className="creator-product-art creator-product-one">✳</span><small>PRD-003</small><strong>{id ? 'Item dari caption' : 'Beach essential'}</strong></div><div><span className="creator-product-art creator-product-two">◒</span><small>PRD-004</small><strong>{id ? 'Buat satu set' : 'The finishing touch'}</strong></div></div></div><a href="/creator/demo">{id ? 'Coba cari sendiri' : 'Explore the actual demo'} ↗</a></article>
        </div>
        <p className="creator-showcase-note">{id ? 'Contoh alur, bukan postingan atau testimoni pengguna sungguhan. Etalase ini masih demo; fitur publikasi belum tersedia.' : '* Illustrative journey. Content and products are samples; creator publishing is not yet available.'}</p>
      </section>

      <section id="cara-kerja" className="creator-process" data-reveal>
        <div className="creator-process-title"><h2>{id ? <>Pilih.<br/>Rapikan.<br/><em>Biar dicari.</em></> : <>Pick.<br/>Arrange.<br/><em>Share.</em></>}</h2></div>
        <div className="creator-process-list">
          <article><span>01</span><div><h3>{id ? 'Pilih yang mau dibagi' : 'Find your picks'}</h3><p>{id ? 'Mulai dari barang yang sering ditanyain orang di kontenmu.' : 'Gather products you genuinely want to recommend.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>02</span><div><h3>{id ? 'Bikin satu koleksi' : 'Give them a point of view'}</h3><p>{id ? 'Misalnya “Set Main ke Pantai”. Biar orang tahu barang-barangnya nyambung.' : 'Build collections around stories, moods, or needs.'}</p></div><span aria-hidden="true">↗</span></article>
          <article><span>03</span><div><h3>{id ? 'Kasih petunjuk di caption' : 'Make them easy to find'}</h3><p>{id ? 'Tulis nama koleksi atau kode barang. Mereka tinggal ketik di etalasemu.' : 'Your audience searches by collection name, showcase number, or product code.'}</p></div><span aria-hidden="true">↗</span></article>
        </div>
      </section>

      <section className="creator-end" data-reveal><h2>{id ? <>Biar link-nya rapi.<br/><em>Yang nanya juga happy.</em></> : <>Organized links.<br/><em>Easy to find.</em></>}</h2><p>{id ? 'Penasaran kalau etalasemu punya gaya sendiri? Coba utak-atik tampilannya dulu. Ini masih demo — belum bisa terbitkan halaman atau sambungkan afiliasi.' : 'Try arranging your storefront in Design Studio. This is still a preview; publishing and affiliate integrations are not available yet.'}</p><div><a className="creator-primary" href="/creator/studio">{id ? 'Coba Design Studio' : 'Enter Design Studio'} ↗</a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat etalase demo' : 'View demo storefront'} ↗</a></div></section>
    </main>
    <footer className="creator-footer"><span>nanti<span className="creator-purple">.</span> creator</span><span>© 2026 NANTI / {id ? 'MASIH DALAM PENGEMBANGAN' : 'WORK IN PROGRESS'}</span><a href="/">{id ? 'KEMBALI KE NANTI' : 'BACK TO NANTI'} ↗</a></footer>
  </div>;
}
