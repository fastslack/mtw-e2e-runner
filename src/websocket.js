/**
 * Minimal WebSocket server — RFC 6455 text frames only, no external deps.
 *
 * Usage:
 *   const wss = createWebSocketServer(httpServer);
 *   wss.broadcast(JSON.stringify({ event: 'hello' }));
 */

import crypto from 'crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x01;
const OP_CLOSE = 0x08;
const OP_PING = 0x09;
const OP_PONG = 0x0a;

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeFrame(data, opcode = OP_TEXT) {
  const buf = Buffer.from(data, 'utf-8');
  const len = buf.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, buf]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const opcode = firstByte & 0x0f;
  const secondByte = buffer[1];
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) {
    if (buffer.length < offset + 4 + payloadLen) return null;
    const mask = buffer.slice(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buffer[offset + i] ^ mask[i % 4];
    }
    return { opcode, payload, totalLength: offset + payloadLen };
  }

  if (buffer.length < offset + payloadLen) return null;
  return { opcode, payload: buffer.slice(offset, offset + payloadLen), totalLength: offset + payloadLen };
}

export function createWebSocketServer(httpServer, options = {}) {
  const clients = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    // Validate Origin to prevent cross-site WebSocket hijacking
    const origin = req.headers.origin;
    if (origin && options.allowedOrigins) {
      if (!options.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = acceptKey(key);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    );

    clients.add(socket);
    let recvBuffer = Buffer.alloc(0);
    const MAX_BUFFER = 1024 * 1024; // 1MB max receive buffer

    socket.on('data', (data) => {
      recvBuffer = Buffer.concat([recvBuffer, data]);
      if (recvBuffer.length > MAX_BUFFER) {
        clients.delete(socket);
        try { socket.write(encodeFrame('', OP_CLOSE)); } catch { /* */ }
        socket.destroy();
        return;
      }

      while (recvBuffer.length > 0) {
        const frame = decodeFrame(recvBuffer);
        if (!frame) break;

        recvBuffer = recvBuffer.slice(frame.totalLength);

        switch (frame.opcode) {
          case OP_TEXT:
            // We don't process client messages for now
            break;
          case OP_PING:
            try { socket.write(encodeFrame(frame.payload.toString(), OP_PONG)); } catch { /* */ }
            break;
          case OP_CLOSE:
            try { socket.write(encodeFrame('', OP_CLOSE)); } catch { /* */ }
            socket.end();
            break;
        }
      }
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));

    // Send connected event
    try {
      socket.write(encodeFrame(JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() })));
    } catch { /* */ }

    // Notify listener of new connection (for replaying state)
    if (options.onConnect) {
      try { options.onConnect(socket); } catch { /* */ }
    }
  });

  return {
    broadcast(data) {
      const frame = encodeFrame(data);
      for (const client of clients) {
        try { client.write(frame); } catch { clients.delete(client); }
      }
    },
    sendTo(socket, data) {
      try { socket.write(encodeFrame(data)); } catch { /* */ }
    },
    get clientCount() {
      return clients.size;
    },
    close() {
      for (const client of clients) {
        try { client.write(encodeFrame('', OP_CLOSE)); client.end(); } catch { /* */ }
      }
      clients.clear();
    },
  };
}
