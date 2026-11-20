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
        <div className="creator-showcase-head"><h2 id="creator-showcase-title">{id ? <>Dari caption.<br/><em>Ketemu barangnya.</em></> : <>From caption.<br/><em>To the right product.</em></>}</h2><p>{id ? 'Bayangin ada yang lihat postinganmu, suka salah satu barangnya, lalu buka link di bio. Ini alurnya — dari caption sampai barang yang dicari.' : 'Followers see a product code on Instagram, enter it in search, and find the item they came for.'}</p></div>
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


function CreatorJourney({ id }: { id: boolean }) {
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('PRD-003');
  const stages = id
    ? ['Lihat postingan', 'Buka profil kreator', 'Ketuk link di bio', 'Temukan produknya']
    : ['See the post', 'Open creator profile', 'Tap the bio link', 'Find the product'];
  const advance = () => setStep(current => Math.min(current + 1, 3));
  return <div className="creator-journey" data-reveal>
    <div className="creator-journey-intro">
      <span className="creator-journey-eyebrow">{id ? 'COBA ALURNYA' : 'TRY THE JOURNEY'}</span>
      <h3>{id ? 'Rasain sendiri, dari konten sampai ketemu barang.' : 'See how a post becomes a product find.'}</h3>
      <p>{id ? 'Ketuk bagian yang disorot, seperti yang dilakukan orang saat melihat kontenmu.' : 'Tap the highlighted actions, just like your audience would.'}</p>
      <div className="creator-journey-progress" aria-label={id ? 'Tahapan simulasi' : 'Demo steps'}>
        {stages.map((stage, index) => <button type="button" key={stage} className={index === step ? 'is-current' : index < step ? 'is-done' : ''} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, '0')}</span><span>{stage}</span></button>)}
      </div>
      <div className="creator-journey-help" aria-live="polite"><strong>{stages[step]}</strong><p>{[
        id ? 'Ketuk username studio.sore untuk melihat profilnya.' : 'Tap studio.sore to visit the profile.',
        id ? 'Sekarang ketuk link Nanti di profil.' : 'Now tap the Nanti link in the profile.',
        id ? 'Ketik kode dari caption, lalu tekan Cari.' : 'Enter the code from the caption and search.',
        id ? 'Itu dia! Produk yang dimaksud langsung muncul.' : 'Found it! The product appears right away.'
      ][step]}</p></div>
      <button className="creator-journey-reset" type="button" onClick={() => { setStep(0); setQuery('PRD-003'); }}>{id ? '↺ Ulangi simulasi' : '↺ Replay demo'}</button>
    </div>
    <div className="creator-journey-device" aria-label={id ? 'Simulasi Instagram menuju etalase Nanti' : 'Instagram to Nanti storefront simulation'}>
      <div className="creator-device-status" aria-hidden="true"><span>9:41</span><span>●●● ▰</span></div>
      <div className="creator-device-stage" key={step}>
        {step === 0 && <div className="creator-ig-screen">
          <div className="creator-ig-appbar"><strong>Instagram</strong><span aria-hidden="true">♡　✉</span></div>
          <div className="creator-ig-stories" aria-hidden="true"><span>✦</span><span>◒</span><span>✳</span><span>◈</span></div>
          <button type="button" className="creator-ig-user" onClick={advance} aria-label={id ? 'Buka profil studio.sore' : 'Open studio.sore profile'}><span className="creator-ig-avatar">s.</span><span><strong>studio.sore</strong><small>{id ? 'Konten outfit & rekomendasi' : 'Outfits and daily finds'}</small></span><span className="creator-ig-dots" aria-hidden="true">•••</span></button>
          <div className="creator-ig-post"><span className="creator-story-sun"/><span className="creator-story-horizon"/><strong>OFF<br/>DUTY.</strong><small>SUMMER EDIT — 03</small></div>
          <div className="creator-ig-actions" aria-hidden="true"><span>♡</span><span>▢</span><span>➤</span><span className="creator-ig-bookmark">♧</span></div>
          <p className="creator-ig-caption"><strong>studio.sore</strong> {id ? 'Outfit pantai kemarin ☀ Semua link ada di bio. Cari PRD-003, ya.' : 'Beach outfit ☀ Links in bio. Search PRD-003.'}</p>
          <p className="creator-ig-muted">{id ? 'Lihat semua komentar' : 'View all comments'}</p>
        </div>}
        {step === 1 && <div className="creator-ig-screen creator-ig-profile">
          <div className="creator-ig-profilebar"><button type="button" onClick={() => setStep(0)} aria-label={id ? 'Kembali' : 'Back'}>‹</button><strong>studio.sore</strong><span>☰</span></div>
          <div className="creator-ig-profile-info"><span className="creator-ig-avatar">s.</span><div><strong>24</strong><small>posts</small></div><div><strong>12.4K</strong><small>followers</small></div><div><strong>380</strong><small>following</small></div></div>
          <div className="creator-ig-bio"><strong>studio.sore</strong><p>{id ? 'Outfit harian, rekomendasi, dan semua barang favoritku ✦' : 'Daily outfits, recommendations, and favorite finds ✦'}</p></div>
          <button type="button" className="creator-ig-biolink" onClick={advance}>↗　nanti.id/@studio.sore <span>›</span></button>
          <div className="creator-ig-profile-buttons"><span>{id ? 'Mengikuti' : 'Following'}</span><span>{id ? 'Pesan' : 'Message'}</span></div>
          <div className="creator-ig-profile-tiles" aria-hidden="true"><span>OFF<br/>DUTY.</span><span>SUMMER<br/>EDIT</span><span>DAILY<br/>FINDS</span></div>
        </div>}
        {step >= 2 && <div className="creator-web-screen">
          <div className="creator-browser-bar"><span aria-hidden="true">‹</span><span>⌁　nanti.id/@studio.sore</span><span aria-hidden="true">⋮</span></div>
          <div className="creator-web-brand">nanti<span>.</span></div>
          <div className="creator-web-content"><span className="creator-web-eyebrow">STUDIO.SORE / {id ? 'ETALASE' : 'STOREFRONT'}</span><h4>{id ? 'Yang tadi kamu lihat, ada di sini.' : 'Find what caught your eye.'}</h4>
            <form className="creator-web-search" onSubmit={event => { event.preventDefault(); setStep(3); }}><label htmlFor="creator-journey-search" className="sr-only">{id ? 'Cari kode produk' : 'Search product code'}</label><input id="creator-journey-search" value={query} onChange={event => { setQuery(event.target.value); if (step === 3) setStep(2); }} placeholder={id ? 'Cari kode produk' : 'Search product code'}/><button type="submit">{id ? 'Cari' : 'Search'} ↗</button></form>
            {step === 3 ? <div className="creator-web-result" role="status"><span>{query.trim().toUpperCase() === 'PRD-003' ? (id ? 'PRODUK DITEMUKAN' : 'PRODUCT FOUND') : (id ? 'CONTOH HASIL PENCARIAN' : 'EXAMPLE SEARCH RESULT')}</span><div className="creator-web-result-card"><span aria-hidden="true">✳</span><div><small>PRD-003</small><strong>{id ? 'Item dari Summer Edit' : 'Summer Edit essential'}</strong><p>{id ? 'Dari postingan OFF DUTY.' : 'From the OFF DUTY. post'}</p></div></div></div> : <p className="creator-web-tip">{id ? 'Coba cari kode PRD-003 dari caption Instagram tadi.' : 'Try searching PRD-003 from the Instagram caption.'}</p>}
          </div>
        </div>}
      </div>
      <div className="creator-device-bottom" aria-hidden="true"><span/></div>
    </div>
    <div className="creator-journey-mobile-controls"><button type="button" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0}>{id ? 'Kembali' : 'Back'}</button><button type="button" onClick={() => step === 3 ? setStep(0) : advance()}>{step === 3 ? (id ? 'Ulangi ↺' : 'Replay ↺') : (id ? 'Lanjut →' : 'Next →')}</button></div>
  </div>;
}
