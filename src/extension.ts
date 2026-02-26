import * as vscode from 'vscode';
import { JiraClient, JiraIssue } from './jiraClient';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';

// ─── Aktivering ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    const participant = vscode.chat.createChatParticipant('jira-skill.assistant', handler);
    participant.iconPath = new vscode.ThemeIcon('bookmark');
    context.subscriptions.push(participant);

    // Kommando for å starte utvikling i Copilot Agent/Plan-mode
    const startDevCmd = vscode.commands.registerCommand(
        'jira-skill.startDevelopment',
        async (prompt: string) => {
            try {
                // Åpne ny Copilot Chat i agent-mode (Plan-mode) med ferdig prompt
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: prompt,
                    isPartialQuery: false,
                    mode: 'agent',
                });
            } catch {
                // Fallback: åpne chat uten mode-parameter (eldre VS Code)
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.open', {
                        query: prompt,
                        isPartialQuery: false,
                    });
                } catch {
                    // Siste fallback: kopier til clipboard
                    await vscode.env.clipboard.writeText(prompt);
                    vscode.window.showInformationMessage(
                        'Utviklingsprompt kopiert til utklippstavlen. Lim inn i Copilot Chat (Agent-mode).'
                    );
                }
            }
        }
    );
    context.subscriptions.push(startDevCmd);
}

export function deactivate() { }

// ─── Hovedhandler ────────────────────────────────────────────────────────────

async function handler(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    switch (request.command) {
        case 'neste':
            return handleNeste(request, stream, token);
        case 'mine':
            return handleMine(request, stream, token);
        case 'sprint':
            return handleSprint(request, stream, token);
        case 'detaljer':
            return handleDetaljer(request, stream, token);
        case 'status':
            return handleStatus(request, stream, token);
        case 'kommenter':
            return handleKommenter(request, stream, token);
        default:
            return handleFreeform(request, stream, token);
    }
}

// ─── Hjelpefunksjoner ────────────────────────────────────────────────────────

function createClient(stream: vscode.ChatResponseStream): JiraClient | null {
    const client = new JiraClient();
    const err = client.validateConfig();
    if (err) {
        stream.markdown(`⚠️ **Konfigurasjonsfeil:** ${err}\n\n`);
        stream.markdown('Konfigurer i VS Code-innstillinger (`settings.json`):\n```json\n{\n');
        stream.markdown('  "jira-skill.baseUrl": "https://jira.example.com",\n');
        stream.markdown('  "jira-skill.pat": "din-pat-eller-api-token",\n');
        stream.markdown('  "jira-skill.email": "din@epost.no",\n');
        stream.markdown('  "jira-skill.projectKey": "PROJ",\n');
        stream.markdown('  "jira-skill.isCloud": true\n}\n```\n');
        return null;
    }
    return client;
}

function formatIssue(issue: JiraIssue, index?: number): string {
    const prefix = index !== undefined ? `${index + 1}. ` : '';
    const statusIcon = getStatusIcon(issue.statusCategoryKey);
    const priorityIcon = getPriorityIcon(issue.priority);
    const assignee = issue.assignee ? issue.assignee : '_Ikke tildelt_';
    const points = issue.storyPoints !== undefined ? ` | ${issue.storyPoints} SP` : '';

    return [
        `${prefix}${statusIcon} **[${issue.key}](${issue.url})** — ${issue.summary}`,
        `   ${priorityIcon} ${issue.priority} | ${issue.issueType} | Status: ${issue.status} | Tildelt: ${assignee}${points}`,
    ].join('\n');
}

function getStatusIcon(categoryKey: string): string {
    switch (categoryKey) {
        case 'done': return '✅';
        case 'indeterminate': return '🔄';
        case 'new': return '📋';
        default: return '📋';
    }
}

function getPriorityIcon(priority: string): string {
    const p = priority.toLowerCase();
    if (p.includes('highest') || p.includes('blocker') || p.includes('critical')) { return '🔴'; }
    if (p.includes('high')) { return '🟠'; }
    if (p.includes('medium')) { return '🟡'; }
    if (p.includes('low')) { return '🟢'; }
    if (p.includes('lowest')) { return '⚪'; }
    return '🔵';
}

