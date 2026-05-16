# ScreenBOT

Aplicação de compartilhamento de tela em tempo real usando **WebRTC** e **WebSocket (Socket.IO)** com um **Bot de IA** que analisa a tela compartilhada e descreve o que ve.

## Funcionalidades

### Transmissor
- Criação de sala com código único de 8 caracteres
- Captura de tela com áudio via `getDisplayMedia()`
- Pré-visualização do conteúdo compartilhado
- Gerenciamento de espectadores em tempo real (lista com status)
- Remoção individual de espectadores da sala
- Botão de copiar código da sala

### Bot AI
- Entrada em sala via código
- Recepção do stream em tempo real via WebRTC
- Captura periódica de frames do vídeo
- Envio de frames para IA local via **Ollama** (modelo `qwen3.5:4b`)
- Descrições da tela em português exibidas em log com timestamp
- Controle de intervalo de análise (3s, 5s, 10s, 30s)
- Iniciar/parar análise sob demanda

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Servidor (Node.js)                │
│  Express + Socket.IO (WebSocket Signaling)           │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ Salas    │◄──►│ Signaling│◄──►│ Gerenciamento│   │
│  │ (Map)    │    │ WebRTC   │    │ de Espectadores│   │
│  └──────────┘    └──────────┘    └──────────────┘   │
└────────┬───────────────────────────────┬────────────┘
         │ WebSocket                     │ WebSocket
         ▼                               ▼
┌────────────────────┐        ┌──────────────────────┐        ┌──────────────┐
│  Transmissor       │        │  Bot AI              │        │   Ollama     │
│  (broadcaster)     │        │  (bot)               │        │   (local)    │
│                    │        │                      │        │              │
│  • getDisplayMedia │        │  • RTCPeerConnection │───────►│ qwen3.5:4b   │
│  • PeerConnection  │◄──────►│  • Captura frames    │  HTTP  │ (vision)     │
│  • 1:1 por viewer  │ WebRTC │  • Envia para Ollama │        │              │
└────────────────────┘        └──────────────────────┘        └──────────────┘
```

### Fluxo de conexão

1. **Transmissor** cria uma sala → servidor gera código baseado no socket ID
2. **Bot AI** entra com o código → servidor notifica o transmissor
3. **Transmissor** inicia captura de tela → cria `RTCPeerConnection` por espectador
4. **Signaling WebRTC** via WebSocket:
   - Transmissor envia `offer` → Bot recebe
   - Bot envia `answer` → Transmissor recebe
   - ICE candidates trocados bidirecionalmente
5. Stream de vídeo estabelecido diretamente (P2P via WebRTC)
6. **Bot** captura frames periodicamente e envia para Ollama
7. **Ollama** retorna descrição em português do que ve na tela

## Estrutura do Projeto

```
screen-share-webrtc/
├── client/
│   ├── broadcaster.html      # Interface do transmissor
│   ├── broadcaster.js        # Lógica do transmissor
│   ├── bot.html              # Interface do Bot AI
│   ├── bot.js                # Lógica do Bot AI + Ollama
│   └── styles.css            # Estilos globais
├── server/
│   ├── server.js             # Servidor Express + Socket.IO
│   └── package.json          # Dependências
└── README.md
```

## Tecnologias

| Camada        | Tecnologia                          |
|---------------|-------------------------------------|
| Backend       | Node.js, Express, Socket.IO         |
| Frontend      | HTML5, CSS3, JavaScript (vanilla)   |
| Streaming     | WebRTC (RTCPeerConnection)          |
| Captura       | Screen Capture API (getDisplayMedia)|
| IA Local      | Ollama (qwen3.5:4b)                 |
| STUN          | Google STUN servers                 |

## Pré-requisitos

- Node.js >= 18
- Navegador moderno com suporte a WebRTC (Chrome, Firefox, Edge, Safari)
- **Ollama** instalado e rodando localmente (`ollama serve`)
- Modelo `qwen3.5:4b` puxado no Ollama: `ollama pull qwen3.5:4b`

## Instalação e Execução

```bash
# Acesse a pasta do servidor
cd screen-share-webrtc/server

# Instale as dependências
npm install

# Inicie o servidor
npm start

# Ou em modo desenvolvimento (auto-reload)
npm run dev
```

O servidor será iniciado em `http://localhost:3003`.

## Acessando a Aplicação

| Página        | URL                                          |
|---------------|----------------------------------------------|
| Transmissor   | http://localhost:3000/broadcaster.html       |
| Bot AI        | http://localhost:3000/bot.html               |

### Passo a passo

1. Inicie o Ollama: `ollama serve` (em outro terminal)
2. Abra `broadcaster.html` e clique em **Criar Sala**
3. Copie o código da sala gerado
4. Abra `bot.html` em outra aba e insira o código
5. No transmissor, clique em **Iniciar Compartilhamento** e selecione a tela
6. No bot, clique em **Iniciar Analise** para começar a analisar a tela

## Eventos WebSocket

### Cliente → Servidor

| Evento              | Origem       | Descrição                              |
|---------------------|--------------|----------------------------------------|
| `create-room`       | Transmissor  | Cria uma nova sala                     |
| `join-room`         | Bot          | Entra em uma sala existente            |
| `start-stream`      | Transmissor  | Inicia a transmissão                   |
| `stop-stream`       | Transmissor  | Encerra a transmissão                  |
| `send-offer`        | Transmissor  | Envia offer WebRTC para espectador     |
| `send-answer`       | Bot          | Envia answer WebRTC para transmissor   |
| `send-ice-candidate`| Ambos        | Envia ICE candidate                    |
| `kick-viewer`       | Transmissor  | Remove espectador da sala              |

### Servidor → Cliente

| Evento                      | Destino      | Descrição                              |
|-----------------------------|--------------|----------------------------------------|
| `room-created`              | Transmissor  | Confirmação de sala criada             |
| `room-joined`               | Bot          | Confirmação de entrada na sala         |
| `viewer-joined`             | Transmissor  | Novo espectador entrou                 |
| `viewer-joined-during-stream`| Transmissor | Espectador entrou com stream ativo     |
| `viewer-left`               | Transmissor  | Espectador saiu da sala                |
| `stream-started`            | Bot          | Transmissão iniciada                   |
| `stream-ended`              | Bot          | Transmissão encerrada                  |
| `stream-already-active`     | Bot          | Stream já ativo ao entrar              |
| `broadcaster-left`          | Bot          | Transmissor desconectou                |
| `kicked`                    | Bot          | Removido pelo transmissor              |
| `receive-offer`             | Bot          | Recebe offer WebRTC                    |
| `receive-answer`            | Transmissor  | Recebe answer WebRTC                   |
| `receive-ice-candidate`     | Ambos        | Recebe ICE candidate                   |

## Notas

- Cada espectador tem sua própria `RTCPeerConnection` (modelo 1:N)
- ICE gathering usa timeout de 5s como fallback
- Servidores STUN do Google são usados para NAT traversal
- Para produção, considere adicionar servidores TURN para redes restritas
- O código da sala é derivado dos primeiros 8 caracteres do socket ID do transmissor
- O Bot captura frames em JPEG com qualidade 0.7 para otimizar o envio ao Ollama
- O modelo `qwen3.5:4b` suporta visão e roda localmente via Ollama
