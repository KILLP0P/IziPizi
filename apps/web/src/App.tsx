import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, Clipboard, Film, Globe2, Headphones, Image as ImageIcon, Link2, LoaderCircle, Monitor, Moon, ShieldCheck, Sparkles, Sun, UserRound, X } from 'lucide-react';
import { normalizeMediaUrl, type Analysis, type Media } from '@izipizi/shared';
import * as api from './api';

type Theme = 'light' | 'dark' | 'system';
const themeIcons = { light: Sun, dark: Moon, system: Monitor };
const themeLabels = { light: 'Claro', dark: 'Oscuro', system: 'Automático' };
function initialTheme(): Theme { try { const saved = localStorage.getItem('izipizi-theme') ?? localStorage.getItem('mediadrop-theme'); return saved === 'light' || saved === 'dark' ? saved : 'system'; } catch { return 'system'; } }
function ThemeSwitch() {
 const [theme,setTheme] = useState<Theme>(initialTheme);
 useEffect(() => {
   const query = matchMedia('(prefers-color-scheme: dark)');
   const update = () => { document.documentElement.dataset.theme = theme === 'system' ? query.matches ? 'dark' : 'light' : theme; };
   update(); query.addEventListener('change',update); try { localStorage.setItem('izipizi-theme',theme); } catch { /* storage optional */ }
   return () => query.removeEventListener('change',update);
 },[theme]);
 return <div className="theme-switch" role="group" aria-label="Tema de la interfaz">{(['light','dark','system'] as const).map(t => { const Icon = themeIcons[t]; return <button key={t} type="button" title={themeLabels[t]} aria-label={`Tema ${themeLabels[t].toLowerCase()}`} aria-pressed={theme === t} onClick={() => setTheme(t)}><Icon size={15}/></button>; })}</div>;
}
function MediaCard({ media,sessionId }: { media: Media; sessionId: string }) {
 const [quality,setQuality] = useState(media.qualities[0]!.id);
 const [status,setStatus] = useState<'idle'|'loading'|'done'>('idle');
 const [error,setError] = useState(''); const [imageError,setImageError] = useState(false);
 const controller = useRef<AbortController | null>(null);
 useEffect(() => () => controller.current?.abort(),[]);
 const kind = media.kind === 'image' ? 'Imagen' : media.kind === 'gif' ? 'GIF' : media.kind === 'audio' ? 'Audio' : 'Vídeo';
 async function save() {
   const task = new AbortController(); controller.current = task; setStatus('loading'); setError('');
   try { await api.download(sessionId,media.id,quality,task.signal); setStatus('done'); }
   catch (e) { setStatus('idle'); if (!task.signal.aborted) setError(e instanceof Error ? e.message : 'No se ha podido descargar el archivo.'); }
 }
 return <article className="media-card">
   <div className="media-preview">{media.previewUrl && !imageError ? <img src={media.previewUrl} alt={`Vista previa del ${kind.toLowerCase()}`} loading="lazy" onError={() => setImageError(true)}/> : <div className="preview-fallback">{media.kind === 'image' ? <ImageIcon size={32}/> : media.kind === 'audio' ? <Headphones size={32}/> : <Film size={32}/>}<span>{media.kind === 'audio' ? 'Audio listo para descargar' : 'Vista previa no disponible'}</span></div>}<span className="media-badge">{kind}{media.duration ? ` · ${Math.floor(media.duration / 60)}:${String(Math.floor(media.duration % 60)).padStart(2,'0')}` : ''}</span></div>
   <div className="media-controls"><div className="media-info"><strong>{kind} {Number(media.id.slice(1)) + 1}</strong><span>{media.width && media.height ? `${media.width} × ${media.height} · ` : ''}{media.kind === 'gif' ? 'GIF animado' : media.qualities.find(q => q.id === quality)!.extension.toUpperCase()}</span></div>
   {media.qualities.length > 1 ? <label className="quality"><span className="sr-only">Calidad de {kind.toLowerCase()}</span><select value={quality} disabled={status === 'loading'} onChange={e => { setQuality(e.target.value); setStatus('idle'); }}>{media.qualities.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select><ChevronDown size={14}/></label> : <span className="single-quality">Original</span>}
   <button className="save-button" onClick={() => { void save(); }} disabled={status === 'loading'}>{status === 'loading' ? <LoaderCircle className="spin" size={17}/> : status === 'done' ? <CheckCheck size={17}/> : <ArrowDownToLine size={17}/>} {status === 'loading' ? 'Preparando…' : status === 'done' ? 'Descargar de nuevo' : 'Descargar'}</button>
   {status === 'loading' && <button className="cancel-download" onClick={() => controller.current?.abort()}>Cancelar</button>}
   {status === 'done' && <p className="download-success" role="status">Archivo enviado al navegador.</p>}{error && <p className="card-error" role="alert">{error}</p>}</div>
 </article>;
}
export function App() {
 const [url,setUrl] = useState(''); const [result,setResult] = useState<Analysis | null>(null); const [loading,setLoading] = useState(false);
 const [error,setError] = useState(''); const [clipboardHint,setClipboardHint] = useState(''); const [accountOpen,setAccountOpen] = useState(false);
 const controller = useRef<AbortController | null>(null); const inputRef = useRef<HTMLInputElement>(null); const resultRef = useRef<HTMLElement>(null);
 useEffect(() => () => controller.current?.abort(),[]);
 useEffect(() => { if (result) { resultRef.current?.focus({ preventScroll:true }); resultRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'nearest' }); } },[result]);
 async function submit(e: FormEvent) {
   e.preventDefault(); if (loading) return; setError(''); setClipboardHint('');
   let normalized: string; try { normalized = normalizeMediaUrl(url); } catch (e) { setError((e as Error).message); inputRef.current?.focus(); return; }
   const task = new AbortController(); controller.current = task; setLoading(true); setResult(null);
   try { setResult(await api.analyze(normalized,task.signal)); } catch (e) { if (!task.signal.aborted) setError(e instanceof Error ? e.message : 'No se ha podido analizar el enlace.'); } finally { setLoading(false); }
 }
 async function paste() { try { const text = await navigator.clipboard.readText(); setUrl(text.trim()); setError(''); setClipboardHint(''); inputRef.current?.focus(); } catch { setClipboardHint('Pega el enlace con ⌘V o mantén pulsado el campo.'); inputRef.current?.focus(); } }
 return <div className="app-shell">
   <a href="#download" className="skip-link">Ir al campo de descarga</a>
   <header className="site-header"><a className="brand" href="/" aria-label="IziPizi, inicio"><span className="brand-mark"><ArrowDownToLine size={23} strokeWidth={2.4}/></span><span>IziPizi<span className="brand-dot">.</span></span></a><div className="header-actions"><span className="guest-label"><span/>Modo invitado</span><ThemeSwitch/><div className="account-wrap"><button className="account-button" title="Acerca de las cuentas" aria-label="Información de cuenta" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><UserRound size={19}/></button>{accountOpen && <div className="account-popover"><button className="popover-close" aria-label="Cerrar información" onClick={() => setAccountOpen(false)}><X size={15}/></button><strong>Sin cuenta. Con libertad.</strong><p>IziPizi funciona en modo invitado. Las cuentas opcionales llegarán en una futura versión.</p></div>}</div></div></header>
   <main><section className="hero" aria-labelledby="hero-title"><div className="eyebrow"><Globe2 size={13}/> DE LA WEB A TU CARPETA</div><h1 id="hero-title">Lo ves.<br/>Lo pegas. <span>Lo tienes.<svg viewBox="0 0 320 14" aria-hidden="true" preserveAspectRatio="none"><path d="M4 10Q160 0 316 7"/></svg></span></h1><p className="hero-description">Vídeos, audio, GIFs e imágenes.<br className="mobile-break"/> De la web a tu dispositivo.</p>
   <div className="download-area" id="download"><form className={`download-form ${error ? 'has-error' : ''}`} onSubmit={e => { void submit(e); }} noValidate aria-busy={loading}><label htmlFor="post-url" className="sr-only">Enlace de una página o archivo multimedia público</label><div className="input-wrap"><Link2 size={21} className="link-icon"/><input ref={inputRef} id="post-url" name="url" type="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Pega el enlace de una página o archivo…" value={url} disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? 'form-error' : 'input-help'} onChange={e => { setUrl(e.target.value); setError(''); }}/>{url && !loading ? <button className="paste-button" type="button" title="Borrar enlace" aria-label="Borrar enlace" onClick={() => { setUrl(''); setResult(null); setError(''); setClipboardHint(''); inputRef.current?.focus(); }}><X size={17}/></button> : <button className="paste-button" type="button" disabled={loading} onClick={() => { void paste(); }} aria-label="Pegar desde el portapapeles"><Clipboard size={16}/><span>Pegar</span></button>}</div><button className="primary-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={19}/>Analizando…</> : <>Obtener archivos<ArrowRight size={19}/></>}</button></form>
   {error && <p id="form-error" className="form-error" role="alert">{error}</p>}{clipboardHint && <p className="clipboard-hint" role="status">{clipboardHint}</p>}
   <div className="input-help" id="input-help">{loading ? <><span className="pulse-dot"/>Buscando el contenido multimedia…<button onClick={() => controller.current?.abort()}>Cancelar</button></> : <><ShieldCheck size={14}/><span>Sin registro. Sin historial. Directo a tu dispositivo.</span></>}</div></div>
   <div className="format-list" aria-label="Formatos compatibles"><span><Film size={15}/>Vídeos</span><span className="format-separator"/><span><span className="gif-icon">GIF</span>GIFs</span><span className="format-separator"/><span><ImageIcon size={15}/>Imágenes</span><span className="format-separator"/><span><Headphones size={15}/>Audio</span></div><p className="compatibility-note">Páginas públicas, plataformas compatibles y enlaces directos.</p>
   </section>
   {result ? <section className="results" ref={resultRef} tabIndex={-1} aria-labelledby="results-heading"><div className="results-heading"><div><p className="section-kicker"><Check size={14}/>TODO LISTO</p><h2 id="results-heading">Tu contenido, a un clic.</h2></div><span className="result-count">{result.media.length} {result.media.length === 1 ? 'archivo' : 'archivos'}</span></div><div className="post-summary"><span className="source-site"><Globe2 size={16}/>{new URL(result.sourceUrl).hostname.replace(/^www\./,'')}</span><div>{result.author && <strong>{result.author}</strong>}<p>{result.title}</p></div></div>{result.warnings.map(w => <p key={w} className="result-warning">{w}</p>)}<div className="media-grid">{result.media.map(media => <MediaCard key={`${result.sessionId}-${media.id}`} sessionId={result.sessionId} media={media}/>)}</div><p className="expiry-note">Por privacidad, esta vista previa caduca en unos minutos. Los GIFs se descargan en formato .gif.</p></section> : <section className="how-it-works" aria-labelledby="how-title"><div className="section-heading"><span className="section-kicker" id="how-title">ASÍ DE FÁCIL</span><span>Tres pasos. Cero complicaciones.</span></div><div className="steps-grid"><div className="step"><span className="step-number">01</span><div className="step-icon"><Link2 size={20}/></div><h2>Copia el enlace</h2><p>Encuentra un vídeo, audio o imagen<br className="desktop-break"/> y copia su enlace.</p></div><div className="step"><span className="step-number">02</span><div className="step-icon"><Clipboard size={20}/></div><h2>Pégalo aquí</h2><p>Nosotros buscamos los archivos<br className="desktop-break"/> y la mejor calidad disponible.</p></div><div className="step"><span className="step-number">03</span><div className="step-icon"><ArrowDown size={20}/></div><h2>Hazlo tuyo</h2><p>Elige tu archivo y descárgalo.<br className="desktop-break"/> Tan sencillo como debería ser.</p></div></div></section>}
   <aside className="privacy-note"><span className="privacy-icon"><Sparkles size={19}/></span><p><strong>Pequeña herramienta. Grandes principios.</strong><span>Sin anuncios, sin rastreo y sin guardar tus archivos.</span></p><span className="open-source-badge">OPEN SOURCE</span></aside>
   </main><footer><span>Hecho para simplificar.</span><div><span>Solo contenido público</span><span className="footer-dot">·</span><span>Respeta los derechos de sus creadores.</span></div><span className="footer-version">IziPizi <span>v0.2</span></span></footer>
 </div>;
}
