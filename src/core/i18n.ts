// i18n simples por chave. Os textos ficam em src/data/i18n/<idioma>.ts.
import { ptBR, type StringKey, type Strings } from '../data/i18n/pt-BR';

const locales: Record<string, Strings> = { 'pt-BR': ptBR };
let current: Strings = ptBR;

export function setLocale(locale: string): void {
  current = locales[locale] ?? ptBR;
}

/** Texto traduzido; {param} é substituído pelos valores de `params`. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  const text = current[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export type { StringKey };
