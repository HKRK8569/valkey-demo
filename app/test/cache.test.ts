import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheRoutes } from '../src/routes/cache.js'

test('初回生成、キャッシュ再利用、期限切れ後の再生成', async () => {
  let now = 0
  let saved: { value: string; expires: number } | undefined
  const route = cacheRoutes({
    async get(key) {
      assert.equal(key, 'app:cache:demo')
      return saved && saved.expires > now ? saved.value : null
    },
    async set(key, value, options) {
      assert.equal(key, 'app:cache:demo')
      saved = { value, expires: now + options.EX * 1000 }
    },
  })

  const first = await route.request('/')
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('Cache-Control'), 'no-store')
  const origin = await first.json()
  assert.equal(origin.source, 'origin')
  assert.equal(typeof origin.value, 'number')
  assert.ok(origin.elapsedMs >= 450)

  now = 9999
  const cached = await (await route.request('/')).json()
  assert.equal(cached.source, 'cache')
  assert.equal(cached.value, origin.value)
  assert.equal(cached.generatedAt, origin.generatedAt)

  now = 10000
  const refreshed = await (await route.request('/')).json()
  assert.equal(refreshed.source, 'origin')
  assert.notEqual(refreshed.generatedAt, origin.generatedAt)
})

test('Valkey の読み書きに失敗したら 503', async () => {
  for (const failRead of [true, false]) {
    const route = cacheRoutes({
      async get() {
        if (failRead) throw new Error('unavailable')
        return null
      },
      async set() { throw new Error('unavailable') },
    })
    const response = await route.request('/')
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Cache temporarily unavailable' })
  }
})
