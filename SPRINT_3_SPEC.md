# Sprint 3 — Incassi, Fatture e R.I.B.A.

## Obiettivo
Integrare nel gestionale il controllo completo delle vetture consegnate, della fatturazione mensile, delle scadenze clienti, delle distinte R.I.B.A., degli anticipi bancari, degli insoluti e della liquidità prevista.

## Vincoli
- Partire da `main` con Sprint 1 e Sprint 2 già integrati.
- Non eliminare o alterare le funzioni esistenti.
- Persistenza IndexedDB con migrazione non distruttiva.
- Nessun placeholder, pulsante vuoto o calcolo simulato.
- Storico non eliminabile; rettifiche solo tramite storni tracciati.

## Funzioni richieste

### 1. Vetture da fatturare
- Ogni vettura consegnata passa allo stato `Da fatturare`.
- Collegamento permanente tra vettura, cliente, importo e futura fattura.
- Blocco della doppia fatturazione della stessa lavorazione.

### 2. Fatture mensili
- Raggruppamento di più vetture dello stesso cliente in un’unica fattura.
- Numero, data, imponibile, IVA, totale, modalità di pagamento e scadenza.
- Condizioni configurabili: 30, 40, 75 giorni, fine mese e regole personalizzate.
- Calcolo automatico della scadenza.

### 3. Dati finanziari del cliente
- Banca abituale.
- IBAN.
- Codice SIA/CUC facoltativo.
- Modalità di pagamento abituale.
- Banca di appoggio R.I.B.A.

### 4. Distinte R.I.B.A.
- Più distinte nello stesso mese, anche per la stessa banca e lo stesso cliente.
- Numero distinta, data, banca, fatture incluse, importo totale e stato.
- Utilizzo totale o parziale della fattura.
- Visualizzazione permanente di totale fattura, importo già utilizzato e residuo disponibile.
- Blocco del doppio caricamento della stessa fattura o dello stesso importo.
- Blocco del superamento del residuo.

### 5. Anticipi bancari
- Registrazione importo anticipato, data accredito, commissioni e interessi.
- L’anticipo bancario non chiude il credito verso il cliente.
- Esposizione bancaria separata dall’incasso definitivo.

### 6. Incasso e insoluti
- Incasso definitivo alla scadenza.
- Gestione insoluto con riapertura dell’esposizione e del credito.
- Stati: da fatturare, fatturata, da incassare, parzialmente inserita in R.I.B.A., inserita in R.I.B.A., anticipata, incassata, scaduta, insoluta, contestata, annullata/stornata.

### 7. Plafond e fido
- Fido/plafond configurabile per banca.
- Totale utilizzato e residuo disponibile.
- Avviso e blocco opzionale al superamento del plafond.

### 8. Dashboard finanziaria
- Crediti totali.
- Fatture in scadenza.
- R.I.B.A. presentate e anticipate.
- Esposizione bancaria.
- Incassi definitivi.
- Insoluti.
- Previsione liquidità a 30/60/90 giorni.
- Calendario giornaliero con entrate, uscite e saldo previsto.
- Soglia minima configurabile con avviso preventivo.

## Regole di integrità
- Una vettura non può essere fatturata due volte.
- Una fattura non può essere caricata oltre il proprio residuo.
- L’anticipo bancario non equivale a pagamento cliente.
- Un insoluto deve ripristinare correttamente credito ed esposizione.
- Nessuna cancellazione distruttiva dello storico.

## Test obbligatori
- Doppio caricamento fattura bloccato.
- Utilizzo parziale e calcolo residuo.
- Superamento residuo impedito.
- Distinte multiple nello stesso mese.
- Anticipo bancario senza chiusura credito.
- Incasso definitivo.
- Insoluto e riapertura esposizione.
- Plafond bancario e avvisi.
- Migrazione IndexedDB non distruttiva.
- Regressione completa Sprint 1 e Sprint 2.

## Verifiche finali
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run dev`
- Pull Request in bozza verso `main`
