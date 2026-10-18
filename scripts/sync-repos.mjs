// Mantém os dois repositórios do projeto iguais (pessoal e da organização): `npm run sync`.
// Para cada branch, leva o lado mais novo para o outro. Só avança histórico (fast-forward), nunca força:
// se os dois lados divergiram (commits diferentes em cada um), avisa e não mexe nessa branch.
// Também atualiza a branch local quando ela está atrás.
//
// `--delete <branch>` apaga a branch nos dois repositórios (usado pelo workflow quando alguém apaga uma
// branch num deles; sem isso, o sync a recriaria a partir do outro).
//
// Acesso: na máquina do desenvolvedor usa a chave SSH; no GitHub Actions usa o token em SYNC_TOKEN
// (fine-grained, com "Contents: read and write" nos dois repositórios). Ver .github/workflows/sync.yml.
import { execFileSync } from 'node:child_process';

const REPOS = {
  pessoal: 'MatheusSaleh/supremo-motorista',
  nexolabs: 'nexolabs-dev/supremo-motorista',
};
const token = process.env.SYNC_TOKEN;
if (process.env.GITHUB_ACTIONS && !token) {
  console.log('::warning::Segredo SYNC_TOKEN não configurado neste repositório; sincronização ignorada.');
  process.exit(0);
}
const REMOTES = Object.fromEntries(
  Object.entries(REPOS).map(([name, slug]) => [
    name,
    token ? `https://x-access-token:${token}@github.com/${slug}.git` : `git@github.com:${slug}.git`,
  ]),
);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};
const isAncestor = (a, b) => tryGit('merge-base', '--is-ancestor', a, b) !== null;

const deleteAt = process.argv.indexOf('--delete');
if (deleteAt !== -1) {
  const branch = process.argv[deleteAt + 1] ?? '';
  if (tryGit('check-ref-format', '--branch', branch) === null) {
    console.error(`Nome de branch inválido: "${branch}"`);
    process.exit(1);
  }
  for (const [name, url] of Object.entries(REMOTES)) {
    if (!tryGit('ls-remote', url, `refs/heads/${branch}`)) continue; // já não existe (ex.: o outro lado já apagou)
    git('push', '--quiet', url, '--delete', branch);
    console.log(`✕ ${branch}: apagada em ${name}`);
  }
  process.exit(0);
}

// Remotes de sincronização (independentes do "origin"): refs em refs/sync/<nome>/<branch>.
const heads = {};
for (const [name, url] of Object.entries(REMOTES)) {
  // --prune: branch apagada num repositório some daqui também (senão o sync a recriaria).
  git('fetch', '--quiet', '--prune', url, `+refs/heads/*:refs/sync/${name}/*`);
  heads[name] = Object.fromEntries(
    git('for-each-ref', '--format=%(refname:lstrip=3) %(objectname)', `refs/sync/${name}/`)
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ')),
  );
}

const [a, b] = Object.keys(REMOTES);
const branches = new Set([...Object.keys(heads[a]), ...Object.keys(heads[b])]);
let problems = 0;
for (const branch of branches) {
  const ha = heads[a][branch];
  const hb = heads[b][branch];
  let newest;
  if (ha === hb) newest = ha;
  else if (!hb || (ha && isAncestor(hb, ha))) newest = ha;
  else if (!ha || isAncestor(ha, hb)) newest = hb;
  if (!newest) {
    console.warn(`⚠ ${branch}: os dois repositórios divergiram. Resolva com merge/rebase e rode de novo.`);
    problems++;
    continue;
  }
  for (const [name, url] of Object.entries(REMOTES)) {
    if (heads[name][branch] === newest) continue;
    git('push', '--quiet', url, `${newest}:refs/heads/${branch}`);
    console.log(`→ ${branch}: ${name} atualizado para ${newest.slice(0, 7)}`);
  }
  // Branch local atrás do remoto: avança (só se a cópia de trabalho não estiver nela com mudanças).
  const local = tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (local && local !== newest && isAncestor(local, newest)) {
    const current = tryGit('symbolic-ref', '--short', 'HEAD');
    if (current === branch) {
      if (git('status', '--porcelain', '--untracked-files=no') === '') {
        git('merge', '--quiet', '--ff-only', newest);
        console.log(`↓ ${branch} local avançou para ${newest.slice(0, 7)}`);
      } else console.warn(`⚠ ${branch} local está atrás, mas há mudanças não salvas; faça commit e rode de novo.`);
    } else {
      git('update-ref', `refs/heads/${branch}`, newest, local);
      console.log(`↓ ${branch} local avançou para ${newest.slice(0, 7)}`);
    }
  }
}
console.log(problems ? `Sincronização incompleta (${problems} branch(es) divergentes).` : 'Repositórios sincronizados.');
process.exitCode = problems ? 1 : 0;
