# Jira-skill — GitHub Copilot Skill

En VS Code Chat Participant-extension (GitHub Copilot Skill) som lar utviklere interagere med **Jira** direkte fra GitHub Copilot Chat. Hent oppgaver, assigner til deg selv, oppdater status og få en AI-generert utviklingsplan — alt uten å forlate editoren.

## Funksjoner

| Kommando | Beskrivelse |
|---|---|
| `@jira /neste` | 🎯 Ta neste høyest prioriterte oppgave, assigner til deg selv og få en utviklingsplan |
| `@jira /mine` | 📋 List alle dine åpne Jira-oppgaver |
| `@jira /sprint` | 🏃 Vis alle oppgaver i aktiv sprint med fremdrift |
| `@jira /detaljer PROJ-123` | 🔍 Vis fullstendige detaljer for en oppgave |
| `@jira /status PROJ-123 done` | 🔄 Endre status på en oppgave |
| `@jira /kommenter PROJ-123 tekst` | 💬 Legg til kommentar på en oppgave |

Du kan også skrive fritt til `@jira`, f.eks.:
- `@jira Hva bør jeg jobbe med nå?`
- `@jira Finn alle bugs med høy prioritet`
- `@jira Lag en utviklingsplan for PROJ-456`

## Hovedfunksjon: `/neste`

Den viktigste kommandoen er `/neste` som automatiserer hele flyten:

1. **Finner neste oppgave** — henter høyest prioriterte uassignerte oppgave fra backlogen
2. **Tilordner til deg** — assignerer oppgaven til innlogget bruker
3. **Starter arbeidet** — flytter oppgaven til "In Progress"
4. **Lager utviklingsplan** — analyserer prosjektets kodebase og bruker Copilot LLM til å lage en konkret plan med:
   - Foreslått branch-navn
   - Filer som må endres/opprettes
   - Steg-for-steg implementasjonsplan
   - Foreslåtte tester
   - Mulige utfordringer
   - Ferdig commit-melding

## Slik fungerer det

```
Utvikler → @jira /neste
  ↓
  ├── JiraClient.getNextPriorityIssue()   → Finner neste oppgave
  ├── JiraClient.assignIssue()            → Tilordner til bruker
  ├── JiraClient.moveToStatus()           → Flytter til In Progress
  ├── WorkspaceAnalyzer.gatherContext()   → Analyserer prosjektets kode
  └── Copilot LLM                        → Genererer utviklingsplan
  ↓
Utviklingsplan med konkrete steg
```

## Oppsett

### 1. Installer extensionen

```bash
# Klon repoet
git clone <repo-url>
cd jira-skill

# Installer avhengigheter
npm install

# Bygg
npm run compile

# Pakke som VSIX (valgfritt)
npm run package
```

For utvikling: Trykk **F5** i VS Code for å starte Extension Development Host.

### 2. Konfigurer Jira-tilkobling

Legg til følgende i VS Code-innstillingene (`settings.json`):

#### Jira Cloud (Atlassian)

```json
{
  "jira-skill.baseUrl": "https://ditt-domene.atlassian.net",
  "jira-skill.pat": "din-api-token",
  "jira-skill.email": "din@epost.no",
  "jira-skill.projectKey": "PROJ",
  "jira-skill.boardId": "123",
  "jira-skill.isCloud": true
}
```

#### Jira Server / Data Center

```json
{
  "jira-skill.baseUrl": "https://jira.ditt-domene.no",
  "jira-skill.pat": "din-personal-access-token",
  "jira-skill.projectKey": "PROJ",
  "jira-skill.boardId": "123",
  "jira-skill.isCloud": false
}
```

### Slik lager du token

#### Jira Cloud (API-token)
1. Gå til [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Klikk **Create API token**
3. Gi tokenet et navn og kopier det
4. Sett tokenet i `jira-skill.pat` og e-posten i `jira-skill.email`

#### Jira Server/Data Center (PAT)
1. Gå til din Jira-profil → **Personal Access Tokens**
2. Klikk **Create token**
3. Gi tokenet et navn og sett utløpsdato
4. Kopier tokenet og sett det i `jira-skill.pat`

> ⚠️ **Sikkerhet:** Token/PAT gir tilgang til Jira. Ikke sjekk det inn i kildekode.

### 3. Krav

- **VS Code** 1.93 eller nyere
- **GitHub Copilot Chat** extension installert og aktiv
- Nettverkstilgang til Jira-instansen

## Konfigurasjon

| Innstilling | Standard | Beskrivelse |
|---|---|---|
| `jira-skill.baseUrl` | *(tom)* | Base-URL for Jira (f.eks. `https://x.atlassian.net`) |
| `jira-skill.pat` | *(tom)* | API-token (Cloud) eller PAT (Server) |
| `jira-skill.email` | *(tom)* | E-post for Jira Cloud-autentisering |
| `jira-skill.projectKey` | *(tom)* | Standard prosjektnøkkel (f.eks. `PROJ`) |
| `jira-skill.boardId` | *(tom)* | Board-ID for sprint-oppslag |
| `jira-skill.isCloud` | `true` | `true` for Cloud, `false` for Server/DC |

## Arkitektur

```
src/
├── extension.ts          # Hovedinngang, registrerer chat participant og håndterer kommandoer
├── jiraClient.ts         # Jira REST API-klient (støtter Cloud og Server/DC)
└── workspaceAnalyzer.ts  # Analyserer prosjektets kodebase for utviklingsplan
```

## Eksempler

### Ta neste oppgave og start utvikling
```
@jira /neste
```
> Finner PROJ-456 (høyest prioritet), assignerer til deg, setter "In Progress", og genererer en utviklingsplan basert på prosjektets kodebase.

### Se dine oppgaver
```
@jira /mine
```
> Lister alle oppgaver tildelt deg, gruppert etter status.

### Oppdater status når du er ferdig
```
@jira /status PROJ-456 done
```
> Flytter oppgaven til "Done".

### Fritt spørsmål
```
@jira Hvilken oppgave bør jeg prioritere nå?
```
> Bruker Copilot LLM til å analysere dine Jira-oppgaver og gi en anbefaling.

## Lisens

MIT