async function callLLM(
    prompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<boolean> {
    try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        if (models.length === 0) {
            stream.markdown('❌ Ingen tilgjengelig språkmodell funnet.\n');
            return false;
        }
        const messages = [vscode.LanguageModelChatMessage.User(prompt)];
        const response = await models[0].sendRequest(messages, {}, token);
        for await (const fragment of response.text) {
            stream.markdown(fragment);
        }
        return true;
    } catch (e: any) {
        stream.markdown(`❌ **LLM-feil:** ${e.message}\n`);
        return false;
    }
}

// ─── /neste — Hovedkommando ──────────────────────────────────────────────────

/**
 * Tar neste høyest prioriterte oppgave, assignerer til bruker,
 * flytter til "In Progress" og lager en utviklingsplan med Copilot.
 */
async function handleNeste(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'neste' } }; }

    // 1. Finn neste oppgave
    stream.progress('Henter neste prioriterte oppgave fra Jira...');
    let issue: JiraIssue | null;
    try {
        issue = await client.getNextPriorityIssue();
    } catch (e: any) {
        stream.markdown(`❌ **Feil ved henting av oppgaver:** ${e.message}\n`);
        return { metadata: { command: 'neste' } };
    }

    if (!issue) {
        stream.markdown('✅ Ingen uassignerte oppgaver funnet i backlog! Alt er tildelt.\n');
        return { metadata: { command: 'neste' } };
    }

    stream.markdown(`## 🎯 Neste oppgave\n\n`);
    stream.markdown(formatIssue(issue) + '\n\n');

    // 2. Hent bruker og assigner
    stream.progress('Tilordner oppgaven til deg...');
    try {
        const user = await client.getCurrentUser();
        const userId = client.getBaseUrl().includes('atlassian.net')
            ? user.accountId!
            : user.name!;
        await client.assignIssue(issue.key, userId);
        stream.markdown(`👤 **Tilordnet til:** ${user.displayName}\n\n`);
    } catch (e: any) {
        stream.markdown(`⚠️ Kunne ikke tilordne oppgaven: ${e.message}\n\n`);
    }

    // 3. Flytt til In Progress
    stream.progress('Flytter til In Progress...');
    try {
        // Prøv vanlige "under arbeid"-synonymer på både norsk og engelsk
        const newStatus = await client.moveToStatus(
            issue.key,
            'utvikling', 'progress', 'in progress', 'active', 'doing', 'open', 'analyse'
        );
        stream.markdown(`🔄 **Status endret til:** ${newStatus}\n\n`);
    } catch (e: any) {
        stream.markdown(`⚠️ Kunne ikke endre status: ${e.message}\n\n`);
    }

    // 4. Re-hent oppdatert issue for fullstendig beskrivelse
    stream.progress('Henter oppgavedetaljer...');
    try {
        issue = await client.getIssue(issue.key);
    } catch {
        // Bruk eksisterende data
    }

    // 5. Analyser workspace og bygg utviklingsprompt for Plan-mode
    stream.progress('Forbereder utviklingsprompt...');
    const analyzer = new WorkspaceAnalyzer();
    let techSummary = '';
    try {
        techSummary = await analyzer.getTechSummary();
    } catch {
        techSummary = '';
    }

    const agentPrompt = buildAgentPrompt(issue, techSummary, request.prompt);

    stream.markdown(`---\n\n## 🛠️ Klar for utvikling\n\n`);
    stream.markdown(`Trykk knappen under for å starte **Plan-mode** i Copilot. `);
    stream.markdown(`Copilot vil analysere kodebasen, foreslå endringer og opprette/redigere filer for deg.\n\n`);

    stream.button({
        command: 'jira-skill.startDevelopment',
        arguments: [agentPrompt],
        title: '🚀 Start utvikling i Plan-mode',
    });

    // 6. Legg til Jira-lenke
    stream.markdown(`\n\n---\n📎 [Åpne ${issue.key} i Jira](${issue.url})\n`);

    return { metadata: { command: 'neste' } };
}

// ─── /mine ───────────────────────────────────────────────────────────────────

