/**
 * bot.js - AI Bot com suporte a multiplos provedores
 */

const providerPresets = {
  ollama: {
    url: 'http://localhost:11434',
    model: 'qwen3.5:4b',
    requiresApiKey: false
  },
  lmstudio: {
    url: 'http://localhost:1234',
    model: 'local-model',
    requiresApiKey: false
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o',
    requiresApiKey: true
  },
  api: {
    url: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    requiresApiKey: true
  }
};

const state = {
  socket: null,
  roomId: null,
  broadcasterId: null,
  peerConnection: null,
  remoteStream: null,
  isWatching: false,
  isAnalyzing: false,
  analysisInterval: null,
  analysisIntervalMs: 5000,
  frameCount: 0,
  aiProvider: 'ollama',
  aiUrl: 'http://localhost:11434',
  aiModel: 'qwen3.5:4b',
  aiApiKey: '',
  disableThinking: false
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const screens = {
  join: document.getElementById('join-screen'),
  room: document.getElementById('room-screen'),
  error: document.getElementById('error-screen')
};

const elements = {
  roomCodeInput: document.getElementById('room-code-input'),
  btnJoinRoom: document.getElementById('btn-join-room'),
  btnLeave: document.getElementById('btn-leave'),
  btnBack: document.getElementById('btn-back'),
  btnExit: document.getElementById('btn-exit'),
  btnToggleAnalysis: document.getElementById('btn-toggle-analysis'),
  intervalSelect: document.getElementById('interval-select'),
  roomCode: document.getElementById('room-code'),
  roomCodeBadge: document.getElementById('room-code-badge'),
  connectionStatus: document.getElementById('connection-status'),
  joinError: document.getElementById('join-error'),
  waitingMessage: document.getElementById('waiting-message'),
  streamContainer: document.getElementById('stream-container'),
  streamVideo: document.getElementById('stream-video'),
  captureCanvas: document.getElementById('capture-canvas'),
  botPanel: document.getElementById('bot-panel'),
  analysisStatus: document.getElementById('analysis-status'),
  frameCount: document.getElementById('frame-count'),
  aiProviderBadge: document.getElementById('ai-provider-badge'),
  descriptionLog: document.getElementById('description-log'),
  logEntries: document.getElementById('log-entries'),
  endedMessage: document.getElementById('ended-message'),
  aiProvider: document.getElementById('ai-provider'),
  aiUrl: document.getElementById('ai-url'),
  aiModel: document.getElementById('ai-model'),
  aiApiKey: document.getElementById('ai-apikey'),
  apiKeyGroup: document.getElementById('api-key-group'),
  disableThinking: document.getElementById('disable-thinking')
};

function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
}

function setStatus(status, text) {
  elements.connectionStatus.className = `status status-${status}`;
  elements.connectionStatus.textContent = text;
}

function showWaiting() {
  elements.waitingMessage.classList.remove('hidden');
  elements.streamContainer.classList.add('hidden');
  elements.botPanel.classList.add('hidden');
  elements.endedMessage.classList.add('hidden');
  elements.btnExit.classList.add('hidden');
  elements.roomCodeBadge.classList.remove('hidden');
}

function showStream() {
  elements.waitingMessage.classList.add('hidden');
  elements.streamContainer.classList.remove('hidden');
  elements.botPanel.classList.remove('hidden');
  elements.endedMessage.classList.add('hidden');
  elements.btnExit.classList.remove('hidden');
  elements.roomCodeBadge.classList.remove('hidden');
}

function showEnded() {
  stopAnalysis();
  elements.waitingMessage.classList.add('hidden');
  elements.streamContainer.classList.add('hidden');
  elements.botPanel.classList.add('hidden');
  elements.endedMessage.classList.remove('hidden');
  elements.btnExit.classList.add('hidden');
  elements.roomCodeBadge.classList.remove('hidden');
}

