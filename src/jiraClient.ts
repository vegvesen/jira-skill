import * as vscode from 'vscode';

// ─── Typer ───────────────────────────────────────────────────────────────────

export interface JiraIssue {
    key: string;
    id: string;
    summary: string;
    description: string;
    status: string;
    statusCategoryKey: string;
    priority: string;
    priorityId: number;
    assignee: string | null;
    reporter: string;
    issueType: string;
    labels: string[];
    created: string;
    updated: string;
    sprint?: string;
    storyPoints?: number;
    url: string;
    subtasks: { key: string; summary: string; status: string }[];
    comments: { author: string; body: string; created: string }[];
}

export interface JiraTransition {
    id: string;
    name: string;
    to: { name: string; id: string };
}

export interface JiraUser {
    accountId?: string;
    name?: string;
    displayName: string;
    emailAddress?: string;
}

export interface JiraSprint {
    id: number;
    name: string;
    state: string;
    startDate?: string;
    endDate?: string;
    goal?: string;
}

// ─── Klient ──────────────────────────────────────────────────────────────────

/**
 * Jira REST API-klient.
 * Støtter både Jira Cloud (API-token + e-post) og Jira Server/Data Center (PAT).
 */
export class JiraClient {
    private baseUrl: string;
    private pat: string;
    private email: string;
    private projectKey: string;
    private boardId: string;
    private isCloud: boolean;
    private resolvedServerBaseUrl?: string;

    constructor(pat: string) {
        const config = vscode.workspace.getConfiguration('jira-skill');
        this.baseUrl = (config.get<string>('baseUrl', '') || '').replace(/\/+$/, '');
        this.pat = pat;
        this.email = config.get<string>('email', '');
        this.projectKey = config.get<string>('projectKey', '');
        this.boardId = config.get<string>('boardId', '');
        // Auto-detect Cloud vs Server/DC: atlassian.net → Cloud, alt annet → Server/DC
        // Kan overstyres eksplisitt med jira-skill.isCloud
        const isCloudConfig = config.inspect<boolean>('isCloud');
        const isCloudExplicit =
            isCloudConfig?.globalValue ??
            isCloudConfig?.workspaceValue ??
            isCloudConfig?.workspaceFolderValue;
        if (isCloudExplicit !== undefined) {
            this.isCloud = isCloudExplicit;
        } else {
            // Automatisk deteksjon basert på URL
            this.isCloud = this.baseUrl.toLowerCase().includes('.atlassian.net');
        }
    }

    // ─── Validering ──────────────────────────────────────────────────────────

    public validateConfig(): string | undefined {
        if (!this.baseUrl) {
            return 'Jira base-URL er ikke konfigurert. Sett `jira-skill.baseUrl` i VS Code-innstillingene.';
        }
        if (!this.baseUrl.startsWith('https://')) {
            return 'Jira base-URL må bruke HTTPS for sikker kommunikasjon. Endre `jira-skill.baseUrl` til å starte med `https://`.';
        }
        if (!this.pat) {
            return 'Jira PAT/API-token er ikke konfigurert. Kjør `@jira /settPAT` for å lagre token sikkert i SecretStorage.';
        }
        if (this.isCloud && !this.email) {
            return 'E-post for Jira Cloud er ikke konfigurert. Sett `jira-skill.email` i VS Code-innstillingene.\n(Bruker du Jira Server/Data Center? Sett `jira-skill.isCloud` til `false`.)';
        }
        return undefined;
    }

    // ─── Autentisering ───────────────────────────────────────────────────────