async function handleMine(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'mine' } }; }

    stream.progress('Henter dine oppgaver fra Jira...');

    let issues: JiraIssue[];
    try {
        issues = await client.getMyIssues();
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
        return { metadata: { command: 'mine' } };
    }

    if (issues.length === 0) {
        stream.markdown('✅ Du har ingen åpne oppgaver! 🎉\n');
        return { metadata: { command: 'mine' } };
    }

    stream.markdown(`# Dine Jira-oppgaver\n\n`);
    stream.markdown(`Totalt **${issues.length}** åpne oppgaver:\n\n`);

    // Grupper etter status
    const inProgress = issues.filter(i => i.statusCategoryKey === 'indeterminate');
    const toDo = issues.filter(i => i.statusCategoryKey === 'new');

    if (inProgress.length > 0) {
        stream.markdown(`### 🔄 Under arbeid (${inProgress.length})\n\n`);
        inProgress.forEach((issue, i) => {
            stream.markdown(formatIssue(issue, i) + '\n\n');
        });
    }

    if (toDo.length > 0) {
        stream.markdown(`### 📋 Ikke startet (${toDo.length})\n\n`);
        toDo.forEach((issue, i) => {
            stream.markdown(formatIssue(issue, i) + '\n\n');
        });
    }

    // Hvis bruker har tilleggsforespørsel, bruk LLM
    if (request.prompt.trim()) {
        stream.markdown(`---\n\n`);
        const issuesSummary = issues.map(i =>
            `- ${i.key}: ${i.summary} [${i.status}] [${i.priority}]`
        ).join('\n');

        const prompt = `Du er en teknisk prosjektleder. Bruker spør: "${request.prompt}"

Her er brukerens Jira-oppgaver:
${issuesSummary}

Svar på norsk med konkrete anbefalinger.`;

        await callLLM(prompt, stream, token);
    }

    return { metadata: { command: 'mine' } };
}

// ─── /sprint ─────────────────────────────────────────────────────────────────

async function handleSprint(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'sprint' } }; }

    stream.progress('Henter sprint-oppgaver fra Jira...');

    let issues: JiraIssue[];
    try {
        issues = await client.getSprintIssues();
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
        stream.markdown('\n💡 **Tips:** Konfigurer `jira-skill.boardId` for direkte sprint-oppslag, eller sørg for at prosjektet bruker sprinter.\n');
        return { metadata: { command: 'sprint' } };
    }

    if (issues.length === 0) {
        stream.markdown('Ingen oppgaver funnet i aktiv sprint.\n');
        return { metadata: { command: 'sprint' } };
    }

    stream.markdown(`# 🏃 Aktiv sprint\n\n`);
    stream.markdown(`**${issues.length}** oppgaver i sprinten:\n\n`);

    const done = issues.filter(i => i.statusCategoryKey === 'done');
    const inProgress = issues.filter(i => i.statusCategoryKey === 'indeterminate');
    const toDo = issues.filter(i => i.statusCategoryKey === 'new');

    if (inProgress.length > 0) {
        stream.markdown(`### 🔄 Under arbeid (${inProgress.length})\n\n`);
        inProgress.forEach((issue, i) => stream.markdown(formatIssue(issue, i) + '\n\n'));
    }
    if (toDo.length > 0) {
        stream.markdown(`### 📋 Ikke startet (${toDo.length})\n\n`);
        toDo.forEach((issue, i) => stream.markdown(formatIssue(issue, i) + '\n\n'));
    }
    if (done.length > 0) {
        stream.markdown(`### ✅ Fullført (${done.length})\n\n`);
        done.forEach((issue, i) => stream.markdown(formatIssue(issue, i) + '\n\n'));
    }

    // Vis sprint-statistikk
    const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
    const donePoints = done.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
    if (totalPoints > 0) {
        stream.markdown(`\n---\n📊 **Sprint-fremdrift:** ${donePoints}/${totalPoints} story points fullført (${Math.round(donePoints / totalPoints * 100)}%)\n`);
    }

    return { metadata: { command: 'sprint' } };
}

// ─── /detaljer ───────────────────────────────────────────────────────────────

