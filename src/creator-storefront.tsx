import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { StorefrontProduct } from '../shared/creator-catalog.js';
import { formatPrice } from '../shared/wishlist.js';
import { defaultDesign } from './creator-design.js';
import type { CreatorDesign, CreatorSection } from './creator-design.js';
import { useLocale, LanguagePicker } from './locale.js';
import './creator-storefront.css';
import './creator-design.css';

const demoCollections = [
  { id: 'daily', name: 'Daily essentials', description: 'Little things I reach for every day.', symbol: '✳', tone: 'lilac' },
  { id: 'desk', name: 'Desk setup', description: 'A calmer, more comfortable workspace.', symbol: '◒', tone: 'sage' },
  { id: 'style', name: 'Style picks', description: 'Simple pieces with plenty of character.', symbol: '✦', tone: 'peach' },
] as const;
type CollectionId = typeof demoCollections[number]['id'];
export const studioSoreExample = {
  id: 3,
  collection: 'style',
  title: 'Classic canvas sneakers',
  price: 'Rp 399.000',
  symbol: '✦',
  tone: 'peach',
  photo: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=640&h=640&fit=crop&auto=format&q=80',
} as const;
const demoProducts: { id: number; collection: CollectionId; title: string; price: string; symbol: string; tone: string; photo: string }[] = [
  { id: 1, collection: 'daily', title: 'Everyday tote bag', price: 'Rp 149.000', symbol: '▤', tone: 'lilac', photo: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=640&h=640&fit=crop&auto=format&q=80' },
  { id: 2, collection: 'desk', title: 'Minimal desk lamp', price: 'Rp 289.000', symbol: '◉', tone: 'sage', photo: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=640&h=640&fit=crop&auto=format&q=80' },
  studioSoreExample,
  { id: 4, collection: 'desk', title: 'Wireless keyboard', price: 'Rp 329.000', symbol: '▦', tone: 'lilac', photo: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=640&h=640&fit=crop&auto=format&q=80' },
  { id: 5, collection: 'daily', title: 'Reusable water bottle', price: 'Rp 119.000', symbol: '◈', tone: 'sage', photo: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=640&h=640&fit=crop&auto=format&q=80' },
  { id: 6, collection: 'style', title: 'Relaxed cotton shirt', price: 'Rp 219.000', symbol: '✳', tone: 'peach', photo: 'https://images.unsplash.com/photo-1598032895397-b9472444bf93?w=640&h=640&fit=crop&auto=format&q=80' },
];
export function CreatorStorefront({ design = defaultDesign, embedded = false, walkthrough = false, preview = false, catalog }: {
  design?: CreatorDesign;
  embedded?: boolean;
  walkthrough?: boolean;
  preview?: boolean;
  catalog?: { name: string; products: StorefrontProduct[] };
}) {
  const { language } = useLocale();
  const id = language === 'id';
  const [active, setActive] = useState('all');
  const collections = catalog
    ? [...new Set(catalog.products.map(item => item.category).filter(Boolean))].map(name => ({
      id: 'category:' + name, name, description: '', symbol: '✳', tone: 'lilac',
    }))
    : demoCollections;
  const products: Array<{
    id: string | number; collection: string; title: string; price: string; symbol: string;
    tone: string; photo: string | null; url?: string; description?: string; attributes?: string;
  }> = catalog ? catalog.products.map(item => ({
    id: item.id, collection: 'category:' + item.category, title: item.title,
    price: item.priceMinor != null && item.currency ? formatPrice(item.priceMinor, item.currency, id ? 'id-ID' : 'en-US') : '',
    photo: item.image, symbol: item.title.slice(0, 1), tone: 'lilac', url: item.url, description: item.description,
    attributes: [item.color, item.productType].filter(Boolean).join(' · '),
  })) : demoProducts;
  const [search, setSearch] = useState(walkthrough ? 'sneakers' : '');
  const [compactSearch, setCompactSearch] = useState(false);
  const searchRef = useRef<HTMLElement>(null);
  const productsRef = useRef<HTMLElement>(null);
  const productTrigger = useRef<HTMLButtonElement>(null);
  const instance = useId();
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (walkthrough) return;
    const sentinel = searchSentinelRef.current;
    if (!sentinel) return;
    const root = embedded ? sentinel.closest<HTMLElement>('.studio-preview-frame') : null;
    const scrollTarget: HTMLElement | Window = root ?? window;
    // The threshold is fixed while scrolling: measuring the sticky element on
    // every frame causes a resize/scroll feedback loop on mobile browsers.
    const initialScroll = root ? root.scrollTop : window.scrollY;
    const boundary = root
      ? sentinel.getBoundingClientRect().top - root.getBoundingClientRect().top + initialScroll
      : sentinel.getBoundingClientRect().top + initialScroll;
    const enterAt = Math.max(24, boundary + 12);
    const leaveAt = Math.max(0, enterAt - 28);
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = root ? root.scrollTop : window.scrollY;
      setCompactSearch(previous => y > (previous ? leaveAt : enterAt));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      scrollTarget.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [embedded, walkthrough]);

  const [selectedProduct, setSelectedProduct] = useState<string | number | null>(null);
  const activeCollection = collections.find(item => item.id === active);
  const normalized = (value: string) => value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const query = normalized(search);
  const collectionMatch = collections.find((collection, index) => query === normalized(collection.name) || query === normalized('etalase ' + (index + 1)) || query === normalized('showcase ' + (index + 1)));
  const visible = products.filter(item => {
    if (query) {
      const collection = collections.find(entry => entry.id === item.collection);
      const collectionNumber = collections.findIndex(entry => entry.id === item.collection) + 1;
      const searchable = catalog ? [item.title, item.description ?? '', collection?.name ?? ''].map(normalized) : [item.title, 'PRD-' + String(item.id).padStart(3, '0'), 'produk ' + item.id, 'product ' + item.id, collection?.name ?? '', 'etalase ' + collectionNumber, 'showcase ' + collectionNumber].map(normalized);
      return collectionMatch ? item.collection === collectionMatch.id : searchable.some(value => value.includes(query));
    }
    return active === 'all' || item.collection === active;
  });
  const productCount = (count: number) => id ? count + ' produk' : count + (count === 1 ? ' product' : ' products');
  const collectionCount = (count: number) => id ? count + ' koleksi' : count + (count === 1 ? ' collection' : ' collections');
  const selected = products.find(item => item.id === selectedProduct);
  function closeProduct() {
    setSelectedProduct(null);
    productTrigger.current?.focus();
  }
  const sections = design.sections;
  const has = (section: CreatorSection) => sections.includes(section);
  const inline = embedded || walkthrough;
  const Content = inline || preview ? 'div' : 'main';
  const ProfileTitle = embedded || preview ? 'h2' : 'h1';
  const ProductListTitle = walkthrough ? 'h3' : 'h2';
  const ProductTitle = walkthrough ? 'h4' : 'h3';
  const searchId = catalog && (embedded || preview) ? instance + '-search' : walkthrough ? 'creator-walkthrough-search' : embedded ? 'creator-preview-search' : 'creator-storefront-search';
  const productsId = catalog && (embedded || preview) ? instance + '-products' : 'storefront-products';
  const featuredTitle = productsId + '-featured-title';
  const collectionsTitle = productsId + '-collections-title';
  const listingTitle = productsId + '-title';
  const headingFamily = design.headingFont === "serif" ? "Georgia, serif" : design.headingFont === "mono" ? "ui-monospace, monospace" : "inherit";
  const style = { "--sf-accent": design.accent, "--sf-ink": design.foreground, "--sf-page": design.background, "--sf-radius": `${design.radius}px`, "--sf-heading-font": headingFamily, "--sf-columns": design.columns, "--sf-ratio": design.imageRatio === "portrait" ? "4/5" : design.imageRatio === "landscape" ? "4/3" : "1/1" } as CSSProperties;
  return <div className={`storefront storefront-theme-${design.theme} storefront-personality-${design.layoutPersonality} storefront-hero-${design.heroLayout} storefront-card-${design.cardStyle} ${inline ? "storefront-embedded" : ""} ${walkthrough ? "storefront-walkthrough" : ""}`} style={style}>
    {!inline && <header className="storefront-header">
      <a href="/creator" className="storefront-brand" aria-label="Nanti Kreator">nanti<span>.</span><small>kreator</small></a>
      <span className="storefront-header-label">{catalog ? catalog.name : id ? 'Contoh halaman kreator' : 'Creator page preview'}</span>
      <div className="storefront-header-actions"><LanguagePicker /><a href="/creator">{id ? 'Kembali' : 'Back'} ↗</a></div>
    </header>}
    <Content className="storefront-main">
      {!catalog && !walkthrough && <div className="storefront-demo-notice" style={{order:-2}} role="status">{id ? 'DEMO · Profil, produk, dan harga di halaman ini hanya contoh. Belum ada tautan pembelian.' : 'DEMO · This profile, products, and prices are examples. Purchase links are not available.'}</div>}
      <div ref={searchSentinelRef} className="storefront-search-sentinel" style={{order:0}} aria-hidden="true" />
      <section ref={searchRef} className={`storefront-search ${compactSearch ? "storefront-search-compact" : ""}`} style={{order:0}} role="search" aria-label={id ? 'Cari produk dan etalase' : 'Search products and collections'}>
        <label htmlFor={searchId}>{catalog || walkthrough ? (id ? 'Cari produk' : 'Search products') : id ? 'Cari dari kode di Instagram' : 'Find it from an Instagram post'}</label>
        <div className="storefront-search-control"><span aria-hidden="true">⌕</span><input id={searchId} type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={catalog || walkthrough ? (id ? 'Nama produk atau koleksi' : 'Product or collection name') : id ? 'Kode PRD-003, Etalase 3, atau nama koleksi' : 'Code PRD-003, Showcase 3, or collection name'} autoComplete="off" />{search && <button type="button" onClick={()=>{setSearch('');setActive('all');}} aria-label={id?'Hapus pencarian':'Clear search'}>×</button>}</div>
        <p aria-live="polite">{query ? (id ? `${visible.length} produk ditemukan` : `${visible.length} products found`) : catalog || walkthrough ? null : (id ? 'Coba: PRD-003 · Etalase 3 · Desk setup' : 'Try: PRD-003 · Showcase 3 · Desk setup')}</p>
      </section>
      {!walkthrough && has("profile") && <section className="storefront-profile" style={{order:sections.indexOf("profile") + 1}}>
        <div className="storefront-avatar" aria-hidden="true">{catalog ? catalog.name.slice(0, 1) : 'S.'}</div>
        <div className="storefront-profile-copy"><ProfileTitle className="storefront-profile-title">{catalog?.name ?? 'Studio Sore'}</ProfileTitle>{!catalog && <><p className="storefront-handle">@studiosore · Jakarta</p><p>{id ? 'Hai, aku Sore! Di sini aku kumpulin barang-barang yang sering kalian tanyain. Tinggal cari koleksinya atau pakai kode dari caption, ya.' : "Hey, I'm Sore! Here's everything you keep asking me about. Search a collection or use the code from my captions."}</p></>}<div className="storefront-profile-meta">{(!catalog || collections.length > 0) && <span>{collectionCount(collections.length)}</span>}<span>{productCount(products.length)}</span></div></div>
      </section>}
      {!walkthrough && has("hero") && <section className="storefront-featured" style={{order:sections.indexOf("hero") + 1}} aria-labelledby={featuredTitle}><div>{!catalog && <span className="storefront-kicker">{id ? 'PILIHAN MINGGU INI' : 'THIS WEEK’S EDIT'}</span>}<h2 id={featuredTitle}>{catalog ? (id ? 'Pilihan kreator' : 'Creator picks') : id ? 'Favorit kecil, dampak besar.' : 'Small favorites, big difference.'}</h2><p>{catalog ? null : id ? 'Mulai dari meja kerja sampai gaya sehari-hari. Semua pilihan ada di sini.' : 'From your desk to your everyday style. Find everything in one place.'}</p><a href={'#' + productsId}>{id ? 'Jelajahi pilihan' : 'Explore picks'} ↗</a></div><div className="storefront-featured-art" aria-hidden="true"><span>✳</span><span>◒</span><span>✦</span></div></section>}
      {!walkthrough && collections.length > 0 && has("collections") && <section className="storefront-collections" style={{order:sections.indexOf("collections") + 1}} aria-labelledby={collectionsTitle}><div className="storefront-section-heading"><div>{!catalog && <span className="storefront-kicker">01 / {id ? 'KOLEKSI' : 'COLLECTIONS'}</span>}<h2 id={collectionsTitle}>{id ? 'Jelajahi koleksi' : 'Browse collections'}</h2></div><span>{collectionCount(collections.length)}</span></div><div className="storefront-collection-grid">{collections.map(collection => <button type="button" key={collection.id} className={`storefront-collection-card storefront-tone-${collection.tone}`} onClick={() => { setSearch(''); setActive(collection.id); productsRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}><span className="storefront-collection-symbol" aria-hidden="true">{collection.symbol}</span><span className="storefront-collection-title">{collection.name}</span><span className="storefront-collection-count">{products.filter(product => product.collection === collection.id).length} {id ? 'produk' : 'products'} <span aria-hidden="true">↗</span></span></button>)}</div></section>}
      {has("products") && <section id={productsId} ref={productsRef} className="storefront-products" style={{order:sections.indexOf("products") + 1}} aria-labelledby={listingTitle}><div className="storefront-section-heading"><div>{!catalog && !walkthrough && <span className="storefront-kicker">02 / {id ? 'ETALASE' : 'THE EDIT'}</span>}<ProductListTitle id={listingTitle}>{query ? (id ? 'Hasil pencarian' : 'Search results') : activeCollection?.name ?? (id ? 'Semua pilihan' : 'All picks')}</ProductListTitle>{!walkthrough && <p>{activeCollection?.description ?? (catalog ? null : id ? 'Produk yang dipilih untuk halaman contoh ini.' : 'Products curated for this sample page.')}</p>}</div>{!walkthrough && <span>{productCount(visible.length)}</span>}</div>{(!catalog || collections.length > 0) && <div className="storefront-filters" role="group" aria-label={id ? 'Filter koleksi' : 'Filter collections'}><button type="button" aria-pressed={active === 'all'} onClick={() => {setSearch('');setActive('all');}}>{id ? 'Semua' : 'All'}</button>{collections.map(collection => <button key={collection.id} type="button" aria-pressed={active === collection.id} onClick={() => {setSearch('');setActive(collection.id);}}>{collection.name}</button>)}</div>}<div className="storefront-product-grid">{visible.map(product => <article className="storefront-product" key={product.id}><div className={`storefront-product-art storefront-tone-${product.tone} ${product.photo ? '' : 'is-image-fallback'}`} >{product.photo && <img src={product.photo} alt={product.title} loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("is-image-fallback"); }}/>}<span className="storefront-photo-fallback" aria-hidden="true">{product.symbol}</span></div><div className="storefront-product-copy">{design.showCategories && (!catalog || product.collection !== 'category:') && <span className="storefront-product-category">{collections.find(collection => collection.id === product.collection)?.name}</span>}<ProductTitle>{product.title}</ProductTitle>{!catalog && !walkthrough && <span className="storefront-product-code">PRD-{String(product.id).padStart(3,'0')}</span>}{design.showPrices && product.price && <strong>{product.price}</strong>}{product.attributes && <span className="storefront-product-attributes">{product.attributes}</span>}<button type="button" aria-label={catalog ? (id ? 'Lihat produk ' : 'View product ') + product.title : undefined} onClick={event => { productTrigger.current = event.currentTarget; setSelectedProduct(product.id); }}>{id ? 'Lihat produk' : 'View product'} <span aria-hidden="true">↗</span></button></div></article>)}</div>{visible.length===0 && <p className="storefront-empty" role="status">{catalog && products.length === 0 ? (id ? 'Belum ada produk.' : 'No products yet.') : walkthrough ? (id ? 'Produk tidak ditemukan.' : 'No products found.') : id ? 'Tidak ada produk yang cocok. Coba kode atau nama koleksi lain.' : 'No matching products. Try another code or collection name.'}</p>}</section>}
      {!catalog && !inline && <section className="storefront-outro" style={{order:99}}><span className="storefront-kicker">{id ? 'DIBUAT DENGAN NANTI' : 'MADE WITH NANTI'}</span><h2>{id ? 'Semua rekomendasi, satu tempat.' : 'Every recommendation, one place.'}</h2><p>{id ? 'Ini contoh etalase kreator. Fitur publikasi dan afiliasi masih dalam pengembangan.' : 'This is a sample storefront. Publishing and affiliate features are still in development.'}</p><a href="/creator">{id ? 'Tentang Nanti Kreator' : 'About Nanti Creator'} ↗</a></section>}
    </Content>
    {!inline && <footer className="storefront-footer"><span>nanti<span>.</span> kreator</span><span>{!catalog && (id ? 'Pratinjau konsep · Bukan toko aktif' : 'Concept preview · Not a live shop')}</span></footer>}
    {catalog && selected?.url && <LiveProductDialog product={selected} close={closeProduct} showPrices={design.showPrices} />}{!catalog && selected && <div className="storefront-modal-backdrop" onClick={() => setSelectedProduct(null)}><section className="storefront-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-modal-title" onClick={event => event.stopPropagation()}><button className="storefront-modal-close" type="button" aria-label={id ? 'Tutup' : 'Close'} onClick={() => setSelectedProduct(null)}>×</button><div className={`storefront-modal-art storefront-tone-${selected.tone}`} ><img src={selected.photo ?? undefined} alt={selected.title} decoding="async" onError={event => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("is-image-fallback"); }}/><span className="storefront-photo-fallback" aria-hidden="true">{selected.symbol}</span></div><span className="storefront-kicker">{id ? 'PRODUK CONTOH' : 'SAMPLE PRODUCT'}</span><h2 id="storefront-modal-title">{selected.title}</h2><strong>{selected.price}</strong><p>{id ? 'Ini hanya contoh tampilan detail produk. Tautan marketplace akan tersedia setelah fitur kreator diluncurkan.' : 'This is a sample product detail. Marketplace links will be available after creator features launch.'}</p><button className="storefront-modal-dismiss" type="button" onClick={() => setSelectedProduct(null)}>{id ? 'Kembali ke etalase' : 'Back to storefront'}</button></section></div>}
  </div>;
}

function LiveProductDialog({ product, close, showPrices }: {
  product: { title: string; price: string; description?: string; url?: string; photo: string | null };
  close: () => void;
  showPrices: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { language } = useLocale();
  const id = language === 'id';
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function dismiss() {
    dialog.current?.close();
    close();
  }
  return <dialog ref={dialog} className="storefront-modal storefront-live-dialog"
    aria-labelledby="storefront-live-product" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <button type="button" className="storefront-modal-close" onClick={dismiss} aria-label={id ? 'Tutup' : 'Close'}>×</button>
    {product.photo && <img className="storefront-live-photo" src={product.photo} alt="" />}
    <h2 id="storefront-live-product">{product.title}</h2>
    {showPrices && product.price && <strong>{product.price}</strong>}
    {product.description && <p>{product.description}</p>}
    <a href={product.url} target="_blank" rel="noopener noreferrer">{id ? 'Buka toko (tab baru)' : 'Open retailer (new tab)'}</a>
  </dialog>;
}
