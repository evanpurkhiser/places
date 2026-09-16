import {useEffect, useRef, useState} from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(workerUrl);
import {createRoot, type Root} from 'react-dom/client';
import {Coffee, Utensils, Wine, Landmark, TreePine, Plus, Minus, LocateFixed, Layers, Maximize} from 'lucide-react';
import {colors, type Place, type Category} from './places';
import 'maplibre-gl/dist/maplibre-gl.css';
export const categoryIcons = {Coffee, Food:Utensils, Drinks:Wine, Culture:Landmark, Outdoors:TreePine};
export function CategoryIcon({category,size=17}:{category:Category;size?:number}) {const Icon=categoryIcons[category];return <Icon size={size}/>;}
export function MapView({places,selected,onSelect}:{places:Place[];selected:Place|null;onSelect:(id:string)=>void}) {
  const container=useRef<HTMLDivElement>(null);
  const map=useRef<maplibregl.Map|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [dark,setDark]=useState(false);
  useEffect(()=>{
    if(!container.current) return;
    let instance:maplibregl.Map;
    try {
      instance=new maplibregl.Map({container:container.current,style:'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',center:[-74.002,40.726],zoom:13.2,attributionControl:{compact:true}});
    } catch {setError('This browser could not start the map. Try enabling WebGL.');return;}
    map.current=instance;
    instance.on('load',()=>setReady(true));
    instance.on('error',()=>setError('Some map tiles could not load. Check your connection.'));
    instance.on('idle',()=>setError(''));
    return ()=>{instance.remove();map.current=null;};
  },[]);
  useEffect(()=>{
    if(!map.current || !ready) return;
    const markers:maplibregl.Marker[]=[];
    const roots:Root[]=[];
    for(const place of places){
      const element=document.createElement('button');
      element.className=`map-pin ${selected?.id===place.id?'selected':''}`;
      element.style.setProperty('--pin-color',colors[place.category]);
      element.setAttribute('aria-label',`Open ${place.name}`);
      element.onclick=()=>onSelect(place.id);
      const root=createRoot(element);
      root.render(<><CategoryIcon category={place.category} size={18}/><span className="pin-label">{place.name}</span></>);
      roots.push(root);
      markers.push(new maplibregl.Marker({element}).setLngLat(place.coordinates).addTo(map.current));
    }
    return ()=>{markers.forEach(m=>m.remove());setTimeout(()=>roots.forEach(r=>r.unmount()),0);};
  },[places,selected,ready,onSelect]);
  useEffect(()=>{
    if(!selected || !map.current) return;
    map.current.flyTo({center:selected.coordinates,zoom:15,duration:850,padding:{left:window.innerWidth>760?380:0,right:0,top:0,bottom:window.innerWidth>760?0:220}});
  },[selected?.id]);
  function fit(){
    if(!map.current || !places.length) return;
    const bounds=new maplibregl.LngLatBounds();
    places.forEach(p=>bounds.extend(p.coordinates));
    map.current.fitBounds(bounds,{padding:{left:window.innerWidth>760?450:55,right:70,top:150,bottom:window.innerWidth>760?90:320},maxZoom:15,duration:700});
  }
  return <><div ref={container} className="map" aria-label="Map of saved places"/>{error&&<div className="map-error" role="alert">{error}</div>}
    <div className="map-controls"><button title="Fit matching places" aria-label="Fit matching places" onClick={fit}><Maximize size={18}/></button><button title="Back to New York" aria-label="Back to New York" onClick={()=>map.current?.flyTo({center:[-74.002,40.726],zoom:13.2,padding:{left:0,right:0,top:0,bottom:0}})}><LocateFixed size={19}/></button><div className="zoom-controls"><button aria-label="Zoom in" onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button aria-label="Zoom out" onClick={()=>map.current?.zoomOut()}><Minus size={20}/></button></div></div>
    <button className="map-style" onClick={()=>{map.current?.setStyle(`https://basemaps.cartocdn.com/gl/${dark?'positron':'dark-matter'}-gl-style/style.json`);setDark(!dark);}}><Layers size={16}/>{dark?'Light map':'Dark map'}</button>
  </>;
}
