import { Hono } from 'hono'

type RateLimitStore = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>
}

export const rateLimitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return {count, redis.call('TTL', KEYS[1])}
`

export function rateLimitRoutes(store: RateLimitStore) {
  const route = new Hono()
  const limit = 100
  const windowSeconds = 60

  route.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    try {
      const result = await store.eval(rateLimitScript, {
        keys: ['app:rate:demo'],
        arguments: [String(windowSeconds)],
      })
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        !Number.isInteger(result[0]) ||
        result[0] < 1 ||
        !Number.isInteger(result[1]) ||
        result[1] < 0
      ) {
        throw new Error('Invalid rate limit response')
      }
      const [count, ttl] = result as [number, number]
      const remaining = Math.max(0, limit - count)
      c.header('X-RateLimit-Limit', String(limit))
      c.header('X-RateLimit-Remaining', String(remaining))
      if (count > limit) {
        const retryAfter = Math.max(1, ttl)
        c.header('Retry-After', String(retryAfter))
        return c.json(
          { error: 'Too Many Requests', limit, remaining, retryAfter },
          429,
        )
      }
    } catch {
      console.error('Rate limit demo: Valkey operation failed')
      return c.json({ error: 'Rate limiter temporarily unavailable' }, 503)
    }
    await next()
  })

  route.get('/', (c) => c.json({ message: 'Request allowed' }))
  return route
}
