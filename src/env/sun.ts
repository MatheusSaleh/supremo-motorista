// Posição do sol (aproximação da NOAA, erro de poucos décimos de grau) e conversão para os eixos do jogo.
import * as THREE from 'three';

/** Centro de Brasília (Rodoviária). */
export const BRASILIA = { lat: -15.7939, lon: -47.8828 };

const RAD = Math.PI / 180;

/** Elevação e azimute (graus; azimute a partir do norte, sentido horário) num instante. */
export function solarPosition(date: Date, lat = BRASILIA.lat, lon = BRASILIA.lon): { elevation: number; azimuth: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = Math.floor((date.getTime() - start) / 86400000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hours - 12) / 24); // ano fracionário (rad)
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hours * 60 + eqTime + 4 * lon;
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZenith = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth =
    Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { elevation: 90 - zenith / RAD, azimuth: azimuth % 360 };
}

/**
 * Direção (unitária, do chão para o sol) nos eixos do jogo: −X = norte, +X = sul, −Z = leste, +Z = oeste.
 */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const el = elevationDeg * RAD;
  const az = azimuthDeg * RAD;
  const north = Math.cos(el) * Math.cos(az);
  const east = Math.cos(el) * Math.sin(az);
  return out.set(-north, Math.sin(el), -east).normalize();
}
