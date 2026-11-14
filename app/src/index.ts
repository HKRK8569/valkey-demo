import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { valkey } from './lib/valkey.js'
import { cacheRoutes } from './routes/cache.js'

const app = new Hono()

await valkey.connect()
app.route('/cache-demo', cacheRoutes(valkey))

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

const server = serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      if (valkey.isOpen) valkey.destroy()
    })
  })
}
