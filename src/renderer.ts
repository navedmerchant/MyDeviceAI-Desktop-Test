/**
 * Test app renderer for the P2PCF prompt/token protocol.
 *
 * This runs in "MyDeviceAI-Desktop-Test" and acts as a remote peer that:
 * - Joins a P2PCF room.
 * - Exchanges hello and negotiates protocol version compatibility.
 * - Sends { t: "prompt", id, messages: [{role, content}], max_tokens? } in OpenAI format.
 * - Requests model info via { t: "get_model" }.
 * - Displays streamed { t: "start" | "token" | "reasoning_token" | "end" | "error" } responses.
 *
 * Protocol Flow:
 * 1. Connection: Both sides exchange "hello" messages
 * 2. Version Negotiation: Client sends "version_negotiate", server responds with "version_ack"
 * 3. Model Info: Client can request "get_model", server responds with "model_info"
 * 4. Prompts: Client sends "prompt" with OpenAI-compatible messages array
 * 5. Streaming: Server streams "start", "token"/"reasoning_token", and "end"/"error"
 *
 * Assumptions:
 * - Both apps use the same room ID convention (e.g. "room-XXXX").
 * - The main MyDeviceAI-Desktop app is already running and connected to the same room.
 * - Protocol version 1.0.0 or compatible is supported by both sides.
 */

import './index.css';
import { P2PCF } from './p2pcf/P2PCF';

const LOG_PREFIX = '[TestApp]';
const DEFAULT_ROOM_ID = 'CY5WRMY76';
const PROTOCOL_VERSION = '1.0.0';
const MIN_COMPATIBLE_VERSION = '1.0.0';

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OutgoingMessage =
  | {
      t: 'hello';
      clientId: string;
      impl: string;
      version: string;
    }
  | {
      t: 'version_negotiate';
      protocolVersion: string;
      minCompatibleVersion: string;
    }
  | {
      t: 'prompt';
      id: string;
      messages: Message[];
      max_tokens?: number;
    }
  | {
      t: 'get_model';
    };

type IncomingMessage =
  | { t: 'hello'; clientId?: string; impl?: string; version?: string }
  | { t: 'version_ack'; compatible: boolean; protocolVersion: string; reason?: string }
  | { t: 'model_info'; id: string; displayName: string; installed: boolean }
  | { t: 'start'; id: string }
  | { t: 'token'; id: string; tok: string }
  | { t: 'reasoning_token'; id: string; tok: string }
  | { t: 'end'; id: string }
  | { t: 'error'; id: string; message: string }
  | { t: string; [k: string]: any };

