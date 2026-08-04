# Elias OS — Business Rules

## 1. Scopo
Questo documento definisce le regole operative, economiche e decisionali che Elias OS deve applicare in modo coerente. In caso di conflitto tra interfaccia, codice e documentazione, queste regole devono essere considerate il riferimento funzionale insieme a `MASTER_SPEC.md`.

## 2. Principi generali
- I dati mostrati come reali devono provenire dal database persistente.
- Nessun dato simulato può essere presentato come valore aziendale reale.
- Ogni modifica importante deve essere tracciabile con data, ora e utente.
- Le automazioni devono essere reversibili o confermabili quando producono effetti economici o amministrativi.
- Le schermate devono privilegiare semplicità, velocità operativa e prevenzione degli errori.

## 3. Clienti e veicoli
- Un cliente può possedere più veicoli.
- La targa deve essere univoca tra i veicoli attivi, salvo gestione esplicita di duplicati storici.
- Ogni pratica deve essere collegata ad almeno un cliente e un veicolo.
- Le modifiche ai dati anagrafici non devono cancellare lo storico delle pratiche precedenti.

## 4. Pratiche e stati
Flusso standard:

`Accettazione → Preventivo → Autorizzazione → Produzione → Lucidatura → Controllo qualità → Pronta → Consegnata`

Regole:
- Una pratica non può passare in Produzione senza autorizzazione, salvo deroga registrata dal titolare.
- Una pratica non può diventare Pronta se il controllo qualità non è completato.
- Una pratica non può diventare Consegnata se non sono registrati data, ora e responsabile della consegna.
- Ogni salto di stato deve richiedere una motivazione.
- Le pratiche annullate restano nello storico e non vengono eliminate fisicamente.

## 5. Gestione coni
- Il sistema gestisce 30 coni numerati.
- Un cono può essere assegnato a una sola pratica attiva alla volta.
- L’assegnazione automatica usa il primo cono libero disponibile, salvo scelta manuale.
- Il cono viene liberato automaticamente quando la pratica passa a Consegnata o Annullata.
- Il titolare può forzare il rilascio, con registrazione della motivazione.
- Il sistema deve segnalare incongruenze tra cono, veicolo e stato pratica.

## 6. Produzione e priorità
La priorità deve considerare almeno:
- data di consegna promessa;
- stato di autorizzazione;
- disponibilità ricambi;
- ore residue stimate;
- carico del reparto;
- cliente o concessionario prioritario;
- rischio di ritardo;
- possibilità di liberare rapidamente un cono.

Il sistema non deve cambiare automaticamente una priorità manuale del titolare senza conferma.

## 7. Ritardi e pratiche bloccate
Una pratica è in ritardo quando supera la data di consegna prevista senza essere Consegnata.

Una pratica è bloccata quando non può avanzare per uno dei motivi codificati:
- autorizzazione mancante;
- ricambi mancanti;
- attesa cliente;
- attesa assicurazione o concessionario;
- problema tecnico;
- pagamento o anticipo mancante;
- capacità produttiva insufficiente;
- altro motivo registrato.

Ogni blocco deve avere data di inizio, responsabile e nota operativa.

## 8. Obiettivi mensili
Gli obiettivi sono modificabili per ogni mese e devono essere salvati come record storici distinti.

Campi minimi:
- obiettivo fatturato;
- obiettivo utile;
- obiettivo incassi;
- obiettivo vetture consegnate;
- obiettivo pannelli;
- ore produttive disponibili;
- margine minimo desiderato.

Regole:
- Il nuovo mese può copiare i valori del mese precedente, ma richiede conferma.
- La modifica di un mese passato deve essere consentita solo al titolare o amministratore.
- Il sistema deve mostrare valore obiettivo, valore raggiunto, differenza, percentuale e previsione di fine mese.
- Lo storico non deve essere sovrascritto.

