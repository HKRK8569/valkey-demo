import { randomInt } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Hono } from 'hono'

type CacheStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
}

const key = 'app:cache:demo'

export function cacheRoutes(store: CacheStore) {
  const route = new Hono()

  route.get('/', async (c) => {
    const started = performance.now()
    // ブラウザやプロキシのキャッシュと Valkey のキャッシュを区別する。
    c.header('Cache-Control', 'no-store')

    try {
      const cached = await store.get(key)
      if (cached !== null) {
        const data = JSON.parse(cached) as { value: number; generatedAt: string }
        return c.json({ ...data, source: 'cache', elapsedMs: Math.round(performance.now() - started) })
      }

      // DB・外部 API の代わりに、取得元での処理を 500ms の待ち時間で再現。
      await setTimeout(500)
      const data = { value: randomInt(1_000_000), generatedAt: new Date().toISOString() }
      await store.set(key, JSON.stringify(data), { EX: 10 })
      return c.json({ ...data, source: 'origin', elapsedMs: Math.round(performance.now() - started) })
    } catch {
      console.error('Cache demo: Valkey read/write failed')
      return c.json({ error: 'Cache temporarily unavailable' }, 503)
    }
  })

  return route
}
