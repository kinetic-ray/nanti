import { useState } from 'react';
import { CreatorStorefront } from './creator-storefront.js';
import { presets, validateDesign } from './creator-design.js';
import type { CreatorDesign, CreatorSection, CreatorTheme } from './creator-design.js';
import { useLocale } from './locale.js';
import './creator-studio.css';

const storageKey = 'nanti.creator.design.draft.v1';
function initialDesign(): CreatorDesign {
  try { const saved = localStorage.getItem(storageKey); return saved ? validateDesign(JSON.parse(saved)) : presets.editorial; }
  catch { return presets.editorial; }
}
const sectionNames: Record<CreatorSection,string> = { profile:'Creator profile', hero:'Featured hero', collections:'Collections', products:'Product grid' };
export function CreatorDesignStudio() {
  const { language } = useLocale();
  const id = language === 'id';
  const [design, setDesign] = useState<CreatorDesign>(initialDesign);
  const [viewport, setViewport] = useState<'desktop'|'mobile'>('desktop');
  const [tab, setTab] = useState<'theme'|'layout'|'cards'|'type'|'sections'>('theme');
  const [notice, setNotice] = useState('');
  const update = (patch: Partial<CreatorDesign>) => { setDesign(prev => ({ ...prev, ...patch })); setNotice(''); };
  const persist = () => { try { localStorage.setItem(storageKey,JSON.stringify(design)); setNotice(id ? 'Draft disimpan di browser ini.' : 'Draft saved in this browser.'); } catch { setNotice(id ? 'Penyimpanan browser tidak tersedia.' : 'Browser storage unavailable.'); } };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(design,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download='nanti-creator-design.json'; link.click(); URL.revokeObjectURL(url);
  };
  const move = (section: CreatorSection, by: number) => {
    const next = [...design.sections]; const from = next.indexOf(section); const to = from+by;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from],next[to]]=[next[to]!,next[from]!]; update({sections:next});
  };
  return <div className="studio">
    <header className="studio-header"><a href="/creator">nanti<span>.</span> <small>creator studio</small></a><span className="studio-status">{id ? 'DESIGN SANDBOX · BELUM DIPUBLIKASIKAN' : 'DESIGN SANDBOX · NOT PUBLISHED'}</span><div><a href="/creator/demo">{id ? 'Lihat demo' : 'View demo'}</a><button type="button" onClick={persist}>{id ? 'Simpan draft' : 'Save draft'}</button><button type="button" onClick={exportJson}>Export JSON</button></div></header>
    <div className="studio-workspace">
      <aside className="studio-panel"><div className="studio-panel-heading"><span>CREATOR DESIGN STUDIO / 01</span><h1>{id ? 'Bentuk etalasemu.' : 'Make it yours.'}</h1><p>{id ? 'Atur tampilan, posisi hero, kartu produk, tipografi, dan urutan bagian. Semua perubahan langsung terlihat.' : 'Adjust layouts, hero, product cards, typography and section order with live preview.'}</p></div>
      <nav className="studio-tabs" aria-label={id ? 'Pengaturan desain' : 'Design settings'}>{(['theme','layout','cards','type','sections'] as const).map(value => <button key={value} type="button" aria-current={tab===value?'page':undefined} onClick={() => setTab(value)}>{value==='type'?'Typography':value.charAt(0).toUpperCase()+value.slice(1)}</button>)}</nav>
      <div className="studio-settings">
        {tab==='theme' && <><h2>{id ? 'Karakter visual' : 'Visual direction'}</h2><p>{id ? 'Preset mengubah banyak properti sekaligus, bukan hanya warna.' : 'Presets change the full visual system, not just colors.'}</p><div className="studio-preset-grid">{(['editorial','utility','gallery'] as CreatorTheme[]).map(theme=><button type="button" key={theme} aria-pressed={design.theme===theme} onClick={()=>setDesign({...presets[theme],sections:design.sections})}><span className={'studio-preset-swatch studio-swatch-'+theme}/>{theme}</button>)}</div><label>{id ? 'Warna aksen' : 'Accent'}<input type="color" value={design.accent} onChange={event=>update({accent:event.target.value})}/></label><label>{id ? 'Latar belakang' : 'Background'}<input type="color" value={design.background} onChange={event=>update({background:event.target.value})}/></label><label>{id ? 'Warna teks' : 'Text color'}<input type="color" value={design.foreground} onChange={event=>update({foreground:event.target.value})}/></label></>}
        {tab==='layout' && <><h2>Hero layout</h2><div className="studio-choice-grid">{(['split','center','compact'] as const).map(value=><button type="button" key={value} aria-pressed={design.heroLayout===value} onClick={()=>update({heroLayout:value})}>{value}</button>)}</div><label>{id ? 'Kolom produk' : 'Product columns'}<select value={design.columns} onChange={event=>update({columns:Number(event.target.value) as 2|3|4})}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label></>}
        {tab==='cards' && <><h2>{id ? 'Kartu produk' : 'Product cards'}</h2><label>Card style<select value={design.cardStyle} onChange={event=>update({cardStyle:event.target.value as CreatorDesign['cardStyle']})}><option value="minimal">Minimal</option><option value="bordered">Bordered</option><option value="solid">Solid</option></select></label><label>Image ratio<select value={design.imageRatio} onChange={event=>update({imageRatio:event.target.value as CreatorDesign['imageRatio']})}><option value="square">1:1 Square</option><option value="portrait">4:5 Portrait</option><option value="landscape">4:3 Landscape</option></select></label><label>Corner radius · {design.radius}px<input type="range" min="0" max="32" value={design.radius} onChange={event=>update({radius:Number(event.target.value)})}/></label><label className="studio-check"><input type="checkbox" checked={design.showPrices} onChange={event=>update({showPrices:event.target.checked})}/>{id ? 'Tampilkan harga' : 'Show prices'}</label><label className="studio-check"><input type="checkbox" checked={design.showCategories} onChange={event=>update({showCategories:event.target.checked})}/>{id ? 'Tampilkan kategori' : 'Show categories'}</label></>}
        {tab==='type' && <><h2>Typography</h2><p>{id ? 'Pilih karakter heading tanpa mengorbankan keterbacaan teks produk.' : 'Choose heading character without compromising product readability.'}</p><div className="studio-choice-grid">{(['sans','serif','mono'] as const).map(value=><button type="button" key={value} aria-pressed={design.headingFont===value} onClick={()=>update({headingFont:value})}>{value}</button>)}</div></>}
        {tab==='sections' && <><h2>{id ? 'Urutan section' : 'Section order'}</h2><p>{id ? 'Pindahkan bagian ke atas atau bawah.' : 'Move sections up or down.'}</p><ol className="studio-section-list">{design.sections.map((section,index)=><li key={section}><span>{sectionNames[section]}</span><button type="button" disabled={index===0} aria-label={'Move '+section+' up'} onClick={()=>move(section,-1)}>↑</button><button type="button" disabled={index===design.sections.length-1} aria-label={'Move '+section+' down'} onClick={()=>move(section,1)}>↓</button></li>)}</ol></>}
      </div>
      <div className="studio-panel-footer"><button type="button" onClick={()=>{setDesign(presets.editorial);setNotice('');}}>{id ? 'Reset desain' : 'Reset design'}</button><span role="status">{notice}</span></div></aside>
      <section className="studio-preview-area" aria-label={id ? 'Pratinjau langsung' : 'Live preview'}><div className="studio-preview-toolbar"><div><strong>Live preview</strong><span>{id ? 'Data produk masih contoh' : 'Sample products only'}</span></div><div className="studio-viewports"><button type="button" aria-pressed={viewport==='desktop'} onClick={()=>setViewport('desktop')}>{id ? 'Desktop' : 'Desktop'}</button><button type="button" aria-pressed={viewport==='mobile'} onClick={()=>setViewport('mobile')}>Mobile</button></div></div><div className={'studio-preview-frame studio-preview-'+viewport}><CreatorStorefront design={design} embedded /></div></section>
    </div>
  </div>;
}
