import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createShareHandler } from './broker.mjs'

const handler = createShareHandler({
  statePath: process.env.SHARE_STATE_PATH || resolve('tmp/share-connections.json'),
  allowedOrigins: (process.env.SHARE_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  turnSecret: process.env.SHARE_TURN_SECRET,
  turnUrls: (process.env.SHARE_TURN_URLS || '').split(',').filter(Boolean)
})
const server = createServer((req, res) => {
  void handler(req, res)
})
const host = process.env.SHARE_HOST || '127.0.0.1',
  port = Number(process.env.SHARE_PORT || 8787)
server.listen(port, host, () => console.log(`Device sharing signaling: http://${host}:${port}`))
