# Elias Body Shop ERP — Master Specification

## 1. Visione del prodotto

Elias Body Shop ERP è un gestionale web/cloud completo per carrozzerie, progettato per controllare in un unico ambiente accettazione, clienti, veicoli, produzione, pianificazione, documenti, finanza, incassi, scadenze, comunicazioni e supporto decisionale.

Il prodotto deve diventare il centro operativo quotidiano del titolare e del personale, con dati persistenti, interfaccia semplice, dashboard leggibile in pochi secondi e architettura modulare.

## 2. Principi obbligatori

- Nessun dato operativo simulato presentato come reale.
- Tutti i dati devono essere persistenti.
- Ogni modulo deve essere riutilizzabile, testabile e separato dagli altri.
- Responsive design per notebook, desktop, iPad e smartphone.
- Conservazione dello storico: nessuna modifica deve cancellare risultati dei mesi precedenti.
- Tracciabilità delle modifiche importanti con data, ora e utente.
- Ruoli e permessi per titolare, ufficio e produzione.
- Backup ed esportazione dei dati.
- Nessuna regressione sulle funzioni già implementate.

## 3. Cruscotto del titolare

La dashboard principale deve mostrare in meno di 30 secondi:

- vetture presenti, in attesa, in lavorazione, pronte e in ritardo;
- ritiri e consegne di oggi;
- pratiche bloccate e relativo motivo;
- preventivi in attesa di conferma;
- ricambi mancanti;
- coni liberi e occupati;
- fatturato, incassi e margine del mese;
- obiettivo mensile, percentuale raggiunta e importo mancante;
- previsione di chiusura del mese;
- liquidità disponibile;
- incassi e pagamenti previsti a 30, 60 e 90 giorni;
- R.I.B.A. e scadenze imminenti;
- notifiche prioritarie e clienti da richiamare.

Tutti i KPI devono derivare dai dati reali del database.

## 4. Obiettivi mensili modificabili

Gli obiettivi non devono essere codificati in modo fisso.

Per ogni mese il titolare deve poter impostare e modificare:

- obiettivo fatturato;
- obiettivo incassi;
- obiettivo utile netto;
- margine minimo desiderato;
- numero di vetture da consegnare;
- numero di pannelli da verniciare;
- ore produttive disponibili;
- produttività attesa;
- saldo minimo di sicurezza;
- eventuali obiettivi personalizzati.

Requisiti:

- creazione automatica del nuovo periodo mensile;
- possibilità di copiare gli obiettivi dal mese precedente;
- storico non modificabile accidentalmente;
- confronto mese corrente, mese precedente e stesso mese dell'anno precedente;
- calcolo automatico di scostamento, ritmo giornaliero richiesto e previsione di fine mese;
- avvisi quando il risultato previsto è inferiore all'obiettivo;
- pagina `Impostazioni > Obiettivi mensili`.

## 5. Clienti e CRM

### 5.1 Anagrafica clienti

- privati, concessionari, società, assicurazioni e flotte;
- ragione sociale, contatti, indirizzi, dati fiscali e condizioni di pagamento;
- referenti multipli;
- storico veicoli, pratiche, preventivi, fatture, incassi e comunicazioni;
- classificazione cliente e note riservate;
- ricerca rapida per nome, telefono, email, targa o partita IVA.

### 5.2 Comunicazioni

- storico telefonate, email e messaggi;
- modelli di messaggio WhatsApp ed email;
- promemoria di richiamo;
- preventivi senza risposta;
- avvisi per cliente da contattare;
- futura integrazione WhatsApp Business tramite provider ufficiale.

## 6. Veicoli

- targa, telaio, marca, modello, versione, alimentazione, colore e chilometraggio;
- proprietario e utilizzatore;
- fotografie e documenti;
- storico riparazioni;
- danni preesistenti;
- relazione con pratiche, preventivi e fatture;
- ricerca per targa o VIN;
- eliminazione protetta quando esistono dati collegati.

## 7. Accettazione e pratica

Ogni pratica deve includere:

- cliente e veicolo;
- tipologia di commessa;
- concessionario o assicurazione collegata;
- data ingresso e consegna prevista;
- foto del veicolo e dei danni;
- documento d'identità e libretto;
- firma del cliente;
- note e richieste;
- ore previste;
- importo preventivo;
- ricambi necessari;
- cono assegnato;
- stato della pratica;
- responsabile e operatori assegnati.

### 7.1 Flusso della pratica

Accettazione → Preventivo → Attesa autorizzazione → Autorizzata → Pianificata → Produzione → Lucidatura → Controllo qualità → Pronta → Consegnata → Chiusa.

Le transizioni incoerenti devono essere bloccate o richiedere conferma autorizzata.

### 7.2 Documenti e OCR

