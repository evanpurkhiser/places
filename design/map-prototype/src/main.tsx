import {useCallback, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronDown, Compass, MapPin, Search, SlidersHorizontal, X, Clock, Footprints} from 'lucide-react';
import {MapView, CategoryIcon} from './Map';
import {places as samplePlaces, colors, filterPlaces, type Place, type Category} from './places';
import './style.css';
const initialFilters={query:'',categories:[] as Category[],tags:[] as string[],open:false,unvisited:false,hideFood:false};
function readPlaces():Place[] {
  try {
    const saved=JSON.parse(localStorage.getItem('elsewhere-places')||'null');
    if(!Array.isArray(saved)) return samplePlaces;
    return samplePlaces.map(place=>{
      const update=saved.find(p=>p.id===place.id);
      return update ? {...place,note:typeof update.note==='string'?update.note:place.note,visited:typeof update.visited==='boolean'?update.visited:place.visited,tags:Array.isArray(update.tags)&&update.tags.every((t:unknown)=>typeof t==='string')?update.tags:place.tags}:place;
    });
  } catch {return samplePlaces;}
}
function App(){
  const [places,setPlaces]=useState(readPlaces);
  const [filters,setFilters]=useState(initialFilters);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [filterPanel,setFilterPanel]=useState(false);
  const [collapsed,setCollapsed]=useState(false);
  const [tag,setTag]=useState('');
  const [storageError,setStorageError]=useState(false);
  const filtered=useMemo(()=>filterPlaces(places,filters),[places,filters]);
  const selected=places.find(p=>p.id===selectedId)||null;
  const select=useCallback((id:string)=>{setSelectedId(id);setCollapsed(false);},[]);
  const allTags=Array.from(new Set(places.flatMap(p=>p.tags))).sort();
  const filterCount=filters.tags.length+Number(filters.open)+Number(filters.unvisited)+Number(filters.hideFood);
  const active=filterCount>0||filters.categories.length>0||!!filters.query;
  useEffect(()=>{try {localStorage.setItem('elsewhere-places',JSON.stringify(places));setStorageError(false);}catch{setStorageError(true);}},[places]);
  useEffect(()=>{function key(e:KeyboardEvent){if(e.key==='Escape'){setSelectedId(null);setFilterPanel(false);}if(e.key==='/'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();document.getElementById('search')?.focus();}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  function updatePlace(update:Partial<Place>){setPlaces(current=>current.map(p=>p.id===selectedId?{...p,...update}:p));}
  function toggleCategory(category:Category){setSelectedId(null);setFilters(f=>({...f,categories:f.categories.includes(category)?f.categories.filter(c=>c!==category):[...f.categories,category]}));}
  function toggleTag(value:string){setSelectedId(null);setFilters(f=>({...f,tags:f.tags.includes(value)?f.tags.filter(t=>t!==value):[...f.tags,value]}));}
  return <main>
    <MapView places={filtered} selected={selected} onSelect={select}/>
    <header className="topbar"><a href="/" className="brand"><span className="brand-icon"><Compass size={24} strokeWidth={1.6}/></span>elsewhere<span className="brand-dot">.</span></a><span className="brand-caption">A little map of your world</span><div className="header-right"><span className="demo-badge"><span/>INTERACTION STUDY</span><span className="avatar">EP</span></div></header>
    <nav className="category-bar" aria-label="Filter by category"><button className={!filters.categories.length?'chip all active':'chip all'} onClick={()=>{setSelectedId(null);setFilters(f=>({...f,categories:[]}));}}><Bookmark size={15}/>All places</button><span className="divider"/>{(Object.keys(colors) as Category[]).map(c=><button key={c} className={`chip ${filters.categories.includes(c)?'active':''}`} style={{'--category-color':colors[c]} as React.CSSProperties} aria-pressed={filters.categories.includes(c)} onClick={()=>toggleCategory(c)}><CategoryIcon category={c} size={16}/>{c}</button>)}</nav>
    <aside className={`places-panel ${collapsed?'collapsed':''}`} aria-label="Saved places">
      {selected?<>
        <div className="detail-top"><button className="text-button" onClick={()=>setSelectedId(null)}><ArrowLeft size={16}/>Your places</button><span className="eyebrow">SAVED PLACE</span></div>
        <div className="detail-heading"><span className="large-category" style={{color:colors[selected.category],background:colors[selected.category]+'18'}}><CategoryIcon category={selected.category} size={30}/></span><div className="eyebrow">{selected.category} · {selected.neighborhood}</div><h1>{selected.name}</h1><p><MapPin size={14}/>New York, NY</p></div>
        <div className="detail-content"><button className={`visited-button ${selected.visited?'visited':''}`} onClick={()=>updatePlace({visited:!selected.visited})}>{selected.visited?<Check size={16}/>:<Bookmark size={16}/>} {selected.visited?'Been here & loved it':'Want to go'}<span>Change</span></button>
        <section><label className="section-label" htmlFor="note">A NOTE TO YOUR FUTURE SELF</label><textarea id="note" key={selected.id} value={selected.note} onChange={e=>updatePlace({note:e.target.value})} placeholder="What made you save this place?"/><span className="save-hint">{storageError?'Changes could not be saved in this browser.':'Saved automatically on this device'}</span></section>
        <section><div className="section-label">YOUR TAGS</div><div className="tags">{selected.tags.map(t=><button key={t} className="tag" aria-label={`Remove tag ${t}`} onClick={()=>updatePlace({tags:selected.tags.filter(x=>x!==t)})}>{t}<X size={11}/></button>)}</div><form onSubmit={e=>{e.preventDefault();const value=tag.trim().toLowerCase();if(value)updatePlace({tags:Array.from(new Set([...selected.tags,value]))});setTag('');}}><input className="tag-input" aria-label="Add a tag" placeholder="+ Add a tag, then press Enter" value={tag} onChange={e=>setTag(e.target.value)}/></form></section>
        <section className="source"><Bookmark size={16}/><div><span className="section-label">HOW IT FOUND YOU</span><p>{selected.source}</p></div></section>
        <a className="external-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.name+' New York')}`} target="_blank" rel="noreferrer">Look up in Google Maps<ArrowUpRight size={17}/></a></div>
      </>:<>
        <div className="panel-heading"><div><div className="eyebrow">YOUR PERSONAL ATLAS</div><h1>Good places.<br/><span>Kept close.</span></h1></div><span className="small-compass"><Compass size={34} strokeWidth={1}/></span></div>
        <div className="search-wrap"><Search size={18}/><input id="search" aria-label="Search saved places" placeholder="Find a place, neighborhood, tag…" value={filters.query} onChange={e=>setFilters(f=>({...f,query:e.target.value}))}/>{filters.query?<button aria-label="Clear search" onClick={()=>setFilters(f=>({...f,query:''}))}><X size={15}/></button>:<kbd>/</kbd>}</div>
        <div className="quick-filters"><button className={filters.unvisited?'active':''} aria-pressed={filters.unvisited} onClick={()=>setFilters(f=>({...f,unvisited:!f.unvisited}))}><Bookmark size={13}/>Want to go</button><button className={filters.open?'active':''} aria-pressed={filters.open} onClick={()=>setFilters(f=>({...f,open:!f.open}))}><Clock size={13}/>Open now</button><button aria-label="More filters" aria-expanded={filterPanel} className={filterPanel||filterCount?'active':''} onClick={()=>setFilterPanel(!filterPanel)}><SlidersHorizontal size={15}/>{filterCount||''}</button></div>
        {filterPanel&&<div className="filter-popover"><div className="filter-title"><strong>Find your kind of place</strong><button aria-label="Close filters" onClick={()=>setFilterPanel(false)}><X size={16}/></button></div><label className="check-row"><input type="checkbox" checked={filters.hideFood} onChange={e=>setFilters(f=>({...f,hideFood:e.target.checked}))}/>Hide food & drink</label><div className="section-label">MATCH ANY TAG</div><div className="tags">{allTags.map(t=><button key={t} className={`tag ${filters.tags.includes(t)?'active':''}`} aria-pressed={filters.tags.includes(t)} onClick={()=>toggleTag(t)}>{t}</button>)}</div><p className="filter-note">Opening status is sample data for this study.</p></div>}
        <div className="results-heading"><span><strong>{filtered.length}</strong> places{active?' matching':' to come back to'}</span>{active?<button onClick={()=>setFilters(initialFilters)}>Reset filters</button>:<span className="sort-label">By name</span>}</div>
        <div className="place-list">{[...filtered].sort((a,b)=>a.name.localeCompare(b.name)).map(p=><button className="place-row" key={p.id} onClick={()=>select(p.id)}><span className="place-category" style={{color:colors[p.category],background:colors[p.category]+'15'}}><CategoryIcon category={p.category} size={20}/></span><span className="place-text"><strong>{p.name}</strong><span>{p.category}<i>·</i>{p.neighborhood}</span><span className="row-tag">{p.tags[0]}</span></span><span className={`place-status ${p.visited?'been':''}`} title={p.visited?'Been here':'Want to go'}>{p.visited?<Check size={14}/>:<Bookmark size={14}/>}</span></button>)}{!filtered.length&&<div className="empty"><Search size={26}/><h2>A little too specific?</h2><p>Try another tag or loosen your filters.</p><button onClick={()=>setFilters(initialFilters)}>Show all places</button></div>}</div>
        <div className="panel-footer"><span className="green-dot"/>Made for wandering, saved for later.</div>
      </>}
      <button className="mobile-toggle" onClick={()=>setCollapsed(!collapsed)}>{collapsed?`Explore ${filtered.length} places`:'More room for the map'}<ChevronDown size={16}/></button>
    </aside>
    <div className="location-label"><span className="green-dot"/>New York City<span className="location-sub">A few good places to start</span></div>
    <div className="study-note"><Footprints size={14}/><span>Sample places · notes & tags saved on this device</span></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
