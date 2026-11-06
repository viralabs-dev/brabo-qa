import { describe, expect, it } from 'vitest';
import { checkConfere, decidirFechamento } from './fechar-check.ts';

const ok = { job: 'success', assinatura: 'success', digest: 'success', spec: 'success' } as const;
const dec = (d: Partial<Record<keyof typeof ok, string>>, cancelado = false) =>
  decidirFechamento({ cancelado, desfechos: { ...ok, ...d } as never });

describe('decidirFechamento', () => {
  it('tudo success vira verde', () => expect(dec({})).toEqual({ tipo: 'causa', causa: null }));
  it('spec skipped sem falha nenhuma vira ambiente', () =>
    expect(dec({ spec: 'skipped', job: 'success' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('digest skipped vira ambiente', () => expect(dec({ digest: 'skipped' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('checkout falhou vira ambiente', () =>
    expect(dec({ job: 'failure', assinatura: '', digest: '', spec: '' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('digest falhou vira digest', () =>
    expect(dec({ job: 'failure', digest: 'failure', spec: 'skipped' })).toEqual({ tipo: 'causa', causa: 'digest' }));
  it('assinatura falhou vira assinatura', () =>
    expect(dec({ job: 'failure', assinatura: 'failure', digest: 'skipped', spec: 'skipped' })).toEqual({ tipo: 'causa', causa: 'assinatura' }));
  it('spec falhou vira spec', () =>
    expect(dec({ job: 'failure', spec: 'failure' })).toEqual({ tipo: 'causa', causa: 'spec' }));
  it('cancelado fecha como cancelled, seja qual for o resto', () => {
    expect(dec({}, true)).toEqual({ tipo: 'cancelled' });
    expect(dec({ job: 'failure', spec: 'failure' }, true)).toEqual({ tipo: 'cancelled' });
  });
});

describe('checkConfere', () => {
  const check = { name: 'E2E do brabo-qa', head_sha: 'a'.repeat(40), status: 'in_progress', app: { id: 7 } };
  it('aceita o check nosso, do head e em andamento', () => expect(checkConfere(check, 'a'.repeat(40), 7)).toBeNull());
  it('recusa nome, head, status ou app diferentes', () => {
    expect(checkConfere({ ...check, name: 'outro' }, 'a'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere(check, 'b'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere({ ...check, status: 'completed' }, 'a'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere({ ...check, app: { id: 8 } }, 'a'.repeat(40), 7)).not.toBeNull();
  });
});
