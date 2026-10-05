# Accesso operatori tramite PIN

Ogni operatore usa un account Auth tecnico distinto, esclusivamente `production`.
Il titolare configura un PIN di sei cifre e ottiene un link casuale di 256 bit
per collegare il tablet. Sul tablet compare il nome e si inserisce il PIN.
Il link è trasferito nel frammento URL, rimosso dalla cronologia al caricamento,
e conservato sul solo tablet; il PIN non viene salvato nel browser.

## Attivazione

1. Applicare `supabase/migrations/20261005_operator_pin.sql` al progetto.
2. Distribuire `operator-pin` con `supabase functions deploy operator-pin`.
   La configurazione `verify_jwt=false` abilita il login senza JWT utente;
   ogni richiesta deve comunque superare collegamento/PIN oppure controllo
   titolare server-side. Nessuna chiamata client alle RPC PIN è consentita.
3. Da Produzione e monte ore, come titolare, aprire Configurazione tablet e
   budget, Accessi tablet con PIN. Scegliere operatore, inserire e ripetere il
   PIN, attivare e copiare il link direttamente sul tablet assegnato.
4. Eseguire un login reale, verificare che il ruolo sia produzione e che prezzi,
   snapshot economico e profili degli altri dipendenti restino inaccessibili.

Nessuna email viene spedita. I PIN sono hash bcrypt, cinque errori bloccano
l'account per quindici minuti; il controllo è atomico e condiviso fra tablet.
Ogni firma e segmento conserva l'ID Auth personale esistente nel sistema.
La configurazione rifiuta di sostituire un account ufficio/titolare o il
collegamento preesistente di un altro account. Non migra automaticamente
account già usati per lavorazioni.

Le credenziali tecniche sono derivate sul server tramite HMAC della chiave
service-role; non sono il PIN e non sono inviate al tablet. Una rotazione della
chiave service-role richiede la riconfigurazione dei PIN da parte del titolare
(aggiorna anche le password tecniche) prima di consentire nuovi login PIN. Le sessioni già aperte restano sessioni Auth
ordinarie: cambiare il PIN/link blocca nuovi login ma non revoca queste sessioni
e non interrompe i timer. Per disabilitare l'accesso impostare il membro
aziendale inattivo e gestire separatamente eventuali segmenti attivi.

Il server consente CORS al sito GitHub Pages di Elias. Sviluppo locale e altri
domini richiedono una lista di origini esplicita, senza esporre dati aggiuntivi.
