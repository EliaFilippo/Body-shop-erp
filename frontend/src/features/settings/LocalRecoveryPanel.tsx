import { useState } from 'react'
import type { ErpData } from '../../types'
import { listLocalCheckpoints, loadDatabase, readLocalCheckpoint, type LocalCheckpointSummary } from '../../services/database'
import { backupFilename, serializeBackup } from '../../services/backup'

export function LocalRecoveryPanel({onRecover}:{onRecover:(source:ErpData)=>Promise<void>}) {
 const [copies,setCopies]=useState<LocalCheckpointSummary[]>([])
 const [selected,setSelected]=useState<ErpData|null>(null)
 const [scanned,setScanned]=useState(false)
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 async function scan(){setBusy(true);setMessage('');try{const current=await loadDatabase();const checkpoints=await listLocalCheckpoints();setCopies([{key:'current',at:current.dbUpdatedAt??'',customers:current.customers.length,vehicles:current.vehicles.length,estimates:current.estimates?.length??0,jobs:current.jobs?.length??0,plates:current.vehicles.map(v=>v.plate)},...checkpoints]);setScanned(true)}catch(e){setMessage(e instanceof Error?e.message:'Lettura copie non riuscita.')}finally{setBusy(false)}}
 async function choose(key:string){setBusy(true);setMessage('');try{setSelected(key==='current'?await loadDatabase():await readLocalCheckpoint(key))}catch(e){setMessage(e instanceof Error?e.message:'Copia non disponibile.')}finally{setBusy(false)}}
 function download(){if(!selected)return;const url=URL.createObjectURL(new Blob([serializeBackup(selected)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='recupero-locale-'+backupFilename();a.click();URL.revokeObjectURL(url)}
 async function recover(){if(!selected)return;setBusy(true);setMessage('');try{await onRecover(selected);setMessage('Inserimenti recuperati e salvati.')}catch(e){setMessage(e instanceof Error?e.message:'Recupero non riuscito.')}finally{setBusy(false)}}
 return <section className="panel"><h3>Recupero inserimenti locali</h3><p>Cerca sul PC dove hai inserito i dati. Le copie possono contenere vetture non ancora arrivate al cloud.</p><button type="button" disabled={busy} onClick={()=>void scan()}>Cerca copie su questo dispositivo</button>
 {scanned&&<ul>{copies.map(copy=><li key={copy.key}><button type="button" disabled={busy} onClick={()=>void choose(copy.key)}>{copy.key==='current'?'Archivio attuale':new Date(copy.at).toLocaleString('it-IT')} · {copy.vehicles} vetture · {copy.estimates} preventivi · {copy.jobs} commesse</button></li>)}</ul>}
 {selected&&<div><h4>Vetture nella copia selezionata</h4><p>{selected.vehicles.map(v=>v.plate).join(' · ')||'Nessuna vettura'}</p><p>Il recupero aggiunge clienti, vetture, preventivi, accettazioni e commesse mancanti. I dati già presenti nel cloud vengono conservati. Le copie locali restano disponibili.</p><button type="button" disabled={busy} onClick={download}>Scarica questa copia</button> <button type="button" className="primary" disabled={busy} onClick={()=>void recover()}>Recupera inserimenti mancanti</button></div>}
 {message&&<p role="status">{message}</p>}</section>
}
