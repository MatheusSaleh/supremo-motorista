// Estado do "mundo real": hora de Brasília, posição do sol, clima e feriados. Sem DOM nem Three.js
// além de vetores. Atualiza sozinho (clima a cada 20 min, feriados uma vez por dia). Com
// `realWorld = false` (menu) ou sem internet, usa um padrão: 14h, céu limpo, dia útil.
import * as THREE from 'three';
import { t } from '../core/i18n';
import { fetchHolidays, fetchWeather, fromWmo, type Holiday, type Weather, type WeatherKind } from './api';
import { solarPosition, sunDirection } from './sun';

/** Brasília: UTC−3 o ano todo (sem horário de verão desde 2019). */
const UTC_OFFSET_H = -3;
const WEATHER_REFRESH = 20 * 60;

export type WeatherOverride = WeatherKind | 'dry';

export interface EnvSnapshot {
  /** Hora local "HH:MM". */
  clock: string;
  /** Elevação do sol (graus). */
  sunElevation: number;
  /** Direção do sol nos eixos do jogo (unitária). */
  sunDir: THREE.Vector3;
  weather: Weather;
  /** Tempo seco de Brasília (umidade < 30%). */
  dry: boolean;
  holiday: Holiday | null;
  /** Amanhã é feriado (e hoje não). */
  holidayEve: Holiday | null;
  /** Dados reais (true) ou padrão (false). */
  live: boolean;
}

const DEFAULT_WEATHER: Weather = { kind: 'clear', cloud: 0.1, rain: 0, temperature: 27, humidity: 55 };

export class Environment {
  /** Debug: força hora (0–24), tempo e feriado. */
  readonly override: { hour: number | null; weather: WeatherOverride | null; holiday: boolean | null } = {
    hour: null,
    weather: null,
    holiday: null,
  };
  /** Chamado quando chegam dados novos (para avisos no HUD). */
  onUpdate: ((s: EnvSnapshot) => void) | null = null;

  private weather: Weather | null = null;
  private holidays: Holiday[] = [];
  private holidayYear = 0;
  private refreshTimer = 0;
  private readonly snap: EnvSnapshot = {
    clock: '14:00',
    sunElevation: 60,
    sunDir: new THREE.Vector3(0, 1, 0),
    weather: DEFAULT_WEATHER,
    dry: false,
    holiday: null,
    holidayEve: null,
    live: false,
  };

  constructor(private real: boolean) {}

  get realWorld(): boolean {
    return this.real;
  }

  set realWorld(v: boolean) {
    if (v === this.real) return;
    this.real = v;
    this.refreshTimer = 0; // busca já
  }

  /** Por frame (segundos reais). As buscas rodam em segundo plano. */
  update(dt: number): void {
    if (!this.real) return;
    this.refreshTimer -= dt;
    if (this.refreshTimer > 0) return;
    this.refreshTimer = WEATHER_REFRESH;
    void this.refresh();
  }

  snapshot(): EnvSnapshot {
    const s = this.snap;
    const o = this.override;
    const now = new Date();
    const local = new Date(now.getTime() + UTC_OFFSET_H * 3600e3); // campos UTC = hora de Brasília
    let instant = now;
    if (o.hour !== null || !this.real) {
      const hour = o.hour ?? 14;
      instant = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (hour - UTC_OFFSET_H) * 3600e3);
    }
    const shown = new Date(instant.getTime() + UTC_OFFSET_H * 3600e3);
    s.clock = `${String(shown.getUTCHours()).padStart(2, '0')}:${String(shown.getUTCMinutes()).padStart(2, '0')}`;
    const sun = solarPosition(instant);
    s.sunElevation = sun.elevation;
    sunDirection(sun.elevation, sun.azimuth, s.sunDir);

    const base = this.real && this.weather ? this.weather : DEFAULT_WEATHER;
    s.weather = o.weather ? forcedWeather(o.weather, base) : base;
    s.dry = s.weather.humidity < 30 && s.weather.rain === 0;
    s.live = this.real && this.weather !== null;

    const today = isoDate(shown);
    const tomorrow = isoDate(new Date(shown.getTime() + 86400e3));
    const find = (d: string) => (this.real ? (this.holidays.find((h) => h.date === d) ?? null) : null);
    s.holiday = o.holiday === null ? find(today) : o.holiday ? { date: today, name: t('env.testHoliday') } : null;
    s.holidayEve = s.holiday || o.holiday !== null ? null : find(tomorrow);
    return s;
  }

  private async refresh(): Promise<void> {
    const year = new Date(Date.now() + UTC_OFFSET_H * 3600e3).getUTCFullYear();
    const [weather, holidays] = await Promise.all([
      fetchWeather(),
      this.holidayYear === year ? Promise.resolve(null) : fetchHolidays(year),
    ]);
    if (weather) this.weather = weather;
    if (holidays) {
      // Feriados do ano seguinte também (véspera de 1º de janeiro).
      const next = (await fetchHolidays(year + 1)) ?? [];
      this.holidays = [...holidays, ...next];
      this.holidayYear = year;
    }
    this.onUpdate?.(this.snapshot());
  }
}

function forcedWeather(kind: WeatherOverride, base: Weather): Weather {
  switch (kind) {
    case 'dry':
      return { kind: 'clear', cloud: 0, rain: 0, temperature: 31, humidity: 14 };
    case 'rain':
      return fromWmo(63, 95, 2.5, 21, 92);
    case 'storm':
      return fromWmo(95, 100, 8, 20, 96);
    case 'fog':
      return fromWmo(45, 90, 0, 17, 98);
    case 'cloudy':
      return fromWmo(3, 95, 0, 23, 70);
    case 'partly':
      return fromWmo(2, 45, 0, 26, 55);
    case 'clear':
      return { ...base, kind: 'clear', cloud: 0.05, rain: 0, humidity: Math.max(base.humidity, 40) };
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
