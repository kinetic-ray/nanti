import { api, errorMessage } from './api.js';
import { ArrowDown, ArrowUp, Check, ChevronDown, RotateCcw, Sparkles } from 'lucide-react';
import type { StorefrontProduct } from '../shared/creator-catalog.js';
import { useEffect, useRef, useState } from 'react';
import { CreatorStorefront } from './creator-storefront.js';
import { applyColorPreset, applyLayoutPreset, presets, validateDesign } from './creator-design.js';
import type { CreatorDesign, CreatorSection, CreatorTheme, LayoutPreset } from './creator-design.js';
import { useLocale } from './locale.js';
import './creator-studio.css';

const storageKey = 'nanti.creator.design.draft.v1';
function initialDesign(key: string): CreatorDesign {
  try { const saved = localStorage.getItem(key); return saved ? validateDesign(JSON.parse(saved)) : presets.editorial; }
  catch { return presets.editorial; }
}

const layoutOptions: Array<{ value: LayoutPreset; name: { id: string; en: string }; desc: { id: string; en: string } }> = [
  { value: 'simple', name: { id: 'Simpel & Rapi', en: 'Simple & Clear' }, desc: { id: 'Tampilan bersih yang mudah dibaca.', en: 'A clean page that is easy to scan.' } },
  { value: 'bold', name: { id: 'Berani & Beda', en: 'Bold & Distinctive' }, desc: { id: 'Judul kuat dan kartu yang tegas.', en: 'Strong headings and confident cards.' } },
  { value: 'elegant', name: { id: 'Elegan & Berkelas', en: 'Elegant & Polished' }, desc: { id: 'Ruang lega dengan sentuhan klasik.', en: 'Open spacing with a classic touch.' } },
  { value: 'magazine', name: { id: 'Penuh Cerita', en: 'Magazine Style' }, desc: { id: 'Sorotan editorial untuk pilihanmu.', en: 'Editorial space for your recommendations.' } },
  { value: 'dynamic', name: { id: 'Seru & Dinamis', en: 'Bright & Dynamic' }, desc: { id: 'Komposisi aktif dengan warna yang hidup.', en: 'An active composition with lively color.' } },
  { value: 'playful', name: { id: 'Ceria & Santai', en: 'Playful & Relaxed' }, desc: { id: 'Sudut membulat dan kartu yang ramah.', en: 'Rounded shapes and friendly cards.' } },
];
const colorOptions: Array<{ value: CreatorTheme; name: { id: string; en: string } }> = [
  { value: 'editorial', name: { id: 'Merona', en: 'Rose' } },
  { value: 'utility', name: { id: 'Kontras', en: 'Contrast' } },
  { value: 'gallery', name: { id: 'Hangat', en: 'Warm' } },
];
const sectionNames: Record<CreatorSection, { id: string; en: string }> = {
  profile: { id: 'Profil kreator', en: 'Creator profile' },
  hero: { id: 'Sorotan utama', en: 'Featured story' },
  collections: { id: 'Koleksi', en: 'Collections' },
  products: { id: 'Daftar produk', en: 'Product list' },
};
const steps = ['theme', 'layout', 'cards', 'type', 'sections'] as const;
type StudioTab = typeof steps[number];
const stepLabels = { id: ['Warna', 'Tata letak', 'Kartu produk', 'Huruf', 'Urutan konten'], en: ['Colors', 'Layout', 'Product cards', 'Typography', 'Sections'] };
const stepHints = { id: ['Pilih palet warna. Tata letak bisa diatur terpisah.', 'Atur bagian atas dan jumlah kolom.', 'Atur cara produk ditampilkan.', 'Pilih gaya judul.', 'Tentukan urutan isi halaman.'], en: ['Choose a color palette. Layout is set separately.', 'Arrange the main section and columns.', 'Control product presentation.', 'Choose the heading style.', 'Order the page sections.'] };

