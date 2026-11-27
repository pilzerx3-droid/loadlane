# Loadlane Starter Kit

Dieses Paket gibt Claude Code den vollen Projektkontext. Inhalt:

- `CLAUDE.md`: Regeln, Entscheidungen und Arbeitsweise (wird von Claude Code automatisch gelesen)
- `docs/adr/`: Architekturentscheidungen (Status: Accepted oder Proposed)
- `docs/backlog-phase-1.md`: konkrete Aufgaben für Phase 1 mit Abnahmekriterien
- `docs/us-market-notes.md`: Besonderheiten des US-Markts (Prüfliste, keine Rechtsberatung)
- `docs/interview-guide.md`: Gesprächsleitfaden und Ansprachetexte für die Kundeninterviews

## So nutzt du es

1. Lege ein leeres Git-Repository an (zum Beispiel `loadlane`) und kopiere den Inhalt dieses Ordners hinein.
2. Lege deinen kompletten Masterprompt als `docs/masterprompt.md` ab. `CLAUDE.md` verweist darauf.
3. Öffne das Repository in Claude Code (Anleitung: https://docs.claude.com).
4. Starte mit diesem Auftrag:

> Lies CLAUDE.md, docs/masterprompt.md und docs/backlog-phase-1.md. Erstelle einen Plan für P1-01 bis P1-03 und warte auf meine Freigabe, bevor du Code schreibst. Arbeite danach in kleinen Schritten, führe nach jedem Schritt Tests aus und berichte mir auf Deutsch.

## Voraussetzungen auf deinem Rechner

Git, Node.js (LTS), pnpm, Docker Desktop und ein GitHub-Konto.

## Tipp zu den Limits

Dein Pro-Kontingent gilt gemeinsam für Claude und Claude Code. Plane die Architektur mit dem stärkeren Modell, setze mit dem schnelleren um und arbeite in kleinen Sitzungen mit je einem Backlog-Eintrag.
