import * as vscode from 'vscode';

/**
 * Analyserer nåværende workspace for å forstå prosjektets kontekst.
 * Brukes av LLM til å planlegge utvikling basert på Jira-oppgaver.
 */
export class WorkspaceAnalyzer {

    /**
     * Samler en kompakt oversikt over prosjektet for LLM-analyse.
     */
    public async gatherContext(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return 'Ingen workspace-mappe er åpen.';
        }

        const rootUri = workspaceFolders[0].uri;
        const sections: string[] = [];

        // 1. Filstruktur
        sections.push('## Filstruktur (topp-nivå)');
        const topLevel = await this.listDirectory(rootUri);
        sections.push(topLevel.join('\n'));

        // 2. Viktige undermapper (src, lib, app, etc.)
        const importantDirs = ['src', 'lib', 'app', 'pages', 'components', 'services', 'api', 'test', 'tests', '__tests__'];
        for (const dir of importantDirs) {
            try {
                const dirUri = vscode.Uri.joinPath(rootUri, dir);
                const stat = await vscode.workspace.fs.stat(dirUri);
                if (stat.type === vscode.FileType.Directory) {
                    sections.push(`\n## ${dir}/`);
                    const contents = await this.listDirectory(dirUri);
                    sections.push(contents.join('\n'));
                }
            } catch {
                // Mappen finnes ikke, ignorer
            }
        }

        // 3. Konfigurasjonsfiler
        sections.push('\n## Konfigurasjonsfiler');
        const configFiles = await this.findConfigFiles(rootUri);
        for (const cf of configFiles) {
            sections.push(`\n### ${cf.path}`);
            sections.push(cf.content);
        }

        // 4. README
        const readme = await this.readFileIfExists(rootUri, 'README.md');
        if (readme) {
            sections.push('\n## README.md');
            sections.push(readme.substring(0, 2000));
        }

        // 5. Teknologier
        sections.push('\n## Detekterte teknologier');
        const techs = await this.detectTechnologies(rootUri);
        sections.push(techs.join(', ') || 'Ingen gjenkjent');

        return sections.join('\n');
    }

    /**
     * Genererer en kort oppsummering av tech-stacken.
     */
    public async getTechSummary(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return 'Ingen workspace åpen';
        }
        const techs = await this.detectTechnologies(workspaceFolders[0].uri);
        return techs.length > 0 ? techs.join(', ') : 'Ukjent tech-stack';
    }

    // ─── Hjelpemetoder ───────────────────────────────────────────────────────

    private async listDirectory(uri: vscode.Uri): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => {
                const icon = type === vscode.FileType.Directory ? '📁' : '📄';
                return `${icon} ${name}`;
            });
        } catch {
            return ['Kunne ikke lese mappeinnhold.'];
        }
    }

    private async readFileIfExists(rootUri: vscode.Uri, relativePath: string): Promise<string | null> {
        try {
            const fileUri = vscode.Uri.joinPath(rootUri, relativePath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            return Buffer.from(content).toString('utf-8');
        } catch {
            return null;
        }
    }

    private async findConfigFiles(rootUri: vscode.Uri): Promise<{ path: string; content: string }[]> {
        const configPatterns = [
            'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
            'tsconfig.json', 'angular.json', 'next.config.js', 'next.config.mjs',
            'vite.config.ts', 'vite.config.js',
            'application.yml', 'application.yaml', 'application.properties',
            'Cargo.toml', 'pyproject.toml', 'requirements.txt',
            'go.mod', 'Dockerfile',
        ];

        const results: { path: string; content: string }[] = [];
        for (const pattern of configPatterns) {
            const content = await this.readFileIfExists(rootUri, pattern);
            if (content) {
                results.push({ path: pattern, content: content.substring(0, 2000) });
            }
        }
        return results;
    }

    private async detectTechnologies(rootUri: vscode.Uri): Promise<string[]> {
        const techs: string[] = [];
        const checks: { file: string; tech: string }[] = [
            { file: 'package.json', tech: 'Node.js' },
            { file: 'tsconfig.json', tech: 'TypeScript' },
            { file: 'pom.xml', tech: 'Java/Maven' },
            { file: 'build.gradle', tech: 'Java/Gradle' },
            { file: 'build.gradle.kts', tech: 'Kotlin/Gradle' },
            { file: 'go.mod', tech: 'Go' },
            { file: 'Cargo.toml', tech: 'Rust' },
            { file: 'pyproject.toml', tech: 'Python' },
            { file: 'requirements.txt', tech: 'Python' },
            { file: 'Dockerfile', tech: 'Docker' },
            { file: 'angular.json', tech: 'Angular' },
            { file: 'next.config.js', tech: 'Next.js' },
            { file: 'next.config.mjs', tech: 'Next.js' },
            { file: 'vite.config.ts', tech: 'Vite' },
            { file: 'vite.config.js', tech: 'Vite' },
        ];

        for (const { file, tech } of checks) {
            try {
                const fileUri = vscode.Uri.joinPath(rootUri, file);
                await vscode.workspace.fs.stat(fileUri);
                if (!techs.includes(tech)) {
                    techs.push(tech);
                }
            } catch {
                // Filen finnes ikke
            }
        }
        return techs;
    }
}