function connectWebSocket() {
  state.socket = io();

  state.socket.on('connect', () => {
    console.log('[WS] Conectado ao servidor');
    if (state.roomId) {
      setStatus('connected', 'Conectado');
    }
  });

  state.socket.on('disconnect', () => {
    console.log('[WS] Desconectado do servidor');
    setStatus('disconnected', 'Desconectado');
    closePeerConnection();
  });

  state.socket.on('stream-started', () => {
    console.log('[WS] Transmissao iniciada');
    setStatus('watching', 'Conectando ao stream...');
  });

  state.socket.on('stream-ended', () => {
    console.log('[WS] Transmissao encerrada');
    closePeerConnection();
    state.isWatching = false;
    showEnded();
    setStatus('waiting', 'Transmissao encerrada');
  });

  state.socket.on('broadcaster-left', () => {
    console.log('[WS] Transmissor saiu da sala');
    closePeerConnection();
    state.isWatching = false;
    showScreen('error');
    setStatus('disconnected', 'Transmissor desconectado');
  });

  state.socket.on('kicked', () => {
    console.log('[WS] Voce foi removido da sala');
    closePeerConnection();
    state.isWatching = false;
    showScreen('error');
    setStatus('disconnected', 'Voce foi removido da sala');
  });

  state.socket.on('stream-already-active', () => {
    console.log('[WS] Transmissao ja esta ativa - aguardando offer...');
    setStatus('watching', 'Conectando ao stream...');
  });

  state.socket.on('receive-offer', async ({ broadcasterId, offer }) => {
    console.log(`[WS] Offer recebido de: ${broadcasterId}`);
    state.broadcasterId = broadcasterId;

    try {
      await handleOffer(offer);
    } catch (err) {
      console.error('[WebRTC] Erro ao processar offer:', err);
      setStatus('disconnected', 'Erro na conexao');
    }
  });

  state.socket.on('receive-ice-candidate', async ({ senderId, candidate }) => {
    if (state.peerConnection && candidate) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Erro ao adicionar ICE candidate:', err);
      }
    }
  });
}

function joinRoom() {
  const roomId = elements.roomCodeInput.value.trim();

  if (!roomId) {
    showJoinError('Insira o codigo da sala');
    return;
  }

  hideJoinError();
  state.roomId = roomId;

  state.socket.emit('join-room', { roomId });

  state.socket.once('room-joined', ({ roomId }) => {
    console.log(`[Sala] Entrou na sala: ${roomId}`);
    elements.roomCode.textContent = roomId;
    showScreen('room');
    showWaiting();
    setStatus('waiting', 'Aguardando transmissao');
  });

  state.socket.once('error', ({ message }) => {
    showJoinError(message);
    state.roomId = null;
  });
}

function showJoinError(message) {
  elements.joinError.textContent = message;
  elements.joinError.classList.remove('hidden');
}

function hideJoinError() {
  elements.joinError.classList.add('hidden');
}

async function handleOffer(offer) {
  closePeerConnection();

  state.peerConnection = new RTCPeerConnection(rtcConfig);

  state.peerConnection.ontrack = (event) => {
    console.log(`[WebRTC] Track recebido: ${event.track.kind}`);

    if (!state.remoteStream) {
      state.remoteStream = new MediaStream();
    }

    state.remoteStream.addTrack(event.track);
    elements.streamVideo.srcObject = state.remoteStream;
    showStream();
    state.isWatching = true;
    setStatus('watching', 'Analisando tela');
  };

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('send-ice-candidate', {
        targetId: state.broadcasterId,
        candidate: event.candidate
      });
    }
  };

  state.peerConnection.onconnectionstatechange = () => {
    console.log(`[WebRTC] Estado da conexao: ${state.peerConnection.connectionState}`);

    if (state.peerConnection.connectionState === 'connected') {
      setStatus('watching', 'Analisando tela');
    } else if (state.peerConnection.connectionState === 'disconnected') {
      setStatus('waiting', 'Reconectando...');
    } else if (state.peerConnection.connectionState === 'failed') {
      console.error('[WebRTC] Falha na conexao');
      setStatus('disconnected', 'Falha na conexao');
    }
  };

  await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);

  await waitForIceGathering(state.peerConnection);

  state.socket.emit('send-answer', {
    targetBroadcasterId: state.broadcasterId,
    answer: state.peerConnection.localDescription
  });

  console.log('[WebRTC] Answer enviada');
}

