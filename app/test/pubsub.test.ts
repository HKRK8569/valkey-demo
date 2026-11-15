import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pubsubEventRoutes, pubsubRoutes } from '../src/routes/pubsub.js'

test('SSEで複数行を配信し、切断時に専用接続を解放する', async () => {
  let receive: (message: string) => void = () => assert.fail('Not subscribed')
  let destroyed = false
  const route = pubsubEventRoutes(() => ({
    isOpen: true,
    async connect() {},
    async subscribe(channel, listener) {
      assert.equal(channel, 'app:events:demo')
      receive = listener
    },
    on() {},
    destroy() {
      destroyed = true
    },
  }))
  const response = await route.request('/events')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type') ?? '', /text\/event-stream/)
  const reader = response.body?.getReader()
  assert.ok(reader)
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    ': connected\n\n',
  )
  receive('hello\r\nworld')
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    'data: hello\ndata: world\n\n',
  )
  await reader.cancel()
  assert.equal(destroyed, true)
})

test('購読失敗時は503、稼働中のValkeyエラーとサーバー停止時はSSEを閉じる', async () => {
  for (const failure of ['connect', 'subscribe', 'error', 'shutdown']) {
    let destroyed = false
    let onError = (_error: Error) => {}
    const shutdown = new AbortController()
    const route = pubsubEventRoutes(
      () => ({
        isOpen: true,
        async connect() {
          if (failure === 'connect') throw new Error('unavailable')
        },
        async subscribe() {
          if (failure === 'subscribe') throw new Error('unavailable')
        },
        on(_event, listener) {
          onError = listener
        },
        destroy() {
          destroyed = true
        },
      }),
      shutdown.signal,
    )
    const response = await route.request('/events')
    if (failure === 'connect' || failure === 'subscribe') {
      assert.equal(response.status, 503)
    } else {
      const reader = response.body?.getReader()
      assert.ok(reader)
      await reader.read()
      if (failure === 'error') onError(new Error('connection lost'))
      else shutdown.abort()
      assert.equal((await reader.read()).done, true)
    }
    assert.equal(destroyed, true)
  }
})

test('メッセージを固定チャネルへ発行し、購読接続数を返す（0件も成功）', async () => {
  for (const subscribers of [0, 2]) {
    const route = pubsubRoutes({
      async publish(channel, message) {
        assert.equal(channel, 'app:events:demo')
        assert.equal(message, 'こんにちは')
        return subscribers
      },
    })
    const response = await route.request('/publish', {
      method: 'POST',
      body: JSON.stringify({ message: 'こんにちは' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      channel: 'app:events:demo',
      subscribers,
    })
  }
})

test('不正なJSON・空文字・型違い・サイズ超過は発行しない', async () => {
  const route = pubsubRoutes({
    async publish() {
      assert.fail('Invalid input must not be published')
    },
  })
  for (const body of [
    '{',
    'null',
    '[]',
    '{}',
    '{"message":1}',
    '{"message":"  "}',
    JSON.stringify({ message: 'あ'.repeat(1366) }),
  ]) {
    const response = await route.request('/publish', { method: 'POST', body })
    assert.equal(response.status, 400)
  }
  const response = await route.request('/publish', {
    method: 'POST',
    body: JSON.stringify({ message: 'x'.repeat(16384) }),
  })
  assert.equal(response.status, 413)
})

test('4096バイトのメッセージは発行できる', async () => {
  const route = pubsubRoutes({
    async publish() {
      return 1
    },
  })
  const response = await route.request('/publish', {
    method: 'POST',
    body: JSON.stringify({ message: 'x'.repeat(4096) }),
  })
  assert.equal(response.status, 200)
})

test('Valkeyへの発行失敗は503', async () => {
  const route = pubsubRoutes({
    async publish() {
      throw new Error('unavailable')
    },
  })
  const response = await route.request('/publish', {
    method: 'POST',
    body: JSON.stringify({ message: 'hello' }),
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: 'Pub/Sub temporarily unavailable',
  })
})
