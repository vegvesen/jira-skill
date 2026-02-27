# Jira-skill — GitHub Copilot Skill

En VS Code Chat Participant-extension (GitHub Copilot Skill) som lar utviklere interagere med **Jira** direkte fra GitHub Copilot Chat. Hent oppgaver, assigner til deg selv, oppdater status og få en AI-generert utviklingsplan — alt uten å forlate editoren.

> **v0.1.1+** — Inkluderer sikkerhets-hardening: PAT lagres nå i SecretStorage, HTTPS kreves, og LLM-utsendelse av Jira-data er konfigurerbar og sanitert.

## Kommandooversikt

| Kommando | Beskrivelse |
|---|---|
| `@jira /neste` | 🎯 Ta neste høyest prioriterte oppgave, assigner til deg selv og få en utviklingsplan |
| `@jira /mine` | 📋 List alle dine åpne Jira-oppgaver |
| `@jira /sprint` | 🏃 Vis alle oppgaver i aktiv sprint med fremdrift |
| `@jira /detaljer PROJ-123` | 🔍 Vis fullstendige detaljer for en oppgave |
| `@jira /status PROJ-123 done` | 🔄 Endre status på en oppgave |
| `@jira /kommenter PROJ-123 tekst` | 💬 Legg til kommentar på en oppgave |
| `@jira /settPAT` | 🔑 Sett Jira PAT/API-token sikkert (lagres i SecretStorage) |
| `@jira /fjernPAT` | 🗑️ Fjern lagret PAT fra SecretStorage |
| `@jira /authstatus` | 🔎 Kjør diagnostikk av Jira-autentisering og konfigurasjon |

Du kan også skrive fritt til `@jira`, f.eks.:
- `@jira Hva bør jeg jobbe med nå?`
- `@jira Finn alle bugs med høy prioritet`
- `@jira Lag en utviklingsplan for PROJ-456`

## Kom i gang (bruker)

### 1. Krav

- **VS Code** 1.109 eller nyere
- **GitHub Copilot Chat** extension installert og aktiv
- Nettverkstilgang til Jira-instansen via HTTPS

### 2. Installer extensionen

Installer `.vsix`-filen via VS Code:

```
Ctrl+Shift+P → Extensions: Install from VSIX...
```

