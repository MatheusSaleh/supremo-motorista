// Polarização: um "calor" de 0 a 100 por facção. Sobe com provocações no território dela (passageiro
// rival, velocidade, buzina, postes derrubados, batidas nos carros dela) e esfria com o tempo, com
// passageiros da própria facção e na garagem do Tribunal. O calor decide quantos perseguidores cada
// facção manda (data/factions.ts → POLARIZATION.pursuerThresholds). Sem DOM nem Three.js.
import { FACTION_IDS, POLARIZATION as P, other, territoryAt, type FactionId, type Territory } from '../data/factions';

export interface PolarizationFrame {
  dt: number;
  x: number;
  z: number;
  /** Josué está dirigindo o carro oficial (a pé, ninguém liga). */
  driving: boolean;
  kmh: number;
  horn: boolean;
  /** Facção do passageiro a bordo: undefined = sem passageiro; null = passageiro neutro. */
  passenger: FactionId | null | undefined;
  /** Facções perseguindo agora: não esfriam (a perseguição só acaba despistando ou na garagem). */
  chasing: (f: FactionId) => boolean;
}

export class Polarization {
  readonly heat: Record<FactionId, number> = { vermelhos: 0, amarelos: 0 };
  /** Território onde o carro está agora (null = área neutra). */
  territory: Territory | null = null;

  update(f: PolarizationFrame): void {
    this.territory = f.driving ? territoryAt(f.x, f.z) : null;
    const here = this.territory?.faction ?? null;
    for (const id of FACTION_IDS) {
      let rate = f.chasing(id) ? 0 : id === here ? -P.decayInside : -P.decayNeutral;
      if (id === here) {
        if (f.passenger === undefined || f.passenger === null) rate += P.officialCar;
        else if (f.passenger === id) rate += P.friendlyPassenger;
        else rate += P.rivalPassenger;
        if (f.kmh > 90) rate += P.speeding;
        if (f.horn) rate += P.horn;
      }
      this.add(id, rate * f.dt);
    }
  }

  /** Poste/árvore/placa derrubado em (x, z): esquenta a facção dona do território. */
  propBroken(x: number, z: number): void {
    const t = territoryAt(x, z);
    if (t) this.add(t.faction, P.propBroken);
  }

  /** Batida forte num carro da facção. */
  hitFactionCar(f: FactionId): void {
    this.add(f, P.hitFactionCar);
  }

  /** Passageiro entregue: a facção dele esfria, a rival esquenta. */
  delivered(f: FactionId | null): void {
    if (!f) return;
    this.add(f, P.deliveredOwn);
    this.add(other(f), P.deliveredRival);
  }

  /** Um perseguidor desistiu (despistado). */
  escaped(f: FactionId): void {
    this.add(f, P.escaped);
  }

  /** Garagem do Tribunal: imunidade, zera tudo. Retorna true se havia algo a zerar. */
  reset(): boolean {
    const had = FACTION_IDS.some((id) => this.heat[id] > 1);
    for (const id of FACTION_IDS) this.heat[id] = 0;
    return had;
  }

  /** Quantos perseguidores a facção quer agora (pelos limiares de calor). */
  wanted(f: FactionId): number {
    return P.pursuerThresholds.filter((t) => this.heat[f] >= t).length;
  }

  private add(f: FactionId, v: number): void {
    this.heat[f] = Math.min(P.max, Math.max(0, this.heat[f] + v));
  }
}
