import { describe, expect, it } from 'vitest';
import { anexarVinculos, checkConfere, decidirFechamento, foiCancelado } from './fechar-check.ts';

const ok = { validar: 'success', job: 'success', assinatura: 'success', digest: 'success', spec: 'success' } as const;
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
  it('validar falhou vira ambiente', () =>
    expect(dec({ validar: 'failure', job: 'failure', assinatura: '', digest: '', spec: '' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('validar skipped ou ausente nunca dá verde', () => expect(dec({ validar: '' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('job skipped (needs.e2e.result) vira ambiente', () => expect(dec({ job: 'skipped' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('spec cancelled (passo morto por timeout) vira ambiente', () =>
    expect(dec({ job: 'failure', spec: 'cancelled' })).toEqual({ tipo: 'causa', causa: 'ambiente' }));
  it('cancelado fecha como cancelled, seja qual for o resto', () => {
    expect(dec({}, true)).toEqual({ tipo: 'cancelled' });
    expect(dec({ job: 'failure', spec: 'failure' }, true)).toEqual({ tipo: 'cancelled' });
  });
});

describe('checkConfere', () => {
  const check = { name: 'E2E do brabo-qa', head_sha: 'a'.repeat(40), status: 'in_progress', app: { id: 7 } };
  it('aceita o check nosso, do head e em andamento', () => expect(checkConfere(check, 'a'.repeat(40), 7)).toBeNull());
  it('aceita também o check do regressivo da dev', () =>
    expect(checkConfere({ ...check, name: 'Regressivo do brabo-qa' }, 'a'.repeat(40), 7)).toBeNull());
  it('recusa nome, head, status ou app diferentes', () => {
    expect(checkConfere({ ...check, name: 'outro' }, 'a'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere({ ...check, name: 'E2E do brabo-qa ' }, 'a'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere(check, 'b'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere({ ...check, status: 'completed' }, 'a'.repeat(40), 7)).not.toBeNull();
    expect(checkConfere({ ...check, app: { id: 8 } }, 'a'.repeat(40), 7)).not.toBeNull();
  });
});

describe('foiCancelado', () => {
  it('só o resultado cancelled do job e2e é cancelamento', () => expect(foiCancelado('cancelled')).toBe(true));
  it('timeout do job (failure) ou qualquer outro resultado vira ambiente, não cancelled', () => {
    for (const r of ['failure', 'success', 'skipped', '']) expect(foiCancelado(r)).toBe(false);
    expect(dec({ job: '', validar: '', assinatura: '', digest: '', spec: '' }, foiCancelado('failure'))).toEqual({ tipo: 'causa', causa: 'ambiente' });
  });
});

describe('anexarVinculos', () => {
  it('sem vínculos devolve o resumo intacto', () => {
    expect(anexarVinculos('r')).toBe('r');
    expect(anexarVinculos('r', '  \n')).toBe('r');
  });
  it('anexa a tabela e limita o tamanho', () => {
    expect(anexarVinculos('r', '## Vínculos\n')).toBe('r\n\n## Vínculos');
    expect(anexarVinculos('r', 'x'.repeat(9000)).length).toBe(1 + 2 + 8000);
  });
});
