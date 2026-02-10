import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

function getTrackedFiles(): string[] {
  const output = execSync('git ls-files', { cwd: '/home/runner/workspace', encoding: 'utf-8' });
  return output.trim().split('\n').filter(f => f.length > 0);
}

function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.wav', '.mp3', '.mp4', '.pdf', '.zip', '.tar', '.gz'];
  const ext = path.extname(filePath).toLowerCase();
  return binaryExtensions.includes(ext);
}

async function main() {
  console.log('Getting GitHub access token...');
  const token = await getAccessToken();
  const octokit = new Octokit({ auth: token });

  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);

  const owner = user.login;
  const repo = 'cfgpt-clone-me';

  try {
    await octokit.repos.get({ owner, repo });
    console.log(`Repository ${owner}/${repo} exists.`);
  } catch (e: any) {
    if (e.status === 404) {
      console.log(`Creating repository ${repo}...`);
      await octokit.repos.createForAuthenticatedUser({
        name: repo,
        description: 'CFGPT Clone Me - AI Voice Receptionist Platform',
        private: false,
        auto_init: false,
      });
      console.log(`Repository created.`);
    } else throw e;
  }

  console.log('Collecting files...');
  const files = getTrackedFiles();
  console.log(`Found ${files.length} tracked files.`);

  console.log('Creating git tree via API...');
  const treeItems: any[] = [];
  let skipped = 0;

  for (const file of files) {
    const fullPath = path.join('/home/runner/workspace', file);
    if (!fs.existsSync(fullPath)) { skipped++; continue; }

    const stat = fs.statSync(fullPath);
    if (stat.size > 50 * 1024 * 1024) { skipped++; continue; }

    try {
      if (isBinaryFile(file)) {
        const content = fs.readFileSync(fullPath);
        const { data: blob } = await octokit.git.createBlob({
          owner, repo,
          content: content.toString('base64'),
          encoding: 'base64',
        });
        treeItems.push({ path: file, mode: '100644' as const, type: 'blob' as const, sha: blob.sha });
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { data: blob } = await octokit.git.createBlob({
          owner, repo,
          content,
          encoding: 'utf-8',
        });
        treeItems.push({ path: file, mode: '100644' as const, type: 'blob' as const, sha: blob.sha });
      }
    } catch (err: any) {
      console.log(`  Skipping ${file}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`Uploaded ${treeItems.length} files (${skipped} skipped).`);

  console.log('Creating tree...');
  const { data: tree } = await octokit.git.createTree({ owner, repo, tree: treeItems });

  const commitMessage = execSync('git log -1 --format=%s', { cwd: '/home/runner/workspace', encoding: 'utf-8' }).trim();
  
  let parentSha: string | undefined;
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    parentSha = ref.object.sha;
  } catch {}

  console.log(`Creating commit: "${commitMessage}"...`);
  const commitParams: any = {
    owner, repo,
    message: commitMessage,
    tree: tree.sha,
  };
  if (parentSha) commitParams.parents = [parentSha];

  const { data: commit } = await octokit.git.createCommit(commitParams);

  try {
    await octokit.git.updateRef({ owner, repo, ref: 'heads/main', sha: commit.sha, force: true });
    console.log('Updated main branch.');
  } catch {
    await octokit.git.createRef({ owner, repo, ref: 'refs/heads/main', sha: commit.sha });
    console.log('Created main branch.');
  }

  console.log(`\nDone! Code pushed to: https://github.com/${owner}/${repo}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
