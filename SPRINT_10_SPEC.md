# Sprint 10 — Messa in produzione, sicurezza dati e multiutenza

## Obiettivo
Trasformare il gestionale completato negli Sprint 1–9 in un prodotto utilizzabile ogni giorno in carrozzeria, con dati recuperabili, accessi separati, sincronizzazione cloud e procedura di rilascio verificata.

## Ordine di consegna
1. Backup e ripristino completo con controllo del file prima dell'importazione.
2. Utenti, ruoli e autorizzazioni (`titolare`, `ufficio`, `produzione`).
3. Archivio cloud condiviso, migrazione non distruttiva da IndexedDB e gestione conflitti.
4. Registro operazioni e protezione dei dati sensibili.
5. Collaudo end-to-end desktop/tablet e pubblicazione dell'ambiente di produzione.

## 1. Backup e ripristino
- Esportazione manuale dell'intero archivio in JSON versionato.
- File con data, revisione, origine e riepilogo dei record.
- Validazione strutturale e controllo integrità prima del ripristino.
- Anteprima delle quantità che verranno ripristinate.
- Conferma esplicita prima della sostituzione dell'archivio corrente.
- Salvataggio automatico di sicurezza prima di ogni ripristino.
- Nessun ripristino parziale o silenzioso.

## 2. Utenti e ruoli
- Accesso personale per ogni operatore.
- Ruoli iniziali: titolare, ufficio e produzione.
- Permessi applicati sia all'interfaccia sia alle operazioni sui dati.
- Disattivazione utente senza perdita dello storico.
- Ogni modifica operativa deve registrare utente, data e ora.

## 3. Archivio cloud
- Database centrale condiviso tra PC e tablet.
- Sincronizzazione affidabile e segnalazione dei conflitti.
- Migrazione guidata dei dati locali esistenti.
- Allegati e fotografie in archivio protetto.
- Funzionamento degradato esplicito in assenza di rete, senza false conferme di salvataggio.

## 4. Sicurezza e privacy
- Sessioni protette e scadenza configurabile.
- Nessuna chiave privata inclusa nel frontend.
- Separazione dei dati per azienda.
- Registro delle operazioni sensibili.
- Politica di conservazione e cancellazione coerente con gli obblighi aziendali.

## 5. Collaudo finale
- Percorso completo: accettazione, OCR, preventivo, commessa, planner, produzione, consegna, fattura e incasso.
- Prova contemporanea da PC ufficio e tablet produzione.
- Ripristino reale di un backup in ambiente di collaudo.
- Test di perdita rete e riaccesso.
- Verifica responsive e usabilità in officina.
- `npm test`, `npm run lint`, `npm run build`, avvio applicazione.

## Criterio di completamento
Il gestionale è concluso quando il flusso completo è utilizzabile con dati reali, da più utenti e dispositivi, con backup verificato e ambiente di produzione pubblicato.
