/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  tag: string | null;
  createdAt: Timestamp;
  friends: string[];
  status?: 'online' | 'offline';
  lastSeen?: Timestamp;
  profileInitialized?: boolean;
}

export interface Player {
    uid: string;
    displayName: string | null;
    tag: string | null;
    isReady: boolean;
    isMuted: boolean;
    isSpeaking: boolean;
    isLoaded: boolean;
    status: 'connected' | 'disconnected';
}

export interface ChatMessage {
    sender: string | null;
    senderUID: string;
    text: string;
    timestamp: Timestamp;
}

export interface GameRoom {
    id: string;
    name: string;
    maxPlayers: number;
    hasPassword?: boolean;
    password?: string;
    host: { uid: string; displayName: string | null; };
    playerIds: { [key: string]: boolean };
    players: Player[];
    chatMessages: ChatMessage[];
    createdAt: Timestamp;
    status: 'waiting' | 'loading' | 'playing' | 'finished';
    settings?: {
      turnCount?: number | null;
      gobletsToWin?: number | null;
      turnLengthSec?: number | null;
    };
}

export interface FriendRequest {
  id: string;
  from: { uid: string; displayName: string | null; tag: string | null; };
  to: { uid: string; displayName: string | null; tag: string | null; };
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Timestamp;
}

export interface GameInvite {
    id: string;
    from: { uid: string; displayName: string | null; };
    to: { uid: string; };
    roomId: string;
    roomName: string;
    status: 'pending' | 'accepted' | 'declined';
    createdAt: Timestamp;
}