// APIs públicas do ambiente, com cache no localStorage e tempo limite. Sem internet (ou com a API fora
// do ar), quem chama recebe null e segue com o padrão.
//  - Clima: Open-Meteo (https://open-meteo.com), sem chave, dados CC BY 4.0.
//  - Feriados nacionais: BrasilAPI (https://brasilapi.com.br), sem chave.
import { BRASILIA } from './sun';

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm';

export interface Weather {
  kind: WeatherKind;
  /** 0..1 */
  cloud: number;
  /** Intensidade da chuva, 0..1. */
  rain: number;
  temperature: number;
  /** Umidade relativa (%). */
  humidity: number;
}

export interface Holiday {
  date: string; // AAAA-MM-DD
  name: string;
}

const WEATHER_KEY = 'supremo.env.weather.v1';
const HOLIDAYS_KEY = 'supremo.env.holidays.v1.';
const WEATHER_TTL = 20 * 60 * 1000;
const HOLIDAYS_TTL = 30 * 24 * 3600 * 1000;

export async function fetchWeather(force = false): Promise<Weather | null> {
  const cached = readCache<Weather>(WEATHER_KEY, force ? 0 : WEATHER_TTL);
  if (cached) return cached;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${BRASILIA.lat}&longitude=${BRASILIA.lon}` +
    '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover&timezone=America%2FSao_Paulo';
  const json = await getJson<{
    current: { temperature_2m: number; relative_humidity_2m: number; precipitation: number; weather_code: number; cloud_cover: number };
  }>(url);
  if (!json?.current) return readCache<Weather>(WEATHER_KEY, Infinity); // vencido, mas melhor que nada
  const c = json.current;
  const weather = fromWmo(c.weather_code, c.cloud_cover, c.precipitation, c.temperature_2m, c.relative_humidity_2m);
  writeCache(WEATHER_KEY, weather);
  return weather;
}

export async function fetchHolidays(year: number): Promise<Holiday[] | null> {
  const key = HOLIDAYS_KEY + year;
  const cached = readCache<Holiday[]>(key, HOLIDAYS_TTL);
  if (cached) return cached;
  const json = await getJson<{ date: string; name: string }[]>(`https://brasilapi.com.br/api/feriados/v1/${year}`);
  if (!Array.isArray(json)) return readCache<Holiday[]>(key, Infinity);
  const list = json.map((h) => ({ date: h.date, name: h.name }));
  writeCache(key, list);
  return list;
}

/** Códigos WMO (Open-Meteo) → tipo de tempo do jogo. */
export function fromWmo(code: number, cloudPct: number, precip: number, temperature: number, humidity: number): Weather {
  let kind: WeatherKind;
  if (code >= 95) kind = 'storm';
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) kind = 'rain';
  else if (code === 45 || code === 48) kind = 'fog';
  else if (code === 3) kind = 'cloudy';
  else if (code === 1 || code === 2) kind = 'partly';
  else kind = 'clear';
  const wet = kind === 'rain' || kind === 'storm';
  // Garoa conta pouco; chuva forte (≥ 4 mm/h) é o máximo.
  const rain = wet ? Math.min(1, Math.max(kind === 'storm' ? 0.8 : 0.35, precip / 4)) : 0;
  return { kind, cloud: Math.min(1, Math.max(cloudPct / 100, wet ? 0.85 : 0)), rain, temperature, humidity };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function readCache<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: T };
    return Date.now() - at <= ttl ? data : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* sem storage: só não há cache */
  }
}
