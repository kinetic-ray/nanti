import { useEffect, useRef, useState } from 'react';
import { useLocale } from './locale.js';
import { CreatorStorefront, demoProducts, studioSoreExample } from './creator-storefront.js';
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
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  personAdd: 'M14 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18-13v6m-3-3h6M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18m6-18v18',
  reels: 'M3 8h18v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2M8 3l3 5m3-5 3 5m-7 4 5 3-5 3z',
  tagged: 'M3 5h5l4-3 4 3h5v16H3zM7 21v-1a5 5 0 0 1 10 0v1m-2-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  home: 'm2 10 10-8 10 8m-2-1v12h-5v-7H9v7H4V9',
  search: 'm16 16 5 5m-3-10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  create: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm6 5v8m-4-4h8',
};

const profilePosts = [studioSoreExample, ...demoProducts.filter(product => product.id !== studioSoreExample.id)];
const journeySteps = [1, 2, 3] as const;
const journeyGuidance = {
  1: {
    title: 'Notice a product you like.',
    description: 'Found something you like in a creator’s post? Open their profile to find out more.',
    hint: 'Tap the creator’s name or profile picture.',
  },
  2: {
    title: 'Find the storefront link in the bio.',
    description: 'Creators often use a link in their profile to list the products they’ve shared.',
    hint: 'Tap the Nanti link in the creator’s bio.',
  },
  3: {
    title: 'Find the product on Nanti.',
    description: 'Search by product name or browse categories to find the item you saw.',
    hint: 'Type "sneakers" in the search field.',
  },
} as const;

