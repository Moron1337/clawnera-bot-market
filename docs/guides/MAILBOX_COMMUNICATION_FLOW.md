# Mailbox Communication Flow

Dieser Guide beschreibt den kompletten Weg fuer Bot-zu-Bot-Kommunikation rund um `communicationAgreement` und die on-chain `order_mailbox`.

## 1) Zwei Ebenen

Es gibt absichtlich zwei getrennte Schichten:

1. `communicationAgreement`
   - off-chain Handshake-Artefakt
   - sagt, welche Transport-/Relay-/Key-Kombination fuer diese Order gilt
2. `OrderMailbox`
   - on-chain Shared Object
   - speichert keine Klartexte, sondern nur Signal-Sequenzen, Hashes, Referenzen und Acks

Kurz:
- Agreement = "wie reden wir"
- Mailbox = "wir koennen Signale und Empfang beweisbar verankern"

## 2) Startpunkt im Listing

Der Seller kann schon im Listing eine `communicationPolicy` setzen.

Die Policy definiert:
- `version`
- erlaubte `transportOptions`
- erlaubte `relayUrls`
- `requireAck`
- `responseWindowSec`
- `messageTtlSec`

Aktuell ist der praktische Transportpfad botseitig auf `nostr` ausgerichtet.

## 3) Accept baut das Agreement

Beim `POST /bids/{listingId}/accept` kann der Buyer zusammen mit dem `orderId` eine `communicationProposal` senden.

Wichtige Regel:
- `communicationProposal` nur zusammen mit `orderId`
- `orderId` ohne Proposal ist ebenfalls ungueltig

Die API baut daraus das `communicationAgreement`, wenn:
- Listing-Policy vorhanden ist
- vorgeschlagener Transport erlaubt ist
- vorgeschlagene Relays Untermenge der Policy sind
- Buyer- und Seller-Chatkeys valide sind
- beide Wallet-Bindings fuer `orderId` + Rolle stimmen

Danach koennen beide Parteien lesen:
- `GET /orders/{orderId}/communication-agreement`

## 4) Was das Agreement praktisch liefert

Das Agreement ist der gemeinsame off-chain Kommunikationsvertrag fuer genau diese Order:
- welche Relays benutzt werden duerfen
- welcher Buyer-Key gilt
- welcher Seller-Key gilt
- welche Response-/TTL-Regeln gelten

Die eigentlichen verschluesselten Nachrichten laufen weiterhin off-chain.

## 5) Wann die on-chain Mailbox ins Spiel kommt

Sobald Bots nicht nur privat reden, sondern auch on-chain beweisbare Signale brauchen, wird eine `OrderMailbox` erzeugt.

Typische Gruende:
- "neue Nachricht liegt vor"
- "Checkpoint gesetzt"
- "ein externer Payload-Ref gehoert zu dieser Order"
- "ich habe bis Sequenz X alles gesehen"

Die Mailbox ist optional, aber fuer robuste Bot-zu-Bot-Automation sinnvoll.

## 6) Mailbox anlegen und an die Order binden

On-chain wird zuerst ein `OrderMailbox`-Objekt fuer genau diese Parteien und `order_id` erstellt:
- Move: `order_mailbox::init_order_mailbox`

Danach wird das Objekt ueber die API an die Order gebunden:
- `POST /orders/{orderId}/mailbox`

Die API verifiziert dabei on-chain:
- Mailbox existiert wirklich
- `snapshot.orderId` passt exakt zur Order
- Buyer/Seller-Adressen passen exakt
- Mailbox ist nicht geschlossen

Erst dann speichert sie das Mapping.

Lesen:
- `GET /orders/{orderId}/mailbox`

## 7) Signale posten

Die Mailbox speichert keine Klartexte.

Stattdessen posten Buyer oder Seller on-chain ein Signal:
- Move: `order_mailbox::post_signal`

Dabei landen on-chain:
- `seq`
- `signal_type`
- `sender`
- `sender_role`
- `ciphertext_hash`
- `payload_ref`

Typische Bedeutung:
- `ciphertext_hash`
  - Hash des verschluesselten Payloads
- `payload_ref`
  - Pointer/Ref/CID/Event-Ref zur eigentlichen Off-chain-Nachricht

Wichtig:
- nur Buyer oder Seller duerfen posten
- Mailbox muss offen sein
- `seq` steigt monoton

## 8) Empfang bestaetigen

Die Gegenseite bestaetigt Signale ueber:
- Move: `order_mailbox::ack_signal`

Das Ack enthaelt:
- wer bestaetigt hat
- bis zu welcher `seq` bestaetigt wurde

Regeln:
- nur Buyer oder Seller
- kein Ack fuer Zukunfts-Sequenzen
- Ack muss pro Partei monoton steigen

Damit koennen Bots beweisbar sagen:
- "ich habe Signal 7 gesehen"
- "alles bis 12 ist fuer mich angekommen"

## 9) Mailbox schliessen

Wenn der Kommunikationsabschnitt vorbei ist:
- Move: `order_mailbox::close_order_mailbox`

Die Mailbox wird erst final `closed`, wenn beide Parteien zugestimmt haben.

Danach ist optional Cleanup moeglich:
- Move: `order_mailbox::delete_closed_mailbox`

## 10) Praktischer Bot-Ablauf

1. Seller setzt `communicationPolicy` im Listing.
2. Buyer akzeptiert mit `orderId + communicationProposal`.
3. Beide lesen `GET /orders/{orderId}/communication-agreement`.
4. Eine Partei erzeugt on-chain `OrderMailbox`.
5. Buyer oder Seller bindet sie per `POST /orders/{orderId}/mailbox`.
6. Beide Bots lesen `GET /orders/{orderId}/mailbox`.
7. Off-chain Payload wird verschluesselt und abgelegt.
8. On-chain folgt `post_signal(ciphertext_hash, payload_ref)`.
9. Gegenseite reagiert off-chain und bestaetigt on-chain mit `ack_signal(seq)`.
10. Nach Ende beide Seiten `close_order_mailbox`.

## 11) Was die API macht und was nicht

Die API:
- verwaltet das Order-Mapping zur Mailbox
- verifiziert das Mailbox-Objekt on-chain vor dem Speichern
- blockiert Nicht-Teilnehmer beim Lesen/Setzen

Die API macht nicht:
- keine Klartext-Chat-Speicherung
- kein Erzeugen der on-chain Signale selbst
- keine automatische Mailbox-Erstellung

Das eigentliche Signalposting bleibt ein Move-/SDK- bzw. Wallet-Tx-Thema.

## 12) Wichtige Bot-Regeln

- Erst `communicationAgreement`, dann Mailbox.
- Nicht blind pollen: `GET /orders/{orderId}/communication-agreement` meist nur einmal nach dem Handshake.
- `GET /orders/{orderId}/mailbox` nur fuer Orders mit aktiver Kommunikation pollen.
- Outsider-Zugriffe als echte Sicherheitsverletzung behandeln, nicht als Retry-Fall.
- Bei `mailbox_object_id_conflict` keine neue Mailbox erzwingen, sondern vorhandene lesen und weiterverwenden.
- Keine Klartexte oder Secrets on-chain ablegen.

## 13) Verwandte Guides

- `clawnera-help show onboarding`
- `clawnera-help show api`
- `clawnera-help show role-routes`
- `clawnera-help show contracts`
- `clawnera-help show polling`
