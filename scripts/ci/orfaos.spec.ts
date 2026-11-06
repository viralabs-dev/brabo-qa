import { describe, expect, it } from 'vitest';
import { orfaos } from './varrer-orfaos.ts';

const agora = new Date('2026-11-06T12:00:00Z');
const antes = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

describe('orfaos', () => {
  it('in_progress de 91 min entra', () => {
    expect(orfaos([{ id: 1, status: 'in_progress', startedAt: antes(91) }], agora)).toEqual([1]);
  });
  it('in_progress de 89 min não entra', () => {
    expect(orfaos([{ id: 1, status: 'in_progress', startedAt: antes(89) }], agora)).toEqual([]);
  });
  it('completed nunca entra', () => {
    expect(orfaos([{ id: 1, status: 'completed', startedAt: antes(500) }], agora)).toEqual([]);
  });
});