## 9. Fatturato, margine e utile
- Il fatturato del mese deriva dai documenti fiscali o dalle pratiche secondo la configurazione aziendale dichiarata.
- Il margine della pratica è dato dai ricavi meno costi diretti attribuiti.
- I costi diretti possono includere ricambi, materiali, lavorazioni esterne e manodopera attribuita.
- L’utile aziendale non deve essere confuso con il margine della singola pratica.
- Ogni KPI deve mostrare chiaramente origine e periodo del dato.

## 10. Fatture, incassi, scadenze e R.I.B.A.
- Una fattura può avere una o più scadenze.
- Ogni incasso deve essere collegato a una fattura o registrato come movimento non abbinato.
- Una scadenza è pagata solo quando la somma degli incassi collegati copre l’importo dovuto.
- Gli incassi parziali devono ridurre il residuo senza chiudere la scadenza.
- Una R.I.B.A. deve avere almeno cliente, importo, scadenza e stato.
- Stati minimi R.I.B.A.: Da emettere, Emessa, Presentata, Pagata, Insoluta, Annullata.
- Le R.I.B.A. insolute devono generare un avviso prioritario.

## 11. Cash flow
Il cash flow deve usare:
- saldo iniziale configurato;
- incassi previsti;
- pagamenti previsti;
- scadenze fiscali;
- costi ricorrenti;
- movimenti straordinari.

Devono essere disponibili almeno le viste 30, 60 e 90 giorni.
Le previsioni devono distinguere dati certi, probabili e stimati.

## 12. Agenda e notifiche
Devono generare notifiche almeno:
- consegna o ritiro imminente;
- pratica in ritardo;
- pratica bloccata;
- preventivo senza risposta;
- cliente da richiamare;
- ricambio mancante;
- fattura o pagamento scaduto;
- R.I.B.A. in scadenza o insoluta;
- auto pronta da oltre 24 ore;
- obiettivo mensile a rischio.

Le notifiche devono poter essere lette, rinviate, assegnate e chiuse.

## 13. Cruscotto del titolare
La dashboard executive deve mostrare soltanto dati aggiornati e utili alle decisioni.

Indicatori minimi:
- liquidità disponibile;
- fatturato mese;
- incassi mese;
- obiettivo e scostamento;
- previsione fine mese;
- auto presenti, in lavorazione, pronte e in ritardo;
- consegne e ritiri di oggi;
- coni liberi e occupati;
- pratiche bloccate;
- ricambi mancanti;
- incassi previsti 30/60/90 giorni;
- notifiche prioritarie.

Ogni KPI deve aprire il dettaglio da cui è calcolato.

## 14. Assistente AI
- L’AI può suggerire, non confermare autonomamente operazioni economiche, fiscali o irreversibili.
- Ogni suggerimento deve indicare i dati che lo giustificano.
- L’AI deve dichiarare quando i dati sono insufficienti.
- Priorità, consegne e previsioni suggerite dall’AI devono poter essere accettate o ignorate dal titolare.
- Nessuna risposta generata deve essere mostrata come dato certo se deriva da una stima.

## 15. Utenti e permessi
Ruoli minimi:
- Titolare/Amministratore;
- Ufficio;
- Produzione;
- Collaboratore in sola lettura.

Solo il titolare o amministratore può:
- modificare obiettivi storici;
- forzare stati e coni;
- modificare impostazioni economiche;
- eliminare o annullare documenti;
- gestire utenti e permessi.

## 16. Audit e sicurezza
- Ogni operazione critica deve essere registrata nell’audit log.
- I dati non devono essere cancellati senza una strategia di conservazione.
- Backup e ripristino devono essere verificabili.
- Le informazioni finanziarie devono essere visibili solo ai ruoli autorizzati.

## 17. Criteri di accettazione
Una funzione è completata soltanto quando:
- usa dati persistenti;
- rispetta queste regole;
- include gestione errori e stati vuoti;
- è responsive su PC e iPad;
- dispone di test adeguati;
- supera `npm test`, `npm run lint` e `npm run build`;
- è stata verificata manualmente nel browser.
