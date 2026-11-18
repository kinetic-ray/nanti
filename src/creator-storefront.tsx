import { useState } from 'react';
import { useLocale, LanguagePicker } from './locale.js';
import './creator-storefront.css';

const collections = [
  { id: 'daily', name: 'Daily essentials', description: 'Little things I reach for every day.', symbol: '✳', tone: 'lilac' },
  { id: 'desk', name: 'Desk setup', description: 'A calmer, more comfortable workspace.', symbol: '◒', tone: 'sage' },
  { id: 'style', name: 'Style picks', description: 'Simple pieces with plenty of character.', symbol: '✦', tone: 'peach' },
] as const;
type CollectionId = typeof collections[number]['id'];
const products: { id: number; collection: CollectionId; title: string; price: string; symbol: string; tone: string }[] = [
  { id: 1, collection: 'daily', title: 'Everyday tote bag', price: 'Rp 149.000', symbol: '▤', tone: 'lilac' },
  { id: 2, collection: 'desk', title: 'Minimal desk lamp', price: 'Rp 289.000', symbol: '◉', tone: 'sage' },
  { id: 3, collection: 'style', title: 'Classic canvas sneakers', price: 'Rp 399.000', symbol: '✦', tone: 'peach' },
  { id: 4, collection: 'desk', title: 'Wireless keyboard', price: 'Rp 329.000', symbol: '▦', tone: 'lilac' },
  { id: 5, collection: 'daily', title: 'Reusable water bottle', price: 'Rp 119.000', symbol: '◈', tone: 'sage' },
  { id: 6, collection: 'style', title: 'Relaxed cotton shirt', price: 'Rp 219.000', symbol: '✳', tone: 'peach' },
];
export function CreatorStorefront() {
  const { language } = useLocale();
  const id = language === 'id';
  const [active, setActive] = useState<CollectionId | 'all'>('all');
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const activeCollection = collections.find(item => item.id === active);
  const visible = active === 'all' ? products : products.filter(item => item.collection === active);
  const selected = products.find(item => item.id === selectedProduct);
  return <div className="storefront">
    <header className="storefront-header">
      <a href="/creator" className="storefront-brand" aria-label="Nanti Kreator">nanti<span>.</span><small>kreator</small></a>
      <span className="storefront-header-label">{id ? 'Contoh halaman kreator' : 'Creator page preview'}</span>
      <div className="storefront-header-actions"><LanguagePicker /><a href="/creator">{id ? 'Kembali' : 'Back'} ↗</a></div>
    </header>
    <main className="storefront-main">
      <div className="storefront-demo-notice" role="status">{id ? 'DEMO · Profil, produk, dan harga di halaman ini hanya contoh. Belum ada tautan pembelian.' : 'DEMO · This profile, products, and prices are examples. Purchase links are not available.'}</div>
      <section className="storefront-profile">
        <div className="storefront-avatar" aria-hidden="true">S.</div>
        <div className="storefront-profile-copy"><span className="storefront-kicker">{id ? 'ETALASE KREATOR' : 'CREATOR STOREFRONT'}</span><h1>Studio Sore <span className="storefront-verified" aria-label={id ? 'Akun contoh' : 'Sample account'}>✳</span></h1><p className="storefront-handle">@studiosore · Jakarta</p><p>{id ? 'Barang-barang yang bikin hari terasa lebih nyaman. Dipilih dengan teliti, dibagikan dengan senang hati.' : 'Thoughtfully picked things for easier, brighter days. Curated with care, shared with joy.'}</p><div className="storefront-profile-meta"><span>{collections.length} {id ? 'koleksi' : 'collections'}</span><span>{products.length} {id ? 'produk pilihan' : 'curated picks'}</span></div></div>
      </section>
      <section className="storefront-featured" aria-labelledby="storefront-featured-title"><div><span className="storefront-kicker">{id ? 'PILIHAN MINGGU INI' : 'THIS WEEK’S EDIT'}</span><h2 id="storefront-featured-title">{id ? 'Favorit kecil, dampak besar.' : 'Small favorites, big difference.'}</h2><p>{id ? 'Mulai dari meja kerja sampai gaya sehari-hari. Semua pilihan ada di sini.' : 'From your desk to your everyday style. Find everything in one place.'}</p><a href="#storefront-products">{id ? 'Jelajahi pilihan' : 'Explore picks'} ↗</a></div><div className="storefront-featured-art" aria-hidden="true"><span>✳</span><span>◒</span><span>✦</span></div></section>
      <section className="storefront-collections" aria-labelledby="storefront-collections-title"><div className="storefront-section-heading"><div><span className="storefront-kicker">01 / {id ? 'KOLEKSI' : 'COLLECTIONS'}</span><h2 id="storefront-collections-title">{id ? 'Jelajahi koleksi' : 'Browse collections'}</h2></div><span>{collections.length} {id ? 'koleksi' : 'collections'}</span></div><div className="storefront-collection-grid">{collections.map(collection => <button type="button" key={collection.id} className={`storefront-collection-card storefront-tone-${collection.tone}`} onClick={() => { setActive(collection.id); document.getElementById('storefront-products')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="storefront-collection-symbol" aria-hidden="true">{collection.symbol}</span><span className="storefront-collection-title">{collection.name}</span><span className="storefront-collection-count">{products.filter(product => product.collection === collection.id).length} {id ? 'produk' : 'products'} <span aria-hidden="true">↗</span></span></button>)}</div></section>
      <section id="storefront-products" className="storefront-products" aria-labelledby="storefront-products-title"><div className="storefront-section-heading"><div><span className="storefront-kicker">02 / {id ? 'ETALASE' : 'THE EDIT'}</span><h2 id="storefront-products-title">{activeCollection?.name ?? (id ? 'Semua pilihan' : 'All picks')}</h2><p>{activeCollection?.description ?? (id ? 'Produk yang dipilih untuk halaman contoh ini.' : 'Products curated for this sample page.')}</p></div><span>{visible.length} {id ? 'produk' : 'products'}</span></div><div className="storefront-filters" role="group" aria-label={id ? 'Filter koleksi' : 'Filter collections'}><button type="button" aria-pressed={active === 'all'} onClick={() => setActive('all')}>{id ? 'Semua' : 'All'}</button>{collections.map(collection => <button key={collection.id} type="button" aria-pressed={active === collection.id} onClick={() => setActive(collection.id)}>{collection.name}</button>)}</div><div className="storefront-product-grid">{visible.map(product => <article className="storefront-product" key={product.id}><div className={`storefront-product-art storefront-tone-${product.tone}`} aria-hidden="true">{product.symbol}</div><div className="storefront-product-copy"><span className="storefront-product-category">{collections.find(collection => collection.id === product.collection)?.name}</span><h3>{product.title}</h3><strong>{product.price}</strong><button type="button" onClick={() => setSelectedProduct(product.id)}>{id ? 'Lihat produk' : 'View product'} <span aria-hidden="true">↗</span></button></div></article>)}</div></section>
      <section className="storefront-outro"><span className="storefront-kicker">{id ? 'DIBUAT DENGAN NANTI' : 'MADE WITH NANTI'}</span><h2>{id ? 'Semua rekomendasi, satu tempat.' : 'Every recommendation, one place.'}</h2><p>{id ? 'Ini contoh etalase kreator. Fitur publikasi dan afiliasi masih dalam pengembangan.' : 'This is a sample storefront. Publishing and affiliate features are still in development.'}</p><a href="/creator">{id ? 'Tentang Nanti Kreator' : 'About Nanti Creator'} ↗</a></section>
    </main>
    <footer className="storefront-footer"><span>nanti<span>.</span> kreator</span><span>{id ? 'Pratinjau konsep · Bukan toko aktif' : 'Concept preview · Not a live shop'}</span></footer>
    {selected && <div className="storefront-modal-backdrop" onClick={() => setSelectedProduct(null)}><section className="storefront-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-modal-title" onClick={event => event.stopPropagation()}><button className="storefront-modal-close" type="button" aria-label={id ? 'Tutup' : 'Close'} onClick={() => setSelectedProduct(null)}>×</button><div className={`storefront-modal-art storefront-tone-${selected.tone}`} aria-hidden="true">{selected.symbol}</div><span className="storefront-kicker">{id ? 'PRODUK CONTOH' : 'SAMPLE PRODUCT'}</span><h2 id="storefront-modal-title">{selected.title}</h2><strong>{selected.price}</strong><p>{id ? 'Ini hanya contoh tampilan detail produk. Tautan marketplace akan tersedia setelah fitur kreator diluncurkan.' : 'This is a sample product detail. Marketplace links will be available after creator features launch.'}</p><button className="storefront-modal-dismiss" type="button" onClick={() => setSelectedProduct(null)}>{id ? 'Kembali ke etalase' : 'Back to storefront'}</button></section></div>}
  </div>;
}
