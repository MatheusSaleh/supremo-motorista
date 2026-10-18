// Abre o app Electron a partir dos scripts npm. Remove ELECTRON_RUN_AS_NODE do ambiente: terminais
// de alguns editores (ex.: extensões do VS Code) a definem, e com ela o Electron roda como Node puro.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBin = require('electron'); // em Node, o pacote exporta o caminho do executável
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--dev')) env.ELECTRON_DEV_URL ??= 'http://localhost:5173';

const child = spawn(electronBin, [root, ...process.argv.slice(2).filter((a) => a !== '--dev')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
