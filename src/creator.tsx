import { useEffect, useRef, useState } from 'react';
import { useLocale } from './locale.js';
import { CreatorStorefront, studioSoreExample } from './creator-storefront.js';
import './creator.css';

export function CreatorLanding() {
  const { language, setLanguage, t } = useLocale();
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

  useEffect(() => {
    if (!coffeeOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCoffeeOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [coffeeOpen]);

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
          <div className="creator-hero-bottom"><p>{id ? 'Pernah ditanya, “Kak, link bajunya mana?” berkali-kali? Taruh semua rekomendasimu di satu tempat. Biar yang lihat kontenmu tinggal cari, bukan scroll chat.' : 'Keep your affiliate product links on one page. Organize them into collections so followers can find products from your Instagram posts without opening links one by one.'}</p><div className="creator-hero-actions"><a className="creator-primary" href="/creator?onboard=1">{id ? 'Buat Nanti Creator' : 'Become a Nanti Creator'} <span aria-hidden="true">↗</span></a><a className="creator-secondary" href="/creator/demo">{id ? 'Intip contohnya' : 'View sample storefront'} <span aria-hidden="true">↗</span></a></div></div>
        </div>
        <div className="creator-hero-index" aria-hidden="true">n<span>.</span></div>
        <div className="creator-hero-footer"><span>{id ? 'Masih dirancang, tapi sudah bisa dicoba.' : 'A work in progress you can already try.'}</span><a href="#manifesto">{id ? 'Lihat caranya' : 'See how it works'} ↓</a></div>
      </section>

      <section id="manifesto" className="creator-manifesto" data-reveal>
        
        <div><h2>{id ? <>Satu konten.<br/><i>Banyak yang nanya.</i><br/>Satu jawaban.</> : <>One post.<br/><i>Many products.</i><br/>Easy to find.</>}</h2><p>{id ? 'Kamu tinggal bilang, “Cari Set Main ke Pantai di link bio, ya.” Mereka bisa langsung nemuin barangnya tanpa harus tanya satu-satu.' : 'Sharing a vacation outfit? Put every item in one collection and add the collection name or product code to your caption. Followers can search your storefront directly.'}</p></div>
      </section>

      <section className="creator-showcase" aria-labelledby="creator-showcase-title" data-reveal>
        <div className="creator-showcase-head"><h2 id="creator-showcase-title">{t('From Instagram to Nanti')}</h2></div>
        <CreatorJourney id={id} />
        <p className="creator-showcase-note">{t('Fictional creator and sample products.')}</p>
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
      <section className="creator-end" data-reveal><h2>{id ? <>Biar link-nya rapi.<br/><em>Yang nanya juga happy.</em></> : <>Organized links.<br/><em>Easy to find.</em></>}</h2><p>{id ? 'Tambahkan produk, atur tampilan, lalu bagikan tautan etalasemu.' : 'Add products, style your storefront, and share your link.'}</p><div><a className="creator-primary" href="/creator?onboard=1">{id ? 'Buat Nanti Creator' : 'Become a Nanti Creator'} ↗</a><a className="creator-secondary" href="/creator/demo">{id ? 'Lihat etalase demo' : 'View demo storefront'} ↗</a></div></section>
    </main>
    {coffeeOpen && <div className="creator-coffee-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCoffeeOpen(false); }}><section className="creator-coffee-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-coffee-title"><button type="button" className="creator-coffee-close" onClick={() => setCoffeeOpen(false)} aria-label={id ? 'Tutup jendela traktir kopi' : 'Close coffee support dialog'} title={id ? 'Tutup' : 'Close'}><span aria-hidden="true">×</span></button><span className="creator-free-tag">{id ? 'DUKUNGAN SUKARELA' : 'OPTIONAL SUPPORT'}</span><h2 id="creator-coffee-title">{id ? 'Mau traktir kopi?' : 'Coffee for the developer?'}</h2><p>{id ? 'Makasih sudah mencoba Nanti. Dukungan ini sepenuhnya opsional dan tidak memengaruhi fitur gratis.' : 'Thanks for trying Nanti. Supporting is completely optional and does not affect free features.'}</p><div className="creator-coffee-methods"><div className="creator-coffee-method"><span className="creator-coffee-method-icon" aria-hidden="true">▦</span><div><strong>QRIS</strong><p>{id ? 'Bayar dengan nominal pilihanmu.' : 'Choose any amount to contribute.'}</p></div><span className="creator-coffee-unavailable">{id ? 'Segera hadir' : 'Coming soon'}</span></div><div className="creator-coffee-method"><span className="creator-coffee-method-icon" aria-hidden="true">↗</span><div><strong>{id ? 'Buka link sponsor' : 'Visit a sponsor link'}</strong><p>{id ? 'Dukung tanpa mengeluarkan uang.' : 'Support without spending money.'}</p></div><span className="creator-coffee-unavailable">{id ? 'Segera hadir' : 'Coming soon'}</span></div></div><button type="button" className="creator-coffee-dismiss" onClick={() => setCoffeeOpen(false)}>{id ? 'Nanti saja' : 'Maybe later'}</button></section></div>}
    <footer className="creator-footer"><span>nanti<span className="creator-purple">.</span> creator</span><span>© 2026 NANTI / {id ? 'MASIH DALAM PENGEMBANGAN' : 'WORK IN PROGRESS'}</span><a href="/">{id ? 'KEMBALI KE NANTI' : 'BACK TO NANTI'} ↗</a></footer>
  </div>;
}


const postIconPaths = {
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  comment: 'M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.6-.3-3.7-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 20.5 11.5Z',
  send: 'm22 2-7.5 20-4.1-8.4L2 9.5 22 2ZM10.4 13.6 22 2',
  bookmark: 'M5 3h14v18l-7-5-7 5V3Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  link: 'M10 13a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 4.3l-1.5 1.5m2.5 5.2a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7l1.5-1.5',
};

function PostIcon({ name, size }: { name: keyof typeof postIconPaths; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={postIconPaths[name]} />
  </svg>;
}

function CreatorJourney({ id }: { id: boolean }) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const focusStage = useRef(false);
  const labels = [t('See the post'), t('Open the profile'), t('Search the storefront')];
  useEffect(() => {
    if (!focusStage.current) return;
    focusStage.current = false;
    const target = step === 3 ? 'input[type="search"]' : step === 2 ? 'h3' : '.creator-post-account';
    stage.current?.querySelector<HTMLElement>(target)?.focus();
  }, [step]);

  const go = (next: 1 | 2 | 3, moveFocus = false) => {
    focusStage.current = moveFocus;
    setStep(next);
  };

  return <div className="creator-post-journey">
    <nav className="creator-stepper" aria-label={id ? 'Langkah simulasi' : 'Demo steps'}>
      {([1, 2, 3] as const).map(number => (
        <button type="button" key={number} aria-current={step === number ? 'step' : undefined}
          aria-label={`${number}. ${labels[number - 1]}`} onClick={() => go(number)}>
          <span aria-hidden="true">{number}</span>{labels[number - 1]}
        </button>
      ))}
    </nav>
    <div className="creator-journey-stage" ref={stage} key={step}>
      {step === 1 && <article className="creator-instagram-post" aria-label={id ? 'Contoh postingan Instagram' : 'Example Instagram post'}>
        <header className="creator-post-header">
          <button className="creator-post-account" type="button" onClick={() => go(2, true)}>
            <span className="creator-post-avatar" aria-hidden="true">S.</span><strong>studio.sore</strong>
          </button>
          <span className="creator-social-label">{t('Simulation')}</span>
        </header>
        <img className="creator-post-photo" src={studioSoreExample.photo} alt={id ? 'Sepatu merah dari etalase Studio Sore' : 'Red sneakers from the Studio Sore storefront'} width="640" height="640" loading="lazy" decoding="async" />
        <div className="creator-post-engagement">
          <button type="button" aria-label={t('Like')} aria-pressed={liked} onClick={() => setLiked(value => !value)}><PostIcon name="heart" size={22} /></button>
          <button type="button" aria-label={t('Comment')} disabled><PostIcon name="comment" size={22} /></button>
          <button type="button" aria-label={t('Share')} disabled><PostIcon name="send" size={22} /></button>
          <button type="button" aria-label={t('Save post')} aria-pressed={saved} onClick={() => setSaved(value => !value)}><PostIcon name="bookmark" size={22} /></button>
        </div>
        <p className="creator-post-caption"><strong>studio.sore</strong> {t('Red sneakers for a Sunday walk. I’ve linked them in my bio.')}</p>
      </article>}
      {step === 2 && <section className="creator-instagram-profile" aria-labelledby="creator-walkthrough-profile">
        <header className="creator-profile-header">
          <button type="button" aria-label={t('Back to post')} onClick={() => go(1, true)}><PostIcon name="back" size={20} /></button>
          <h3 id="creator-walkthrough-profile" tabIndex={-1}>studio.sore</h3>
          <span className="creator-social-label">{t('Simulation')}</span>
        </header>
        <div className="creator-profile-body">
          <div className="creator-profile-identity">
            <span className="creator-post-avatar creator-profile-ring" aria-hidden="true">S.</span>
            <dl className="creator-profile-stats">
              <div><dt>{t('Posts')}</dt><dd>1</dd></div>
              <div><dt>{t('Followers')}</dt><dd>0</dd></div>
              <div><dt>{t('Following')}</dt><dd>0</dd></div>
            </dl>
          </div>
          <div className="creator-profile-bio">
            <strong>Studio Sore</strong>
            <p className="creator-profile-category">{t('Digital creator')}</p>
            <p>{t('Everyday outfits and the pieces you ask me about.')}</p>
            <a className="creator-profile-link" href="/creator/demo" aria-label={`Nanti / Studio Sore · ${t('Open bio link')}`} onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              go(3, true);
            }}><PostIcon name="link" size={17} /><span>Nanti / Studio Sore</span></a>
          </div>
        </div>
      </section>}
      {step === 3 && <>
        <CreatorStorefront walkthrough />
        <a className="creator-journey-store-link" href="/creator/demo">{t('Open demo storefront')} <PostIcon name="arrow" size={16} /></a>
      </>}
    </div>
  </div>;
}
