/**
 * broadcaster.js - Lado do Transmissor
 */

const state = {
  socket: null,
  roomId: null,
  localStream: null,
  peerConnections: new Map(),
  viewers: new Set(),
  isStreaming: false
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const screens = {
  createRoom: document.getElementById('create-room-screen'),
  room: document.getElementById('room-screen'),
  ended: document.getElementById('ended-screen')
};

const elements = {
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnCopyCode: document.getElementById('btn-copy-code'),
  btnStartStream: document.getElementById('btn-start-stream'),
  btnStopStream: document.getElementById('btn-stop-stream'),
  btnNewRoom: document.getElementById('btn-new-room'),
  roomCode: document.getElementById('room-code'),
  roomCard: document.getElementById('room-card'),
  connectionStatus: document.getElementById('connection-status'),
  viewerCount: document.getElementById('viewer-count'),
  viewersPanel: document.getElementById('viewers-panel'),
  viewersList: document.getElementById('viewers-list'),
  noViewersMsg: document.getElementById('no-viewers-msg'),
  previewContainer: document.getElementById('preview-container'),
  previewVideo: document.getElementById('preview-video')
};

function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
}

function setStatus(status, text) {
  elements.connectionStatus.className = `status status-${status}`;
  elements.connectionStatus.textContent = text;
}

function renderViewers() {
  const count = state.viewers.size;
  elements.viewerCount.textContent = count;

  if (count === 0) {
    elements.noViewersMsg.classList.remove('hidden');
    elements.viewersList.innerHTML = '';
    return;
  }

  elements.noViewersMsg.classList.add('hidden');
  elements.viewersList.innerHTML = '';

  state.viewers.forEach(viewerId => {
    const li = document.createElement('li');
    li.className = 'viewer-item';
    li.dataset.viewerId = viewerId;

    const info = document.createElement('div');
    info.className = 'viewer-info';

    const idSpan = document.createElement('span');
    idSpan.className = 'viewer-id';
    idSpan.textContent = viewerId.substring(0, 8);

    const statusSpan = document.createElement('span');
    const pc = state.peerConnections.get(viewerId);
    statusSpan.className = `viewer-status viewer-${pc ? 'connected' : 'waiting'}`;
    statusSpan.textContent = pc ? 'Conectado' : 'Aguardando';

    info.appendChild(idSpan);
    info.appendChild(statusSpan);

    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn btn-small btn-remove';
    btnRemove.textContent = 'Remover';
    btnRemove.addEventListener('click', () => kickViewer(viewerId));

    li.appendChild(info);
    li.appendChild(btnRemove);
    elements.viewersList.appendChild(li);
  });
}

function addViewer(viewerId) {
  state.viewers.add(viewerId);
  renderViewers();
}

function removeViewer(viewerId) {
  state.viewers.delete(viewerId);
  removePeerConnection(viewerId);
  renderViewers();
}

async function kickViewer(viewerId) {
  if (!confirm(`Remover espectador ${viewerId.substring(0, 8)} da sala?`)) return;

  removePeerConnection(viewerId);
  state.viewers.delete(viewerId);
  renderViewers();

  state.socket.emit('kick-viewer', { viewerId });
  console.log(`[WS] Espectador removido: ${viewerId}`);
}

function connectWebSocket() {
  state.socket = io();

  state.socket.on('connect', () => {
    console.log('[WS] Conectado ao servidor');
    setStatus('connected', 'Conectado');
  });

  state.socket.on('disconnect', () => {
    console.log('[WS] Desconectado do servidor');
    setStatus('disconnected', 'Desconectado');
    stopStreaming();
  });

  state.socket.on('viewer-joined', async ({ viewerId }) => {
    console.log(`[WS] Espectador entrou: ${viewerId}`);
    addViewer(viewerId);

    if (state.isStreaming && state.localStream) {
      await createPeerConnection(viewerId);
      renderViewers();
    }
  });

  state.socket.on('viewer-joined-during-stream', async ({ viewerId }) => {
    console.log(`[WS] Espectador entrou durante stream ativa: ${viewerId}`);
    addViewer(viewerId);

    if (state.localStream) {
      await createPeerConnection(viewerId);
      renderViewers();
    }
  });

  state.socket.on('viewer-left', ({ viewerId }) => {
    console.log(`[WS] Espectador saiu: ${viewerId}`);
    removeViewer(viewerId);
  });

  state.socket.on('receive-answer', async ({ viewerId, answer }) => {
    console.log(`[WS] Answer recebida de: ${viewerId}`);
    const pc = state.peerConnections.get(viewerId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        renderViewers();
      } catch (err) {
        console.error(`[WebRTC] Erro ao definir remoteDescription:`, err);
      }
    }
  });

  state.socket.on('receive-ice-candidate', ({ senderId, candidate }) => {
    const pc = state.peerConnections.get(senderId);
    if (pc && candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
        console.error(`[WebRTC] Erro ao adicionar ICE candidate:`, err);
      });
    }
  });
}

