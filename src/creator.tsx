import { useEffect, useState } from 'react';
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
        <div className="creator-showcase-head"><h2 id="creator-showcase-title">{id ? <>Dari caption.<br/><em>Ketemu barangnya.</em></> : <>From caption.<br/><em>To the right product.</em></>}</h2><p>{id ? 'Lihat contoh postingan Instagram, lalu buka etalase Nanti untuk mencari barang dari caption.' : 'Followers see a product code on Instagram, enter it in search, and find the item they came for.'}</p></div>
        <CreatorJourney id={id} />
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


type PostIconName = 'heart' | 'comment' | 'repost' | 'send' | 'bookmark' | 'more' | 'verified' | 'arrow' | 'back';
function PostIcon({ name, size = 24 }: { name: PostIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (name === 'verified') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="#3897f0" d="m12 1.5 2.4 1.4 2.8-.1 1.4 2.4 2.4 1.4-.1 2.8 1.4 2.4-1.4 2.4.1 2.8-2.4 1.4-1.4 2.4-2.8-.1-2.4 1.4-2.4-1.4-2.8.1-1.4-2.4-2.4-1.4.1-2.8-1.4-2.4 1.4-2.4-.1-2.8 2.4-1.4 1.4-2.4 2.8.1z"/><path d="m8 12 2.5 2.5L16 9" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  return <svg {...common}>{name === 'heart' ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/> : name === 'comment' ? <path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.6-.3-3.7-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 20.5 11.5Z"/> : name === 'repost' ? <><path d="M4 7h13l-3-3m3 3-3 3M20 17H7l3 3m-3-3 3-3"/><path d="M20 12v5M4 12V7"/></> : name === 'send' ? <path d="m22 2-7.5 20-4.1-8.4L2 9.5 22 2ZM10.4 13.6 22 2"/> : name === 'bookmark' ? <path d="M5 3h14v18l-7-5-7 5V3Z"/> : name === 'more' ? <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></> : name === 'back' ? <path d="m14 5-7 7 7 7"/> : <path d="M5 12h14m-6-6 6 6-6 6"/>}</svg>;
}
function CreatorJourney({ id }: { id: boolean }) {
  const [view, setView] = useState<'post' | 'store'>('post');
  const [query, setQuery] = useState('PRD-003');
  const [searched, setSearched] = useState(false);
  const found = searched && query.trim().toUpperCase() === 'PRD-003';
  return <div className="creator-journey creator-post-journey" data-reveal>
    <div className="creator-journey-intro">
      <span className="creator-journey-eyebrow">{id ? 'DARI INSTAGRAM KE NANTI' : 'FROM INSTAGRAM TO NANTI'}</span>
      <h3>{id ? 'Lihat postingannya. Temukan barangnya.' : 'See the post. Find the product.'}</h3>
      <p>{id ? 'Contoh sederhana bagaimana followers menemukan rekomendasimu tanpa harus bertanya di komentar.' : 'A simple example of how followers find your picks without asking in the comments.'}</p>
      <div className="creator-journey-help" aria-live="polite"><strong>{view === 'post' ? (id ? '01 / Lihat postingan' : '01 / See the post') : (id ? '02 / Cari di Nanti' : '02 / Search on Nanti')}</strong><p>{view === 'post' ? (id ? 'Baca kode PRD-003 di caption, lalu buka link bio lewat tombol di bawah postingan.' : 'Find PRD-003 in the caption, then use the bio-link button below the post.') : (id ? 'Tekan Cari untuk menemukan produk dengan kode PRD-003.' : 'Press Search to find product PRD-003.')}</p></div>
      <div className="creator-post-actions"><button type="button" className="creator-post-main-cta" onClick={() => { if (view === 'post') { setView('store'); setSearched(false); } else { setView('post'); setQuery('PRD-003'); setSearched(false); } }}>{view === 'post' ? (id ? 'Buka link di bio' : 'Open link in bio') : (id ? 'Kembali ke postingan' : 'Back to post')} <PostIcon name={view === 'post' ? 'arrow' : 'back'} size={18}/></button><span>{id ? 'Simulasi interaktif' : 'Interactive preview'}</span></div>
    </div>
    <div className="creator-post-preview" aria-label={id ? 'Simulasi postingan Instagram dan etalase Nanti' : 'Instagram post and Nanti storefront simulation'}>
      <div className="creator-post-viewport" key={view}>
        {view === 'post' ? <article className="creator-instagram-post" aria-label={id ? 'Contoh postingan Instagram' : 'Sample Instagram post'}>
          <header className="creator-post-header"><div className="creator-post-avatar"><span>s.</span></div><div className="creator-post-account"><div><strong>studio.sore</strong><PostIcon name="verified" size={17}/></div><span>{id ? 'Rekomendasi outfit' : 'Outfit recommendations'}</span></div><span className="creator-post-more"><PostIcon name="more" size={22}/></span></header>
          <div className="creator-post-media" role="img" aria-label={id ? 'Ilustrasi editorial outfit musim panas' : 'Summer outfit editorial illustration'}><span className="creator-post-media-sun"/><span className="creator-post-media-arc"/><div className="creator-post-media-copy"><small>STUDIO.SORE — SUMMER / 03</small><strong>OFF<br/>DUTY.</strong><span>THE WEEKEND EDIT</span></div></div>
          <div className="creator-post-dots" aria-label={id ? 'Slide 1 dari 3' : 'Slide 1 of 3'}><i className="active"/><i/><i/></div>
          <div className="creator-post-engagement"><span><PostIcon name="heart" size={29}/><b>37.3K</b></span><span><PostIcon name="comment" size={29}/><b>649</b></span><span><PostIcon name="repost" size={29}/><b>1,312</b></span><span><PostIcon name="send" size={29}/><b>14K</b></span><span className="creator-post-save"><PostIcon name="bookmark" size={29}/></span></div>
          <p className="creator-post-caption"><strong>studio.sore</strong> {id ? 'Outfit pantai kemarin ☀ Semua detail ada di link bio. Cari kode ' : 'Weekend outfit ☀ Everything is in my bio link. Search for '}<b>PRD-003</b>.</p>
          <p className="creator-post-time">{id ? '12 jam yang lalu' : '12 hours ago'}</p>
        </article> : <div className="creator-post-store"><div className="creator-post-store-bar"><button type="button" onClick={() => setView('post')} aria-label={id ? 'Kembali ke Instagram' : 'Back to Instagram'}><PostIcon name="back" size={22}/></button><span>nanti.id/@studio.sore</span><span>•••</span></div><div className="creator-post-store-logo">nanti<span>.</span></div><div className="creator-post-store-body"><span className="creator-journey-eyebrow">STUDIO.SORE / STOREFRONT</span><h4>{id ? 'Yang kamu cari, ada di sini.' : 'Find what caught your eye.'}</h4><p>{id ? 'Cari kode barang dari caption Instagram.' : 'Search the product code from the Instagram caption.'}</p><form onSubmit={event => { event.preventDefault(); setSearched(true); }}><label className="sr-only" htmlFor="creator-post-product-code">{id ? 'Kode produk' : 'Product code'}</label><input id="creator-post-product-code" value={query} onChange={event => { setQuery(event.target.value); setSearched(false); }} placeholder="PRD-003"/><button type="submit">{id ? 'Cari' : 'Search'}</button></form>{found ? <div className="creator-post-result" role="status"><small>{id ? 'PRODUK DITEMUKAN' : 'PRODUCT FOUND'}</small><div><span>03</span><section><strong>{id ? 'Summer Edit — Item 03' : 'Summer Edit — Item 03'}</strong><p>{id ? 'Dari postingan OFF DUTY.' : 'From the OFF DUTY. post'}</p></section></div></div> : <p className="creator-post-store-hint" role="status">{searched ? (id ? 'Kode tidak ditemukan dalam demo. Coba PRD-003.' : 'Code not found in this demo. Try PRD-003.') : (id ? 'Contoh kode: PRD-003' : 'Example code: PRD-003')}</p>}</div></div>}
      </div>
    </div>
  </div>;
}