- caricamento drag-and-drop e da fotocamera;
- OCR di carta d'identità, libretto e documenti compatibili;
- conferma manuale dei dati estratti;
- nessun dato OCR deve essere salvato senza possibilità di verifica;
- generazione PDF di accettazione e consegna.

## 8. Preventivi

- righe di manodopera, materiali, ricambi e servizi esterni;
- imponibile, IVA, sconti e totale;
- versioni e revisioni;
- stato bozza, inviato, accettato, rifiutato, scaduto;
- allegati e fotografie;
- firma o conferma del cliente;
- invio tramite email e predisposizione WhatsApp;
- conversione in commessa e fattura;
- confronto preventivo/consuntivo;
- evidenza pratiche senza autorizzazione.

## 9. Gestione coni

- configurazione iniziale di 30 coni, estendibile;
- assegnazione automatica del primo cono libero;
- possibilità di assegnazione manuale;
- un solo cono attivo per pratica;
- impossibilità di doppia assegnazione;
- rilascio automatico alla consegna o chiusura;
- mappa coni liberi, occupati e fuori servizio;
- storico assegnazioni.

## 10. Produzione

### 10.1 Kanban

Colonne configurabili per:

- attesa;
- smontaggio;
- lattoneria;
- preparazione;
- verniciatura;
- rimontaggio;
- lucidatura;
- controllo qualità;
- pronta.

Ogni card deve mostrare almeno targa, cliente, consegna prevista, priorità, ore residue, cono, ricambi mancanti e stato di blocco.

### 10.2 Avanzamento

- timeline e percentuale reale;
- inizio/fine di ogni lavorazione;
- operatore assegnato;
- ore previste e consuntive;
- motivi di fermo;
- fotografie durante la lavorazione;
- controllo qualità con checklist;
- storico completo.

### 10.3 Carico di lavoro

- capacità giornaliera e settimanale;
- calendario operatori;
- ferie e indisponibilità;
- saturazione per reparto;
- evidenza sovraccarichi;
- stima automatica della data di consegna.

## 11. Planner intelligente

Il planner deve proporre un piano, ma l'utente mantiene il controllo finale.

Criteri:

- data promessa;
- priorità cliente;
- disponibilità ricambi;
- stato della pratica;
- ore residue;
- capacità reparto;
- operatori presenti;
- dipendenze tra lavorazioni;
- vetture già iniziate;
- urgenze manuali.

Funzioni:

- pianificazione giornaliera e settimanale;
- drag-and-drop;
- ricalcolo dopo ritardi o assenze;
- spiegazione del motivo della priorità;
- avvisi sulle consegne a rischio;
- nessuna modifica automatica irreversibile senza conferma.

## 12. Magazzino e ricambi

- ricambi richiesti, ordinati, ricevuti, mancanti e resi;
- fornitore, costo, prezzo e data prevista;
- collegamento alla pratica;
- avviso se un ricambio blocca la produzione;
- storico ordini e resi;
- futura gestione materiali di consumo e soglie minime.

## 13. Finanza e amministrazione

### 13.1 Fatture

- fatture clienti e note di credito;
- numerazione e sezionali configurabili;
- collegamento a cliente, pratica e preventivo;
- scadenze multiple;
- stato da emettere, emessa, parzialmente incassata, incassata, scaduta;
- esportazione dati per commercialista;
- futura integrazione con fatturazione elettronica tramite provider autorizzato.

### 13.2 Incassi

- contanti, bonifico, carta, assegno e R.I.B.A.;
- incassi parziali;
- riconciliazione con fatture;
- insoluti;
- promemoria;
- storico movimenti.

### 13.3 R.I.B.A.

- creazione distinte;
- banca, scadenza, importo e stato;
- presentata, pagata, insoluta, richiamata;
- avvisi prima della scadenza;
- evidenza esposizione futura.

### 13.4 Pagamenti e costi

- fornitori, dipendenti, affitto, noleggi, utenze, assicurazioni, imposte e altri costi;
- ricorrenze mensili, trimestrali e annuali;
- scadenze e stato pagamento;
- documenti allegati;
- centro di costo e categoria.

### 13.5 Cash flow

- saldo iniziale reale;
- entrate e uscite previste;
- proiezione 30/60/90 giorni;
- scenari prudente, realistico e ottimistico;
- fido bancario e disponibilità residua;
- saldo minimo di sicurezza;
- avvisi di possibile tensione finanziaria;
- confronto previsto/consuntivo.

## 14. Agenda e calendario

- appuntamenti, ritiri, consegne, perizie e scadenze;
- vista giorno, settimana e mese;
- collegamento a cliente, veicolo e pratica;
- assegnazione a utente;
- promemoria;
- evidenza eventi in ritardo;
- futura sincronizzazione con Google Calendar e altri calendari.

## 15. Centro notifiche

Notifiche configurabili per:

