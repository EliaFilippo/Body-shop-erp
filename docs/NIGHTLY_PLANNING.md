# Piano notturno Elias
Il codice è pronto ma il servizio va installato una volta su Supabase. Senza questa installazione non esiste alcuna esecuzione a PC spenti.

1. SQL Editor: eseguire supabase/updates/20261027_nightly_planning.sql.
2. Edge Functions → Deploy a new function → Via Editor: nome **nightly-planner**, sostituire index.ts con supabase/functions/nightly-planner/index.ts e distribuire. Nella funzione disattivare **Verify JWT**: l'accesso è autenticato dal token privato generato nel passaggio seguente, non da una chiave pubblica. Le variabili SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già fornite dal progetto; non inserire password o chiavi nella chat o nel frontend.
3. SQL Editor: eseguire supabase/updates/20261027_nightly_schedule.sql. Crea il token in Vault e il job Cron **elias-nightly-planning**. Non mostra il token.
4. Prima di lasciare l'officina, Pausa/Fine sui lavori terminati e terminare Pulizie. Spegnere il tablet non termina un timer.
5. Dal primo piano concluso correttamente, al caricamento del gestionale il calendario smette di ricalcolarsi continuamente. Restano Start/Pausa/Fine, firme reali, aggiornamenti operativi, nuove commesse e scelta fuori programma.

## Orario e recuperi
Alle **03:00 Europe/Rome** il server prepara il primo giorno lavorativo disponibile, di norma la mattina successiva alla giornata appena conclusa. UTC e ora legale vengono gestiti dal database. Se c'è ancora lavoro/Pulizie aperto, riprova ogni 15 minuti fino alle 06:59. Le richieste di controllo sono leggere e non ricalcolano un piano già completato. Un solo piano riuscito per data civile; lease e revisione proteggono da duplicazioni e scritture concorrenti. Nessun timer viene chiuso, nessuna fase viene completata per orario.

Il piano usa il medesimo motore del frontend: prima scartare le vetture già verniciate e asciutte, poi verniciare quelle pronte, poi incartare/preparare le successive. Mantiene mansioni, assenze, singolo lavaggio e tre postazioni di verniciatura. I box sono riservati per verniciatura/asciugatura come nel planner esistente; la priorità di scartatura non inventa uno spostamento fisico della vettura.

## Controllo
Cron → elias-nightly-planning permette di verificare le richieste. In SQL, senza visualizzare segreti:
select run_date,status,completed_at from public.production_nightly_runs order by run_date desc limit 7;
Nel Programma operatori compare la data del piano notturno riuscito. La prima esecuzione reale resta da verificare nel progetto del cliente.

## Sviluppo
Dalla radice, dopo npm ci in frontend: node scripts/build-nightly-planner.mjs.
La funzione index.ts è un bundle autonomo generato dallo stesso motore del gestionale. Ripubblicare la funzione quando cambia la logica di pianificazione.
