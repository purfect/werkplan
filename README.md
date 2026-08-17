# Werkplan

Kleines lokales Zeichenprogramm fuer technische Entwurfszeichnungen.

## Start unter Windows 11

`Start-Zeichenprogramm.bat` doppelklicken oder `index.html` im Browser oeffnen. Es wird keine Installation und kein Server benoetigt.

## Werkzeuge

### Auswahl (Werkzeug 1)
- **Objekt anklicken**: Wählt das Objekt aus und zeigt seine Eigenschaften
- **Ausgewähltes Objekt verschieben**: Mit der Maus auf dem Objekt halten und ziehen (Drag & Drop)
- **Eigenschaften bearbeiten**: Werte im rechten Panel ändern und "Änderungen übernehmen" klicken
- **Objekt löschen**: "Auswahl löschen" Button klicken

### Linie (Werkzeug 2)
Klicken und ziehen für eine gerade Linie.

### Polylinie (Werkzeug 3)
Mehrfaches Klicken für Punkte; Rechtsklick oder ESC zum Beenden.

### Rechteck (Werkzeug 4)
Klicken und ziehen für ein Rechteck.

### Bemaßung (Werkzeug 5)
Linie mit Beschriftung. Die Länge wird automatisch berechnet.

### Text (Werkzeug 6)
Klicken, Text eingeben, Enter zum Bestätigen.

## Maßstab und Richtmaß

Rechts unter **Maßstab & Richtmaß** kann zwischen 1:1, 1:10, 1:20, 1:50, 1:100 oder einem eigenen Maßstab gewählt werden. Die Objekte werden immer in echten Millimetern gespeichert; der Maßstab steuert nur, wie viel davon auf dem Zeichenblatt sichtbar ist. Bei 1:20 entsprechen 100 mm auf dem Blatt 2.000 mm in der Planung.

### Ein Richtmaß setzen

1. Mit dem Linienwerkzeug eine bekannte Strecke zeichnen.
2. Das Objekt mit dem Auswahlwerkzeug anklicken.
3. Rechts im Bereich **Richtmaß festlegen** die echte Länge eintragen, zum Beispiel `1800 mm`.
4. **Übernehmen** klicken.

Die gesamte Zeichnung wird proportional kalibriert. Die ausgewählte Linie ist danach exakt 1,8 m lang; alle weiteren Objekte können sich an diesem Maß orientieren.
