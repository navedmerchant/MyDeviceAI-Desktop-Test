/**
 * P2PCF - Peer-to-Peer Cloudflare Library
 *
 * A lightweight P2P library using WebRTC with Cloudflare Worker signaling
 * Desktop-hub star topology: mobile/remote clients connect to desktop
 *
 * @packageDocumentation
 */

export { P2PCF } from './P2PCF';
export type { P2PCFOptions, Peer, P2PCFEvents, P2PCFEventType } from './types';
export {
  hexToBytes,
  bytesToHex,
  base64ToBytes,
  bytesToBase64,
  stringToBytes,
  bytesToString,
  generateUUID,
  generateSessionId,
} from './utils';

// Default export
import { P2PCF } from './P2PCF';
export default P2PCF;
