const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.IO com CORS para desenvolvimento
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve os arquivos estáticos do client
app.use(express.static(path.join(__dirname, '..', 'client')));

// Proxy para IA — evita CORS ao acessar provedores externos
app.use(express.json({ limit: '50mb' }));

const AI_TIMEOUT = 60000; // 60 segundos

async function fetchWithTimeout(url, options, timeout = AI_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

app.post('/api/ai/analyze', async (req, res) => {
  const { provider, targetUrl, model, apiKey, imageBase64, prompt, disableThinking, timeout } = req.body;

  const customTimeout = timeout || AI_TIMEOUT;

  console.log(`[AI Proxy] Recebida requisicao: provider=${provider}, url=${targetUrl}, model=${model}, disableThinking=${disableThinking}, timeout=${customTimeout}ms`);

  if (!targetUrl || !model || !imageBase64) {
    console.error(`[AI Proxy] Parametros faltando`);
    return res.status(400).json({ error: 'targetUrl, model e imageBase64 sao obrigatorios' });
  }

  try {
    let result;

    if (provider === 'ollama') {
      result = await proxyToOllama(targetUrl, model, imageBase64, prompt, disableThinking, customTimeout);
    } else {
      result = await proxyToOpenAICompatible(targetUrl, model, apiKey, imageBase64, prompt, provider, disableThinking, customTimeout);
    }

    console.log(`[AI Proxy] Sucesso`);
    res.json({ response: result });
  } catch (err) {
    console.error(`[AI Proxy] Erro: ${err.message}`);
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Timeout: a IA demorou demais para responder' });
    } else {
      res.status(502).json({ error: err.message });
    }
  }
});

async function proxyToOllama(targetUrl, model, imageBase64, prompt, disableThinking, timeout = AI_TIMEOUT) {
  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const fullUrl = `${targetUrl.replace(/\/+$/, '')}/api/generate`;

  console.log(`[AI Proxy] Chamando: ${fullUrl}`);

  const body = {
    model,
    prompt: prompt || 'Descreva em portugues o que voce ve nesta tela. Seja conciso e objetivo, focando nos elementos principais visiveis.',
    images: [base64Data],
    stream: false
  };

  if (disableThinking) {
    body.options = {
      thinking: false
    };
  }

  const response = await fetchWithTimeout(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, timeout);

  const responseText = await response.text();
  console.log(`[AI Proxy] Ollama status: ${response.status}`);

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText} - ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseErr) {
    throw new Error(`Falha ao parsear JSON do Ollama: ${parseErr.message}. Response: ${responseText.substring(0, 200)}`);
  }

  if (!data.response) {
    throw new Error(`Resposta invalida do Ollama: campo response ausente. Keys: ${Object.keys(data).join(', ')}`);
  }

  return data.response;
}