function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    };

    pc.addEventListener('icegatheringstatechange', checkState);

    setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    }, 5000);
  });
}

function closePeerConnection() {
  stopAnalysis();

  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
    console.log('[WebRTC] Conexao encerrada');
  }

  if (state.remoteStream) {
    state.remoteStream.getTracks().forEach(track => track.stop());
    state.remoteStream = null;
  }

  elements.streamVideo.srcObject = null;
}

function captureFrame() {
  const video = elements.streamVideo;

  if (!video || video.readyState < 2) {
    console.warn('[Bot] Video nao pronto para captura');
    return null;
  }

  const canvas = elements.captureCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', 0.7);
}

async function analyzeFrameWithOllama(imageBase64) {
  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'ollama',
      targetUrl: state.aiUrl,
      model: state.aiModel,
      apiKey: '',
      imageBase64,
      prompt: 'Descreva em portugues o que voce ve nesta tela. Seja conciso e objetivo, focando nos elementos principais visiveis.',
      disableThinking: state.disableThinking
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errData.error || `Server error: ${response.status}`);
  }

  const data = await response.json();
  return data.response;
}

async function analyzeFrameWithOpenAICompatible(imageBase64) {
  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: state.aiProvider,
      targetUrl: state.aiUrl,
      model: state.aiModel,
      apiKey: state.aiApiKey,
      imageBase64,
      prompt: 'Descreva em portugues o que voce ve nesta tela. Seja conciso e objetivo, focando nos elementos principais visiveis.',
      disableThinking: state.disableThinking
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errData.error || `Server error: ${response.status}`);
  }

  const data = await response.json();
  return data.response;
}

async function analyzeFrame(imageBase64) {
  if (state.aiProvider === 'ollama') {
    return analyzeFrameWithOllama(imageBase64);
  }

  return analyzeFrameWithOpenAICompatible(imageBase64);
}

