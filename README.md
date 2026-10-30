# Body-shop-erp
Private

### Avvisi per fase (6 ottobre 2026)

Ufficio e operatori possono aggiungere avvisi a ciascuna fase prevista, dal tablet oppure dalla scheda commessa. Il server registra autore e data, senza sostituire la cronologia con un nuovo salvataggio del gestionale. Gli avvisi sono aggiornati ogni cinque secondi e restano consultabili dopo la consegna. Nella scheda commessa, accanto alla checklist qualità, l’ufficio vede gli avvisi da verificare e può mettere un visto con nome e data. Il visto è una verifica informativa: non blocca automaticamente la consegna.

Attivazione: eseguire `supabase/migrations/20261006_phase_notices.sql` nel progetto prima della pubblicazione frontend. Nessuna nuova credenziale, nessun accesso degli operatori ai dati economici. I testi hanno limite di 2000 caratteri e sono visualizzati come testo; gli operatori devono avere un profilo attivo e la commessa deve essere abilitata alla produzione. Il retry riutilizza lo stesso UUID per impedire duplicati in caso di risposta interrotta.

### Scelta manuale vetture e fasi (27 ottobre 2026)

Tutti gli operatori vedono le commesse aperte pubblicate in produzione. Nel tablet, “Scelta del lavoro” mantiene la modalità Automatica (mansioni e programma prioritario) e aggiunge Manuale: qualsiasi fase prevista sulla vettura, anche fuori mansione, fuori sequenza o già completata come intervento aggiuntivo. La consegna resta all’ufficio. Il nuovo tempo si aggiunge allo storico senza cancellare i visti; Pausa e Fine agiscono solo sul proprio timer. Il passaggio è atomico: se l’avvio fallisce, il lavoro precedente continua. Restano i limiti delle postazioni e l’asciugatura. Le priorità automatiche restano attive; il calendario si aggiorna anche dopo ogni completamento di fase.

Applicare `supabase/migrations/20261027213003_manual_vehicle_phase_start.sql` prima del frontend. La colonna `production_live_segments.manual_start` distingue gli avvii manuali; le tabelle non acquisiscono permessi di scrittura diretta per i client.

### Fasi non previste nel preventivo (28 ottobre 2026)

La scelta Manuale mostra tutte le lavorazioni del ciclo, comprese le fasi escluse dal preventivo e quelle assenti nelle vecchie commesse. Le voci extra sono indicate come “non prevista nel preventivo”. Start/Riprendi registrano tempo reale sulla vettura senza cambiare preventivi, prezzi, programma automatico o tempi congelati. Anche i report per fase includono questi interventi con tempo assegnato zero; non viene inventato un tempo standard e non viene firmato automaticamente un completamento. I limiti delle postazioni e l’asciugatura si applicano anche agli interventi extra.

Applicare `supabase/migrations/20261028072111_manual_unquoted_phases.sql` prima del frontend.

### Tariffe e obiettivo nel piano notturno (28 ottobre 2026)

Il ricalcolo delle 03:00 salva in `nightlyPlanning.economics` due indicatori separati: costo operativo per ora produttiva registrata e tariffa di fatturato residuo necessaria per l’obiettivo del mese. Dashboard e Planner mostrano l’obiettivo della giornata preparata, le ore effettive e la capacità residua. Preventivi, prezzi, tariffe degli operatori e budget dei timer già congelati restano conservati.

Il costo consuntivo usa i costi mensili configurati maturati pro rata di calendario e il personale da ore registrate solo quando non è già compreso nei costi mensili. Gli operatori esterni extra sono aggiunti a parte; materiali e ricambi sono separati. Non è una misura di utile netto o una ricostruzione contabile di spese non registrate. In assenza di ore o costi sufficienti il dato è non disponibile.

La tariffa obiettivo divide il fatturato mensile ancora da emettere (IVA esclusa, escluse bozze, fatture stornate e date future) per la capacità residua. La capacità usa turni, assenze e resa produttiva effettivamente registrata nei giorni trascorsi, limitata alla presenza configurata; senza storico usa l’efficienza impostata. Le ore extra e fuori preventivo sono comprese nel consuntivo. Il residuo è distribuito proporzionalmente alle ore disponibili di ogni giornata, con arrotondamento che conserva l’importo totale.

Il piano conserva la priorità dei box: scartatura reale dopo asciugatura, verniciatura pronta, incartatura e preparazione; poi consegna, margine e attesa. Il commit conserva esclusione tra aziende, token privato, blocco turno attivo, revisione e watermark. Le ore sono estratte sul server con confini di mese e giorni Europe/Rome, inclusi i cambi d’ora.

Applicare `supabase/migrations/20261028080641_nightly_economics.sql`, poi pubblicare il bundle `nightly-planner` generato da `node scripts/build-nightly-planner.mjs`, mantenendo la sua autenticazione privata esistente. Nessun dato economico è aggiunto al feed tablet degli operatori.

### Avanzamento manuale condiviso con l’automatico (28 ottobre 2026)

Lavorazioni manuali e automatiche condividono la stessa proiezione operativa. Le fasi extra realmente avviate entrano nell’avanzamento; un visto esplicito le completa e abilita le successive. Start, Pausa e Fine dei timer non generano completamenti automatici. Sul tablet il pulsante “✓ Completa …” chiude anche il proprio timer sulla fase, dopo aver verificato che nessun collega sia ancora attivo su quella fase.

Le proposte del programma operatori si aggiornano dopo ogni completamento di fase in base al lavoro reale, alle mansioni, ai box e alle dipendenze. Le fasi già completate non vengono riproposte. L’ufficio importa l’avanzamento anche con piano notturno attivo; il calendario si ricalcola sul server dopo ogni firma di completamento e mantiene anche la verifica notturna sugli stessi stati. Le fasi fuori preventivo con tempo residuo non configurato sono segnalate: possono essere continuate e completate manualmente, ma non viene inventata una durata per il planner.

La ripresa manuale di una fase già firmata riapre lo stato operativo e archivia il precedente visto in `production_phase_check_history`. Non vengono cancellati lo storico, le ore, i prezzi dei preventivi o i budget congelati. Il completamento reale della verniciatura conserva il vincolo di asciugatura nel passaggio automatico.

Applicare `supabase/migrations/20261028083902_manual_phase_progress.sql`, ricostruire e distribuire il bundle `nightly-planner`, poi pubblicare il frontend. Gli helper e lo storico restano privati; i profili operatore ricevono soltanto lo stato di produzione autorizzato.

### Calendario dopo completamento fase (30 ottobre 2026)

La firma «Completa fase» accoda un ricalcolo condiviso sul server. Start, Pausa e Fine timer non equivalgono a completamento; la normale sincronizzazione delle ore non avvia un secondo ricalcolo. Restano le priorità dei box, le mansioni e le attese di asciugatura. Gli operatori già al lavoro rimangono riservati sulla loro vettura. Si aggiornano le consegne previste, non gli impegni concordati con il cliente. Durate sconosciute, blocchi e capacità insufficiente producono una previsione da verificare.

Il piano derivato è separato dall’archivio dell’ufficio: non sostituisce bozze o salvataggi concorrenti. PC e tablet adottano la stessa versione, con controllo leggero ogni pochi secondi. Le richieste simultanee condividono una lease; un evento sopraggiunto durante il calcolo viene ripreso subito, con controllo di recupero ogni minuto in caso di errori. I turni del nuovo piano seguono Europe/Rome e gli slot sono arrotondati in avanti. Tariffe e obiettivi economici conservano il ricalcolo notturno.
