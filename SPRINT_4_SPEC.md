# Sprint 4 — Controllo Produzione e Avanzamento Vetture

## Obiettivo
Trasformare il gestionale in uno strumento operativo quotidiano per la carrozzeria, collegando planner, stato reale delle vetture, carico di lavoro, priorità, assegnazioni, coni e date di consegna.

## Vincoli
- Partire dal branch `agent/sprint-3-incassi-fatture-riba` senza perdere nessuna funzione degli Sprint 1, 2 e 3.
- Architettura modulare e scalabile.
- Persistenza IndexedDB con migrazione non distruttiva.
- Nessun dato dimostrativo inserito automaticamente.
- Nessun pulsante vuoto o funzione simulata.
- Tutte le modifiche operative devono lasciare uno storico tracciabile.

## 1. Flusso produttivo vettura
Ogni vettura deve poter avanzare attraverso queste fasi:

1. Accettata
2. In attesa autorizzazione
3. Ricambi da ordinare
4. In attesa ricambi
5. Smontaggio
6. Lattoneria
7. Preparazione
8. Verniciatura
9. Montaggio
10. Lucidatura
11. Lavaggio
12. Controllo qualità
13. Pronta consegna
14. Consegnata
15. Sospesa

Per ogni cambio fase registrare:
- data e ora;
- operatore;
- fase precedente e nuova fase;
- nota facoltativa;
- eventuale motivo di sospensione.

## 2. Scheda di lavorazione
Per ogni vettura prevedere:
- cliente e targa;
- modello e colore;
- data ingresso;
- data consegna promessa;
- priorità;
- responsabile;
- lavorazioni previste;
- ore stimate e ore effettive;
- ricambi necessari;
- note operative;
- stato autorizzazione;
- stato ricambi;
- cono assegnato;
- importo preventivato;
- collegamento alla parte finanziaria dello Sprint 3.

## 3. Kanban di produzione
Realizzare una vista Kanban con colonne corrispondenti alle fasi operative.

Funzioni richieste:
- trascinamento della vettura tra le fasi;
- salvataggio immediato e persistente;
- filtro per cliente, priorità, responsabile e data consegna;
- ricerca per targa o modello;
- evidenza delle vetture in ritardo;
- evidenza delle vetture sospese;
- contatore vetture per fase;
- carico ore stimato per fase.

## 4. Planner giornaliero e settimanale
Integrare il planner dello Sprint 2 con lo stato reale della produzione.

Il planner deve:
- proporre automaticamente le attività giornaliere;
- tenere conto di priorità, data consegna, ore residue e fase corrente;
- impedire sovraccarichi non segnalati;
- mostrare capacità disponibile e capacità utilizzata;
- permettere modifiche manuali;
- ricalcolare le priorità dopo ogni variazione;
- conservare lo storico del piano originario e delle modifiche.

## 5. Gestione operatori
Per ogni operatore:
- nome;
- ruolo;
- ore disponibili al giorno;
- competenze/fasi abilitate;
- vetture assegnate;
- carico di lavoro previsto;
- ore effettivamente registrate.

Prevedere avvisi per:
- sovraccarico;
- assenza di assegnazione;
- consegne a rischio;
- fase bloccata senza attività programmata.

## 6. Timer e consuntivazione tempi
Consentire di:
- avviare e fermare un timer su una vettura e una fase;
- impedire timer multipli contemporanei per lo stesso operatore;
- correggere manualmente un tempo con motivazione obbligatoria;
- visualizzare ore stimate, effettuate e residue;
- calcolare scostamento percentuale;
- conservare lo storico delle registrazioni.

## 7. Controllo consegne
Creare una vista dedicata alle consegne:
- oggi;
- domani;
- questa settimana;
- in ritardo;
- a rischio.

La previsione di rischio deve considerare almeno:
- fase corrente;
- ore residue;
- ricambi mancanti;
- autorizzazione mancante;
- capacità produttiva disponibile;
- giorni lavorativi residui.

## 8. Gestione ricambi e blocchi
Per ogni vettura:
- elenco ricambi;
- stato: da ordinare, ordinato, arrivato, errato, reso;
- fornitore;
- data ordine;
- consegna prevista;
- costo;
- note.

Una vettura con blocchi deve mostrare chiaramente:
- tipo di blocco;
- data di apertura;
- responsabile;
- azione necessaria;
- data prevista di sblocco.

## 9. Controllo qualità e consegna
Prima di passare a `Pronta consegna`, richiedere una checklist configurabile:
- montaggio completato;
- funzionamento componenti verificato;
- lucidatura completata;
- pulizia interna/esterna;
- assenza spie;
- fotografie finali;
- documenti pronti;
- controllo responsabile.

La consegna deve:
- liberare automaticamente il cono;
- aggiornare lo stato finanziario a `Da fatturare`;
- registrare data, ora e operatore;
- impedire la consegna se la checklist obbligatoria non è completa, salvo deroga motivata.

## 10. Dashboard produzione
Mostrare almeno:
- vetture presenti;
- vetture per fase;
- consegne di oggi e settimana;
- vetture in ritardo;
- vetture bloccate;
- ore pianificate e disponibili;
- saturazione per operatore;
- tempo medio per fase;
- scostamento medio tra ore stimate ed effettive;
- coni liberi e occupati.

## 11. Regole di integrità
- Una vettura consegnata non può tornare in produzione senza riapertura tracciata.
- Un cono non può essere assegnato a due vetture contemporaneamente.
- Ogni cambio fase deve essere persistito nello storico.
- Le ore registrate non possono essere negative.
- Le modifiche manuali ai tempi richiedono una motivazione.
- La consegna deve alimentare automaticamente il modulo finanziario.
- Le migrazioni non devono cancellare dati esistenti.

## 12. Test obbligatori
- Avanzamento fase e storico.
- Drag & drop Kanban con persistenza.
- Filtri e ricerca.
- Assegnazione operatore e controllo sovraccarico.
- Timer singolo per operatore.
- Correzione tempi con motivazione.
- Calcolo ore residue e scostamento.
- Individuazione consegna a rischio.
- Gestione ricambi e blocchi.
- Checklist qualità obbligatoria.
- Consegna con rilascio cono.
- Passaggio automatico a `Da fatturare`.
- Migrazione IndexedDB non distruttiva.
- Regressione completa Sprint 1, 2 e 3.

## 13. Verifiche finali
Prima della chiusura eseguire:

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run dev`

Creare una Pull Request in bozza verso `main` con:
- riepilogo funzionalità;
- test eseguiti;
- migrazioni introdotte;
- limiti residui;
- istruzioni di verifica manuale.
