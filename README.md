# Werkplan

Kleines lokales Zeichenprogramm fuer technische Entwurfszeichnungen.

## Start unter Windows 11

`Start-Zeichenprogramm.bat` doppelklicken oder `index.html` im Browser oeffnen. Es wird keine Installation und kein Server benoetigt.

## Werkzeuge

### Auswahl (Werkzeug 1)
- **Objekt anklicken**: Wählt das Objekt aus und zeigt seine Eigenschaften
- **Ausgewähltes Objekt verschieben**: Mit der Maus auf dem Objekt halten und ziehen (Drag & Drop)
- **Eigenschaften bearbeiten**: Werte im rechten Panel ändern; die Änderung wird beim Verlassen des Feldes direkt übernommen
- **Objekt löschen**: "Auswahl löschen" Button klicken

Im Eigenschaftenbereich stehen zusätzlich exaktes Verschieben und Duplizieren, Drehen, horizontales und vertikales Spiegeln sowie rechteckige und kreisförmige Wiederholungen zur Verfügung. Linien können an Anfang oder Ende um einen festen Betrag getrimmt oder verlängert und an einer exakten Länge geteilt werden.

### Linie (Werkzeug 2)
Klicken und ziehen für eine gerade Linie.

### Kreis (Werkzeug 3)
Vom Mittelpunkt nach außen ziehen. Zielradius und Winkel können links exakt vorgegeben werden.

### Halbkreis (Werkzeug 4)
Vom Mittelpunkt zum Rand ziehen. Die Ausrichtung folgt dem gezeichneten Winkel.

### Rechteck (Werkzeug 5)
Klicken und ziehen für ein Rechteck.

### Bemaßung (Werkzeug 6)
Linie mit Beschriftung. Die Länge wird automatisch berechnet.

### Text (Werkzeug 7)
Klicken, Text eingeben, Enter zum Bestätigen.

### Weitere Formen

- **Polylinie**: Punkte nacheinander anklicken, mit Doppelklick abschließen
- **Ellipse / Ellipsenbogen**: Mittelpunkt anklicken und beide Radien durch Ziehen bestimmen
- **Langloch**: Mittellinie ziehen; die Breite kann über das exakte Höhenfeld vorgegeben werden
- **Polygon**: Mittelpunkt anklicken und Radius ziehen; die Seitenzahl wird links eingestellt
- **Fase / Abrundung**: Rechteck auswählen und unter Eigenschaften Eckenart und Eckmaß einstellen

### Intelligentes Trimmen und Verlängern

**Trimmen** oder **Verlängern** wählen und eine Linie nahe dem zu bearbeitenden Ende anklicken. Werkplan sucht entlang der Linie die nächste Schnittkante und setzt das Ende automatisch dorthin.

## Ebenen

Werkplan besitzt die Ebenen **Kontur**, **Achsen**, **Bemaßung**, **Text** und **Hilfslinien**. Neue Objekte werden auf der aktiven Ebene angelegt. Pro Ebene stehen drei getrennte Schalter zur Verfügung:

- **S**: auf der Arbeitsfläche sichtbar
- **G**: gegen Auswahl und Bearbeitung gesperrt
- **D**: in SVG, PNG und PDF druckbar

Die Sichtbarkeit wird für jede Arbeitsansicht separat gespeichert. Hilfslinien sind standardmäßig nicht druckbar.

## Mehrfachauswahl und Gruppen

- Mit **Shift + Klick** Objekte zur Auswahl hinzufügen oder daraus entfernen
- Auf freier Fläche einen Auswahlrahmen aufziehen
- Ausgewählte Objekte gemeinsam ziehen, drehen, spiegeln, kopieren oder löschen
- Im Eigenschaftenbereich gruppieren oder eine Gruppierung aufheben
- Ein Klick auf ein gruppiertes Objekt wählt beim Verschieben die gesamte Gruppe

## Objektfang

Neben Endpunkt, Mittelpunkt, Schnittpunkt, Kante und Lotpunkt stehen Quadrant, Tangente, Verlängerung, Parallel und Senkrecht zur Verfügung. Bei richtungsabhängigen Fängen zeigt eine orange gestrichelte Hilfsspur den verwendeten Bezug. Der Fang ist bei allen geometrischen Zeichenwerkzeugen aktiv.

