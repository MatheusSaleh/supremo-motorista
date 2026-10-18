// Mantém os dois repositórios do projeto iguais (pessoal e da organização): `npm run sync`.
// Para cada branch, leva o lado mais novo para o outro. Só avança histórico (fast-forward), nunca força:
// se os dois lados divergiram (commits diferentes em cada um), avisa e não mexe nessa branch.
// Também atualiza a branch local quando ela está atrás.
import { execFileSync } from 'node:child_process';

const REMOTES = {
  pessoal: 'git@github.com:MatheusSaleh/supremo-motorista.git',
  nexolabs: 'git@github.com:nexolabs-dev/supremo-motorista.git',
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};
const isAncestor = (a, b) => tryGit('merge-base', '--is-ancestor', a, b) !== null;

// Remotes de sincronização (independentes do "origin"): refs em refs/sync/<nome>/<branch>.
const heads = {};
for (const [name, url] of Object.entries(REMOTES)) {
  git('fetch', '--quiet', url, `+refs/heads/*:refs/sync/${name}/*`);
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