    private getAuthHeaders(): Record<string, string> {
        if (this.isCloud) {
            // Jira Cloud: Basic auth med e-post:api-token
            const encoded = Buffer.from(`${this.email}:${this.pat}`).toString('base64');
            return {
                'Authorization': `Basic ${encoded}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
        } else {
            // Jira Server/Data Center: Bearer PAT
            return {
                'Authorization': `Bearer ${this.pat}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
        }
    }

    // ─── HTTP ────────────────────────────────────────────────────────────────

    private async fetchJson(url: string, method: string = 'GET', body?: any): Promise<any> {
        const headers = this.getAuthHeaders();

        const options: RequestInit = { method, headers };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const urlsToTry = this.getFallbackUrls(url);

        let lastStatus = 0;
        for (const candidateUrl of urlsToTry) {
            const response = await fetch(candidateUrl, options);
            lastStatus = response.status;

            if (response.ok) {
                if (!this.isCloud && candidateUrl.includes(`${this.baseUrl}/jira/rest/`)) {
                    this.resolvedServerBaseUrl = `${this.baseUrl}/jira`;
                }

                if (response.status === 204) {
                    return null;
                }

                return response.json();
            }

            if (response.status !== 404) {
                await response.text().catch(() => '');
                break;
            }
            await response.text().catch(() => '');
        }

        const hint = lastStatus === 401 ? ' — sjekk PAT/API-token'
            : lastStatus === 403 ? ' — mangler tilgang'
            : lastStatus === 404 ? ' — ressurs ikke funnet (sjekk baseUrl, ofte mangler /jira)'
            : '';
        throw new Error(`Jira API-feil (${lastStatus})${hint}`);
    }

    private getFallbackUrls(url: string): string[] {
        if (this.isCloud) {
            return [url];
        }

        const urls = new Set<string>();
        urls.add(url);

        const activeBase = this.resolvedServerBaseUrl || this.baseUrl;
        if (activeBase !== this.baseUrl && url.startsWith(`${this.baseUrl}/`)) {
            urls.add(url.replace(this.baseUrl, activeBase));
        }

        if (url.includes('/rest/api/2/')) {
            urls.add(url.replace('/rest/api/2/', '/rest/api/latest/'));
        }

        if (!activeBase.toLowerCase().endsWith('/jira') && url.startsWith(`${activeBase}/rest/`)) {
            const jiraBaseUrl = `${activeBase}/jira`;
            urls.add(url.replace(activeBase, jiraBaseUrl));
            if (url.includes('/rest/api/2/')) {
                urls.add(url.replace(activeBase, jiraBaseUrl).replace('/rest/api/2/', '/rest/api/latest/'));
            }
        }

        return Array.from(urls);
    }

    // ─── Bruker ──────────────────────────────────────────────────────────────

    /**
     * Henter innlogget bruker (myself).
     */
    public async getCurrentUser(): Promise<JiraUser> {
        const url = `${this.baseUrl}/rest/api/2/myself`;
        const data = await this.fetchJson(url);
        return {
            accountId: data.accountId,
            name: data.name,
            displayName: data.displayName,
            emailAddress: data.emailAddress,
        };
    }

    // ─── Issues ──────────────────────────────────────────────────────────────

    /**
     * Henter en enkelt issue basert på nøkkel (f.eks. PROJ-123).
     */
    public async getIssue(issueKey: string): Promise<JiraIssue> {
        const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}?expand=names,transitions`;
        const data = await this.fetchJson(url);
        return this.mapIssue(data);
    }

    /**
     * Søker etter issues med JQL.
     */
    public async searchIssues(jql: string, maxResults: number = 20): Promise<JiraIssue[]> {
        const url = `${this.baseUrl}/rest/api/2/search`;
        const data = await this.fetchJson(url, 'POST', {
            jql,
            maxResults,
            fields: [
                'summary', 'description', 'status', 'priority', 'assignee',
                'reporter', 'issuetype', 'labels', 'created', 'updated',
                'subtasks', 'comment', 'customfield_10016' // story points
            ],
        });
        return (data.issues || []).map((issue: any) => this.mapIssue(issue));
    }

    /**
     * Henter oppgaver tildelt innlogget bruker som ikke er ferdige.
     */
    public async getMyIssues(): Promise<JiraIssue[]> {
        const projectFilter = this.projectKey
            ? ` AND project = ${this.projectKey}`
            : '';
        const jql = `assignee = currentUser() AND statusCategory != Done${projectFilter} ORDER BY priority ASC, updated DESC`;
        return this.searchIssues(jql, 30);
    }

    /**
     * Henter neste høyest prioriterte uassignerte oppgave fra backlog/sprint.
     * Inkluderer alle ikke-ferdige statuser (støtter både Scrum og Kanban).
     */
    public async getNextPriorityIssue(): Promise<JiraIssue | null> {
        const projectFilter = this.projectKey
            ? `project = ${this.projectKey} AND `
            : '';
        // Uassignerte oppgaver som ikke er ferdige, epics ekskludert, sortert etter prioritet
        const jql = `${projectFilter}assignee is EMPTY AND statusCategory != Done AND issuetype != Epic ORDER BY priority ASC, rank ASC`;
        const issues = await this.searchIssues(jql, 1);
        return issues.length > 0 ? issues[0] : null;
    }

    // ─── Assigning ───────────────────────────────────────────────────────────

    /**
     * Assignerer en oppgave til en bruker.
     */
    public async assignIssue(issueKey: string, userId: string): Promise<void> {
        const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}/assignee`;
        const body = this.isCloud
            ? { accountId: userId }
            : { name: userId };
        await this.fetchJson(url, 'PUT', body);
    }

    // ─── Transitions ─────────────────────────────────────────────────────────

