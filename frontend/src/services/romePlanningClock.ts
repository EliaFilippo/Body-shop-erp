/** Legacy calendar routines use UTC fields as local schedule labels. Adapt only
 * the derived server plan; stored timestamps and existing nightly plans stay intact. */
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
export function toRomePlanningClock(iso:string):string{
 const date=new Date(iso)
 return formatter.format(date).replace(' ','T')+'.'+String(date.getUTCMilliseconds()).padStart(3,'0')+'Z'
}
export function fromRomePlanningClock(wall:string,notBefore=-Infinity):string{
 const desired=Date.parse(wall);let guess=desired
 for(let i=0;i<4;i++){
  const offset=Date.parse(toRomePlanningClock(new Date(guess).toISOString()))-guess
  const next=desired-offset;if(next===guess)break;guess=next
 }
 const candidates=[guess-3600000,guess,guess+3600000].filter(t=>t>=notBefore&&toRomePlanningClock(new Date(t).toISOString())===wall)
 return new Date(candidates.length?Math.min(...candidates):guess).toISOString()
}
export function localizePlanningTimestamps<T>(value:T):T{
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return toRomePlanningClock(value) as T
 if(Array.isArray(value))return value.map(localizePlanningTimestamps) as T
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localizePlanningTimestamps(v)])) as T
 return value
}