function log(message: string, extra?: Record<string, unknown>): void {
  if (extra) {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} ${message}`, extra);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function logError(
  message: string,
  error?: unknown,
  extra?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.error(`${LOG_PREFIX} ${message}`, {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    ...extra,
  });
}

// Basic DOM
function setupUI() {
  document.body.innerHTML = '';

  const root = document.createElement('div');
  root.style.fontFamily =
    'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  root.style.padding = '16px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';

  const title = document.createElement('h1');
  title.textContent = 'MyDeviceAI P2PCF Protocol Test Client';

  const roomRow = document.createElement('div');
  roomRow.style.display = 'flex';
  roomRow.style.gap = '8px';
  roomRow.style.alignItems = 'center';

  const roomLabel = document.createElement('label');
  roomLabel.textContent = 'Room ID:';

  const roomInput = document.createElement('input');
  roomInput.type = 'text';
  roomInput.value = DEFAULT_ROOM_ID;
  roomInput.style.flex = '1';
  roomInput.id = 'room-input';

  const connectBtn = document.createElement('button');
  connectBtn.textContent = 'Connect';
  connectBtn.id = 'connect-btn';

  roomRow.appendChild(roomLabel);
  roomRow.appendChild(roomInput);
  roomRow.appendChild(connectBtn);

  const modelStatus = document.createElement('div');
  modelStatus.id = 'model-status';
  modelStatus.style.fontSize = '13px';
  modelStatus.style.color = '#374151';
  modelStatus.style.fontWeight = '500';
  modelStatus.textContent = 'Model: (waiting for info...)';

  const systemPromptLabel = document.createElement('div');
  systemPromptLabel.textContent = 'System prompt (optional):';
  systemPromptLabel.style.marginTop = '8px';

  const systemPromptInput = document.createElement('textarea');
  systemPromptInput.id = 'system-prompt-input';
  systemPromptInput.rows = 2;
  systemPromptInput.style.width = '100%';
  systemPromptInput.placeholder = 'You are a helpful assistant...';
  systemPromptInput.value = 'You are a helpful assistant.';

  const userPromptLabel = document.createElement('div');
  userPromptLabel.textContent =
    'User message (will be sent as OpenAI-compatible messages array):';

  const userPromptInput = document.createElement('textarea');
  userPromptInput.id = 'user-prompt-input';
  userPromptInput.rows = 4;
  userPromptInput.style.width = '100%';
  userPromptInput.placeholder = 'Ask something...';

  const controlsRow = document.createElement('div');
  controlsRow.style.display = 'flex';
  controlsRow.style.gap = '8px';
  controlsRow.style.alignItems = 'center';

  const maxTokensInput = document.createElement('input');
  maxTokensInput.type = 'number';
  maxTokensInput.min = '1';
  maxTokensInput.value = '256';
  maxTokensInput.style.width = '100px';
  maxTokensInput.id = 'max-tokens-input';

  const maxTokensLabel = document.createElement('label');
  maxTokensLabel.textContent = 'max_tokens:';
  maxTokensLabel.htmlFor = maxTokensInput.id;

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send Prompt';
  sendBtn.id = 'send-btn';
  sendBtn.disabled = true;

  const getModelBtn = document.createElement('button');
  getModelBtn.textContent = 'Get Model Info';
  getModelBtn.id = 'get-model-btn';
  getModelBtn.disabled = true;

  controlsRow.appendChild(maxTokensLabel);
  controlsRow.appendChild(maxTokensInput);
  controlsRow.appendChild(sendBtn);
  controlsRow.appendChild(getModelBtn);

  const status = document.createElement('div');
  status.id = 'status';
  status.style.fontSize = '12px';
  status.style.color = '#666';
  status.textContent = 'Disconnected. Enter room ID and click Connect.';

  const logView = document.createElement('pre');
  logView.id = 'log-view';
  logView.style.height = '260px';
  logView.style.overflow = 'auto';
  logView.style.padding = '8px';
  logView.style.border = '1px solid #e5e7eb';
  logView.style.borderRadius = '4px';
  logView.style.background = '#f9fafb';
  logView.style.whiteSpace = 'pre-wrap';

  const resultLabel = document.createElement('div');
  resultLabel.textContent = 'Latest streamed completion (assistant-visible):';

  const resultView = document.createElement('pre');
  resultView.id = 'result-view';
  resultView.style.height = '120px';
  resultView.style.overflow = 'auto';
  resultView.style.padding = '8px';
  resultView.style.border = '1px solid #e5e7eb';
  resultView.style.borderRadius = '4px';
  resultView.style.background = '#fefce8';
  resultView.style.whiteSpace = 'pre-wrap';

  const reasoningLabel = document.createElement('div');
  reasoningLabel.textContent = 'Latest streamed reasoning (hidden / internal):';

  const reasoningView = document.createElement('pre');
  reasoningView.id = 'reasoning-view';
  reasoningView.style.height = '80px';
  reasoningView.style.overflow = 'auto';
  reasoningView.style.padding = '8px';
  reasoningView.style.border = '1px solid #fee2e2';
  reasoningView.style.borderRadius = '4px';
  reasoningView.style.background = '#fff7ed';
  reasoningView.style.whiteSpace = 'pre-wrap';
  reasoningView.style.fontSize = '11px';
  reasoningView.style.color = '#9f1239';

  root.appendChild(title);
  root.appendChild(roomRow);
  root.appendChild(modelStatus);
  root.appendChild(systemPromptLabel);
  root.appendChild(systemPromptInput);
  root.appendChild(userPromptLabel);
  root.appendChild(userPromptInput);
  root.appendChild(controlsRow);
  root.appendChild(status);
  root.appendChild(logView);
  root.appendChild(resultLabel);
  root.appendChild(resultView);
  root.appendChild(reasoningLabel);
  root.appendChild(reasoningView);

  document.body.appendChild(root);
}

function appendLog(line: string) {
  const el = document.getElementById('log-view') as HTMLPreElement | null;
  if (!el) return;
  const ts = new Date().toISOString().split('T')[1]?.replace('Z', '') ?? '';
  el.textContent += `[${ts}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(text: string, isError = false) {
  const el = document.getElementById('status') as HTMLDivElement | null;
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#b91c1c' : '#666';
}

function setResult(text: string) {
  const el = document.getElementById('result-view') as HTMLPreElement | null;
  if (!el) return;
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
}

function setReasoning(text: string) {
  const el = document.getElementById('reasoning-view') as HTMLPreElement | null;
  if (!el) return;
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
}

let p2pcf: any | null = null;
let currentPeer: any | null = null;
let currentPromptId: string | null = null;
let currentBuffer = '';
let currentReasoningBuffer = '';
let isVersionNegotiated = false;
let isCompatible = false;
let currentModelInfo: { id: string; displayName: string; installed: boolean } | null = null;

function createClient(roomId: string) {
  const clientId = 'test-client';
  appendLog(`Creating P2PCF client for room "${roomId}"`);
  log('Creating P2PCF client', { clientId, roomId });

  const instance = new P2PCF(clientId, roomId, {
    isDesktop: false,
    workerUrl: 'https://p2pcf.naved-merchant.workers.dev'
  });

  instance.on('peerconnect', (peer: any) => {
    currentPeer = peer;
    isVersionNegotiated = false;
    isCompatible = false;
    appendLog(
      `Peer connected: id=${peer?.id} client_id=${peer?.client_id ?? 'n/a'}`,
    );
    setStatus('Connected to peer. Negotiating protocol version...');
    log('Peer connected', {
      id: peer?.id,
      client_id: peer?.client_id,
    });

    // Send hello message followed by version negotiation
    try {
      const hello: OutgoingMessage = {
        t: 'hello',
        clientId,
        impl: 'mydeviceai-desktop-test',
        version: '1.0.0',
      };
      instance.send(peer, JSON.stringify(hello));
      appendLog('Sent hello message to peer');

      // Immediately send version negotiation
      const versionNegotiate: OutgoingMessage = {
        t: 'version_negotiate',
        protocolVersion: PROTOCOL_VERSION,
        minCompatibleVersion: MIN_COMPATIBLE_VERSION,
      };
      instance.send(peer, JSON.stringify(versionNegotiate));
      appendLog(`Sent version_negotiate: protocol=${PROTOCOL_VERSION}, minCompat=${MIN_COMPATIBLE_VERSION}`);
    } catch (err) {
      logError('Failed to send hello/version_negotiate', err as Error);
      setStatus('Failed to negotiate protocol version', true);
    }
  });

  instance.on('peerclose', (peer: any) => {
    appendLog(
      `Peer disconnected: id=${peer?.id} client_id=${peer?.client_id ?? 'n/a'}`,
    );
    setStatus('Peer disconnected. You may reconnect or wait for peer.');
    if (currentPeer === peer) {
      currentPeer = null;
      isVersionNegotiated = false;
      isCompatible = false;
      currentModelInfo = null;
    }
  });

  instance.on('msg', (_peer: any, data: any) => {
    // Expect JSON messages from the main app following our protocol.
    try {
      const asString =
        typeof data === 'string'
          ? data
          : data instanceof ArrayBuffer
          ? new TextDecoder().decode(new Uint8Array(data))
          : ArrayBuffer.isView(data)
          ? new TextDecoder().decode(
              data.buffer instanceof ArrayBuffer
                ? new Uint8Array(data.buffer)
                : new Uint8Array(data as any),
            )
          : null;

      if (!asString) {
        appendLog(`Received unsupported payload type: ${typeof data}`);
        return;
      }

      let msg: IncomingMessage;
      try {
        msg = JSON.parse(asString);
      } catch (err) {
        appendLog(`Non-JSON message from peer: ${asString.slice(0, 256)}`);
        return;
      }

      if (!msg || typeof msg.t !== 'string') {
        appendLog(`Invalid JSON message missing "t": ${asString.slice(0, 256)}`);
        return;
      }

      handleIncoming(msg);
    } catch (err) {
      logError('Error handling incoming P2PCF msg', err as Error);
      appendLog(`Error handling incoming message: ${(err as Error).message}`);
    }
  });

  instance.start();
  setStatus('Connecting (polling for peers)...');
  appendLog('Started P2PCF client (polling)');

  return instance;
}

function handleIncoming(msg: IncomingMessage) {
  switch (msg.t) {
    case 'hello':
      appendLog(
        `Received hello: impl=${msg.impl ?? ''} version=${msg.version ?? ''}`,
      );
      break;

    case 'version_ack':
      isVersionNegotiated = true;
      isCompatible = msg.compatible;
      if (msg.compatible) {
        appendLog(
          `Version negotiation successful: server protocol=${msg.protocolVersion}`,
        );
        setStatus('Connected and ready. Protocol version compatible.');

        // Request model info after successful version negotiation
        if (p2pcf && currentPeer) {
          try {
            const getModel: OutgoingMessage = { t: 'get_model' };
            p2pcf.send(currentPeer, JSON.stringify(getModel));
            appendLog('Requested model info from server');
          } catch (err) {
            logError('Failed to request model info', err as Error);
          }
        }
      } else {
        appendLog(
          `Version negotiation failed: ${msg.reason || 'incompatible versions'}`,
        );
        setStatus(
          `Protocol version incompatible: ${msg.reason || 'server version mismatch'}`,
          true,
        );
      }
      break;

    case 'model_info':
      currentModelInfo = {
        id: msg.id,
        displayName: msg.displayName,
        installed: msg.installed,
      };
      appendLog(
        `Received model info: ${msg.displayName} (id=${msg.id}, installed=${msg.installed})`,
      );
      const modelStatus = document.getElementById('model-status');
      if (modelStatus) {
        modelStatus.textContent = `Model: ${msg.displayName} (${msg.installed ? 'installed' : 'not installed'})`;
      }
      break;

    case 'start':
      if (!msg.id) {
        appendLog('Received start without id (ignored)');
        return;
      }
      currentPromptId = msg.id;
      currentBuffer = '';
      currentReasoningBuffer = '';
      appendLog(`Received start for id=${msg.id}`);
      setResult('');
      setReasoning('');
      break;

    case 'token':
      if (!msg.id || msg.id !== currentPromptId) {
        appendLog(
          `Received token for unknown/mismatched id=${msg.id} (current=${currentPromptId})`,
        );
        return;
      }
      if (typeof msg.tok === 'string') {
        currentBuffer += msg.tok;
        setResult(currentBuffer);
      }
      break;

    case 'reasoning_token':
      if (!msg.id || msg.id !== currentPromptId) {
        appendLog(
          `Received reasoning_token for unknown/mismatched id=${msg.id} (current=${currentPromptId})`,
        );
        return;
      }
      if (typeof msg.tok === 'string') {
        currentReasoningBuffer += msg.tok;
        setReasoning(currentReasoningBuffer);
      }
      break;

    case 'end':
      if (!msg.id || msg.id !== currentPromptId) {
        appendLog(
          `Received end for unknown/mismatched id=${msg.id} (current=${currentPromptId})`,
        );
        return;
      }
      appendLog(`Received end for id=${msg.id}`);
      setStatus('Completion finished successfully.');
      currentPromptId = null;
      break;

    case 'error':
      if (!msg.id || (currentPromptId && msg.id !== currentPromptId)) {
        appendLog(
          `Received error for id=${msg.id} (current=${currentPromptId || 'n/a'})`,
        );
      } else {
        appendLog(
          `Received error for id=${msg.id}: ${msg.message || 'Unknown error'}`,
        );
      }
      setStatus(`Error from server: ${msg.message || 'Unknown error'}`, true);
      currentPromptId = null;
      break;

    default:
      appendLog(`Ignoring unknown message type "${msg.t}"`);
      break;
  }
}

function sendPrompt() {
  if (!p2pcf || !currentPeer) {
    appendLog('Cannot send: no connected peer');
    setStatus('Cannot send prompt: not connected to any peer.', true);
    return;
  }

  if (!isVersionNegotiated) {
    appendLog('Cannot send: version not negotiated yet');
    setStatus('Waiting for protocol version negotiation...', true);
    return;
  }

  if (!isCompatible) {
    appendLog('Cannot send: protocol version incompatible');
    setStatus('Cannot send: protocol version incompatible with server', true);
    return;
  }

  const systemPromptEl = document.getElementById(
    'system-prompt-input',
  ) as HTMLTextAreaElement | null;
  const userPromptEl = document.getElementById(
    'user-prompt-input',
  ) as HTMLTextAreaElement | null;
  const maxTokensEl = document.getElementById(
    'max-tokens-input',
  ) as HTMLInputElement | null;

  if (!systemPromptEl || !userPromptEl || !maxTokensEl) {
    appendLog('Required input elements missing from DOM');
    return;
  }

  const systemPrompt = systemPromptEl.value.trim();
  const userPrompt = userPromptEl.value.trim();
  const maxTokens = Number(maxTokensEl.value) || undefined;

  if (!userPrompt) {
    setStatus('Enter a user message before sending.', true);
    return;
  }

  const id = `test-${Date.now().toString(36)}`;

  // Build messages array in OpenAI format
  const messages: Message[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });

  const msg: OutgoingMessage = {
    t: 'prompt',
    id,
    messages,
  };

  if (maxTokens && maxTokens > 0) {
    msg.max_tokens = maxTokens;
  }

  try {
    const serialized = JSON.stringify(msg);
    p2pcf.send(currentPeer, serialized);
    appendLog(
      `Sent prompt id=${id}, messages=${messages.length}, max_tokens=${msg.max_tokens ?? 'default'}`,
    );
    setStatus('Prompt sent. Waiting for streamed tokens...');
    currentPromptId = id;
    currentBuffer = '';
    currentReasoningBuffer = '';
    setResult('');
    setReasoning('');
  } catch (err) {
    logError('Failed to send prompt over P2PCF', err as Error, { id });
    setStatus('Failed to send prompt over P2PCF.', true);
  }
}

function getModelInfo() {
  if (!p2pcf || !currentPeer) {
    appendLog('Cannot get model info: no connected peer');
    setStatus('Cannot get model info: not connected to any peer.', true);
    return;
  }

  if (!isVersionNegotiated || !isCompatible) {
    appendLog('Cannot get model info: version not negotiated or incompatible');
    setStatus('Waiting for protocol version negotiation...', true);
    return;
  }

  try {
    const getModel: OutgoingMessage = { t: 'get_model' };
    p2pcf.send(currentPeer, JSON.stringify(getModel));
    appendLog('Requested model info from server');
    setStatus('Model info request sent...');
  } catch (err) {
    logError('Failed to send get_model', err as Error);
    setStatus('Failed to send model info request', true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupUI();

  const connectBtn = document.getElementById(
    'connect-btn',
  ) as HTMLButtonElement | null;
  const roomInput = document.getElementById(
    'room-input',
  ) as HTMLInputElement | null;
  const sendBtn = document.getElementById(
    'send-btn',
  ) as HTMLButtonElement | null;
  const getModelBtn = document.getElementById(
    'get-model-btn',
  ) as HTMLButtonElement | null;

  if (!connectBtn || !roomInput || !sendBtn || !getModelBtn) {
    logError('Missing core UI elements; cannot initialize test app');
    return;
  }

  connectBtn.onclick = () => {
    const roomId = roomInput.value.trim() || DEFAULT_ROOM_ID;

    if (p2pcf) {
      try {
        appendLog('Destroying previous P2PCF client before reconnect');
        (p2pcf as any).destroy?.();
      } catch (err) {
        logError('Error destroying previous P2PCF client', err as Error);
      } finally {
        p2pcf = null;
      }
    }

    appendLog(`Connecting to room "${roomId}"...`);
    setStatus(`Connecting to room "${roomId}"...`);
    p2pcf = createClient(roomId);
    sendBtn.disabled = false;
    getModelBtn.disabled = false;
  };

  sendBtn.onclick = () => {
    sendPrompt();
  };

  getModelBtn.onclick = () => {
    getModelInfo();
  };

  // Optional: auto-connect to DEFAULT_ROOM_ID on load for convenience.
  connectBtn.click();
});