## Maßstab und Richtmaß

Rechts unter **Maßstab & Richtmaß** kann zwischen 1:1, 1:10, 1:20, 1:50, 1:100 oder einem eigenen Maßstab gewählt werden. Die Objekte werden immer in echten Millimetern gespeichert; der Maßstab steuert nur, wie viel davon auf dem Zeichenblatt sichtbar ist. Bei 1:20 entsprechen 100 mm auf dem Blatt 2.000 mm in der Planung.

Die aktive Arbeitsansicht wird direkt in der Leiste oberhalb der Zeichenfläche umgeschaltet. Das farbig hervorgehobene Segment und die ausgeschriebene Bezeichnung zeigen jederzeit, ob gerade Frontansicht, Seitenansicht, Draufsicht oder Detail bearbeitet wird.

Jede Ansicht speichert ihren eigenen Zoom, Bildausschnitt, Darstellungsmaßstab und ihre Ebenensichtbarkeit. Unter **Blattposition der aktiven Ansicht** können X und Y für die freie Positionierung dieser Ansicht im Export festgelegt werden. Leere Felder verwenden die automatische Anordnung.

### Ein Richtmaß setzen

1. Mit dem Linienwerkzeug eine bekannte Strecke zeichnen.
2. Das Objekt mit dem Auswahlwerkzeug anklicken.
3. Rechts im Bereich **Richtmaß festlegen** die echte Länge eintragen, zum Beispiel `1800 mm`.
4. **Übernehmen** klicken.

Nur die Bemaßungswerte der zugehörigen Ansicht werden kalibriert. Objektgeometrie, Positionen, Zeichnungsgröße, Zoom und Bildausschnitt bleiben vollständig unverändert. Eine auf 1,8 m gesetzte Referenzlinie bewirkt, dass alle Bemaßungen derselben Ansicht mit diesem Verhältnis beschriftet werden. Frontansicht, Seitenansicht, Draufsicht und Detail können unabhängig voneinander kalibriert werden.

Zum Kalibrieren einer weiteren Ansicht diese unter **Aktive Ansicht** auswählen, dort eine Linie oder ein Rechteck markieren und ein eigenes Richtmaß übernehmen. Unter der Auswahl der aktiven Ansicht wird das zuletzt gesetzte Richtmaß angezeigt.

## Navigation

- **Mausrad**: Um die Cursorposition zoomen
- **Mittlere Maustaste ziehen**: Zeichenfläche verschieben
- **Leertaste und linke Maustaste ziehen**: Zeichenfläche verschieben
- **Alles**: Alle Objekte der aktiven Ansicht einpassen
- **Auswahl**: Das ausgewählte Objekt einpassen

## Speichern und Export

Ein Stern vor dem Fenstertitel zeigt ungespeicherte Änderungen an. Projektdateien verwenden ab Version 4 auch gedrehte Objekte, ab Version 5 getrennte Richtmaße, ab Version 6 Ebenen, Gruppen, neue Grundformen sowie Ansichtseinstellungen und ab Version 7 rein visuelle Bemaßungskalibrierungen ohne Geometrieänderung. Beim PDF-Export stehen die ersten sechs Materialpositionen auf dem Zeichnungsblatt; alle weiteren Positionen werden automatisch auf so viele Folgeseiten verteilt, wie benötigt werden.

## Objektinspektor und Kontextmenü

In der Objektliste kann nach Name oder Typ sowie nach Ansicht und Ebene gefiltert werden. Objekte lassen sich dort sichtbar oder unsichtbar schalten, sperren, auswählen und anhand ihrer Material- oder Bemaßungsverknüpfungen prüfen. Objektname, Ebene und Sperre sind direkt in den Eigenschaften editierbar.

Ein Rechtsklick auf ein Objekt öffnet Befehle für Kopieren, 90-Grad-Drehung, Spiegelung, Schnellbemaßung, Materialzuordnung und Löschen.

Die verwendeten Schriften liegen als WOFF2-Dateien im Ordner `fonts`. Werkplan benötigt deshalb auch für die Typografie keine Internetverbindung. Die zugehörigen OFL-Lizenztexte befinden sich im selben Ordner.