async function handleDetaljer(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'detaljer' } }; }

    const query = request.prompt.trim();
    if (!query) {
        stream.markdown('Oppgi en Jira-nøkkel. Eksempel: `@jira /detaljer PROJ-123`\n');
        return { metadata: { command: 'detaljer' } };
    }

    // Ekstraher issue-nøkkel (f.eks. PROJ-123)
    const issueKey = extractIssueKey(query, client.getProjectKey());
    if (!issueKey) {
        stream.markdown(`Kunne ikke gjenkjenne Jira-nøkkel i "${query}". Bruk format: \`PROJ-123\`\n`);
        return { metadata: { command: 'detaljer' } };
    }

    stream.progress(`Henter ${issueKey} fra Jira...`);

    let issue: JiraIssue;
    try {
        issue = await client.getIssue(issueKey);
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
        return { metadata: { command: 'detaljer' } };
    }

    // Oppgavedetaljer
    stream.markdown(`# ${issue.key} — ${issue.summary}\n\n`);
    stream.markdown(`| Felt | Verdi |\n|---|---|\n`);
    stream.markdown(`| **Type** | ${issue.issueType} |\n`);
    stream.markdown(`| **Status** | ${getStatusIcon(issue.statusCategoryKey)} ${issue.status} |\n`);
    stream.markdown(`| **Prioritet** | ${getPriorityIcon(issue.priority)} ${issue.priority} |\n`);
    stream.markdown(`| **Tildelt** | ${issue.assignee || '_Ikke tildelt_'} |\n`);
    stream.markdown(`| **Reporter** | ${issue.reporter} |\n`);
    if (issue.storyPoints !== undefined) {
        stream.markdown(`| **Story Points** | ${issue.storyPoints} |\n`);
    }
    if (issue.labels.length > 0) {
        stream.markdown(`| **Labels** | ${issue.labels.join(', ')} |\n`);
    }
    stream.markdown(`| **Opprettet** | ${formatDate(issue.created)} |\n`);
    stream.markdown(`| **Oppdatert** | ${formatDate(issue.updated)} |\n\n`);

    // Beskrivelse
    if (issue.description) {
        stream.markdown(`## Beskrivelse\n\n${issue.description}\n\n`);
    }

    // Deloppgaver
    if (issue.subtasks.length > 0) {
        stream.markdown(`## Deloppgaver (${issue.subtasks.length})\n\n`);
        issue.subtasks.forEach(st => {
            const icon = st.status.toLowerCase().includes('done') ? '✅' : '📋';
            stream.markdown(`- ${icon} **${st.key}**: ${st.summary} _(${st.status})_\n`);
        });
        stream.markdown('\n');
    }

    // Siste kommentarer
    if (issue.comments.length > 0) {
        stream.markdown(`## Siste kommentarer\n\n`);
        issue.comments.forEach(c => {
            stream.markdown(`> **${c.author}** _(${formatDate(c.created)})_:\n> ${c.body.substring(0, 500)}\n\n`);
        });
    }

    stream.markdown(`---\n📎 [Åpne i Jira](${issue.url})\n`);

    return { metadata: { command: 'detaljer' } };
}

// ─── /status ─────────────────────────────────────────────────────────────────

async function handleStatus(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'status' } }; }

    const input = request.prompt.trim();
    if (!input) {
        stream.markdown('Oppgi issue-nøkkel og ønsket status.\n\n');
        stream.markdown('**Eksempler:**\n');
        stream.markdown('- `@jira /status PROJ-123 in progress`\n');
        stream.markdown('- `@jira /status PROJ-123 done`\n');
        stream.markdown('- `@jira /status PROJ-123 review`\n');
        return { metadata: { command: 'status' } };
    }

    // Parse: <ISSUE-KEY> <status>
    const issueKey = extractIssueKey(input, client.getProjectKey());
    if (!issueKey) {
        stream.markdown(`Kunne ikke gjenkjenne Jira-nøkkel i "${input}". Bruk format: \`PROJ-123 in progress\`\n`);
        return { metadata: { command: 'status' } };
    }

    const targetStatus = input.replace(issueKey, '').trim();
    if (!targetStatus) {
        // Vis tilgjengelige transitions
        stream.progress('Henter tilgjengelige overganger...');
        try {
            const transitions = await client.getTransitions(issueKey);
            stream.markdown(`## Tilgjengelige statusoverganger for ${issueKey}\n\n`);
            transitions.forEach(t => {
                stream.markdown(`- **${t.name}** → ${t.to.name}\n`);
            });
            stream.markdown(`\nBruk: \`@jira /status ${issueKey} <status>\`\n`);
        } catch (e: any) {
            stream.markdown(`❌ **Feil:** ${e.message}\n`);
        }
        return { metadata: { command: 'status' } };
    }

    stream.progress(`Endrer status på ${issueKey}...`);

    try {
        const newStatus = await client.moveToStatus(issueKey, targetStatus);
        stream.markdown(`✅ **${issueKey}** er nå i status: **${newStatus}**\n`);
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
    }

    return { metadata: { command: 'status' } };
}

// ─── /kommenter ──────────────────────────────────────────────────────────────