export function CreatorDesignStudio({ ownerId, draft, catalog, onSaved }: {
  ownerId: string; draft: unknown; catalog: { name: string; products: StorefrontProduct[] };
  onSaved: (design: CreatorDesign) => void;
}) {
  const ownedKey = storageKey + '.' + ownerId;
  const { language, t } = useLocale();
  const id = language === 'id';
  const [design, setDesign] = useState<CreatorDesign>(() => draft === null ? initialDesign(ownedKey) : validateDesign(draft));
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>(window.matchMedia('(max-width: 40rem)').matches ? 'mobile' : 'desktop');
  const [mode, setMode] = useState<'easy' | 'advanced'>('easy');
  const [tab, setTab] = useState<StudioTab>('theme');
  const [showMoreLayouts, setShowMoreLayouts] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(design);
  const [hasSavedDraft, setHasSavedDraft] = useState(draft !== null);
  const [mobilePanel, setMobilePanel] = useState<'edit' | 'preview'>('edit');
  const dialog = useRef<HTMLDialogElement>(null);
  const presetTrigger = useRef<HTMLButtonElement | null>(null);
  const unsaved = JSON.stringify(design) !== JSON.stringify(snapshot);
  const stepIndex = steps.indexOf(tab);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => {
    const element = dialog.current;
    if (!confirmReset || !element) return;
    if (!element.open) element.showModal();
    element.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    return () => { if (element.open) element.close(); };
  }, [confirmReset]);

  const update = (patch: Partial<CreatorDesign>) => { setDesign(prev => validateDesign({ ...prev, ...patch })); setNotice(''); };
  const persist = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      await api('/account/creator/design', { method: 'PUT', data: { design } });
      setSnapshot(design);
      setHasSavedDraft(true);
      onSaved(design);
      setNotice(id ? 'Draf tampilan disimpan di akunmu. Etalase publik belum berubah.' : 'Design draft saved to your account. Your public storefront has not changed.');
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
    const next = [...design.sections]; const from = next.indexOf(section); const to = from + by;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to]!, next[from]!]; update({ sections: next });
  };
  const requestLayoutPreset = (value: LayoutPreset) => {
    setDesign(current => applyLayoutPreset(current, value, true));
    setNotice('');
  };
  const requestColorPreset = (value: CreatorTheme) => {
    setDesign(current => applyColorPreset(current, value, true));
    setNotice('');
  };
  const finishReset = () => {
    setDesign(presets.editorial);
    setConfirmReset(false);
    setNotice('');
    window.requestAnimationFrame(() => presetTrigger.current?.focus());
  };
  const cancelPreset = () => {
    setConfirmReset(false);
    window.requestAnimationFrame(() => presetTrigger.current?.focus());
  };
  const firstLayouts = layoutOptions.slice(0, 4);
  const visibleLayouts = showMoreLayouts ? layoutOptions : firstLayouts;

  return <div className="studio">
    <header className="studio-header">
      <div><strong>{id ? 'Tampilan etalase' : 'Storefront appearance'}</strong><p className="studio-draft-status" role="status">{unsaved ? (id ? 'Ada perubahan yang belum disimpan' : 'You have unsaved changes') : hasSavedDraft ? (id ? 'Draf tersimpan di akun · belum diterapkan ke etalase publik' : 'Saved draft · not applied to your public storefront') : (id ? 'Tampilan awal · belum disimpan' : 'Default design · not saved')}</p></div>
      <div className="studio-header-actions">
        {unsaved && <button type="button" onClick={() => { setDesign(snapshot); setNotice(''); setError(''); }}><RotateCcw size={16} aria-hidden="true" />{id ? 'Urungkan' : 'Undo'}</button>}
        <button className="aw-primary" type="button" onClick={persist} disabled={saving}>{saving ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan draf' : 'Save draft')}</button>
      </div>
    </header>
    {(notice || error) && <div className="studio-save-feedback">
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error === 'session'
        ? <a href="/account?next=creator">{t('Sign in again to save')}</a>
        : t('Could not save your draft. Try again.')}</p>}
    </div>}
    <div className="studio-mobile-switch" role="group" aria-label={id ? 'Mode studio' : 'Studio view'}><button type="button" aria-pressed={mobilePanel === 'edit'} onClick={() => setMobilePanel('edit')}>{id ? 'Ubah desain' : 'Edit design'}</button><button type="button" aria-pressed={mobilePanel === 'preview'} onClick={() => setMobilePanel('preview')}>{id ? 'Lihat hasil' : 'Preview'}</button></div>
    <div className={'studio-workspace studio-show-' + mobilePanel}>
      <aside className="studio-panel">
        {mode === 'easy' ? <div className="studio-easy-setup">
          <div className="studio-easy-heading"><Sparkles size={18} aria-hidden="true" /><div><h2>{id ? 'Pilih gaya etalase' : 'Choose a storefront style'}</h2><p>{id ? 'Pilih gaya dan warna. Hasilnya langsung terlihat di pratinjau.' : 'Choose a layout and color. The preview updates as you go.'}</p></div></div>
          <fieldset className="studio-preset-fieldset"><legend>{id ? 'Tata letak' : 'Layout'}</legend><div className="studio-easy-layout-grid">
            {visibleLayouts.map(option => <button type="button" key={option.value} className="studio-layout-option" aria-pressed={design.layoutPreset === option.value} onClick={() => requestLayoutPreset(option.value)}>
              <span className={'studio-miniature studio-miniature-' + option.value} aria-hidden="true"><i /><i /><i /><b /><small /></span>
              <strong>{option.name[id ? 'id' : 'en']}</strong><small>{option.desc[id ? 'id' : 'en']}</small>
            </button>)}
          </div></fieldset>
          {!showMoreLayouts && <button className="studio-more-layouts" type="button" onClick={() => setShowMoreLayouts(true)}>{id ? 'Lihat gaya lainnya' : 'See more styles'}<ChevronDown size={16} aria-hidden="true" /></button>}
          <fieldset className="studio-preset-fieldset"><legend>{id ? 'Palet warna' : 'Color palette'}</legend><div className="studio-color-options">
            {colorOptions.map(option => <button type="button" key={option.value} aria-pressed={design.colorPreset === option.value} onClick={() => requestColorPreset(option.value)}><span className={'studio-preset-swatch studio-swatch-' + option.value} aria-hidden="true" />{option.name[id ? 'id' : 'en']}</button>)}
          </div></fieldset>
          <details className="studio-advanced studio-easy-colors"><summary>{id ? 'Sesuaikan warna sendiri' : 'Choose custom colors'}</summary>
            <label>{id ? 'Warna aksen' : 'Accent'}<input type="color" value={design.accent} onChange={event => update({ accent: event.target.value })} /></label>
            <label>{id ? 'Latar belakang' : 'Background'}<input type="color" value={design.background} onChange={event => update({ background: event.target.value })} /></label>
            <label>{id ? 'Warna teks' : 'Text color'}<input type="color" value={design.foreground} onChange={event => update({ foreground: event.target.value })} /></label>
          </details>
          <div className="studio-easy-footer"><button type="button" onClick={() => { setMode('advanced'); setTab('layout'); }}>{id ? 'Sesuaikan detail' : 'Customize details'}</button><button className="aw-primary" type="button" onClick={persist} disabled={saving}>{saving ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Terapkan & simpan draf' : 'Apply & save draft')}</button></div>
        </div> : <>
          <div className="studio-mode-heading"><button type="button" onClick={() => setMode('easy')}>{id ? '← Pengaturan mudah' : '← Easy setup'}</button><strong>{id ? 'Pengaturan lanjutan' : 'Advanced settings'}</strong></div>
          <nav className="studio-tabs" aria-label={id ? 'Pengaturan desain' : 'Design settings'}>{steps.map((value, index) =>
            <button key={value} type="button" aria-current={tab === value ? 'true' : undefined} onClick={() => setTab(value)}>{stepLabels[id ? 'id' : 'en'][index]}</button>
          )}</nav>
          <p className="studio-step-hint">{stepHints[id ? 'id' : 'en'][stepIndex]}</p>
          <div className="studio-settings">
            {tab === 'theme' && <><h2>{id ? 'Palet warna' : 'Color palette'}</h2><p>{id ? 'Warna bisa diubah sendiri dan tidak mengubah tata letak.' : 'Colors can be customized without changing the layout.'}</p><div className="studio-preset-grid">{colorOptions.map(option => <button type="button" key={option.value} aria-pressed={design.colorPreset === option.value} onClick={() => requestColorPreset(option.value)}><span className={'studio-preset-swatch studio-swatch-' + option.value} />{option.name[id ? 'id' : 'en']}</button>)}</div><details className="studio-advanced" open><summary>{id ? 'Warna kustom' : 'Custom colors'}</summary><label>{id ? 'Warna aksen' : 'Accent'}<input type="color" value={design.accent} onChange={event => update({ accent: event.target.value })} /></label><label>{id ? 'Latar belakang' : 'Background'}<input type="color" value={design.background} onChange={event => update({ background: event.target.value })} /></label><label>{id ? 'Warna teks' : 'Text color'}<input type="color" value={design.foreground} onChange={event => update({ foreground: event.target.value })} /></label></details></>}
            {tab === 'layout' && <><h2>{id ? 'Tampilan bagian utama' : 'Main section layout'}</h2><div className="studio-choice-grid">{(['split', 'center', 'compact'] as const).map(value => <button type="button" key={value} aria-pressed={design.heroLayout === value} onClick={() => update({ heroLayout: value })}>{({ split: id ? 'Berdampingan' : 'Side by side', center: id ? 'Di tengah' : 'Centered', compact: id ? 'Ringkas' : 'Compact' } as const)[value]}</button>)}</div><div className="studio-field"><strong>{id ? 'Kepadatan produk' : 'Product density'}</strong><div className="studio-choice-grid">{([2, 3, 4] as const).map((value, index) => <button key={value} type="button" aria-pressed={design.columns === value} onClick={() => update({ columns: value })}><span className="studio-column-icon" style={{ gridTemplateColumns: `repeat(${value},1fr)` }}>{Array.from({ length: value * 2 }, (_, i) => <i key={i} />)}</span>{(id ? ['Lapang', 'Seimbang', 'Padat'] : ['Spacious', 'Balanced', 'Compact'])[index]}</button>)}</div></div></>}
            {tab === 'cards' && <><h2>{id ? 'Kartu produk' : 'Product cards'}</h2><label>{id ? 'Gaya kartu' : 'Card style'}<select value={design.cardStyle} onChange={event => update({ cardStyle: event.target.value as CreatorDesign['cardStyle'] })}><option value="minimal">Minimal</option><option value="bordered">{id ? 'Bergaris' : 'Bordered'}</option><option value="solid">{id ? 'Blok' : 'Solid'}</option></select></label><label>{id ? 'Rasio foto' : 'Image ratio'}<select value={design.imageRatio} onChange={event => update({ imageRatio: event.target.value as CreatorDesign['imageRatio'] })}><option value="square">{id ? '1:1 Persegi' : '1:1 Square'}</option><option value="portrait">{id ? '4:5 Potret' : '4:5 Portrait'}</option><option value="landscape">{id ? '4:3 Lanskap' : '4:3 Landscape'}</option></select></label><div className="studio-field"><strong>{id ? 'Bentuk sudut' : 'Corner style'}</strong><div className="studio-choice-grid">{([0, 12, 28] as const).map((value, index) => <button type="button" key={value} aria-pressed={Math.abs(design.radius - value) < 7} onClick={() => update({ radius: value })}><span className="studio-corner-icon" style={{ borderRadius: value }} />{(id ? ['Tegas', 'Lembut', 'Bulat'] : ['Sharp', 'Soft', 'Round'])[index]}</button>)}</div></div><label className="studio-check"><input type="checkbox" checked={design.showPrices} onChange={event => update({ showPrices: event.target.checked })} />{id ? 'Tampilkan harga' : 'Show prices'}</label><label className="studio-check"><input type="checkbox" checked={design.showCategories} onChange={event => update({ showCategories: event.target.checked })} />{id ? 'Tampilkan kategori' : 'Show categories'}</label></>}
            {tab === 'type' && <><h2>{id ? 'Tipografi' : 'Typography'}</h2><p>{id ? 'Pilih karakter heading tanpa mengorbankan keterbacaan teks produk.' : 'Choose heading character without compromising product readability.'}</p><div className="studio-choice-grid">{(['sans', 'serif', 'mono'] as const).map(value => <button className="studio-font-choice" type="button" key={value} aria-pressed={design.headingFont === value} onClick={() => update({ headingFont: value })}><span className={'studio-font-sample studio-font-' + value} aria-hidden="true">Aa</span><span className={'studio-font-name studio-font-' + value}>{({ sans: 'Sans serif', serif: 'Serif', mono: 'Monospace' } as const)[value]}</span><small>{({ sans: id ? 'Modern' : 'Modern & clean', serif: id ? 'Klasik' : 'Editorial & classic', mono: id ? 'Teknis' : 'Technical & precise' } as const)[value]}</small></button>)}</div></>}
            {tab === 'sections' && <><h2>{id ? 'Urutan konten' : 'Section order'}</h2><p>{id ? 'Pindahkan bagian ke atas atau bawah.' : 'Move sections up or down.'}</p><ol className="studio-section-list">{design.sections.map((section, index) => <li key={section}><span>{sectionNames[section][id ? 'id' : 'en']}</span><button type="button" disabled={index === 0} aria-label={id ? 'Naikkan ' + sectionNames[section].id : 'Move ' + section + ' up'} onClick={() => move(section, -1)}><ArrowUp size={16} aria-hidden="true" /></button><button type="button" disabled={index === design.sections.length - 1} aria-label={id ? 'Turunkan ' + sectionNames[section].id : 'Move ' + section + ' down'} onClick={() => move(section, 1)}><ArrowDown size={16} aria-hidden="true" /></button></li>)}</ol></>}
          </div>
          <div className="studio-panel-footer"><button type="button" onClick={event => { presetTrigger.current = event.currentTarget; setConfirmReset(true); }}>{id ? 'Reset desain' : 'Reset design'}</button><button type="button" onClick={downloadDesign}>{t('Download design backup')}</button><button className="aw-primary" type="button" onClick={persist} disabled={saving}>{id ? 'Simpan draf' : 'Save draft'}</button></div>
        </>}
      </aside>
      <section className="studio-preview-area" aria-label={id ? 'Pratinjau langsung' : 'Live preview'}><div className="studio-preview-toolbar"><div><strong>{id ? 'Pratinjau langsung' : 'Live preview'}</strong><br /><span className="aw-muted">{id ? 'Etalase publik diperbarui setelah draf ini diterbitkan.' : 'Your public storefront updates when you publish this draft.'}</span></div><div className="studio-viewports"><button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}>{id ? 'Komputer' : 'Desktop'}</button><button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}>{id ? 'Ponsel' : 'Mobile'}</button></div></div><div className={'studio-preview-frame studio-preview-' + viewport}><CreatorStorefront design={design} catalog={catalog} embedded /></div></section>
    </div>
    <dialog ref={dialog} className="studio-preset-dialog" aria-labelledby="studio-preset-title" onCancel={event => { event.preventDefault(); cancelPreset(); }} onClick={event => { if (event.target === dialog.current) cancelPreset(); }}>
      <div className="studio-preset-dialog-content"><h2 id="studio-preset-title">{id ? 'Reset desain?' : 'Reset design?'}</h2><p>{id ? 'Semua penyesuaian akan dikembalikan ke tampilan awal.' : 'All custom settings will return to the default design.'}</p>
        <div className="studio-preset-dialog-actions"><button type="button" className="aw-danger" onClick={finishReset} data-autofocus>{id ? 'Reset desain' : 'Reset design'}</button><button type="button" onClick={cancelPreset}>{id ? 'Batal' : 'Cancel'}</button></div>
      </div>
    </dialog>
  </div>;
}
