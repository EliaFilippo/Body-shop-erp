# Body-shop-erp
Private

### Avvisi per fase (6 ottobre 2026)

Ufficio e operatori possono aggiungere avvisi a ciascuna fase prevista, dal tablet oppure dalla scheda commessa. Il server registra autore e data, senza sostituire la cronologia con un nuovo salvataggio del gestionale. Gli avvisi sono aggiornati ogni cinque secondi e restano consultabili dopo la consegna. Nella scheda commessa, accanto alla checklist qualità, l’ufficio vede gli avvisi da verificare e può mettere un visto con nome e data. Il visto è una verifica informativa: non blocca automaticamente la consegna.

Attivazione: eseguire `supabase/migrations/20261006_phase_notices.sql` nel progetto prima della pubblicazione frontend. Nessuna nuova credenziale, nessun accesso degli operatori ai dati economici. I testi hanno limite di 2000 caratteri e sono visualizzati come testo; gli operatori devono avere un profilo attivo e la commessa deve essere abilitata alla produzione. Il retry riutilizza lo stesso UUID per impedire duplicati in caso di risposta interrotta.

### Scelta manuale vetture e fasi (27 ottobre 2026)

Tutti gli operatori vedono le commesse aperte pubblicate in produzione. Nel tablet, “Scelta del lavoro” mantiene la modalità Automatica (mansioni e programma prioritario) e aggiunge Manuale: qualsiasi fase prevista sulla vettura, anche fuori mansione, fuori sequenza o già completata come intervento aggiuntivo. La consegna resta all’ufficio. Il nuovo tempo si aggiunge allo storico senza cancellare i visti; Pausa e Fine agiscono solo sul proprio timer. Il passaggio è atomico: se l’avvio fallisce, il lavoro precedente continua. Restano i limiti delle postazioni e l’asciugatura. Il programma automatico e il ricalcolo serale non cambiano.

Applicare `supabase/migrations/20261027213003_manual_vehicle_phase_start.sql` prima del frontend. La colonna `production_live_segments.manual_start` distingue gli avvii manuali; le tabelle non acquisiscono permessi di scrittura diretta per i client.