async function handleKommenter(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: 'kommenter' } }; }

    const input = request.prompt.trim();
    if (!input) {
        stream.markdown('Oppgi issue-nøkkel og kommentar.\n\n');
        stream.markdown('**Eksempel:** `@jira /kommenter PROJ-123 Har startet utvikling av denne`\n');
        return { metadata: { command: 'kommenter' } };
    }

    const issueKey = extractIssueKey(input, client.getProjectKey());
    if (!issueKey) {
        stream.markdown(`Kunne ikke gjenkjenne Jira-nøkkel i "${input}".\n`);
        return { metadata: { command: 'kommenter' } };
    }

    const comment = input.replace(issueKey, '').trim();
    if (!comment) {
        stream.markdown('Oppgi kommentartekst etter issue-nøkkelen.\n');
        return { metadata: { command: 'kommenter' } };
    }

    stream.progress(`Legger til kommentar på ${issueKey}...`);

    try {
        await client.addComment(issueKey, comment);
        stream.markdown(`✅ Kommentar lagt til på **${issueKey}**:\n\n> ${comment}\n`);
    } catch (e: any) {
        stream.markdown(`❌ **Feil:** ${e.message}\n`);
    }

    return { metadata: { command: 'kommenter' } };
}

// ─── Freeform ────────────────────────────────────────────────────────────────

/**
 * Når bruker skriver fritt til @jira uten spesifikk kommando.
 * Forsøker å forstå hva bruker ønsker og svare intelligent.
 */
