# iOS-Hülle mit direktem HealthKit-Zugriff

Vorbereitetes natives SwiftUI/WKWebView-Projekt, keine reine PWA. Die vorhandene Inertia-App
läuft weiterhin auf dem eigenen Server. Die iOS-Hülle stellt ausschliesslich dem konfigurierten
HTTPS-Origin eine kleine, lesende HealthKit-Bridge bereit.
Der Reverse Proxy muss den ursprünglichen Host erhalten; `APP_URL` sollte auf die verwendete
HTTPS-Adresse zeigen. Die bestehende Same-Origin-Prüfung bleibt aktiv.

## Aktueller Stand und Voraussetzungen

Quellcode, HealthKit-Entitlement, Zweckbeschreibung und XcodeGen-Projektdefinition vorhanden.
Noch **nicht mit dem iOS-SDK gebaut, signiert oder auf einem iPhone getestet**. Auf dem
Entwicklungsrechner sind bislang nur die Command Line Tools vorhanden, nicht die vollständige Xcode-App.

Benötigt: vollständiges Xcode mit iOS-SDK, XcodeGen, ein Signing-Team mit HealthKit-Capability
und ein iPhone für den Test mit echten Daten. Deployment-Ziel iOS 16+.

```sh
# Nach Installation von Xcode und XcodeGen:
cd mobile/ios
xcodegen generate
open Bauchgefuehl.xcodeproj
```

In Xcode Bundle-ID und Development Team auf eigene Werte setzen; HealthKit-Capability prüfen.
Dann auf dem iPhone starten. `project.yml` und die Swift-/Plist-Dateien sind die Quellen;
generierte Xcode-Projekte und lokale Signierungseinstellungen werden nicht eingecheckt.

## Server und Datenschutz

Beim ersten Start den **eigenen, abgesicherten HTTPS-Tagebuch-Server** eintragen. `localhost`
auf dem iPhone ist nicht der Mac. Die vorhandene Compose-App ist absichtlich nur an Loopback
gebunden und enthält noch keine Benutzeranmeldung. Sie darf nicht einfach öffentlich
freigegeben werden. Ein abgesicherter privater Zugang mit TLS und Zugriffsschutz muss separat
eingerichtet werden; diese Änderung veröffentlicht keinen Server und schaltet keine Ports frei.

Keine globale ATS-Ausnahme und kein eingebauter Bearer-Token. Externe HTTPS-Links werden aus
der HealthKit-fähigen WebView heraus geöffnet. Nur Nachrichten aus dem Hauptframe des
konfigurierten Origins erreichen HealthKit; fremde Frames bekommen keine Gesundheitsdaten.

## Nutzerablauf

1. Profil → Health öffnen.
2. Die Erklärung zur Übertragung an den Tagebuch-Server lesen.
3. „Apple Health freigeben & synchronisieren“ antippen.
4. Die **echte iOS-Systemfreigabe** wählen. Sie ist vom Betriebssystem vorgeschrieben,
   nicht ein weiterer App-Dialog.
5. Höchstens die neuesten 500 Messungen je Typ aus sieben Tagen werden gelesen und direkt
   über den vorhandenen Same-Origin-Endpunkt gespeichert. Keine JSON-Datei auswählen.

Gelesen werden Puls, Ruhepuls und HRV-SDNN; keine Schreibrechte, keine Hintergrundabfragen,
keine erfundene Stress-Skala. Rohwerte werden als Kontext gespeichert, nicht als normalisierter
Stress in das Modell eingeschleust. Die Bridge sendet keine Patientennotizen an andere Dienste.
HealthKit-Sample-UUIDs dienen als IDs für idempotente Wiederholungen.

Apple legt nicht offen, ob einzelne Leseberechtigungen verweigert wurden. Ein abgeschlossener
Freigabe-Dialog ist deshalb kein Beweis für vollständigen Zugriff. Leere Ergebnisse werden
als „keine freigegebenen Messungen“ angezeigt, nicht als erfolgreiche Verbindung mit Daten.

Widerruf in Apple Health stoppt künftigen Zugriff. Bereits gespeicherte Tagebucheinträge werden
nicht automatisch gelöscht. Dieses erste Gerüst synchronisiert keine HealthKit-Löschungen und
keine vollständige Historie; dazu wäre später ein Anchor-/Deletion-Abgleich nötig.

## Android und Samsung

Auf ausdrücklichen Wunsch zunächst nur iOS. Android wäre eine zweite native Implementierung
mit Health Connect und dessen Systemberechtigungen. Direkter Zugriff mit Samsung Health Data
SDK erfordert für die Veröffentlichung ausserhalb des Entwicklermodus eine Partnerregistrierung.
In der Web-UI werden diese Integrationen nicht als bereits verbunden dargestellt.

## Primärquellen

- [Apple: HealthKit-Freigaben](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Apple: Datenschutz bei Leseberechtigungen](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus)
- [Apple: Sample-Abfragen](https://developer.apple.com/documentation/healthkit/hksamplequery)
- [Android: Health Connect einrichten](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Samsung: SDK-Voraussetzungen und Partnerregistrierung](https://developer.samsung.com/health/data/faq.html)