- pratica in ritardo;
- consegna imminente o scaduta;
- ricambio mancante;
- preventivo senza risposta;
- cliente da richiamare;
- vettura pronta da oltre 24 ore;
- fattura o pagamento scaduto;
- R.I.B.A. imminente o insoluta;
- liquidità sotto soglia;
- obiettivo mensile a rischio;
- anomalie di dati.

Le notifiche devono poter essere lette, archiviate e assegnate.

## 16. Assistente AI

L'assistente AI deve usare dati autorizzati del gestionale e distinguere chiaramente dati, stime e suggerimenti.

Funzioni previste:

- riepilogo della giornata;
- suggerimento priorità vetture;
- previsione consegne;
- rilevazione ritardi e colli di bottiglia;
- analisi carico di lavoro;
- previsione fatturato, incassi e liquidità;
- spiegazione degli scostamenti dagli obiettivi;
- suggerimenti sui clienti da contattare;
- preparazione bozze di messaggi;
- interrogazione in linguaggio naturale.

Vincoli:

- nessuna decisione finanziaria o operativa irreversibile senza conferma;
- indicazione del livello di affidabilità;
- log delle azioni suggerite e approvate;
- rispetto dei permessi utente.

## 17. Utenti, ruoli e sicurezza

Ruoli iniziali:

- titolare/amministratore;
- ufficio;
- responsabile produzione;
- operatore;
- sola lettura.

Requisiti:

- accesso autenticato;
- permessi granulari;
- audit log;
- sessioni sicure;
- protezione dati personali;
- backup automatici;
- esportazione e cancellazione secondo normativa;
- nessuna password memorizzata in chiaro.

## 18. Report e analisi

- fatturato e incassi per periodo;
- margine per pratica e cliente;
- produttività per operatore e reparto;
- tempi medi di attraversamento;
- puntualità consegne;
- preventivi accettati/rifiutati;
- clienti più redditizi;
- insoluti e giorni medi di incasso;
- utilizzo coni;
- confronto obiettivi/risultati;
- esportazione PDF, CSV ed Excel.

## 19. Requisiti tecnici

- frontend modulare con componenti riutilizzabili;
- service layer separato dall'interfaccia;
- database con migrazioni versionate;
- validazione centralizzata;
- test unitari e di integrazione;
- gestione errori leggibile;
- logging strutturato;
- configurazione separata per sviluppo, test e produzione;
- API pronte per future app e integrazioni;
- performance adeguate ad almeno 100 pratiche mensili e crescita futura;
- accessibilità di base.

## 20. Strategia di sviluppo accelerata

Lo sviluppo deve essere suddiviso in workstream paralleli, evitando modifiche simultanee agli stessi file core.

### Workstream A — Core e dati

Database, modelli, migrazioni, servizi condivisi, autenticazione e permessi.

### Workstream B — Operazioni

Clienti, veicoli, accettazione, preventivi, documenti e coni.

### Workstream C — Produzione

Kanban, timeline, consuntivazione, controllo qualità, planner e ricambi.

### Workstream D — Finanza

Fatture, incassi, R.I.B.A., scadenze, costi, cash flow e report economici.

### Workstream E — Dashboard e comunicazioni

Cruscotto titolare, KPI, agenda, notifiche, CRM e messaggi.

### Workstream F — AI e integrazioni

Assistente AI, OCR evoluto, WhatsApp, email, calendario e servizi esterni.

Ogni workstream deve lavorare su branch dedicato e aprire Pull Request piccole e verificabili verso un branch di integrazione.

## 21. Definition of Done globale

Una funzionalità è completata soltanto quando:

- usa dati persistenti reali;
- gestisce validazioni ed errori;
- rispetta ruoli e permessi;
- è responsive;
- ha test adeguati;
- non rompe funzioni esistenti;
- è documentata;
- supera `npm test`, `npm run lint` e `npm run build`;
- è verificata manualmente nel browser;
- è inclusa in una Pull Request revisionabile.

## 22. Ordine di rilascio consigliato

1. Consolidamento Sprint 1–5 e modello dati.
2. Obiettivi mensili modificabili e storico.
3. Cruscotto titolare completo.
4. Produzione Kanban, timeline e carico operatori.
5. Finanza completa e cash flow 90 giorni.
6. Agenda, notifiche e CRM.
7. Planner intelligente.
8. AI, OCR avanzato e integrazioni.
9. Sicurezza, backup, multiutente e rilascio cloud.
10. Collaudo completo con dati reali della carrozzeria.

## 23. Criterio finale di successo

Il gestionale è pronto quando il titolare può gestire la giornata senza fogli esterni, conoscere in tempo reale stato delle vetture e situazione finanziaria, impostare ogni mese nuovi obiettivi, ricevere avvisi affidabili e ottenere suggerimenti spiegabili senza perdere il controllo delle decisioni.