async function createRoom() {
  state.socket.emit('create-room');

  state.socket.once('room-created', ({ roomId }) => {
    state.roomId = roomId;
    elements.roomCode.textContent = roomId;
    elements.roomCard.classList.remove('hidden');
    elements.viewersPanel.classList.remove('hidden');
    elements.btnStartStream.classList.remove('hidden');
    showScreen('room');
    setStatus('connected', 'Aguardando espectadores');
    renderViewers();
    console.log(`[Sala] Criada: ${roomId}`);
  });
}

async function startScreenCapture() {
  try {
    state.localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        displaySurface: 'monitor'
      },
      audio: true
    });

    elements.previewVideo.srcObject = state.localStream;
    elements.previewContainer.classList.remove('hidden');

    state.localStream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('[Tela] Compartilhamento encerrado pelo navegador');
      stopStreaming();
    });

    state.socket.emit('start-stream');
    state.isStreaming = true;

    elements.btnStartStream.classList.add('hidden');
    elements.btnStopStream.classList.remove('hidden');
    setStatus('streaming', 'Transmitindo');

    for (const viewerId of state.viewers) {
      await createPeerConnection(viewerId);
    }

    renderViewers();
    console.log('[Tela] Captura iniciada com sucesso');
  } catch (err) {
    console.error('[Tela] Erro ao capturar tela:', err);

    if (err.name === 'NotAllowedError') {
      alert('Permissão negada. Você precisa permitir o compartilhamento de tela.');
    } else if (err.name === 'NotFoundError') {
      alert('Nenhum dispositivo de captura encontrado.');
    } else {
      alert(`Erro ao capturar tela: ${err.message}`);
    }
  }
}

function stopStreaming() {
  for (const [viewerId, pc] of state.peerConnections) {
    pc.close();
  }
  state.peerConnections.clear();

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }

  elements.previewVideo.srcObject = null;
  elements.previewContainer.classList.add('hidden');
  elements.btnStartStream.classList.remove('hidden');
  elements.btnStopStream.classList.add('hidden');

  state.isStreaming = false;

  if (state.roomId) {
    state.socket.emit('stop-stream');
    setStatus('connected', 'Aguardando transmissão');
  }

  renderViewers();
  console.log('[Tela] Transmissão encerrada');
}

async function createPeerConnection(viewerId) {
  console.log(`[WebRTC] Criando peer connection para ${viewerId}`);

  if (state.peerConnections.has(viewerId)) {
    removePeerConnection(viewerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  state.localStream.getTracks().forEach(track => {
    pc.addTrack(track);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('send-ice-candidate', {
        targetId: viewerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Estado da conexão com ${viewerId}: ${pc.connectionState}`);

    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      console.warn(`[WebRTC] Conexão com ${viewerId} perdida`);
      removePeerConnection(viewerId);
      renderViewers();
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC] ICE state com ${viewerId}: ${pc.iceConnectionState}`);
  };

  state.peerConnections.set(viewerId, pc);

  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });

    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    state.socket.emit('send-offer', {
      targetViewerId: viewerId,
      offer: pc.localDescription
    });

    console.log(`[WebRTC] Offer enviada para ${viewerId}`);
  } catch (err) {
    console.error(`[WebRTC] Erro ao criar offer para ${viewerId}:`, err);
    removePeerConnection(viewerId);
    renderViewers();
  }
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

function removePeerConnection(viewerId) {
  const pc = state.peerConnections.get(viewerId);
  if (pc) {
    pc.close();
    state.peerConnections.delete(viewerId);
    console.log(`[WebRTC] Conexão removida: ${viewerId}`);
  }
}

elements.btnCreateRoom.addEventListener('click', createRoom);

elements.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomId).then(() => {
    elements.btnCopyCode.textContent = 'Copiado!';
    setTimeout(() => {
      elements.btnCopyCode.textContent = 'Copiar';
    }, 2000);
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = state.roomId;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    elements.btnCopyCode.textContent = 'Copiado!';
    setTimeout(() => {
      elements.btnCopyCode.textContent = 'Copiar';
    }, 2000);
  });
});

elements.btnStartStream.addEventListener('click', startScreenCapture);

elements.btnStopStream.addEventListener('click', () => {
  if (confirm('Encerrar o compartilhamento de tela?')) {
    stopStreaming();
  }
});

elements.btnNewRoom.addEventListener('click', () => {
  state.roomId = null;
  state.viewers.clear();
  state.peerConnections.clear();
  showScreen('createRoom');
  setStatus('connected', 'Conectado');
});

connectWebSocket();
showScreen('createRoom');
setStatus('connected', 'Conectado');
