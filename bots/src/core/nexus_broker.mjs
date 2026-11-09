// Length-Prefixed Unix Domain Socket Nexus Broker (/dev/shm/mc-bot-${UID}/nexus.sock)
// ponytail: 4-byte u32 BE length-prefixed JSON framing over native node:net Unix socket; zero external deps
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'

export const MAX_FRAME_BYTES = 1024 * 1024 // 1 MB safety cap

export function encodeFrame(payloadObj) {
  const body = Buffer.from(JSON.stringify(payloadObj), 'utf8')
  const frame = Buffer.allocUnsafe(4 + body.length)
  frame.writeUInt32BE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

export class FrameDecoder {
  constructor(onMessage) {
    this.buf = Buffer.alloc(0)
    this.onMessage = onMessage
  }

  push(chunk) {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (len > MAX_FRAME_BYTES) {
        this.buf = Buffer.alloc(0)
        throw new RangeError(`Frame length ${len} exceeds MAX_FRAME_BYTES (${MAX_FRAME_BYTES})`)
      }
      if (this.buf.length < 4 + len) break
      const jsonSlice = this.buf.subarray(4, 4 + len).toString('utf8')
      this.buf = this.buf.subarray(4 + len)
      const parsed = JSON.parse(jsonSlice)
      this.onMessage(parsed)
    }
  }
}

export class NexusBrokerServer extends EventEmitter {
  constructor(options = {}) {
    super()
    const uid = process.getuid ? process.getuid() : 0
    this.baseDir = options.baseDir || `/dev/shm/mc-bot-${uid}`
    this.socketPath = options.socketPath || path.join(this.baseDir, 'nexus.sock')
    this.clients = new Map() // agentName -> socket
    this.allSockets = new Set()
    this.server = null
  }

  async listen() {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true, mode: 0o700 })
    try { fs.chmodSync(path.dirname(this.socketPath), 0o700) } catch {}
    try {
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath)
    } catch {}

    this.server = net.createServer((sock) => this._handleConnection(sock))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.socketPath, () => {
        this.server.removeListener('error', reject)
        try { fs.chmodSync(this.socketPath, 0o600) } catch {}
        resolve()
      })
    })
    return this.socketPath
  }

  _handleConnection(sock) {
    this.allSockets.add(sock)
    let registeredName = null

    const decoder = new FrameDecoder((msg) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'REGISTER' && msg.agent) {
        registeredName = String(msg.agent)
        this.clients.set(registeredName, sock)
        sock.write(encodeFrame({ type: 'REGISTERED', agent: registeredName, reqId: msg.reqId }))
        this.emit('register', registeredName)
        return
      }
      if (msg.type === 'ROSTER_REQ') {
        sock.write(encodeFrame({
          type: 'ROSTER_RES',
          reqId: msg.reqId,
          roster: Array.from(this.clients.keys())
        }))
        return
      }
      if (msg.target) {
        const targetStr = String(msg.target)
        if (targetStr.toLowerCase() === 'all') {
          const frame = encodeFrame(msg)
          for (const [name, clientSock] of this.clients.entries()) {
            if (name !== registeredName && !clientSock.destroyed) {
              clientSock.write(frame)
            }
          }
          if (msg.reqId) {
            sock.write(encodeFrame({ type: 'ACK', reqId: msg.reqId, delivered: this.clients.size }))
          }
        } else {
          const dest = this.clients.get(targetStr)
          const delivered = Boolean(dest && !dest.destroyed && dest.write(encodeFrame(msg)))
          if (msg.reqId) {
            sock.write(encodeFrame({ type: 'ACK', reqId: msg.reqId, delivered: delivered ? 1 : 0 }))
          }
        }
        return
      }
      this.emit('message', msg, sock, registeredName)
    })

    sock.on('data', (chunk) => {
      try {
        decoder.push(chunk)
      } catch {
        sock.destroy()
      }
    })

    const cleanup = () => {
      this.allSockets.delete(sock)
      if (registeredName && this.clients.get(registeredName) === sock) {
        this.clients.delete(registeredName)
        this.emit('unregister', registeredName)
      }
    }
    sock.on('close', cleanup)
    sock.on('error', cleanup)
  }

  getActiveRoster() {
    return Array.from(this.clients.keys())
  }

  async close() {
    for (const sock of this.allSockets) {
      try { sock.destroy() } catch {}
    }
    this.allSockets.clear()
    this.clients.clear()
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()))
      this.server = null
    }
    try {
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath)
    } catch {}
  }
}

export class NexusClient extends EventEmitter {
  constructor(agentName, options = {}) {
    super()
    const uid = process.getuid ? process.getuid() : 0
    this.agentName = agentName
    this.socketPath = options.socketPath || `/dev/shm/mc-bot-${uid}/nexus.sock`
    this.socket = null
    this.reqSeq = 0
    this.pending = new Map()
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) return
    const sock = net.createConnection(this.socketPath)
    const decoder = new FrameDecoder((msg) => {
      if (msg.reqId && this.pending.has(msg.reqId)) {
        const waiter = this.pending.get(msg.reqId)
        this.pending.delete(msg.reqId)
        waiter.resolve(msg)
        return
      }
      this.emit('message', msg)
    })
    sock.on('data', (chunk) => decoder.push(chunk))
    sock.on('close', () => {
      for (const w of this.pending.values()) w.reject(new Error('nexus_closed'))
      this.pending.clear()
    })

    await new Promise((resolve, reject) => {
      sock.once('error', reject)
      sock.once('connect', () => {
        sock.removeListener('error', reject)
        this.socket = sock
        resolve()
      })
    })

    if (this.agentName) {
      await this.request({ type: 'REGISTER', agent: this.agentName })
    }
  }

  request(payload) {
    const reqId = ++this.reqSeq
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      this.socket.write(encodeFrame({ ...payload, reqId }))
    })
  }

  sendTo(target, payload) {
    return this.request({ ...payload, sender: this.agentName, target })
  }

  getRoster() {
    return this.request({ type: 'ROSTER_REQ' }).then((r) => r.roster || [])
  }

  close() {
    if (this.socket) {
      try { this.socket.destroy() } catch {}
      this.socket = null
    }
  }
}
