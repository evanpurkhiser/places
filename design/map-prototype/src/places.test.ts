import {describe,it,expect} from 'vitest';
import {filterPlaces,places,type Filters} from './places';
const base:Filters={query:'',categories:[],tags:[],open:false,unvisited:false,hideFood:false};
describe('intent filters',()=>{
  it('combines categories with OR and intersects with open and unvisited',()=>{
    const result=filterPlaces(places,{...base,categories:['Coffee','Food'],open:true,unvisited:true});
    expect(result.map(p=>p.id)).toEqual(['3','6','7','10','11']);
  });
  it('hides food, coffee and drinks together',()=>{
    expect(filterPlaces(places,{...base,hideFood:true}).every(p=>['Culture','Outdoors'].includes(p.category))).toBe(true);
    expect(filterPlaces(places,{...base,hideFood:true,categories:['Coffee']})).toEqual([]);
  });
  it('matches any selected tag, combined with a case-insensitive neighborhood query',()=>{
    expect(filterPlaces(places,{...base,tags:['date night','great coffee'],query:' WEST VILLAGE '}).map(p=>p.id)).toEqual(['2','3','6']);
  });
  it('returns an empty result for unmatched queries and every place for no filters',()=>{
    expect(filterPlaces(places,{...base,query:'no such place'})).toEqual([]);
    expect(filterPlaces(places,base)).toHaveLength(places.length);
  });
});
