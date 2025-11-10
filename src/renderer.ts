/**
 * Test app renderer for the P2PCF prompt/token protocol.
 *
 * This runs in "MyDeviceAI-Desktop-Test" and acts as a remote peer that:
 * - Joins a P2PCF room.
 * - Sends { t: "prompt", id, prompt, max_tokens? } messages to the main app.
 * - Displays streamed { t: "start" | "token" | "end" | "error" } responses.
 *
 * Assumptions:
 * - Both apps use the same room ID convention (e.g. "room-XXXX").
 * - The main MyDeviceAI-Desktop app is already running and connected to the same room.
 */

import './index.css';
// @ts-ignore - rely on runtime resolution
import P2PCF from 'p2pcf';

const LOG_PREFIX = '[TestApp]';
const DEFAULT_ROOM_ID = 'room-test';

type OutgoingPromptMessage = {
  t: 'prompt';
  id: string;
  prompt: string;
  max_tokens?: number;
};

type IncomingMessage =
  | { t: 'start'; id: string }
  | { t: 'token'; id: string; tok: string }
  | { t: 'reasoning_token'; id: string; tok: string }
  | { t: 'end'; id: string }
  | { t: 'error'; id: string; message: string }
  | { t: 'hello'; clientId?: string; impl?: string; version?: string }
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

  const promptLabel = document.createElement('div');
  promptLabel.textContent =
    'Prompt (will be sent as { t: "prompt", id, prompt, max_tokens }):';

  const promptInput = document.createElement('textarea');
  promptInput.id = 'prompt-input';
  promptInput.rows = 4;
  promptInput.style.width = '100%';
  promptInput.placeholder = 'Ask something...';

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

  controlsRow.appendChild(maxTokensLabel);
  controlsRow.appendChild(maxTokensInput);
  controlsRow.appendChild(sendBtn);

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
  root.appendChild(promptLabel);
  root.appendChild(promptInput);
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

function createClient(roomId: string) {
  const clientId = 'test-client';
  appendLog(`Creating P2PCF client for room "${roomId}"`);
  log('Creating P2PCF client', { clientId, roomId });

  const instance = new P2PCF(clientId, roomId);

  instance.on('peerconnect', (peer: any) => {
    currentPeer = peer;
    appendLog(
      `Peer connected: id=${peer?.id} client_id=${peer?.client_id ?? 'n/a'}`,
    );
    setStatus('Connected to peer. Ready to send prompts.');
    log('Peer connected', {
      id: peer?.id,
      client_id: peer?.client_id,
    });

    // Optional: send a hello message so the main app can log we are protocol-aware.
    try {
      const hello = {
        t: 'hello',
        clientId,
        impl: 'mydeviceai-desktop-test',
        version: '1.0.0',
      };
      peer.send(JSON.stringify(hello));
      appendLog('Sent hello message to peer');
    } catch (err) {
      logError('Failed to send hello', err as Error);
    }
  });

  instance.on('peerclose', (peer: any) => {
    appendLog(
      `Peer disconnected: id=${peer?.id} client_id=${peer?.client_id ?? 'n/a'}`,
    );
    setStatus('Peer disconnected. You may reconnect or wait for peer.');
    if (currentPeer === peer) {
      currentPeer = null;
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

  const promptEl = document.getElementById(
    'prompt-input',
  ) as HTMLTextAreaElement | null;
  const maxTokensEl = document.getElementById(
    'max-tokens-input',
  ) as HTMLInputElement | null;

  if (!promptEl || !maxTokensEl) {
    appendLog('Prompt or max_tokens input missing from DOM');
    return;
  }

  const prompt = promptEl.value.trim();
  const maxTokens = Number(maxTokensEl.value) || undefined;

  if (!prompt) {
    setStatus('Enter a prompt before sending.', true);
    return;
  }

  const id = `test-${Date.now().toString(36)}`;

  const msg: OutgoingPromptMessage = {
    t: 'prompt',
    id,
    prompt,
  };

  if (maxTokens && maxTokens > 0) {
    msg.max_tokens = maxTokens;
  }

  try {
    const serialized = JSON.stringify(msg);
    currentPeer.send(serialized);
    appendLog(
      `Sent prompt id=${id}, len=${prompt.length}, max_tokens=${msg.max_tokens ?? 'default'}`,
    );
    setStatus('Prompt sent. Waiting for streamed tokens...');
    currentPromptId = id;
    currentBuffer = '';
    setResult('');
  } catch (err) {
    logError('Failed to send prompt over P2PCF', err as Error, { id });
    setStatus('Failed to send prompt over P2PCF.', true);
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

  if (!connectBtn || !roomInput || !sendBtn) {
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
  };

  sendBtn.onclick = () => {
    sendPrompt();
  };

  // Optional: auto-connect to DEFAULT_ROOM_ID on load for convenience.
  connectBtn.click();
});
