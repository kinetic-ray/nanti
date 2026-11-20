import { useEffect, useState } from 'react';
import { useLocale } from './locale.js';
import './creator.css';

export function CreatorLanding() {
  const { language, setLanguage } = useLocale();
  const id = language === 'id';
  const [coffeeOpen, setCoffeeOpen] = useState(false);
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

      <section className="creator-free-support" aria-labelledby="creator-free-title" data-reveal>
        <div className="creator-free-support-copy"><span className="creator-free-tag">FREE PLAN</span><h2 id="creator-free-title">{id ? 'Mulai gratis. Berkarya sesukamu.' : 'Start free. Create your way.'}</h2><p>{id ? 'Nanti bisa dicoba tanpa harus traktir siapa pun. Kalau suatu hari kamu merasa terbantu, boleh dukung pengembangnya.' : 'Try Nanti without paying or tipping. If it helps, you can support the developer voluntarily.'}</p></div>
        <button type="button" className="creator-coffee-trigger" onClick={() => setCoffeeOpen(true)}><span aria-hidden="true">☕</span> {id ? 'Traktir kopi developer' : 'Buy the developer a coffee'} <span aria-hidden="true">↗</span></button>
      </section>
      <section className="creator-end" data-reveal><h2>{id ? <>Biar link-nya rapi.<br/><em>Yang nanya juga happy.</em></> : <>Organized links.<br/><em>Easy to find.</em></>}</h2><p>{id ? 'Penasaran kalau etalasemu punya gaya sendiri? Coba utak-atik tampilannya dulu. Ini masih demo — belum bisa terbitkan halaman atau sambungkan afiliasi.' : 'Try arranging your storefront in Design Studio. This is still a preview; publishing and affiliate integrations are not available yet.'}</p><div><a className="creator-primary" href="/creator/studio">{id ? 'Coba Design Studio' : 'Enter Design Studio'} ↗</a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat etalase demo' : 'View demo storefront'} ↗</a></div></section>
    </main>
    {coffeeOpen && <div className="creator-coffee-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCoffeeOpen(false); }}><section className="creator-coffee-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-coffee-title"><button type="button" className="creator-coffee-close" onClick={() => setCoffeeOpen(false)} aria-label={id ? 'Tutup' : 'Close'}>×</button><span className="creator-free-tag">{id ? 'DUKUNGAN SUKARELA' : 'OPTIONAL SUPPORT'}</span><h2 id="creator-coffee-title">{id ? 'Mau traktir kopi?' : 'Coffee for the developer?'}</h2><p>{id ? 'Makasih sudah mencoba Nanti. Dukungan ini sepenuhnya opsional dan tidak memengaruhi fitur gratis.' : 'Thanks for trying Nanti. Supporting is completely optional and does not affect free features.'}</p><div className="creator-coffee-methods"><div className="creator-coffee-method"><span className="creator-coffee-method-icon" aria-hidden="true">▦</span><div><strong>QRIS</strong><p>{id ? 'Bayar dengan nominal pilihanmu.' : 'Choose any amount to contribute.'}</p></div><span className="creator-coffee-unavailable">{id ? 'Segera hadir' : 'Coming soon'}</span></div><div className="creator-coffee-method"><span className="creator-coffee-method-icon" aria-hidden="true">↗</span><div><strong>{id ? 'Buka link sponsor' : 'Visit a sponsor link'}</strong><p>{id ? 'Dukung tanpa mengeluarkan uang.' : 'Support without spending money.'}</p></div><span className="creator-coffee-unavailable">{id ? 'Segera hadir' : 'Coming soon'}</span></div></div><button type="button" className="creator-coffee-dismiss" onClick={() => setCoffeeOpen(false)}>{id ? 'Nanti saja' : 'Maybe later'}</button></section></div>}
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('PRD-003');
  const [error, setError] = useState(false);
  const labels = id ? ['Lihat postingan', 'Cari produk', 'Produk ditemukan'] : ['See the post', 'Search product', 'Product found'];
  const go = (next: 1 | 2 | 3) => { setStep(next); setError(false); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim().toUpperCase() === 'PRD-003') go(3);
    else setError(true);
  };
  return <div className="creator-journey creator-post-journey" data-reveal>
    <div className="creator-journey-intro">
      <span className="creator-journey-eyebrow">{id ? 'DARI INSTAGRAM KE NANTI' : 'FROM INSTAGRAM TO NANTI'}</span>
      <h3>{id ? 'Lihat postingannya. Temukan barangnya.' : 'See the post. Find the product.'}</h3>
      <p>{id ? 'Coba sendiri bagaimana followers menemukan barang dari postingan kreator.' : 'See how followers find products from a creator post.'}</p>
      <nav className="creator-stepper" aria-label={id ? 'Langkah simulasi' : 'Demo steps'}>
        {labels.map((label, index) => {
          const number = (index + 1) as 1 | 2 | 3;
          return <button type="button" key={number} className={step === number ? 'is-active' : step > number ? 'is-complete' : ''} aria-current={step === number ? 'step' : undefined} aria-label={`${number}. ${label}`} onClick={() => go(number)}><span>{number}</span><small>{label}</small></button>;
        })}
      </nav>
      <div className="creator-journey-help" aria-live="polite"><strong>{String(step).padStart(2, '0')} / {labels[step - 1]}</strong><p>{step === 1 ? (id ? 'Lihat kode PRD-003 di caption, lalu lanjut ke etalase.' : 'Find PRD-003 in the caption, then open the storefront.') : step === 2 ? (id ? 'Ketik PRD-003 dan tekan Cari.' : 'Enter PRD-003 and press Search.') : (id ? 'Sepatunya ketemu! Ini contoh hasil pencarian di Nanti.' : 'Found the shoes! This is a sample Nanti search result.')}</p></div>
      <div className="creator-post-actions"><button type="button" className="creator-post-main-cta" onClick={() => go(step === 3 ? 1 : (step + 1) as 2 | 3)}>{step === 1 ? (id ? 'Buka link di bio' : 'Open bio link') : step === 2 ? (id ? 'Lihat contoh hasil' : 'Preview result') : (id ? 'Ulangi simulasi' : 'Replay demo')} <PostIcon name="arrow" size={18}/></button></div>
    </div>
    <div className="creator-post-preview" aria-label={id ? 'Simulasi Instagram dan etalase Nanti' : 'Instagram and Nanti demo'}>
      <div className="creator-post-viewport" key={step}>
        {step === 1 ? <article className="creator-instagram-post" aria-label={id ? 'Contoh postingan Instagram' : 'Sample Instagram post'}>
          <header className="creator-post-header"><div className="creator-post-avatar"><span>s.</span></div><div className="creator-post-account"><div><strong>studio.sore</strong><PostIcon name="verified" size={17}/></div><span>{id ? 'Rekomendasi outfit' : 'Outfit recommendations'}</span></div><span className="creator-post-more"><PostIcon name="more" size={22}/></span></header>
          <div className="creator-post-media" role="img" aria-label={id ? 'Ilustrasi editorial outfit musim panas' : 'Summer outfit editorial illustration'}><span className="creator-post-media-sun"/><span className="creator-post-media-arc"/><div className="creator-post-media-copy"><small>STUDIO.SORE — SUMMER / 03</small><strong>OFF<br/>DUTY.</strong><span>THE WEEKEND EDIT</span></div></div>
          <div className="creator-post-dots" aria-label={id ? 'Slide 1 dari 3' : 'Slide 1 of 3'}><i className="active"/><i/><i/></div>
          <div className="creator-post-engagement"><span><PostIcon name="heart" size={29}/><b>37.3K</b></span><span><PostIcon name="comment" size={29}/><b>649</b></span><span><PostIcon name="repost" size={29}/><b>1,312</b></span><span><PostIcon name="send" size={29}/><b>14K</b></span><span className="creator-post-save"><PostIcon name="bookmark" size={29}/></span></div>
          <p className="creator-post-caption"><strong>studio.sore</strong> {id ? 'Outfit pantai kemarin ☀ Semua detail ada di link bio. Cari kode ' : 'Weekend outfit ☀ Everything is in my bio link. Search for '}<b>PRD-003</b>.</p>
          <p className="creator-post-time">{id ? '12 jam yang lalu' : '12 hours ago'}</p>
        </article> : <div className="creator-post-store"><div className="creator-post-store-bar"><button type="button" onClick={() => go(1)} aria-label={id ? 'Kembali ke Instagram' : 'Back to Instagram'}><PostIcon name="back" size={22}/></button><span>nanti.id/@studio.sore</span><span>•••</span></div><div className="creator-post-store-logo">nanti<span>.</span></div><div className="creator-post-store-body"><span className="creator-journey-eyebrow">STUDIO.SORE / STOREFRONT</span><h4>{id ? 'Yang kamu cari, ada di sini.' : 'Find what caught your eye.'}</h4><p>{id ? 'Cari kode barang dari caption Instagram.' : 'Search the product code from the Instagram caption.'}</p><form className="creator-product-search" onSubmit={submit}><label className="sr-only" htmlFor="creator-post-product-code">{id ? 'Kode produk' : 'Product code'}</label><input id="creator-post-product-code" type="text" autoComplete="off" spellCheck={false} value={query} onChange={event => { setQuery(event.target.value); setError(false); if (step === 3) setStep(2); }} placeholder="PRD-003"/><button type="submit">{id ? 'Cari' : 'Search'}</button></form>{error && <p className="creator-post-store-hint" role="alert">{id ? 'Kode tidak ditemukan. Coba PRD-003.' : 'Code not found. Try PRD-003.'}</p>}{step === 3 ? <div className="creator-post-result" role="status"><small>{id ? 'PRODUK DITEMUKAN' : 'PRODUCT FOUND'}</small><div><img src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=320&auto=format&fit=crop&q=80" alt={id ? 'Sepatu sneaker merah' : 'Red sneaker shoe'} loading="lazy"/><section><strong>{id ? 'Sneakers — Summer Edit' : 'Sneakers — Summer Edit'}</strong><p>{id ? 'PRD-003 · Dari postingan OFF DUTY.' : 'PRD-003 · From the OFF DUTY. post'}</p></section></div></div> : <p className="creator-post-store-hint">{id ? 'Contoh kode: PRD-003' : 'Example code: PRD-003'}</p>}</div></div>}
      </div>
    </div>
  </div>;
}
