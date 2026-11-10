export const PAINT_STATION_COUNT=3
export interface PaintReservation {jobId:string;startAt:string;endAt:string}
export class StationAvailabilityError extends Error {}

export function normalizeStationStart(at: string, normalize: (at: string) => string) {
 const workingStart = normalize(at)
 if (workingStart >= at) return workingStart
 // Working calendars have minute precision; a real reservation can end mid-minute.
 return normalize(new Date(Math.ceil(Date.parse(at) / 60_000) * 60_000).toISOString())
}

/** Half-open occupancy intervals; support operators never consume an extra bay. */
export function findPaintStationStart(
 requestedAt:string,jobId:string,reservations:PaintReservation[],
 endForStart:(start:string)=>string,normalizeStart:(start:string)=>string=(start)=>start,
):string {
 let start=normalizeStationStart(requestedAt,normalizeStart)
 for(let attempt=0;attempt<=reservations.length+1;attempt++){
  const end=endForStart(start)
  const relevant=reservations.filter(item=>item.jobId!==jobId&&item.startAt<end&&item.endAt>start)
  const points=[start,...relevant.map(item=>item.startAt).filter(at=>at>start&&at<end)].sort()
  let conflict:string|undefined
  for(const point of points){
   const active=relevant.filter(item=>item.startAt<=point&&item.endAt>point)
   if(new Set(active.map(item=>item.jobId)).size>=PAINT_STATION_COUNT){
    conflict=active.map(item=>item.endAt).sort()[0];break
   }
  }
  if(!conflict)return start
  start=normalizeStationStart(conflict,normalizeStart)
 }
 throw new StationAvailabilityError('Impossibile trovare una postazione di verniciatura libera.')
}
