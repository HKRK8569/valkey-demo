import { Buffer } from 'node:buffer'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

type PubSubStore = {
  publish(channel: string, message: string): Promise<number>
}

const channel = 'app:events:demo'

type Subscriber = {
  connect(): Promise<unknown>
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<unknown>
  on(event: 'error', listener: (error: Error) => void): unknown
  destroy(): void
  isOpen: boolean
}

export function pubsubEventRoutes(
  createSubscriber: () => Subscriber,
  shutdownSignal?: AbortSignal,
) {
  const route = new Hono()

  route.get('/events', async (c) => {
    const subscriber = createSubscriber()
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array>
    let closed = false
    let cancelled = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      c.req.raw.signal.removeEventListener('abort', cleanup)
      shutdownSignal?.removeEventListener('abort', cleanup)
      if (subscriber.isOpen) subscriber.destroy()
      if (!cancelled) controller.close()
    }
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
      cancel() {
        cancelled = true
        cleanup()
      },
    })
    const send = (value: string) => {
      if (closed) return
      // 遅い受信側に通知を無制限に蓄積しない。
      if ((controller.desiredSize ?? 0) <= 0) {
        cleanup()
        return
      }
      controller.enqueue(encoder.encode(value))
    }
    subscriber.on('error', cleanup)
    c.req.raw.signal.addEventListener('abort', cleanup, { once: true })
    shutdownSignal?.addEventListener('abort', cleanup, { once: true })

    try {
      if (c.req.raw.signal.aborted || shutdownSignal?.aborted) {
        cleanup()
        return c.json({ error: 'Subscription unavailable' }, 503)
      }
      await subscriber.connect()
      if (closed) throw new Error('Subscription closed')
      await subscriber.subscribe(channel, (message) => {
        send(
          `${message
            .split(/\r\n|\r|\n/)
            .map((line) => `data: ${line}`)
            .join('\n')}\n\n`,
        )
      })
      if (closed) throw new Error('Subscription closed')
      send(': connected\n\n')
      heartbeat = setInterval(() => send(': heartbeat\n\n'), 15000)
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      })
    } catch {
      cleanup()
      return c.json({ error: 'Subscription unavailable' }, 503)
    }
  })

  return route
}

export function pubsubRoutes(store: PubSubStore) {
  const route = new Hono()

  route.post(
    '/publish',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'Invalid JSON' }, 400)
      }

      if (
        typeof body !== 'object' ||
        body === null ||
        !('message' in body) ||
        typeof body.message !== 'string' ||
        body.message.trim().length === 0 ||
        Buffer.byteLength(body.message, 'utf8') > 4096
      ) {
        return c.json(
          {
            error:
              'message must be a non-empty string of at most 4096 UTF-8 bytes',
          },
          400,
        )
      }

      try {
        const subscribers = await store.publish(channel, body.message)
        return c.json({ channel, subscribers })
      } catch {
        console.error('Pub/Sub demo: Valkey publish failed')
        return c.json({ error: 'Pub/Sub temporarily unavailable' }, 503)
      }
    },
  )

  return route
}
