import { createClient } from '@redis/client'

export const valkey = createClient({
  socket: {
    host: process.env.VALKEY_HOST ?? '127.0.0.1',
    port: Number(process.env.VALKEY_PORT ?? 6379),
    connectTimeout: 3000,
    reconnectStrategy: false,
  },
  username: process.env.VALKEY_USERNAME ?? 'app',
  password: process.env.VALKEY_PASSWORD ?? 'local-app-password',
  disableClientInfo: true,
  disableOfflineQueue: true,
})

valkey.on('error', () => console.error('Valkey connection error'))