async function proxyToOpenAICompatible(targetUrl, model, apiKey, imageBase64, prompt, provider, disableThinking, timeout = AI_TIMEOUT) {
  const headers = { 'Content-Type': 'application/json' };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:3003';
    headers['X-Title'] = 'ScreenBOT';
  }

  const baseUrl = targetUrl.replace(/\/+$/, '');
  const endpoint = provider === 'lmstudio' ? '/v1/chat/completions' : '/chat/completions';
  const fullUrl = `${baseUrl}${endpoint}`;

  console.log(`[AI Proxy] Chamando: ${fullUrl}`);

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Descreva em portugues o que voce ve nesta tela. Seja conciso e objetivo, focando nos elementos principais visiveis.' },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }
    ],
    max_tokens: 4096
  };

  if (disableThinking) {
    body.reasoning_effort = 'low';
  }

  console.log(`[AI Proxy] Body: model=${model}, messages=${body.messages.length}, max_tokens=${body.max_tokens}`);

  const response = await fetchWithTimeout(fullUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, timeout);

  const responseText = await response.text();
  console.log(`[AI Proxy] Status: ${response.status}`);
  console.log(`[AI Proxy] Raw response (first 500 chars): ${responseText.substring(0, 500)}`);

  if (!response.ok) {
    console.error(`[AI Proxy] Resposta do servidor: ${response.status} - ${responseText}`);
    throw new Error(`API error: ${response.status} - ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseErr) {
    throw new Error(`Falha ao parsear JSON da resposta: ${parseErr.message}. Response: ${responseText.substring(0, 200)}`);
  }

  console.log(`[AI Proxy] Parsed response keys: ${Object.keys(data).join(', ')}`);

  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error(`Resposta invalida da API: choices ausente ou vazio. Response: ${JSON.stringify(data).substring(0, 300)}`);
  }

  const choice = data.choices[0];
  if (!choice.message) {
    throw new Error(`Resposta invalida da API: message ausente. Choice: ${JSON.stringify(choice).substring(0, 300)}`);
  }

  const content = choice.message.content || choice.message.reasoning_content || '';
  if (!content) {
    throw new Error(`Resposta invalida da API: content e reasoning_content ausentes. Choice: ${JSON.stringify(choice).substring(0, 300)}`);
  }

  return content;
}

// Armazena o estado das salas: { roomId: { broadcasterId: string, viewers: Set<string>, isStreaming: boolean } }
const rooms = new Map();

// Retorna o roomId associado a um socket
function getRoomId(socketId) {
  for (const [roomId, room] of rooms) {
    if (room.broadcasterId === socketId || room.viewers.has(socketId)) {
      return roomId;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  try {
    console.log(`[WS] Conectado: ${socket.id}`);

  // --- Transmissor: cria uma nova sala ---
  socket.on('create-room', () => {
    try {
      const roomId = socket.id.substring(0, 8);
      rooms.set(roomId, {
        broadcasterId: socket.id,
        viewers: new Set(),
        isStreaming: false
      });
      socket.join(roomId);
      socket.emit('room-created', { roomId });
      console.log(`[WS] Sala criada: ${roomId} por ${socket.id}`);
    } catch (err) {
      console.error(`[WS] Erro em create-room: ${err.message}`);
    }
  });

  // --- Espectador: entra em uma sala existente ---
  socket.on('join-room', ({ roomId }) => {
    try {
      console.log(`[WS] join-room recebido: roomId=${roomId} de ${socket.id}`);
      
      const room = rooms.get(roomId);

      if (!room) {
        console.log(`[WS] Sala ${roomId} não encontrada`);
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      if (room.broadcasterId === socket.id) {
        socket.emit('error', { message: 'Você já é o transmissor desta sala' });
        return;
      }

      room.viewers.add(socket.id);
      socket.join(roomId);
      socket.emit('room-joined', { roomId });

      io.to(room.broadcasterId).emit('viewer-joined', { viewerId: socket.id });

      if (room.isStreaming) {
        socket.emit('stream-already-active');
        io.to(room.broadcasterId).emit('viewer-joined-during-stream', { viewerId: socket.id });
      }

      console.log(`[WS] Espectador ${socket.id} entrou na sala ${roomId} (total: ${room.viewers.size})`);
    } catch (err) {
      console.error(`[WS] Erro em join-room: ${err.message}`);
    }
  });

  // --- Transmissor: inicia a transmissão ---
  socket.on('start-stream', () => {
    try {
      const roomId = getRoomId(socket.id);
      if (!roomId) {
        console.log(`[WS] start-stream: sala não encontrada para ${socket.id}`);
        return;
      }

      const room = rooms.get(roomId);
      if (!room) return;

      room.isStreaming = true;

      console.log(`[WS] Transmissão iniciada na sala ${roomId}, espectadores: ${room.viewers.size}`);
      room.viewers.forEach(vId => console.log(`  - Viewer: ${vId}`));

      socket.to(roomId).emit('stream-started');
    } catch (err) {
      console.error(`[WS] Erro em start-stream: ${err.message}`);
    }
  });

  // --- Transmissor: encerra a transmissão ---
  socket.on('stop-stream', () => {
    try {
      const roomId = getRoomId(socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      room.isStreaming = false;

      socket.to(roomId).emit('stream-ended');
      console.log(`[WS] Transmissão encerrada na sala ${roomId}`);
    } catch (err) {
      console.error(`[WS] Erro em stop-stream: ${err.message}`);
    }
  });

  // --- Transmissor: remove espectador da sala ---
  socket.on('kick-viewer', ({ viewerId }) => {
    try {
      const roomId = getRoomId(socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room || !room.viewers) return;

      if (!room.viewers.has(viewerId)) return;

      room.viewers.delete(viewerId);
      io.to(viewerId).emit('kicked');
      io.sockets.sockets.get(viewerId)?.leave(roomId);
      socket.emit('viewer-left', { viewerId });
      console.log(`[WS] Espectador ${viewerId} removido da sala ${roomId}`);
    } catch (err) {
      console.error(`[WS] Erro em kick-viewer: ${err.message}`);
    }
  });

  // --- WebRTC Signaling: Offer (transmissor -> espectador) ---
  socket.on('send-offer', ({ targetViewerId, offer }) => {
    try {
      io.to(targetViewerId).emit('receive-offer', {
        broadcasterId: socket.id,
        offer
      });
    } catch (err) {
      console.error(`[WS] Erro em send-offer: ${err.message}`);
    }
  });

  // --- WebRTC Signaling: Answer (espectador -> transmissor) ---
  socket.on('send-answer', ({ targetBroadcasterId, answer }) => {
    try {
      io.to(targetBroadcasterId).emit('receive-answer', {
        viewerId: socket.id,
        answer
      });
    } catch (err) {
      console.error(`[WS] Erro em send-answer: ${err.message}`);
    }
  });

  // --- WebRTC Signaling: ICE Candidate (bidirecional) ---
  socket.on('send-ice-candidate', ({ targetId, candidate }) => {
    try {
      io.to(targetId).emit('receive-ice-candidate', {
        senderId: socket.id,
        candidate
      });
    } catch (err) {
      console.error(`[WS] Erro em send-ice-candidate: ${err.message}`);
    }
  });

  // --- Desconexão ---
  socket.on('disconnect', () => {
    try {
      console.log(`[WS] Desconectado: ${socket.id}`);

      const roomId = getRoomId(socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      // Se o transmissor saiu, notifica todos os espectadores e limpa a sala
      if (room.broadcasterId === socket.id) {
        socket.to(roomId).emit('broadcaster-left');
        rooms.delete(roomId);
        console.log(`[WS] Sala ${roomId} removida (transmissor saiu)`);
        return;
      }

      // Se um espectador saiu, remove da lista e notifica o transmissor
      room.viewers.delete(socket.id);
      io.to(room.broadcasterId).emit('viewer-left', { viewerId: socket.id });
      console.log(`[WS] Espectador ${socket.id} saiu da sala ${roomId}`);
    } catch (err) {
      console.error(`[WS] Erro em disconnect: ${err.message}`);
    }
  });
} catch (err) {
  console.error(`[WS] Erro na conexao do socket ${socket.id}: ${err.message}`);
}
});

// Handlers globais para evitar crash do servidor
process.on('uncaughtException', (err) => {
  console.error(`[CRITICAL] Uncaught Exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[CRITICAL] Unhandled Rejection at: ${promise}`);
  console.error(`[CRITICAL] Reason: ${reason}`);
});

const PORT = process.env.PORT || 3003;

server.on('error', (err) => {
  console.error(`[HTTP] Erro no servidor: ${err.message}`);
});

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Servidor rodando em http://localhost:${PORT}`);
  console.log(`  Transmissor: http://localhost:${PORT}/broadcaster.html`);
  console.log(`  Bot AI:      http://localhost:${PORT}/bot.html`);
  console.log(`========================================\n`);
});
