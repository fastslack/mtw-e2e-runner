/**
 * Issue Provider Drivers — GitHub and GitLab
 *
 * Fetches issue details from GitHub or GitLab using their respective CLI tools
 * (gh / glab). All external commands use execFileSync to prevent shell injection.
 */

import { execFileSync } from 'child_process';

// ── URL Parsing ───────────────────────────────────────────────────────────────

const GITHUB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/;
const GITLAB_RE = /^https?:\/\/([^/]+)\/((?:[^/]+\/)*[^/]+)\/-\/issues\/(\d+)/;

/**
 * Detects the issue provider from a URL.
 * @param {string} url
 * @returns {'github' | 'gitlab'}
 */
export function detectProvider(url) {
  if (GITHUB_RE.test(url)) return 'github';
  if (GITLAB_RE.test(url)) return 'gitlab';
  throw new Error(`Unsupported issue URL: ${url}. Expected a GitHub or GitLab issue URL.`);
}

/**
 * Parses an issue URL into its components.
 * @param {string} url
 * @returns {{ provider: string, owner: string, repo: string, fullPath: string, number: number }}
 */
export function parseIssueUrl(url) {
  const ghMatch = url.match(GITHUB_RE);
  if (ghMatch) {
    return {
      provider: 'github',
      owner: ghMatch[1],
      repo: ghMatch[2],
      fullPath: `${ghMatch[1]}/${ghMatch[2]}`,
      number: parseInt(ghMatch[3], 10),
    };
  }

  const glMatch = url.match(GITLAB_RE);
  if (glMatch) {
    return {
      provider: 'gitlab',
      host: glMatch[1],
      owner: glMatch[2].split('/').slice(0, -1).join('/'),
      repo: glMatch[2].split('/').pop(),
      fullPath: glMatch[2],
      number: parseInt(glMatch[3], 10),
    };
  }

  throw new Error(`Cannot parse issue URL: ${url}`);
}

// ── Auth Check ────────────────────────────────────────────────────────────────

/**
 * Checks if the CLI tool for the given provider is authenticated.
 * @param {'github' | 'gitlab'} provider
 * @returns {{ authenticated: boolean, error?: string }}
 */
export function checkCliAuth(provider) {
  try {
    if (provider === 'github') {
      execFileSync('gh', ['auth', 'token'], { stdio: 'pipe', timeout: 10000 });
      return { authenticated: true };
    } else if (provider === 'gitlab') {
      execFileSync('glab', ['auth', 'status'], { stdio: 'pipe', timeout: 10000 });
      return { authenticated: true };
    }
    return { authenticated: false, error: `Unknown provider: ${provider}` };
  } catch (err) {
    const cmd = provider === 'github' ? 'gh auth login' : 'glab auth login';
    return { authenticated: false, error: `Not authenticated. Run: ${cmd}` };
  }
}

// ── Fetch Issue ───────────────────────────────────────────────────────────────

/**
 * Fetches an issue from GitHub using the gh CLI.
 * @param {{ fullPath: string, number: number }} parsed
 * @returns {object} Normalized issue object
 */
function fetchGitHubIssue(parsed) {
  const output = execFileSync('gh', [
    'api',
    `repos/${parsed.fullPath}/issues/${parsed.number}`,
  ], { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });

  const data = JSON.parse(output);

  return {
    title: data.title,
    body: data.body || '',
    labels: (data.labels || []).map(l => typeof l === 'string' ? l : l.name),
    url: data.html_url,
    provider: 'github',
    state: data.state,
    number: data.number,
    repo: parsed.fullPath,
  };
}

/**
 * Fetches an issue from GitLab using the glab CLI.
 * @param {{ fullPath: string, number: number }} parsed
 * @returns {object} Normalized issue object
 */
function fetchGitLabIssue(parsed) {
  const projectPath = encodeURIComponent(parsed.fullPath);
  const output = execFileSync('glab', [
    'api',
    `projects/${projectPath}/issues/${parsed.number}`,
  ], { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });

  const data = JSON.parse(output);

  return {
    title: data.title,
    body: data.description || '',
    labels: data.labels || [],
    url: data.web_url,
    provider: 'gitlab',
    state: data.state,
    number: data.iid,
    repo: parsed.fullPath,
  };
}

/**
 * Fetches and normalizes an issue from its URL.
 * @param {string} url - GitHub or GitLab issue URL
 * @returns {{ title: string, body: string, labels: string[], url: string, provider: string, state: string, number: number, repo: string }}
 */
export function fetchIssue(url) {
  const parsed = parseIssueUrl(url);

  const auth = checkCliAuth(parsed.provider);
  if (!auth.authenticated) {
    throw new Error(auth.error);
  }

  if (parsed.provider === 'github') {
    return fetchGitHubIssue(parsed);
  } else {
    return fetchGitLabIssue(parsed);
  }
}