Eller for utvikling, se [Utviklerguide](#utviklerguide) nedenfor.

### 3. Konfigurer Jira-tilkobling

Legg til grunninnstillinger i VS Code (`settings.json`). **Ikke legg inn token her** — bruk `/settPAT` i stedet (se neste steg).

#### Jira Cloud (Atlassian)

```json
{
  "jira-skill.baseUrl": "https://ditt-domene.atlassian.net",
  "jira-skill.email": "din@epost.no",
  "jira-skill.projectKey": "PROJ",
  "jira-skill.boardId": "123",
  "jira-skill.isCloud": true
}
```

> Hvis Jira Cloud bruker custom domene (ikke `*.atlassian.net`), sett alltid `"jira-skill.isCloud": true` eksplisitt.

#### Jira Server / Data Center

```json
{
  "jira-skill.baseUrl": "https://jira.ditt-domene.no",
  "jira-skill.projectKey": "PROJ",
  "jira-skill.boardId": "123",
  "jira-skill.isCloud": false
}
```

### 4. Sett PAT sikkert

Kjør i Copilot Chat:

```
@jira /settPAT
```

Du får opp en passordinnput-dialog. Tokenet lagres i VS Code SecretStorage (kryptert på maskinen — ikke i `settings.json` eller versjonskontroll).

#### Slik lager du token

**Jira Cloud (API-token):**
1. Gå til [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Klikk **Create API token**, gi et navn og kopier verdien
3. Bruk tokenet i `/settPAT`-dialogen

**Jira Server/Data Center (PAT):**
1. Gå til din Jira-profil → **Personal Access Tokens**
2. Klikk **Create token**, gi et navn og sett utløpsdato
3. Bruk tokenet i `/settPAT`-dialogen

### 5. Test tilkoblingen

```
@jira /mine
```

Lister dine åpne Jira-oppgaver. Hvis du ser feil, sjekk base-URL og at tokenet har riktige tilganger.

---

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

```
Utvikler → @jira /neste
  ↓
  ├── JiraClient.getNextPriorityIssue()   → Finner neste oppgave
  ├── JiraClient.assignIssue()            → Tilordner til bruker
  ├── JiraClient.moveToStatus()           → Flytter til In Progress
  ├── WorkspaceAnalyzer.getTechSummary()  → Leser tech-stack lokalt
  └── Copilot LLM (agent-mode)           → Genererer utviklingsplan
  ↓
Utviklingsplan med konkrete steg
```

---

## Konfigurasjon

| Innstilling | Standard | Beskrivelse |
|---|---|---|
| `jira-skill.baseUrl` | *(tom)* | Base-URL for Jira — **må starte med `https://`** |
| `jira-skill.email` | *(tom)* | E-post for Jira Cloud-autentisering |
| `jira-skill.projectKey` | *(tom)* | Standard prosjektnøkkel (f.eks. `PROJ`) |
| `jira-skill.boardId` | *(tom)* | Board-ID for sprint-oppslag |
| `jira-skill.isCloud` | auto-detect | `true` for Cloud, `false` for Server/DC. Utelat for automatisk deteksjon. |
| `jira-skill.allowLlmData` | `true` | Tillat at Jira-oppgavedata sendes til Copilot LLM. Sett til `false` for å deaktivere LLM-analyse. |

---

## Sikkerhet

| Tiltak | Detaljer |
|---|---|
| **SecretStorage** | PAT/API-token lagres kryptert via VS Code SecretStorage, ikke i `settings.json` |
| **HTTPS-krav** | `baseUrl` avvises hvis den ikke starter med `https://` |
| **Feilmeldingssanering** | Rå Jira API-responser vises aldri — kun HTTP-statuskode og kontekstuell hint |
| **LLM-dataminimering** | Jira-tekst saniteres (hemmeligheter strippes) og avkortes før LLM-kall |
| **LLM-toggle** | `jira-skill.allowLlmData: false` deaktiverer all Jira-data til LLM |
| **Ingen settings-token** | PAT/API-token støttes kun i SecretStorage (`@jira /settPAT`) |

> **Merk:** Jira-oppgavedata (tittel, beskrivelse, status) sendes til Copilot LLM ved analyse og fritekst-spørsmål. PAT/token sendes **aldri** til LLM — kun til Jira REST API via HTTPS.

---

## Utviklerguide

### Forutsetninger

- Node.js 20+
- npm 10+
- VS Code 1.109+
- GitHub Copilot Chat installert

### Lokalt oppsett

```bash
git clone <repo-url>
cd jira-skill
npm install
npm run compile
```

Trykk **F5** i VS Code for å starte Extension Development Host med extensionen lastet.

### Nyttige scripts

```bash
npm run compile   # Enkeltbygg
npm run watch     # Bygg ved filendringer (anbefalt under utvikling)
npm run lint      # Kjør ESLint
npm run package   # Pakk som .vsix (krever ingen repository-URL)
```

### Arkitektur

```
src/
├── extension.ts          # Aktivering, chat participant-handler og alle kommandoer
├── jiraClient.ts         # Jira REST API-klient (Cloud og Server/DC)
└── workspaceAnalyzer.ts  # Leser workspace-struktur og tech-stack lokalt
```

**Dataflyt:**

```
settings.json (baseUrl, email, projectKey, boardId)
         +
SecretStorage (PAT/API-token)
         ↓
    JiraClient
         ↓ HTTPS
    Jira REST API
         ↓
  sanitizeForLlm()   ←── strippes/avkortes
         ↓
   Copilot LLM (vscode.lm API — lokal proxy via GitHub Copilot)
         ↓
    ChatResponseStream → utvikler
```

### Legge til ny kommando

1. Legg til et innslag i `contributes.chatParticipants[].commands` i `package.json`
2. Legg til en `case`-gren i `handler()`-switchen i `src/extension.ts`
3. Implementer en `handleXxx()`-funksjon etter samme mønster som eksisterende handlere
4. Bruk `await createClient(stream)` for å hente autentisert Jira-klient med SecretStorage-token
5. Bruk `sanitizeForLlm(tekst, maxLength)` på alt Jira-innhold som sendes til `callLLM()`

### Sikkerhetsprinsipper (obligatorisk for bidrag)

- **Aldri** les PAT fra config/settings — bruk alltid `createClient()` som henter token fra SecretStorage
- **Aldri** send rå Jira API-respons i feilmeldinger til bruker
- **Alltid** kall `sanitizeForLlm()` på Jira-tekst (beskrivelse, kommentarer) før LLM-kall
- **Alltid** respekter `jira-skill.allowLlmData`-togglen — dette gjøres automatisk i `callLLM()`

---

## Eksempler

```
@jira /neste
```
> Finner PROJ-456 (høyest prioritet), assignerer til deg, setter "In Progress", og åpner Plan-mode i Copilot.

```
@jira /mine
```
> Lister alle oppgaver tildelt deg, gruppert etter status.

```
@jira /status PROJ-456 done
```
> Flytter oppgaven til "Done".

```
@jira Hvilken oppgave bør jeg prioritere nå?
```
> Henter dine oppgaver og ber Copilot LLM gi en anbefaling.

---

## Lisens

MIT
