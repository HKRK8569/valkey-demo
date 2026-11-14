import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rateLimitRoutes } from '../src/routes/rate-limit.js'

test('100回まで許可、101回目から拒否、期限切れ後に再開', async () => {
  let now = 0
  let expires = 0
  let count = 0
  const route = rateLimitRoutes({
    async eval(_script, options) {
      assert.deepEqual(options.keys, ['app:rate:demo'])
      assert.deepEqual(options.arguments, ['60'])
      if (now >= expires) {
        count = 0
        expires = now + 60
      }
      return [++count, expires - now]
    },
  })
  const responses = await Promise.all(
    Array.from({ length: 101 }, () => route.request('/')),
  )
  assert.equal(responses.filter((r) => r.status === 200).length, 100)
  const rejected = responses.find((r) => r.status === 429)
  assert.ok(rejected)
  assert.equal(responses[99].headers.get('X-RateLimit-Remaining'), '0')
  assert.equal(rejected.headers.get('Retry-After'), '60')
  assert.equal(rejected.headers.get('Cache-Control'), 'no-store')
  now = 30
  const later = await route.request('/')
  assert.equal(later.status, 429)
  assert.equal(later.headers.get('Retry-After'), '30')
  now = 60
  const reset = await route.request('/')
  assert.equal(reset.status, 200)
  assert.equal(reset.headers.get('X-RateLimit-Remaining'), '99')
})

test('Valkey 障害・不正応答では許可せず 503', async () => {
  for (const result of [null, [1, -1], [0, 60]]) {
    const route = rateLimitRoutes({
      async eval() {
        return result
      },
    })
    assert.equal((await route.request('/')).status, 503)
  }
  const route = rateLimitRoutes({
    async eval() {
      throw new Error('unavailable')
    },
  })
  const response = await route.request('/')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: 'Rate limiter temporarily unavailable',
  })
})
