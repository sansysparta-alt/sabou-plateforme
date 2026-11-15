import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from './accounts-api';
import { clearPrefetched, prefetch, requestKey, takePrefetched } from './prefetch';

afterEach(() => {
  clearPrefetched();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => Response.json({ url }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Données demandées en avance (US-017)', () => {
  it('la page reprend la réponse demandée en avance : une seule requête vers l’API', async () => {
    const fetchMock = stubFetch();
    prefetch('/api/comptes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await call('/api/comptes')).toEqual({ url: '/api/comptes' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('une réponse ne sert qu’une fois : l’appel suivant (après une décision) repart vers l’API', async () => {
    const fetchMock = stubFetch();
    prefetch('/api/comptes');
    await call('/api/comptes');
    await call('/api/comptes');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('une réponse demandée il y a plus de 10 s n’est pas servie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = stubFetch();
    prefetch('/api/comptes');
    vi.setSystemTime(Date.now() + 10_001);
    await call('/api/comptes');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('la consultation d’une invitation n’est reprise que pour le même jeton', async () => {
    const fetchMock = stubFetch();
    prefetch('/api/invitation/consultation', { method: 'POST', body: { token: 'a' } });
    await call('/api/invitation/consultation', { token: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await call('/api/invitation/consultation', { token: 'a' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('une lecture et une écriture à la même adresse ne se confondent pas', () => {
    stubFetch();
    prefetch('/api/comptes');
    expect(takePrefetched(requestKey('POST', '/api/comptes', '{}'))).toBeUndefined();
    expect(takePrefetched(requestKey('GET', '/api/comptes'))).toBeDefined();
  });

  it('une panne réseau est rendue à la page qui reprend la requête, comme sans préchargement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('réseau'))),
    );
    prefetch('/api/comptes');
    await expect(call('/api/comptes')).rejects.toMatchObject({ status: 0 });
  });
});