function PostIcon({ name, size }: { name: keyof typeof postIconPaths; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={postIconPaths[name]} />
  </svg>;
}

function JourneyStatus({ label }: { label: string }) {
  return <div className="creator-profile-status">
    <span aria-hidden="true">9:41</span>
    <span className="creator-social-label">{label}</span>
    <svg width="42" height="22" viewBox="0 0 42 22" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 15v-2m3 2v-4m3 4V9m3 6V7" />
      <path d="M15 9a8 8 0 0 1 10 0m-8 2.5a5 5 0 0 1 6 0m-4 2.5a2 2 0 0 1 2 0m-1 2h.01" />
      <rect x="29" y="7.5" width="10" height="7" rx="1.5" />
      <path d="M41 10v2m-9.5-.5h4.5" />
    </svg>
  </div>;
}

function SocialNavigation() {
  return <div className="creator-profile-bottom" aria-hidden="true">
    <PostIcon name="home" size={21} />
    <PostIcon name="search" size={21} />
    <PostIcon name="create" size={21} />
    <PostIcon name="reels" size={21} />
    <span className="creator-post-avatar">S.</span>
  </div>;
}

function CreatorJourney({ id }: { id: boolean }) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const comments = useRef<HTMLParagraphElement>(null);
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
      {journeySteps.map(number => (
        <button type="button" key={number} aria-current={step === number ? 'step' : undefined}
          aria-label={`${number}. ${labels[number - 1]}`} onClick={() => go(number)}>
          <span aria-hidden="true">{number}</span>{labels[number - 1]}
        </button>
      ))}
    </nav>
    <div className="creator-journey-guidance">
      {journeySteps.map(number => {
        const { title, description, hint } = journeyGuidance[number];
        return <div key={number} aria-hidden={number !== step ? true : undefined}>
          <h3>{t(title)}</h3>
          <p>{t(description)}</p>
          <p className="creator-journey-hint">{t(hint)}</p>
        </div>;
      })}
      <p className="sr-only" role="status">{t(journeyGuidance[step].hint)}</p>
    </div>
    <div className="creator-journey-stage" ref={stage}>
      {step === 1 ? <article className="creator-instagram-post" aria-label={id ? 'Contoh postingan Instagram' : 'Example Instagram post'}>
        <JourneyStatus label={t('Simulation')} />
        <header className="creator-post-header">
          <button className="creator-post-account" type="button" onClick={() => go(2, true)}>
            <span className="creator-post-avatar" aria-hidden="true">S.</span><strong>studio.sore</strong>
          </button>
          <button className="creator-post-more" type="button" aria-label={t('Post options')} disabled><PostIcon name="more" size={20} /></button>
        </header>
        <div className="creator-profile-scroll" role="region" aria-label={t('Post content')} tabIndex={0}>
          <img className="creator-post-photo" src={studioSoreExample.photo} alt={id ? 'Sepatu merah dari etalase Studio Sore' : 'Red sneakers from the Studio Sore storefront'} width="640" height="640" loading="lazy" decoding="async" />
          <div className="creator-post-engagement">
            <button type="button" aria-label={t('Like')} aria-pressed={liked} onClick={() => setLiked(value => !value)}><PostIcon name="heart" size={22} /></button>
            <button type="button" aria-label={t('Comment')} onClick={() => comments.current?.focus()}><PostIcon name="comment" size={22} /></button>
            <button type="button" aria-label={t('Share')} disabled><PostIcon name="send" size={22} /></button>
            <button type="button" aria-label={t('Save post')} aria-pressed={saved} onClick={() => setSaved(value => !value)}><PostIcon name="bookmark" size={22} /></button>
          </div>
          <div className="creator-post-caption">
            <strong aria-live="polite">{t('{count} likes', { count: liked ? 25 : 24 })}</strong>
            <p><button className="creator-caption-account" type="button" onClick={() => go(2, true)}>studio.sore</button> {t('Red sneakers for a Sunday walk. I’ve linked them in my bio.')}</p>
            <p ref={comments} className="creator-post-comment-count" tabIndex={-1}>{t('1 comment')}</p>
            <p><strong>rina.pagi</strong> {t('What are these sneakers called?')}</p>
          </div>
        </div>
        <SocialNavigation />
      </article> : <div className={`creator-journey-panel${step === 3 ? ' creator-journey-shop' : ''}`} key={step}>
      {step === 2 ? <section className="creator-instagram-profile" aria-labelledby="creator-walkthrough-profile">
        <JourneyStatus label={t('Simulation')} />
        <header className="creator-profile-header">
          <button type="button" aria-label={t('Back to post')} onClick={() => go(1, true)}><PostIcon name="back" size={20} /></button>
          <h3 id="creator-walkthrough-profile" tabIndex={-1}>studio.sore</h3>
          <button type="button" aria-label={t('Profile options')} disabled><PostIcon name="more" size={20} /></button>
        </header>
        <div className="creator-profile-scroll" role="region" aria-label={t('Profile content')} tabIndex={0}>
          <div className="creator-profile-body">
            <div className="creator-profile-identity">
              <span className="creator-profile-ring" aria-hidden="true"><span className="creator-post-avatar">S.</span></span>
              <dl className="creator-profile-stats">
                <div><dt>{t('Posts')}</dt><dd>{profilePosts.length}</dd></div>
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
            <div className="creator-profile-actions">
              <button type="button" disabled>{t('Follow')}</button>
              <button type="button" disabled>{t('Message')}</button>
              <button type="button" disabled>{t('Email')}</button>
              <button type="button" aria-label={t('Add person')} disabled><PostIcon name="personAdd" size={17} /></button>
            </div>
          </div>
          <div className="creator-profile-tabs" role="group" aria-label={t('Profile content')}>
            <button type="button" aria-label={t('Posts')} aria-pressed="true" disabled><PostIcon name="grid" size={20} /></button>
            <button type="button" aria-label={t('Reels')} disabled><PostIcon name="reels" size={20} /></button>
            <button type="button" aria-label={t('Tagged')} disabled><PostIcon name="tagged" size={20} /></button>
          </div>
          <ul className="creator-profile-grid" role="list" aria-label={t('Posts')}>
            {profilePosts.map(product => <li key={product.id}>
              <img src={product.photo} alt={product.title} width="640" height="640" loading="lazy" decoding="async" />
            </li>)}
          </ul>
        </div>
        <SocialNavigation />
      </section> : <>
        <JourneyStatus label="nanti." />
        <header className="creator-profile-header">
          <button type="button" aria-label={t('Back to profile')} onClick={() => go(2, true)}><PostIcon name="back" size={20} /></button>
          <h3>Studio Sore</h3>
        </header>
        <div className="creator-profile-scroll">
          <CreatorStorefront walkthrough />
        </div>
        <footer className="creator-journey-shop-footer">
          <a className="creator-journey-store-link" href="/creator/demo">{t('Open demo storefront')} <PostIcon name="arrow" size={16} /></a>
        </footer>
      </>}
      </div>}
    </div>
  </div>;
}
