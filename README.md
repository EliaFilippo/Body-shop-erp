# Body-shop-erp
Private

### Avvisi per fase (6 ottobre 2026)

Ufficio e operatori possono aggiungere avvisi a ciascuna fase prevista, dal tablet oppure dalla scheda commessa. Il server registra autore e data, senza sostituire la cronologia con un nuovo salvataggio del gestionale. Gli avvisi sono aggiornati ogni cinque secondi e restano consultabili dopo la consegna. Nella scheda commessa, accanto alla checklist qualità, l’ufficio vede gli avvisi da verificare e può mettere un visto con nome e data. Il visto è una verifica informativa: non blocca automaticamente la consegna.

Attivazione: eseguire `supabase/migrations/20261006_phase_notices.sql` nel progetto prima della pubblicazione frontend. Nessuna nuova credenziale, nessun accesso degli operatori ai dati economici. I testi hanno limite di 2000 caratteri e sono visualizzati come testo; gli operatori devono avere un profilo attivo e la commessa deve essere abilitata alla produzione. Il retry riutilizza lo stesso UUID per impedire duplicati in caso di risposta interrotta.
