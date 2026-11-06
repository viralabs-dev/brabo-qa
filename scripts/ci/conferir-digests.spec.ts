import { describe, expect, it } from 'vitest';
import { conferirDigests, type Inspecao, type Servico } from './conferir-digests.ts';

const SERVICOS: Servico[] = ['api', 'engine', 'web', 'broker', 'backup'];
const ref = (s: Servico, h = 'a') => `ghcr.io/viralabs-dev/brabo-${s}@sha256:${h.repeat(64)}`;
const esperado = Object.fromEntries(SERVICOS.map((s) => [s, ref(s)])) as Record<Servico, string>;
const todas = (): Inspecao[] => SERVICOS.map((s) => ({ servico: s, repoDigests: [ref(s)] }));

describe('conferirDigests', () => {
  it('passa quando todos os digests são os esperados', () => {
    const r = conferirDigests(esperado, todas());
    expect(r.ok).toBe(true);
    expect(r.linhas).toHaveLength(5);
  });

  it('reprova o digest diferente e mostra o encontrado', () => {
    const insp = todas().map((i) => (i.servico === 'web' ? { ...i, repoDigests: [ref('web', 'b')] } : i));
    const r = conferirDigests(esperado, insp);
    expect(r.ok).toBe(false);
    expect(r.linhas.find((l) => l.servico === 'web')?.encontrado).toBe(ref('web', 'b'));
  });

  it('reprova RepoDigests vazio (imagem de build local)', () => {
    const insp = todas().map((i) => (i.servico === 'api' ? { ...i, repoDigests: [] } : i));
    expect(conferirDigests(esperado, insp).ok).toBe(false);
  });

  it('reprova serviço sem inspeção, com encontrado null', () => {
    const r = conferirDigests(esperado, todas().filter((i) => i.servico !== 'broker'));
    expect(r.ok).toBe(false);
    expect(r.linhas.find((l) => l.servico === 'broker')?.encontrado).toBeNull();
  });

  it('aceita dois RepoDigests quando um deles é o esperado', () => {
    const insp = todas().map((i) =>
      i.servico === 'engine' ? { ...i, repoDigests: [ref('engine', 'c'), ref('engine')] } : i,
    );
    const r = conferirDigests(esperado, insp);
    expect(r.ok).toBe(true);
    expect(r.linhas.find((l) => l.servico === 'engine')?.encontrado).toBe(ref('engine'));
  });
});