async function handleFreeform(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const client = createClient(stream);
    if (!client) { return { metadata: { command: '' } }; }

    const prompt = request.prompt.trim();
    if (!prompt) {
        stream.markdown(`# 👋 Hei! Jeg er Jira-skill\n\n`);
        stream.markdown(`Jeg kan hjelpe deg med Jira-oppgaver rett fra Copilot Chat.\n\n`);
        stream.markdown(`## Tilgjengelige kommandoer\n\n`);
        stream.markdown(`| Kommando | Beskrivelse |\n|---|---|\n`);
        stream.markdown(`| \`@jira /neste\` | 🎯 Ta neste oppgave og start utvikling |\n`);
        stream.markdown(`| \`@jira /mine\` | 📋 Se dine tildelte oppgaver |\n`);
        stream.markdown(`| \`@jira /sprint\` | 🏃 Se aktiv sprint |\n`);
        stream.markdown(`| \`@jira /detaljer PROJ-123\` | 🔍 Vis detaljer for en oppgave |\n`);
        stream.markdown(`| \`@jira /status PROJ-123 done\` | 🔄 Endre status |\n`);
        stream.markdown(`| \`@jira /kommenter PROJ-123 tekst\` | 💬 Legg til kommentar |\n\n`);
        stream.markdown(`Du kan også skrive fritt, f.eks.:\n`);
        stream.markdown(`- \`@jira Hva bør jeg jobbe med nå?\`\n`);
        stream.markdown(`- \`@jira Finn alle bugs med høy prioritet\`\n`);
        stream.markdown(`- \`@jira Lag en utviklingsplan for PROJ-456\`\n`);
        return { metadata: { command: '' } };
    }

    // Sjekk om bruker refererer til en spesifikk oppgave
    const issueKey = extractIssueKey(prompt, client.getProjectKey());

    // Forsøk å hente kontekstuell informasjon
    stream.progress('Henter info fra Jira...');
    let jiraContext = '';

    try {
        if (issueKey) {
            // Hent spesifikk oppgave
            const issue = await client.getIssue(issueKey);
            jiraContext = `Oppgave ${issue.key}:\n- Tittel: ${issue.summary}\n- Status: ${issue.status}\n- Prioritet: ${issue.priority}\n- Tildelt: ${issue.assignee || 'Ingen'}\n- Beskrivelse: ${issue.description || 'Ingen beskrivelse'}\n`;
        } else {
            // Hent brukerens oppgaver som kontekst
            const myIssues = await client.getMyIssues();
            jiraContext = `Brukerens oppgaver:\n` +
                myIssues.map(i => `- ${i.key}: ${i.summary} [${i.status}] [${i.priority}]`).join('\n');
        }
    } catch (e: any) {
        jiraContext = `Kunne ikke hente Jira-data: ${e.message}`;
    }

    const llmPrompt = `Du er en hjelpsom utviklingsassistent som har tilgang til Jira. Svar på norsk.

Brukerens forespørsel: "${prompt}"

Jira-kontekst:
${jiraContext}

Gi et nyttig og konkret svar basert på Jira-dataene. Hvis bruker ser ut til å ville gjøre noe spesifikt (som å endre status, ta en oppgave osv.), forklar hvilken @jira-kommando de kan bruke.`;

    await callLLM(llmPrompt, stream, token);

    return { metadata: { command: '' } };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Ekstraher en Jira issue-nøkkel fra tekst (f.eks. "PROJ-123").
 * Støtter også bare tall hvis projectKey er konfigurert.
 */
function extractIssueKey(text: string, projectKey: string): string | null {
    // Matchs "PROJ-123" format
    const keyMatch = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
    if (keyMatch) {
        return keyMatch[1];
    }

    // Hvis bare tall og prosjektnøkkel er konfigurert
    if (projectKey) {
        const numMatch = text.match(/\b(\d+)\b/);
        if (numMatch) {
            return `${projectKey}-${numMatch[1]}`;
        }
    }

    return null;
}

/**
 * Formaterer ISO-dato til lesbar norsk dato.
 */
function formatDate(isoDate: string): string {
    if (!isoDate) { return 'Ukjent'; }
    try {
        const d = new Date(isoDate);
        return d.toLocaleDateString('nb-NO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoDate;
    }
}

/**
 * Bygger en prompt for Copilot Agent/Plan-mode basert på Jira-oppgave.
 * Holdes kompakt — workspace-konteksten hentes av agent-mode selv.
 */
function buildAgentPrompt(issue: JiraIssue, techSummary: string, userPrompt: string): string {
    const subtaskInfo = issue.subtasks.length > 0
        ? `\nDeloppgaver:\n${issue.subtasks.map(st => `- ${st.key}: ${st.summary} (${st.status})`).join('\n')}`
        : '';

    const techLine = techSummary ? `\nTeknologier i prosjektet: ${techSummary}` : '';

    return `Implementer følgende Jira-oppgave i dette prosjektet.

Jira-oppgave: ${issue.key}
Tittel: ${issue.summary}
Type: ${issue.issueType}
Prioritet: ${issue.priority}
Beskrivelse: ${issue.description || 'Ingen beskrivelse gitt.'}
${subtaskInfo}${techLine}
${userPrompt ? `\nTilleggsinformasjon fra utvikler: ${userPrompt}` : ''}

Instruksjoner:
1. Analyser kodebasen og forstå eksisterende arkitektur
2. Opprett en feature-branch med navn: feature/${issue.key.toLowerCase()}-<kort-beskrivelse>
3. Implementer endringene som trengs
4. Skriv relevante tester
5. Sørg for at eksisterende tester fortsatt passerer

Bruk Plan-mode: vis meg planen før du gjør endringer.`;
}

/**
 * Bygger en utviklingsplan-prompt for LLM (brukes ved fritekst-analyse).
 */
function buildDevPlanPrompt(issue: JiraIssue, repoContext: string, userPrompt: string): string {
    const subtaskInfo = issue.subtasks.length > 0
        ? `\nDeloppgaver:\n${issue.subtasks.map(st => `- ${st.key}: ${st.summary} (${st.status})`).join('\n')}`
        : '';

    return `Du er en erfaren utvikler som skal lage en konkret utviklingsplan for en Jira-oppgave.

## Jira-oppgave
- **Nøkkel:** ${issue.key}
- **Tittel:** ${issue.summary}
- **Type:** ${issue.issueType}
- **Prioritet:** ${issue.priority}
- **Beskrivelse:** ${issue.description || 'Ingen beskrivelse gitt.'}
${subtaskInfo}

## Prosjektkontekst
${repoContext}

${userPrompt ? `## Brukerens tilleggsinfo:\n${userPrompt}\n` : ''}

## Instruksjoner
Svar på **norsk**. Lag en konkret utviklingsplan med følgende:

1. **Forståelse:** Kort oppsummering av hva oppgaven innebærer
2. **Foreslått branch-navn:** basert på issue-nøkkel og oppgaven (f.eks. \`feature/${issue.key.toLowerCase()}-kort-beskrivelse\`)
3. **Filer som trolig må endres/opprettes:** basert på repoets struktur
4. **Steg-for-steg implementasjonsplan:** nummererte, konkrete steg
5. **Testing:** foreslå relevante tester
6. **Mulige utfordringer:** ting å være obs på

Vær konkret og referer til filer/mapper i prosjektet der det er relevant.
Hvis oppgaven er vag, still gjerne oppklarende spørsmål til utvikleren.

Etter planen, skriv en kort tekst som utvikleren kan kopiere som Git-commit-melding.`;
}