function addLogEntry(description) {
  const placeholder = elements.logEntries.querySelector('.log-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  state.frameCount++;
  elements.frameCount.textContent = `${state.frameCount} analises`;

  const timestamp = new Date().toLocaleTimeString('pt-BR');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${timestamp}</span>
    <p class="log-text">${description}</p>
  `;

  elements.logEntries.insertBefore(entry, elements.logEntries.firstChild);
}

async function runAnalysis() {
  if (!state.isAnalyzing) return;

  elements.analysisStatus.className = 'analysis-status analyzing';
  elements.analysisStatus.textContent = 'Analisando...';

  try {
    const frame = captureFrame();

    if (!frame) {
      console.warn('[Bot] Falha ao capturar frame');
      elements.analysisStatus.className = 'analysis-status idle';
      elements.analysisStatus.textContent = 'Falha na captura';
      return;
    }

    const description = await analyzeFrame(frame);
    addLogEntry(description);

    elements.analysisStatus.className = 'analysis-status idle';
    elements.analysisStatus.textContent = 'Aguardando';
  } catch (err) {
    console.error('[Bot] Erro na analise:', err);
    elements.analysisStatus.className = 'analysis-status error';
    elements.analysisStatus.textContent = `Erro: ${err.message}`;
  }
}

function startAnalysis() {
  if (state.isAnalyzing) return;

  state.isAnalyzing = true;
  state.analysisIntervalMs = parseInt(elements.intervalSelect.value);

  elements.btnToggleAnalysis.textContent = 'Parar Analise';
  elements.btnToggleAnalysis.className = 'btn btn-danger';
  elements.intervalSelect.disabled = true;

  runAnalysis();
  state.analysisInterval = setInterval(runAnalysis, state.analysisIntervalMs);
}

function stopAnalysis() {
  state.isAnalyzing = false;

  if (state.analysisInterval) {
    clearInterval(state.analysisInterval);
    state.analysisInterval = null;
  }

  elements.btnToggleAnalysis.textContent = 'Iniciar Analise';
  elements.btnToggleAnalysis.className = 'btn btn-success';
  elements.intervalSelect.disabled = false;
  elements.analysisStatus.className = 'analysis-status idle';
  elements.analysisStatus.textContent = 'Aguardando';
}

function updateAiProviderFields() {
  const provider = elements.aiProvider.value;
  const preset = providerPresets[provider];

  state.aiProvider = provider;
  state.aiUrl = preset.url;
  state.aiModel = preset.model;

  elements.aiUrl.value = preset.url;
  elements.aiModel.value = preset.model;

  if (preset.requiresApiKey) {
    elements.apiKeyGroup.classList.remove('hidden');
  } else {
    elements.apiKeyGroup.classList.add('hidden');
    elements.aiApiKey.value = '';
  }
}

function readAiConfig() {
  state.aiProvider = elements.aiProvider.value;
  state.aiUrl = elements.aiUrl.value.trim();
  state.aiModel = elements.aiModel.value.trim();
  state.aiApiKey = elements.aiApiKey.value.trim();
  state.disableThinking = elements.disableThinking.checked;

  if (!state.aiUrl) {
    throw new Error('URL da IA e obrigatoria');
  }
  if (!state.aiModel) {
    throw new Error('Modelo da IA e obrigatorio');
  }
  if (providerPresets[state.aiProvider].requiresApiKey && !state.aiApiKey) {
    throw new Error('API Key e obrigatoria para este provedor');
  }
}

elements.btnJoinRoom.addEventListener('click', () => {
  try {
    readAiConfig();
  } catch (err) {
    showJoinError(err.message);
    return;
  }
  joinRoom();
});

elements.roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    try {
      readAiConfig();
    } catch (err) {
      showJoinError(err.message);
      return;
    }
    joinRoom();
  }
});

elements.btnLeave.addEventListener('click', () => {
  closePeerConnection();
  state.roomId = null;
  state.broadcasterId = null;
  state.isWatching = false;
  state.frameCount = 0;
  elements.frameCount.textContent = '0 analises';
  elements.logEntries.innerHTML = '<p class="log-placeholder">As descricoes da IA aparecerao aqui...</p>';
  showScreen('join');
  setStatus('disconnected', 'Desconectado');
  elements.roomCodeInput.value = '';
  elements.roomCodeBadge.classList.add('hidden');
});

elements.btnBack.addEventListener('click', () => {
  closePeerConnection();
  state.roomId = null;
  state.broadcasterId = null;
  state.isWatching = false;
  state.frameCount = 0;
  elements.frameCount.textContent = '0 analises';
  elements.logEntries.innerHTML = '<p class="log-placeholder">As descricoes da IA aparecerao aqui...</p>';
  showScreen('join');
  setStatus('disconnected', 'Desconectado');
  elements.roomCodeInput.value = '';
  elements.roomCodeBadge.classList.add('hidden');
});

elements.btnExit.addEventListener('click', () => {
  closePeerConnection();
  state.roomId = null;
  state.broadcasterId = null;
  state.isWatching = false;
  state.frameCount = 0;
  elements.frameCount.textContent = '0 analises';
  elements.logEntries.innerHTML = '<p class="log-placeholder">As descricoes da IA aparecerao aqui...</p>';
  showScreen('join');
  setStatus('disconnected', 'Desconectado');
  elements.roomCodeInput.value = '';
  elements.roomCodeBadge.classList.add('hidden');
});

elements.btnToggleAnalysis.addEventListener('click', () => {
  if (state.isAnalyzing) {
    stopAnalysis();
  } else {
    startAnalysis();
  }
});

elements.intervalSelect.addEventListener('change', () => {
  if (state.isAnalyzing) {
    stopAnalysis();
    startAnalysis();
  }
});

elements.aiProvider.addEventListener('change', updateAiProviderFields);

updateAiProviderFields();

connectWebSocket();
showScreen('join');
setStatus('disconnected', 'Desconectado');
