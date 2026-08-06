# Sprint 5 — Accettazione intelligente, OCR e preventivo dinamico

## Obiettivo
Consegnare un MVP utilizzabile in carrozzeria entro lunedì 3 agosto 2026, mantenendo intatte tutte le funzionalità degli Sprint 1–4.

## 1. Accettazione intelligente
- Creazione di una pratica di accettazione collegata a cliente e veicolo.
- Acquisizione da fotocamera o caricamento file di:
  - documento di identità fronte/retro;
  - libretto di circolazione;
  - fotografie della vettura e dei danni.
- Archiviazione locale persistente e non distruttiva in IndexedDB.
- Anteprima, eliminazione e sostituzione delle immagini.

## 2. OCR documento di identità
Il sistema deve estrarre e proporre automaticamente, quando leggibili:
- nome;
- cognome;
- codice fiscale;
- data e luogo di nascita;
- indirizzo di residenza;
- numero documento;
- data di rilascio;
- data di scadenza;
- ente rilasciante.

Requisiti:
- nessun dato deve essere salvato definitivamente senza conferma dell’operatore;
- ogni campo deve restare modificabile manualmente;
- evidenziare i campi non riconosciuti o con bassa affidabilità;
- non inventare dati mancanti;
- l’OCR deve poter fallire senza bloccare la compilazione manuale.

## 3. Lettura libretto
Estrarre e proporre, quando leggibili:
- targa;
- telaio/VIN;
- marca;
- modello;
- data di prima immatricolazione;
- alimentazione;
- cilindrata;
- potenza;
- intestatario, se presente e leggibile.

Prima del salvataggio, l’operatore deve controllare e confermare tutti i dati.

## 4. Preventivo dinamico
### Configurazione mensile
Per ogni mese devono essere configurabili:
- obiettivo economico;
- giorni lavorativi;
- ore lavorabili giornaliere;
- operatori produttivi;
- efficienza/capacità reale già prevista dal Planner;
- percentuale predefinita materiale di consumo, inizialmente 20%.

### Tariffa oraria
Calcolare la tariffa oraria obiettivo usando l’obiettivo economico e le ore produttive realmente disponibili del mese.

La tariffa deve:
- essere salvata con mese e anno;
- poter essere ricalcolata;
- mostrare chiaramente i parametri utilizzati;
- restare modificabile manualmente con motivazione facoltativa;
- conservare nel preventivo la tariffa applicata al momento della creazione.

### Voci del preventivo
Sezioni modificabili:
- manodopera;
- ricambi;
- materiale di consumo;
- lavorazioni esterne;
- altri costi;
- sconti/maggiorazioni;
- IVA.

Per ogni voce deve essere possibile:
- aggiungere;
- modificare descrizione, quantità e prezzo;
- eliminare;
- riordinare se utile.

Il materiale di consumo deve supportare:
- proposta automatica pari al 20% della manodopera;
- percentuale liberamente modificabile;
- importo manuale;
- azzeramento o eliminazione completa;
- ulteriori righe aggiuntive.

## 5. Calcoli economici
Mostrare in tempo reale:
- ore preventivate;
- tariffa oraria applicata;
- totale manodopera;
- totale ricambi;
- totale materiali;
- totale lavorazioni esterne e altri costi;
- imponibile;
- IVA;
- totale preventivo;
- costi vivi;
- margine previsto in euro;
- margine previsto in percentuale.

Non confondere il prezzo di vendita con il costo interno. Ricambi e materiali devono poter avere costo e prezzo di vendita separati.

## 6. Integrazione operativa
Dopo la conferma dell’accettazione:
- creare o aggiornare cliente e veicolo evitando duplicati;
- creare la pratica;
- assegnare automaticamente il primo cono libero quando previsto dalle regole esistenti;
- rendere la vettura disponibile nel Planner e nella Produzione;
- mantenere invariati storico e dati degli sprint precedenti.

## 7. MVP da collaudare lunedì
Il collaudo minimo deve permettere di:
1. aprire una nuova accettazione;
2. fotografare o caricare un documento;
3. tentare l’estrazione OCR;
4. correggere e confermare i dati cliente;
5. fotografare o caricare il libretto;
6. correggere e confermare i dati veicolo;
7. allegare fotografie danni;
8. creare un preventivo con tariffa mensile;
9. aggiungere/eliminare ricambi e materiali;
10. modificare o azzerare il 20% dei materiali;
11. visualizzare totale e margine;
12. salvare, chiudere e riaprire la pratica verificando la persistenza.

## 8. Qualità e test
Prima del completamento eseguire:
- `npm test`;
- `npm run lint`;
- `npm run build`;
- `npm run dev`;
- verifica di persistenza dopo ricaricamento;
- test di regressione degli Sprint 1–4;
- controllo responsive su desktop e tablet.

## 9. Limiti da dichiarare
- L’OCR non è infallibile e richiede sempre controllo umano.
- La qualità dipende da luce, inclinazione, riflessi e nitidezza della foto.
- Nessun dato sensibile deve essere inviato a servizi esterni senza configurazione e informativa privacy esplicite.