    /**
     * Henter tilgjengelige overganger (transitions) for en oppgave.
     */
    public async getTransitions(issueKey: string): Promise<JiraTransition[]> {
        const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}/transitions`;
        const data = await this.fetchJson(url);
        return (data.transitions || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            to: { name: t.to.name, id: t.to.id },
        }));
    }

    /**
     * Utfører en overgang (transition) på en oppgave.
     */
    public async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
        const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}/transitions`;
        await this.fetchJson(url, 'POST', {
            transition: { id: transitionId },
        });
    }

    /**
     * Flytter en oppgave til en gitt status ved å finne riktig transition.
     * @param targets - én eller flere søkestrenger (prøves i rekkefølge)
     */
    public async moveToStatus(issueKey: string, ...targets: string[]): Promise<string> {
        const transitions = await this.getTransitions(issueKey);

        for (const target of targets) {
            const t = target.toLowerCase();
            const match = transitions.find(tr =>
                tr.name.toLowerCase().includes(t) ||
                tr.to.name.toLowerCase().includes(t)
            );
            if (match) {
                await this.transitionIssue(issueKey, match.id);
                return match.to.name;
            }
        }

        const available = transitions.map(t => `"${t.name}" → ${t.to.name}`).join(', ');
        throw new Error(
            `Fant ingen overgang for [${targets.join(' / ')}]. Tilgjengelige overganger: ${available}`
        );
    }

    // ─── Kommentarer ─────────────────────────────────────────────────────────

    /**
     * Legger til en kommentar på en oppgave.
     */
    public async addComment(issueKey: string, commentBody: string): Promise<void> {
        const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
        await this.fetchJson(url, 'POST', { body: commentBody });
    }

    // ─── Sprint ──────────────────────────────────────────────────────────────

    /**
     * Henter aktiv sprint for konfigurert board.
     * Returnerer null for Kanban-board (støtter ikke sprinter).
     */
    public async getActiveSprint(): Promise<JiraSprint | null> {
        if (!this.boardId) {
            return null;
        }
        try {
            const url = `${this.baseUrl}/rest/agile/1.0/board/${this.boardId}/sprint?state=active`;
            const data = await this.fetchJson(url);
            const sprints = data.values || [];
            return sprints.length > 0 ? sprints[0] : null;
        } catch {
            // Kanban-board støtter ikke sprint-API — returner null
            return null;
        }
    }

    /**
     * Henter alle oppgaver i aktiv sprint eller fra Kanban-board.
     */
    public async getSprintIssues(): Promise<JiraIssue[]> {
        // Forsøk 1: Scrum-sprint via agile API
        if (this.boardId) {
            const sprint = await this.getActiveSprint();
            if (sprint) {
                const url = `${this.baseUrl}/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=50`;
                const data = await this.fetchJson(url);
                return (data.issues || []).map((issue: any) => this.mapIssue(issue));
            }
            // Forsøk 2: Kanban-board — hent alle aktive issues direkte fra boardet
            try {
                const url = `${this.baseUrl}/rest/agile/1.0/board/${this.boardId}/issue?maxResults=50&fields=summary,status,priority,assignee,issuetype,labels,created,updated,comment,customfield_10016,subtasks,reporter`;
                const data = await this.fetchJson(url);
                if (data.issues && data.issues.length > 0) {
                    return data.issues.map((issue: any) => this.mapIssue(issue));
                }
            } catch {
                // Fallthrough til JQL
            }
        }
        // Fallback: JQL for ikke-ferdige oppgaver i prosjektet
        const projectFilter = this.projectKey
            ? `project = ${this.projectKey} AND `
            : '';
        const jql = `${projectFilter}statusCategory != Done ORDER BY priority ASC, rank ASC`;
        return this.searchIssues(jql, 50);
    }

    // ─── Mapping ─────────────────────────────────────────────────────────────

    private mapIssue(data: any): JiraIssue {
        const fields = data.fields || {};
        const comments = fields.comment?.comments || [];

        return {
            key: data.key,
            id: data.id,
            summary: fields.summary || '',
            description: fields.description || '',
            status: fields.status?.name || 'Ukjent',
            statusCategoryKey: fields.status?.statusCategory?.key || '',
            priority: fields.priority?.name || 'Ukjent',
            priorityId: parseInt(fields.priority?.id || '99', 10),
            assignee: fields.assignee?.displayName || null,
            reporter: fields.reporter?.displayName || 'Ukjent',
            issueType: fields.issuetype?.name || 'Ukjent',
            labels: fields.labels || [],
            created: fields.created || '',
            updated: fields.updated || '',
            storyPoints: fields.customfield_10016 ?? undefined,
            url: `${this.baseUrl}/browse/${data.key}`,
            subtasks: (fields.subtasks || []).map((st: any) => ({
                key: st.key,
                summary: st.fields?.summary || '',
                status: st.fields?.status?.name || '',
            })),
            comments: comments.slice(-5).map((c: any) => ({
                author: c.author?.displayName || 'Ukjent',
                body: typeof c.body === 'string' ? c.body : JSON.stringify(c.body),
                created: c.created || '',
            })),
        };
    }

    // ─── Hjelpemetoder ───────────────────────────────────────────────────────

    public getProjectKey(): string {
        return this.projectKey;
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }
}
