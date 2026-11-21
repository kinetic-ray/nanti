import { api, errorMessage } from './api.js';
import type { StorefrontProduct } from '../shared/creator-catalog.js';
import { useEffect, useState } from 'react';
import { CreatorStorefront } from './creator-storefront.js';
import { presets, validateDesign } from './creator-design.js';
import type { CreatorDesign, CreatorSection, CreatorTheme, LayoutPersonality } from './creator-design.js';
import { useLocale } from './locale.js';
import './creator-studio.css';

const storageKey = 'nanti.creator.design.draft.v1';
function initialDesign(key: string): CreatorDesign {
  try { const saved = localStorage.getItem(key); return saved ? validateDesign(JSON.parse(saved)) : presets.editorial; }
  catch { return presets.editorial; }
}
const sectionNames: Record<CreatorSection,string> = { profile:'Profil kreator', hero:'Sorotan utama', collections:'Koleksi', products:'Daftar produk' };
const steps = ['theme','layout','cards','type','sections'] as const;
const stepLabels = { id: ['Tema','Tata letak','Kartu produk','Huruf','Urutan konten'], en: ['Theme','Layout','Product cards','Typography','Sections'] };
const stepHints = { id: ['Pilih gaya visual yang paling cocok.','Atur bagian atas dan jumlah kolom.','Atur cara produk ditampilkan.','Pilih gaya judul.','Tentukan urutan isi halaman.'], en: ['Pick a visual style.','Arrange the hero and columns.','Control product presentation.','Choose the heading style.','Order the page sections.'] };
export function CreatorDesignStudio({ ownerId, draft, catalog, onSaved }: {
  ownerId: string; draft: unknown; catalog: { name: string; products: StorefrontProduct[] };
  onSaved: (design: CreatorDesign) => void;
}) {
  const ownedKey = storageKey + '.' + ownerId;
  const { language, t } = useLocale();
  const id = language === 'id';
  const [design, setDesign] = useState<CreatorDesign>(() => draft === null ? initialDesign(ownedKey) : validateDesign(draft));
  const [viewport, setViewport] = useState<'desktop'|'mobile'>(window.matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop');
  const [tab, setTab] = useState<'theme'|'layout'|'cards'|'type'|'sections'>('theme');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(design);
  const [mobilePanel, setMobilePanel] = useState<'edit'|'preview'>('edit');
  const unsaved = JSON.stringify(design) !== JSON.stringify(snapshot);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const stepIndex = steps.indexOf(tab);
  const update = (patch: Partial<CreatorDesign>) => { setDesign(prev => ({ ...prev, ...patch })); setNotice(''); };
  const persist = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      await api('/account/creator/design', { method: 'PUT', data: { design } });
      setSnapshot(design);
      onSaved(design);
      setNotice(id ? 'Draft disimpan di akunmu.' : 'Draft saved to your account.');
    } catch (failure) {
      setError(errorMessage(failure) === 'Sign in to continue.' ? 'session' : 'save');
    } finally { setSaving(false); }
  };
  function downloadDesign() {
    const file = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const download = document.createElement('a');
    download.href = url;
    download.download = 'nanti-creator-design.json';
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const move = (section: CreatorSection, by: number) => {
    const next = [...design.sections]; const from = next.indexOf(section); const to = from+by;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from],next[to]]=[next[to]!,next[from]!]; update({sections:next});
  };
  return <div className="studio">
    <header className="studio-header"><span className="studio-status">{id ? 'DRAF TAMPILAN' : 'APPEARANCE DRAFT'}</span><div><button type="button" onClick={persist} disabled={saving}>{id ? 'Simpan desain' : 'Save design'}</button></div></header>
    {(notice || error) && <div className="studio-save-feedback">
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error === 'session'
        ? <a href="/account?next=creator">{t('Sign in again to save')}</a>
        : t('Could not save your draft. Try again.')}</p>}
    </div>}
    <div className="studio-mobile-switch" role="group" aria-label={id?'Mode studio':'Studio view'}><button type="button" aria-pressed={mobilePanel==='edit'} onClick={()=>setMobilePanel('edit')}>{id?'Ubah desain':'Edit design'}</button><button type="button" aria-pressed={mobilePanel==='preview'} onClick={()=>setMobilePanel('preview')}>{id?'Lihat hasil':'Preview'}</button></div>
    <div className={'studio-workspace studio-show-'+mobilePanel}>
      <aside className="studio-panel"><div className="studio-panel-heading"><span>DESIGN STUDIO</span><h1 tabIndex={-1}>{id ? 'Bentuk etalasemu.' : 'Make it yours.'}</h1><p>{id ? 'Atur tampilan, posisi hero, kartu produk, tipografi, dan urutan bagian. Semua perubahan langsung terlihat.' : 'Adjust layouts, hero, product cards, typography and section order with live preview.'}</p></div>
      <div className="studio-progress" aria-live="polite">{id ? 'Langkah' : 'Step'} {stepIndex+1} / {steps.length} · {stepLabels[id?'id':'en'][stepIndex]}</div>
      <nav className="studio-tabs" aria-label={id ? 'Pengaturan desain' : 'Design settings'}>{steps.map((value,index) => <button key={value} type="button" aria-current={tab===value?'step':undefined} onClick={() => setTab(value)}><span>{index+1}</span>{stepLabels[id?'id':'en'][index]}</button>)}</nav>
      <p className="studio-step-hint">{stepHints[id?'id':'en'][stepIndex]}</p>
      <div className="studio-settings">
        {tab==='theme' && <><div className="studio-layout-personalities"><h2>{id ? 'Pilih karakter halaman' : 'Choose your page character'}</h2><p>{id ? 'Bukan cuma warna. Setiap gaya mengubah komposisi, jarak, kartu, dan tipografi halaman.' : 'More than colors. Each style changes composition, spacing, cards, and typography.'}</p><div className="studio-personality-grid">{([
          {value:'minimalist',name:'Minimalist',desc:id?'Bersih & lapang':'Clean & spacious'},
          {value:'editorial',name:'Editorial',desc:id?'Seperti majalah':'Magazine-inspired'},
          {value:'brutalist',name:'Brutalist',desc:id?'Berani & tegas':'Bold & expressive'},
          {value:'gallery',name:'Gallery',desc:id?'Visual jadi fokus':'Image-first'}
        ] as {value:LayoutPersonality;name:string;desc:string}[]).map(option=><button type="button" key={option.value} className={'studio-personality-option studio-personality-'+option.value} aria-pressed={design.layoutPersonality===option.value} onClick={()=>update({layoutPersonality:option.value})}><span className="studio-personality-art" aria-hidden="true"><i/><i/><i/></span><strong>{option.name}</strong><small>{option.desc}</small></button>)}</div></div><h2>{id ? 'Karakter visual' : 'Visual direction'}</h2><p>{id ? 'Pilih palet warna dasar. Karakter layout tetap bisa dipilih terpisah.' : 'Choose a base palette. Your layout character stays independent.'}</p><div className="studio-preset-grid">{(['editorial','utility','gallery'] as CreatorTheme[]).map(theme=><button type="button" key={theme} aria-pressed={design.theme===theme} onClick={()=>setDesign({...presets[theme],layoutPersonality:design.layoutPersonality,sections:design.sections})}><span className={'studio-preset-swatch studio-swatch-'+theme}/>{theme}</button>)}</div><details className="studio-advanced"><summary>{id?'Sesuaikan warna (opsional)':'Customize colors (optional)'}</summary><label>{id ? 'Warna aksen' : 'Accent'}<input type="color" value={design.accent} onChange={event=>update({accent:event.target.value})}/></label><label>{id ? 'Latar belakang' : 'Background'}<input type="color" value={design.background} onChange={event=>update({background:event.target.value})}/></label><label>{id ? 'Warna teks' : 'Text color'}<input type="color" value={design.foreground} onChange={event=>update({foreground:event.target.value})}/></label></details></>}
        {tab==='layout' && <><h2>{id?'Tampilan bagian utama':'Main section layout'}</h2><div className="studio-choice-grid">{(['split','center','compact'] as const).map(value=><button type="button" key={value} aria-pressed={design.heroLayout===value} onClick={()=>update({heroLayout:value})}>{({split:id?'Berdampingan':'Side by side',center:id?'Di tengah':'Centered',compact:id?'Ringkas':'Compact'} as const)[value]}</button>)}</div><div className="studio-field"><strong>{id ? 'Kepadatan produk' : 'Product density'}</strong><div className="studio-choice-grid">{([2,3,4] as const).map((value,index)=><button key={value} type="button" aria-pressed={design.columns===value} onClick={()=>update({columns:value})}><span className="studio-column-icon" style={{gridTemplateColumns:`repeat(${value},1fr)`}}>{Array.from({length:value*2},(_,i)=><i key={i}/>)}</span>{(id?['Lapang','Seimbang','Padat']:['Spacious','Balanced','Compact'])[index]}</button>)}</div></div></>}
        {tab==='cards' && <><h2>{id ? 'Kartu produk' : 'Product cards'}</h2><label>Card style<select value={design.cardStyle} onChange={event=>update({cardStyle:event.target.value as CreatorDesign['cardStyle']})}><option value="minimal">Minimal</option><option value="bordered">Bordered</option><option value="solid">Solid</option></select></label><label>Image ratio<select value={design.imageRatio} onChange={event=>update({imageRatio:event.target.value as CreatorDesign['imageRatio']})}><option value="square">1:1 Square</option><option value="portrait">4:5 Portrait</option><option value="landscape">4:3 Landscape</option></select></label><div className="studio-field"><strong>{id?'Bentuk sudut':'Corner style'}</strong><div className="studio-choice-grid">{([0,12,28] as const).map((value,index)=><button type="button" key={value} aria-pressed={Math.abs(design.radius-value)<7} onClick={()=>update({radius:value})}><span className="studio-corner-icon" style={{borderRadius:value}}/>{(id?['Tegas','Lembut','Bulat']:['Sharp','Soft','Round'])[index]}</button>)}</div></div><label className="studio-check"><input type="checkbox" checked={design.showPrices} onChange={event=>update({showPrices:event.target.checked})}/>{id ? 'Tampilkan harga' : 'Show prices'}</label><label className="studio-check"><input type="checkbox" checked={design.showCategories} onChange={event=>update({showCategories:event.target.checked})}/>{id ? 'Tampilkan kategori' : 'Show categories'}</label></>}
        {tab==='type' && <><h2>Typography</h2><p>{id ? 'Pilih karakter heading tanpa mengorbankan keterbacaan teks produk.' : 'Choose heading character without compromising product readability.'}</p><div className="studio-choice-grid">{(['sans','serif','mono'] as const).map(value=><button type="button" className="studio-font-choice" key={value} aria-pressed={design.headingFont===value} onClick={()=>update({headingFont:value})}><span className={'studio-font-sample studio-font-'+value} aria-hidden="true">Aa</span><span className={'studio-font-name studio-font-'+value}>{({sans:'Sans serif',serif:'Serif',mono:'Monospace'} as const)[value]}</span><small>{({sans:'Modern & clean',serif:'Editorial & classic',mono:'Technical & precise'} as const)[value]}</small></button>)}</div></>}
        {tab==='sections' && <><h2>{id ? 'Urutan section' : 'Section order'}</h2><p>{id ? 'Pindahkan bagian ke atas atau bawah.' : 'Move sections up or down.'}</p><ol className="studio-section-list">{design.sections.map((section,index)=><li key={section}><span>{sectionNames[section]}</span><button type="button" disabled={index===0} aria-label={'Move '+section+' up'} onClick={()=>move(section,-1)}>↑</button><button type="button" disabled={index===design.sections.length-1} aria-label={'Move '+section+' down'} onClick={()=>move(section,1)}>↓</button></li>)}</ol></>}
      </div>
      <div className="studio-next"><button type="button" disabled={stepIndex===0} onClick={()=>setTab(steps[stepIndex-1]!)}>{id?'← Sebelumnya':'← Previous'}</button><button type="button" onClick={()=>{if(stepIndex===steps.length-1){setMobilePanel('preview');document.querySelector('.studio-preview-area')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});}else setTab(steps[stepIndex+1]!);}}>{stepIndex===steps.length-1?(id?'Lihat hasil →':'View result →'):(id?'Berikutnya →':'Next →')}</button></div>
      <div className="studio-panel-footer"><button type="button" onClick={()=>{setDesign(presets.editorial);setNotice('');}}>{id ? 'Reset desain' : 'Reset design'}</button>
        <button type="button" onClick={downloadDesign}>{t('Download design backup')}</button></div></aside>
      <section className="studio-preview-area" aria-label={id ? 'Pratinjau langsung' : 'Live preview'}><div className="studio-preview-toolbar"><div><strong>Live preview</strong><span>{id ? 'Produk yang diterbitkan' : 'Published products'}</span></div><div className="studio-viewports"><button type="button" aria-pressed={viewport==='desktop'} onClick={()=>setViewport('desktop')}>{id ? 'Desktop' : 'Desktop'}</button><button type="button" aria-pressed={viewport==='mobile'} onClick={()=>setViewport('mobile')}>Mobile</button></div></div><div className={'studio-preview-frame studio-preview-'+viewport}><CreatorStorefront design={design} catalog={catalog} embedded /></div></section>
    </div>
  </div>;
}
