export type Category = 'Coffee' | 'Food' | 'Drinks' | 'Culture' | 'Outdoors';
export interface Place {
  id: string; name: string; category: Category; neighborhood: string;
  coordinates: [number, number]; tags: string[]; note: string; source: string;
  visited: boolean; open: boolean;
}
export const colors: Record<Category, string> = {Coffee:'#b7804f',Food:'#d77859',Drinks:'#977da9',Culture:'#628b9e',Outdoors:'#7e946a'};
export const places: Place[] = [
  {id:'1',name:'La Cabra',category:'Coffee',neighborhood:'East Village',coordinates:[-73.9876,40.7292],tags:['great coffee','pastries','slow mornings'],note:'The cardamom bun is the move. A good spot to bring a book on a quiet weekday.',source:'A recommendation from a friend',visited:true,open:true},
  {id:'2',name:'Little Branch',category:'Drinks',neighborhood:'West Village',coordinates:[-74.0067,40.7307],tags:['date night','cocktails'],note:'Tucked downstairs. Come early and ask for something with mezcal.',source:'Spotted on a walk',visited:false,open:false},
  {id:'3',name:'L’Artusi',category:'Food',neighborhood:'West Village',coordinates:[-74.0052,40.7339],tags:['date night','Italian'],note:'On the list for a long dinner with friends.',source:'A recommendation from a friend',visited:false,open:true},
  {id:'4',name:'McNally Jackson',category:'Culture',neighborhood:'SoHo',coordinates:[-73.9978,40.7245],tags:['books','rainy day'],note:'Always leave with something unexpected.',source:'Spotted on a walk',visited:true,open:true},
  {id:'5',name:'Washington Square Park',category:'Outdoors',neighborhood:'Greenwich Village',coordinates:[-73.9973,40.7308],tags:['people watching','slow mornings'],note:'Coffee, a bench, and absolutely no plans.',source:'Personal favorite',visited:true,open:true},
  {id:'6',name:'Café Kitsuné',category:'Coffee',neighborhood:'West Village',coordinates:[-74.0039,40.7352],tags:['great coffee','people watching'],note:'Save for the next walk through the Village.',source:'Instagram',visited:false,open:true},
  {id:'7',name:'Balthazar',category:'Food',neighborhood:'SoHo',coordinates:[-73.9982,40.7227],tags:['breakfast','French'],note:'A solo breakfast at the bar sounds pretty ideal.',source:'A recommendation from a friend',visited:false,open:true},
  {id:'8',name:'The Tenement Museum',category:'Culture',neighborhood:'Lower East Side',coordinates:[-73.9900,40.7188],tags:['history','rainy day'],note:'Book one of the apartment tours.',source:'Personal shortlist',visited:false,open:true},
  {id:'9',name:'Dante',category:'Drinks',neighborhood:'Greenwich Village',coordinates:[-74.0016,40.7289],tags:['cocktails','date night'],note:'Negronis and a seat by the window.',source:'A recommendation from a friend',visited:true,open:true},
  {id:'10',name:'Scarr’s Pizza',category:'Food',neighborhood:'Lower East Side',coordinates:[-73.9895,40.7153],tags:['pizza','quick bite'],note:'For the inevitable post-walk slice.',source:'Instagram',visited:false,open:true},
  {id:'11',name:'Sey Coffee',category:'Coffee',neighborhood:'Bushwick',coordinates:[-73.9328,40.7058],tags:['great coffee','slow mornings'],note:'Make an afternoon of it next time we’re in Brooklyn.',source:'A recommendation from a friend',visited:false,open:true},
  {id:'12',name:'Domino Park',category:'Outdoors',neighborhood:'Williamsburg',coordinates:[-73.9677,40.7149],tags:['waterfront','sunset'],note:'Manhattan from the other side. Go around golden hour.',source:'Personal favorite',visited:true,open:true},
  {id:'13',name:'Whitney Museum',category:'Culture',neighborhood:'Meatpacking District',coordinates:[-74.0089,40.7396],tags:['art','rainy day'],note:'Leave time for the terraces.',source:'Personal shortlist',visited:false,open:false},
  {id:'14',name:'Stumptown',category:'Coffee',neighborhood:'Greenwich Village',coordinates:[-73.9976,40.7327],tags:['great coffee','quick bite'],note:'An easy stop before a wander around the Village.',source:'Spotted on a walk',visited:true,open:true},
  {id:'15',name:'Elizabeth Street Garden',category:'Outdoors',neighborhood:'Nolita',coordinates:[-73.9947,40.7222],tags:['quiet corners','art'],note:'A little pocket of calm.',source:'Spotted on a walk',visited:true,open:true},
  {id:'16',name:'Lucien',category:'Food',neighborhood:'East Village',coordinates:[-73.9881,40.7232],tags:['French','date night'],note:'For a lively, late dinner.',source:'Instagram',visited:false,open:false},
];
export interface Filters {query:string; categories:Category[]; tags:string[]; open:boolean; unvisited:boolean; hideFood:boolean}
export function filterPlaces(data:Place[], filters:Filters) {
  const query = filters.query.trim().toLowerCase();
  return data.filter(p => (!query || [p.name,p.neighborhood,...p.tags].join(' ').toLowerCase().includes(query))
    && (!filters.categories.length || filters.categories.includes(p.category))
    && (!filters.tags.length || filters.tags.some(t=>p.tags.includes(t)))
    && (!filters.open || p.open) && (!filters.unvisited || !p.visited)
    && (!filters.hideFood || !['Coffee','Food','Drinks'].includes(p.category)));
}
