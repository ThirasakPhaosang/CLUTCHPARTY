/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, ButtonHTMLAttributes, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, Timestamp, runTransaction, collection, addDoc, query, where, deleteDoc, arrayUnion, setDoc, deleteField, serverTimestamp, getDoc, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { getMicStream, setStreamMuted } from '@/lib/mic';
import { LoaderCircle, LogOut, MessageSquare, Mic, MicOff, Send, Trophy, Skull, Volume2, VolumeX } from 'lucide-react';
import GameBoard from '@/components/game/GameBoard';
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { cva, type VariantProps } from 'class-variance-authority';
import { Player, ChatMessage, GameRoom, UserProfile } from '@/lib/types';
type RoomDoc = Omit<GameRoom, 'players'> & { players: Record<string, Player> };


// Global augmentation for older Safari AudioContext prefix
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

// --- TYPES ---
// Using shared types from '@/lib/types'

// --- MOCK GAME STATE TYPES ---
interface PlayerStats {
    uid: string;
    score: number;
    lives: number;
    health: number;
}


// --- UTILS & COMPONENTS ---

const buttonVariants = cva("inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", {
    variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/80", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", outline: "border border-input bg-background hover:bg-accent", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80", ghost: "hover:bg-accent" }, size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", icon: "h-9 w-9" } },
    defaultVariants: { variant: "default", size: "default" },
});
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />);
Button.displayName = "Button";

const PLAYER_COLORS = [0xff6347, 0x4682b4, 0x32cd32, 0xffd700, 0xda70d6, 0x00ced1, 0xfafafa, 0x808080];
const getOrdinal = (n: number) => {
    const s = ["TH", "ST", "ND", "RD"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
};
const toHex = (c: number) => '#' + ('00000' + c.toString(16)).slice(-6);


// --- GAME ROOM PAGE ---
export default function GamePage() {
    const router = useRouter();
    const params = useParams();
    const roomId = params.id as string;

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [room, setRoom] = useState<RoomDoc | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isChatVisible, setIsChatVisible] = useState(false);
    const [isVolumePanelVisible, setIsVolumePanelVisible] = useState(false);
    const [chatMessage, setChatMessage] = useState("");
    const [isMuted, setIsMuted] = useState(true);
    const [micReady, setMicReady] = useState(false);
    // Debounce Firestore writes for mic toggle to avoid lag and conflicts
    const muteWriteTimerRef = useRef<number | null>(null);
    const lastDesiredMuteRef = useRef<boolean>(true);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const micTrackRef = useRef<MediaStreamTrack | null>(null);
    const localMicWantedRef = useRef<boolean>(true);
    const lastLocalMicChangeRef = useRef<number>(0);
    
    // Mocked game state for UI
    const [playerStats, setPlayerStats] = useState<PlayerStats[]>([]);
    const [eventLog, setEventLog] = useState<{ message: string; timestamp: number }[]>([]);
    const [gameInfo, setGameInfo] = useState({ firstTo: 3, turn: 0, maxTurns: 30 });

    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const roomStateRef = useRef<RoomDoc | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    // Local-only controls for others' volume/mute
    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
    const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({});
    // removed unused isSpeakingRef
    const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
    const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
    const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
    const remoteAudioContextRef = useRef<AudioContext | null>(null);
    // FIX: Removed incorrect generic type from Uint8Array.
    const remoteAnalyzersRef = useRef<Map<string, { analyser: AnalyserNode, source: MediaStreamAudioSourceNode, dataArray: Uint8Array<ArrayBuffer>, rafId: number }>>(new Map());
    const makingOfferRef = useRef<Record<string, boolean>>({});
    const isNegotiatingRef = useRef<Record<string, boolean>>({});
    const iceCandidateQueues = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
    const outboundCandidateQueuesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
    const outboundFlushTimersRef = useRef<Record<string, number>>({});
    const sentCandidateKeysRef = useRef<Record<string, Set<string>>>({});
    const receivedCandidateKeysRef = useRef<Record<string, Set<string>>>({});
    const signalingBackoffUntilRef = useRef<number>(0);
    // removed unused lastDbUpdateRef
    const didMarkLoadedRef = useRef(false);
    const didSetPlayingRef = useRef(false);


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                router.replace('/login');
            }
        });
        return () => unsubscribe();
    }, [router]);
    useEffect(() => {
        const roomRef = doc(db, "rooms", roomId);
        const unsubscribe = onSnapshot(roomRef,
        (docSnap) => {
            if (docSnap.exists()) {
                type FirestoreRoomData = Partial<GameRoom> & Record<string, unknown> & { id: string };
                const raw = { id: docSnap.id, ...docSnap.data() } as unknown as FirestoreRoomData;
                
                setRoom(prevRoom => {
                    // This is the key fix: use prevRoom.players to avoid stale closure.
                    const roomData: RoomDoc = { ...(raw as unknown as Omit<RoomDoc, 'players'>), players: (prevRoom?.players || {}) } as RoomDoc;
                    
                    if(roomData.status === 'waiting'){
                        router.push(`/room/${roomId}`);
                        toast.info("Game has ended, returning to lobby.");
                        return prevRoom ?? roomData; // Must return a state
                    }
                    
                    roomStateRef.current = roomData;

                    // This logic is preserved as requested. It will now run with correct player data.
                    setPlayerStats(Object.values(roomData.players || {}).map(p => ({
                        uid: p.uid, score: 0, lives: 35, health: 30
                    })));
                    setEventLog([{ message: "Game Started!", timestamp: Date.now() }]);

                    return roomData;
                });

            } else {
                toast.error("Room not found.");
                router.push('/lobby');
            }
        },
        (error: import("firebase/firestore").FirestoreError) => {
            console.warn('Room snapshot error', error);
            if (error?.code === 'permission-denied') {
                toast.error('Missing permission to view this room');
                router.push('/lobby');
            }
        });
        return () => unsubscribe();
    }, [roomId, router]);
    // Listen players subcollection only when current user is a member
    useEffect(() => {
        if (!user?.uid) return;
        const isMember = !!room?.playerIds && !!room.playerIds[user.uid];
        const isHost = user?.uid === room?.host.uid;
        if (!isMember && !isHost) return;
        const roomRef = doc(db, "rooms", roomId);
        const playersCol = collection(roomRef, 'players');
        const unsub = onSnapshot(playersCol,
          async (snap) => {
            const map: Record<string, Player> = {};
            snap.forEach(d => { try { map[d.id] = d.data() as Player; } catch {} });
            setRoom(prev => prev ? { ...prev, players: map } : prev);
            roomStateRef.current = roomStateRef.current ? { ...roomStateRef.current, players: map } : roomStateRef.current;
            // Seed my subdoc if missing
            try {
              if ((isMember || isHost) && !map[user.uid]) {
                await setDoc(doc(roomRef, 'players', user.uid), {
                  uid: user.uid,
                  isReady: false,
                  isMuted: true,
                  isSpeaking: false,
                  isLoaded: false,
                  status: 'connected'
                } as Partial<Player>, { merge: true });
              }
            } catch {}
          },
          (err) => {
            console.warn('Players listen error', err);
          }
        );
        return () => unsub();
    }, [roomId, user?.uid, Object.keys(room?.playerIds || {}).sort().join(',')]);

    // Fetch real usernames for any missing displayName in players map
    useEffect(() => {
        const ids = Object.keys(room?.players || {});
        const missing = ids.filter(uid => !(room?.players?.[uid]?.displayName) && !userNames[uid]);
        if (missing.length === 0) return;
        const chunks: string[][] = [];
        for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));
        (async () => {
          try {
            const out: Record<string, string> = {};
            for (const c of chunks) {
              const qUsers = query(collection(db, 'users'), where('uid', 'in', c));
              const snap = await getDocs(qUsers);
              snap.forEach((d: QueryDocumentSnapshot) => { const u = d.data() as UserProfile; if (u?.uid) out[u.uid] = u.displayName || u.email || u.uid; });
            }
            if (Object.keys(out).length) setUserNames(prev => ({ ...prev, ...out }));
          } catch {}
        })();
    }, [Object.keys(room?.players || {}).sort().join(','), userNames]);
useEffect(() => {
  if (room?.id) {
    try { localStorage.setItem('lastRoomId', room.id); } catch {}
  }
}, [room?.id]);
    useEffect(() => {
        // Seed local mic UI state from authoritative player subdoc immediately on enter
        if (!user?.uid || !roomId) return;
        const roomRef = doc(db, 'rooms', roomId);
        const meRef = doc(roomRef, 'players', user.uid);
        (async () => {
            try {
                const snap = await getDoc(meRef);
                if (snap.exists()) {
                    const data = snap.data() as Player;
                    if (typeof data.isMuted === 'boolean') {
                        setIsMuted(data.isMuted);
                        localMicWantedRef.current = !data.isMuted;
                        try { micTrackRef.current && (micTrackRef.current.enabled = localMicWantedRef.current); } catch {}
                    }
                }
            } catch {}
        })();
    }, [user?.uid, roomId]);

    useEffect(() => {
        if (user?.uid && room?.players) {
            const myPlayer = room.players[user.uid as string];
            if (myPlayer) {
                // Reflect remote mute to UI only if not just changed locally
                if (Date.now() - lastLocalMicChangeRef.current > 2000) {
                    setIsMuted(myPlayer.isMuted);
                }
            }
        }
    }, [room, user]);

    const attachMicWatchers = (track: MediaStreamTrack) => {
        track.onended = () => { try { void reacquireMic(); } catch {} };
        track.onmute = () => { setTimeout(() => { if (track && !track.muted) { try { void reacquireMic(); } catch {} } }, 500); };
    };

    const reacquireMic = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const newTrack = stream.getAudioTracks()[0];
            micTrackRef.current = newTrack;
            attachMicWatchers(newTrack);
            const wanted = localMicWantedRef.current;
            try { newTrack.enabled = wanted; } catch {}
            // Replace on all peer connections
            Object.values(peerConnectionsRef.current).forEach((pc: RTCPeerConnection) => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) { try { sender.replaceTrack(newTrack); } catch {} }
                else { try { pc.addTrack(newTrack, stream); } catch {} }
            });
            audioStreamRef.current = stream;
        } catch (e) {
            console.warn('Reacquire mic failed', e);
        }
    };

    // Ensure membership if joinable (direct link safety)
    useEffect(() => {
        if (!user || !room) return;
        const isMember = !!room.playerIds?.[user.uid];
        const joinable = room.status === 'waiting' || room.status === 'loading';
        if (!isMember && joinable) {
            updateDoc(doc(db, 'rooms', roomId), { [`playerIds.${user.uid}`]: true }).catch(() => {});
        }
    }, [user?.uid, room?.id, room?.status, Object.keys(room?.playerIds || {}).sort().join(','), roomId]);

    // Mark this player as loaded or reconnected (debounced and idempotent)
    useEffect(() => {
        if (!user || !room || room.status === 'playing') return;
        const me = room.players[user.uid];
        if (!me) return; // wait until my player subdoc is visible
        if (me.isLoaded && me.status !== 'disconnected') return; // nothing to do
        if (didMarkLoadedRef.current) return;
        didMarkLoadedRef.current = true;
        const roomRef = doc(db, "rooms", roomId);
        const pRef = doc(roomRef, 'players', user.uid);
        setDoc(pRef, { isLoaded: true, status: 'connected' } as Partial<Player>, { merge: true }).catch(error => {
            console.error('Set loaded failed', error);
            didMarkLoadedRef.current = false; // allow retry on failure
        });
    }, [user, room, roomId]);
    
    // Host checks if all players are loaded (based on playerIds, not empty map)
    useEffect(() => {
        if (!user || !room || room.host.uid !== user.uid || room.status !== 'loading') return;
        const ids = Object.keys(room.playerIds || {});
        // Only require loaded for currently connected players; ignore disconnected ghosts
        const connectedIds = ids.filter(id => room.players?.[id]?.status !== 'disconnected');
        const allPresentAndLoaded = connectedIds.length > 0 && connectedIds.every(id => !!room.players?.[id]?.isLoaded);
        if (allPresentAndLoaded) {
            if (process.env.NODE_ENV !== 'production') {
                if (didSetPlayingRef.current) return;
                didSetPlayingRef.current = true;
            }
            const roomRef = doc(db, "rooms", roomId);
            updateDoc(roomRef, { status: 'playing' }).catch(console.error);
        }
    }, [user, room, roomId]);
    
  useEffect(() => {
    // Respect last mic preference on reload to avoid "no sound after refresh"
    const savedWanted = typeof window !== 'undefined' && localStorage.getItem('micWanted') === 'true';
    localMicWantedRef.current = savedWanted;
    setIsMuted(!savedWanted);
    if (audioStreamRef.current) {
      try { audioStreamRef.current.getAudioTracks().forEach(t => t.enabled = savedWanted); } catch {}
    }
  }, []);

  useEffect(() => {
    if (room) {
        setIsLoading(room.status !== 'playing');
    }
  }, [room]);

    useEffect(() => {
        if (!user?.uid || !roomId) return;
        let animationFrameId: number | null = null;
        let localStream: MediaStream | null = null;
        let audioContext: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let dataArray: Uint8Array<ArrayBuffer> | null = null;

        const setupMic = async () => {
            try {
                localStream = await getMicStream();
                audioStreamRef.current = localStream;
                setMicReady(true);
                // Initialize local mic wanted from remote only if not just changed locally
                const currentPlayer = roomStateRef.current?.players?.[user.uid];
                if (typeof currentPlayer?.isMuted === 'boolean' && (Date.now() - lastLocalMicChangeRef.current > 2000)) {
                    localMicWantedRef.current = !currentPlayer.isMuted;
                    setIsMuted(currentPlayer.isMuted);
                }
                // Apply local mic state
                micTrackRef.current = localStream.getAudioTracks()[0] || null;
                if (micTrackRef.current) {
                    try { micTrackRef.current.enabled = localMicWantedRef.current; } catch {}
                    attachMicWatchers(micTrackRef.current);
                }

                const AudioCtx: typeof AudioContext | undefined = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;

                audioContext = new AudioCtx({ latencyHint: 'interactive' } as AudioContextOptions);
                analyser = audioContext.createAnalyser();
                source = audioContext.createMediaStreamSource(localStream);
                source.connect(analyser);
                // Allocate with ArrayBuffer to satisfy stricter typings
                dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

                const onThreshold = 18;
                const offThreshold = 12;
                let speaking = false;
                let lastFlip = 0;
                const minHoldMs = 150;

                const detectSpeaking = () => {
                    if (!analyser || !dataArray) return;
                    analyser.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                    const now = performance.now();
                    if (!speaking && average > onThreshold && now - lastFlip > minHoldMs) {
                        speaking = true; lastFlip = now;
                        setIsSpeaking(true);
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: true }));
                    } else if (speaking && average < offThreshold && now - lastFlip > minHoldMs) {
                        speaking = false; lastFlip = now;
                        setIsSpeaking(false);
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: false }));
                    }
                    animationFrameId = requestAnimationFrame(detectSpeaking);
                };
                animationFrameId = requestAnimationFrame(detectSpeaking);
            } catch (err) {
                console.error("Mic access error:", err);
            }
        };
        setupMic();
        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            try { source?.disconnect(); } catch {}
            try { analyser?.disconnect(); } catch {}
            try { audioContext?.close(); } catch {}
            try { localStream?.getTracks().forEach(t => t.stop()); } catch {}
            setMicReady(false);
        };
    }, [user?.uid, roomId]);

    useEffect(() => {
        const onDeviceChange = () => {
            if (!micTrackRef.current || micTrackRef.current.readyState !== 'live') {
                void reacquireMic();
            }
        };
        try { navigator.mediaDevices.addEventListener('devicechange', onDeviceChange); } catch {}
        return () => { try { navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange); } catch {} };
    }, []);

    // Apply local volume/mute preferences to remote audio elements
    useEffect(() => {
        remoteAudioElementsRef.current.forEach((el, uid) => {
            const vol = (peerMuted?.[uid]) ? 0 : (peerVolumes?.[uid] ?? 1);
            try { el.volume = vol; } catch {}
        });
    }, [peerVolumes, peerMuted, remoteStreams]);

    // Analyze remote streams for speaking state with hysteresis and minimal flicker
    useEffect(() => {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!remoteAudioContextRef.current) {
            try { remoteAudioContextRef.current = new AudioCtx(); } catch { return; }
        }
        const audioCtx = remoteAudioContextRef.current!;

        const attach = (uid: string, stream: MediaStream) => {
            if (remoteAnalyzersRef.current.has(uid)) return;
            try {
                const source = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.85;
                source.connect(analyser);
                // Allocate with ArrayBuffer to satisfy stricter typings
                const dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
                const onThreshold = 18, offThreshold = 12; let speaking = false; let lastFlip = 0; const minHoldMs = 150;
                const tick = () => {
                    analyser.getByteFrequencyData(dataArray);
                    const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                    const now = performance.now();
                    if (!speaking && avg > onThreshold && now - lastFlip > minHoldMs) { speaking = true; lastFlip = now; setSpeakingPeers(prev => ({ ...prev, [uid]: true })); }
                    else if (speaking && avg < offThreshold && now - lastFlip > minHoldMs) { speaking = false; lastFlip = now; setSpeakingPeers(prev => ({ ...prev, [uid]: false })); }
                    const rafId = requestAnimationFrame(tick);
                    remoteAnalyzersRef.current.set(uid, { analyser, source, dataArray, rafId });
                };
                const rafId = requestAnimationFrame(tick);
                remoteAnalyzersRef.current.set(uid, { analyser, source, dataArray, rafId });
            } catch {}
        };

        const current = new Set(Object.keys(remoteStreams));
        // FIX: Correctly iterate over remoteStreams object using Object.entries.
        for (const [uid, stream] of Object.entries(remoteStreams)) attach(uid, stream as MediaStream);
        for (const [uid, entry] of remoteAnalyzersRef.current.entries()) {
            if (!current.has(uid)) {
                cancelAnimationFrame(entry.rafId);
                try { entry.source.disconnect(); } catch {}
                try { entry.analyser.disconnect(); } catch {}
                remoteAnalyzersRef.current.delete(uid);
                setSpeakingPeers(prev => { const n = { ...prev }; delete n[uid]; return n; });
            }
        }

        return () => {
            // keep context for reuse
        };
    }, [remoteStreams]);

    useEffect(() => {
        // Apply per-peer volume/mute to existing audio tags when controls change
        remoteAudioElementsRef.current.forEach((el, uid) => {
            try { el.muted = Boolean(peerMuted?.[uid]); } catch {}
            try { const v = peerVolumes?.[uid]; if (typeof v === 'number') el.volume = Math.max(0, Math.min(1, v)); } catch {}
        });
    }, [peerVolumes, peerMuted]);

    useEffect(() => {
        // Start signaling as soon as user is a member (do not wait for mic)
        const isMember = !!room?.playerIds && !!room.playerIds[user?.uid || ''];
        if (!user || !roomId || !room?.players || !isMember) return;
        const myId = user.uid;
        const roomRef = doc(db, "rooms", roomId);
        const signalingCollection = collection(roomRef, 'signaling');
        // Robust ICE servers: multiple STUNs + optional TURN (recommended)
        const iceServers: RTCIceServer[] = [
          { urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
            'stun:stun3.l.google.com:19302',
            'stun:stun4.l.google.com:19302'
          ] },
        ];
        const turnUrlsEnv = (process.env.NEXT_PUBLIC_TURN_URLS || process.env.NEXT_PUBLIC_TURN_URL || '').trim();
        if (turnUrlsEnv) {
          const urls = turnUrlsEnv.split(',').map(s => s.trim()).filter(Boolean);
          iceServers.push({ urls, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL } as RTCIceServer);
        }
        const pcConfig: RTCConfiguration = {
          iceServers,
          // If you want guaranteed connectivity across strict NATs, set NEXT_PUBLIC_FORCE_TURN=1
          iceTransportPolicy: process.env.NEXT_PUBLIC_FORCE_TURN ? 'relay' : 'all',
        };
        const localPeerConnections = { ...peerConnectionsRef.current };
        const createPeerConnection = (peerId: string, initiator: boolean) => {
            if (localPeerConnections[peerId]) return localPeerConnections[peerId];
            const pc = new RTCPeerConnection(pcConfig);
            try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch {}
            localPeerConnections[peerId] = pc;
            audioStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
            pc.ontrack = (event) => {
              const stream = event.streams?.[0] ?? new MediaStream([event.track]);
              setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
              const ensurePlay = () => {
                const el = remoteAudioElementsRef.current.get(peerId);
                if (!el) return;
                if (el.srcObject !== stream) el.srcObject = stream;
                el.play?.().catch(() => {});
              };
              try { event.track.onunmute = ensurePlay; } catch {}
              setTimeout(ensurePlay, 0);
            };
            pc.onicecandidate = e => {
              if (!e.candidate) {
                const flushNow = async () => {
                  const now = Date.now();
                  const list = outboundCandidateQueuesRef.current[peerId] || [];
                  if (list.length === 0) return;
                  if (now < signalingBackoffUntilRef.current) return;
                  try {
                    await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: list } });
                    outboundCandidateQueuesRef.current[peerId] = [];
                  } catch (e) {
                    const code = (e as { code?: string })?.code || '';
                    if (code === 'resource-exhausted') signalingBackoffUntilRef.current = Date.now() + 30000;
                  }
                };
                flushNow();
                return;
              }
              const cand = e.candidate.toJSON();
              const key = `${cand.candidate || ''}|${cand.sdpMid || ''}|${cand.sdpMLineIndex || ''}`;
              const sentSet = sentCandidateKeysRef.current[peerId] || new Set<string>();
              if (sentSet.has(key)) return;
              sentSet.add(key);
              sentCandidateKeysRef.current[peerId] = sentSet;
              const q = outboundCandidateQueuesRef.current[peerId] || [];
              const first = q.length === 0;
              q.push(cand);
              outboundCandidateQueuesRef.current[peerId] = q;
              // Send the very first candidate immediately for faster connectivity
              if (first) {
                (async () => {
                  const now = Date.now();
                  if (now < signalingBackoffUntilRef.current) return;
                  try {
                    await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: q.splice(0, q.length) } });
                    outboundCandidateQueuesRef.current[peerId] = [];
                  } catch (e) {
                    const code = (e as { code?: string })?.code || '';
                    if (code === 'resource-exhausted') signalingBackoffUntilRef.current = Date.now() + 30000;
                  }
                })();
              }
              if (!outboundFlushTimersRef.current[peerId]) {
                outboundFlushTimersRef.current[peerId] = (setTimeout(async function flush() {
                  const now = Date.now();
                  const list = outboundCandidateQueuesRef.current[peerId] || [];
                  if (list.length === 0) { outboundFlushTimersRef.current[peerId] = 0 as unknown as number; return; }
                  if (now < signalingBackoffUntilRef.current) {
                    const delay = signalingBackoffUntilRef.current - now + 100;
                    outboundFlushTimersRef.current[peerId] = (setTimeout(flush, delay) as unknown) as number; return;
                  }
                  try {
                    await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: list } });
                    outboundCandidateQueuesRef.current[peerId] = [];
                    outboundFlushTimersRef.current[peerId] = 0 as unknown as number;
                  } catch (e) {
                    const code = (e as { code?: string })?.code || '';
                    if (code === 'resource-exhausted') {
                      signalingBackoffUntilRef.current = Date.now() + 30000;
                      outboundFlushTimersRef.current[peerId] = (setTimeout(flush, 30000) as unknown) as number;
                    } else {
                      outboundFlushTimersRef.current[peerId] = (setTimeout(flush, 300) as unknown) as number;
                    }
                  }
                }, 300) as unknown) as number;
              }
            };
            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === 'complete') {
                const list = outboundCandidateQueuesRef.current[peerId] || [];
                if (list.length > 0 && Date.now() >= signalingBackoffUntilRef.current) {
                  addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: list } })
                    .then(() => { outboundCandidateQueuesRef.current[peerId] = []; })
                    .catch((e: unknown) => {
                      const code = (e as { code?: string })?.code || '';
                      if (code === 'resource-exhausted') signalingBackoffUntilRef.current = Date.now() + 30000;
                    });
                }
              }
            };
            pc.oniceconnectionstatechange = async () => {
                const st = pc.iceConnectionState;
                if ((st === 'failed' || st === 'disconnected') && initiator) {
                    try {
                        if (pc.signalingState === 'stable') {
                            await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
                            await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } });
                        } else {
                            try { pc.restartIce?.(); } catch {}
                        }
                    } catch {}
                }
            };
            pc.onconnectionstatechange = async () => {
              const st = pc.connectionState as RTCPeerConnectionState;
              if ((st === 'failed' || st === 'disconnected') && initiator) {
                try {
                  if (pc.signalingState === 'stable') {
                    await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
                    await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } });
                  } else {
                    try { pc.restartIce?.(); } catch {}
                  }
                } catch {}
              }
            };
            // Negotiation: only the chosen initiator proactively creates offers to reduce glare
            if (initiator) {
              pc.onnegotiationneeded = async () => {
                if (pc.signalingState !== 'stable') return;
                if (isNegotiatingRef.current[peerId]) return;
                isNegotiatingRef.current[peerId] = true;
                try {
                  makingOfferRef.current[peerId] = true;
                  await pc.setLocalDescription(await pc.createOffer());
                  await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } });
                } catch (e) {
                  // ignore
                } finally {
                  makingOfferRef.current[peerId] = false;
                  isNegotiatingRef.current[peerId] = false;
                }
              };
            }
            return pc;
        };
        const playerIds = Object.keys(room.playerIds || {}).filter(id => id !== myId);
        playerIds.forEach(peerId => createPeerConnection(peerId, myId < peerId));
        Object.keys(localPeerConnections).forEach(peerId => { if (!playerIds.includes(peerId)) { localPeerConnections[peerId].close(); delete localPeerConnections[peerId]; } });
        peerConnectionsRef.current = localPeerConnections;
        const q = query(signalingCollection, where("to", "==", myId));
        const unsub = onSnapshot(q, async (snapshot) => {
            for (const change of snapshot.docChanges()) {
                if (change.type === "added") {
                    const { from: fromId, signal } = change.doc.data();
                    const pc = peerConnectionsRef.current[fromId];
                    if (!pc) continue;
                    try {
                        if (signal.type === 'offer') {
                            // Perfect negotiation with rollback
                            const polite = myId > fromId;
                            const offerCollision = (makingOfferRef.current[fromId] === true) || pc.signalingState !== 'stable';
                            if (offerCollision && !polite) {
                              // Ignore the offer; let the other side win
                            } else {
                              if (offerCollision && polite && pc.signalingState !== 'stable') {
                                // Rollback local description before applying remote offer
                                try { await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit); } catch {}
                              }
                              await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp } as RTCSessionDescriptionInit);
                              const queue = iceCandidateQueues.current[fromId] || [];
                              for (const c of queue) { await pc.addIceCandidate(new RTCIceCandidate(c)); }
                              iceCandidateQueues.current[fromId] = [];
                              await pc.setLocalDescription(await pc.createAnswer());
                              await addDoc(signalingCollection, { from: myId, to: fromId, signal: { type: 'answer', sdp: pc.localDescription?.sdp } });
                            }
                        } else if (signal.type === 'answer') {
                            if (pc.signalingState === 'have-local-offer') {
                                try {
                                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                                  const queue = iceCandidateQueues.current[fromId] || [];
                                  for (const c of queue) { await pc.addIceCandidate(new RTCIceCandidate(c)); }
                                  iceCandidateQueues.current[fromId] = [];
                                } catch (e) {
                                  // Ignore InvalidStateError if state already stabilized
                                }
                            }
                        } else if (signal.candidate) {
                           if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                           else {
                               if (!iceCandidateQueues.current[fromId]) iceCandidateQueues.current[fromId] = [];
                               iceCandidateQueues.current[fromId].push(signal.candidate);
                           }
                        } else if (signal.candidates) {
                           const arr = signal.candidates as RTCIceCandidateInit[];
                           const recvSet = receivedCandidateKeysRef.current[fromId] || new Set<string>();
                           const unique: RTCIceCandidateInit[] = [];
                           for (const c of arr) {
                             const k = `${c.candidate || ''}|${c.sdpMid || ''}|${c.sdpMLineIndex || ''}`;
                             if (recvSet.has(k)) continue;
                             recvSet.add(k);
                             unique.push(c);
                           }
                           receivedCandidateKeysRef.current[fromId] = recvSet;
                           if (pc.remoteDescription) {
                             for (const c of unique) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
                           } else {
                             if (!iceCandidateQueues.current[fromId]) iceCandidateQueues.current[fromId] = [];
                             iceCandidateQueues.current[fromId].push(...unique);
                           }
                        }
                    } catch { }
                    await deleteDoc(change.doc.ref);
                }
            }
        }, (err) => {
          // Avoid crashing on permission/network blips
          console.warn('Signaling listen error', err);
        });
        return () => { unsub(); Object.values(peerConnectionsRef.current).forEach((pc: RTCPeerConnection) => pc.close()); peerConnectionsRef.current = {}; };
    }, [roomId, user?.uid, Object.keys(room?.playerIds || {}).sort().join(',')]);

    // When mic becomes available, attach tracks to existing PCs
    useEffect(() => {
      if (!audioStreamRef.current) return;
      Object.entries(peerConnectionsRef.current).forEach(([peerId, pc]: [string, RTCPeerConnection]) => {
        const haveSender = pc.getSenders().some(s => s.track && audioStreamRef.current!.getTracks().some(t => t.id === s.track!.id));
        if (!haveSender) {
          audioStreamRef.current!.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
        }
      });
    }, [micReady]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [room?.chatMessages, isChatVisible]);

    const handleLeaveGamePermanently = async () => {
        if (!user || !roomId) return;
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) return;

                const data = roomDoc.data() as unknown as { playerIds?: Record<string, boolean>; host: { uid: string; displayName: string | null } };
                const newPlayerIds = { ...(data.playerIds || {}) } as Record<string, boolean>;
                delete newPlayerIds[user.uid];

                // Determine new host from remaining playerIds
                const remainingIds = Object.keys(newPlayerIds);
                if (remainingIds.length === 0) {
                    // Delete room and player subdoc
                    transaction.delete(roomRef);
                } else {
                    let newHost = data.host;
                    if (user.uid === data.host.uid) {
                        const nextUid = remainingIds[0];
                        // We cannot read player's displayName here reliably; keep uid only
                        newHost = { uid: nextUid, displayName: null };
                    }
                    transaction.update(roomRef, { playerIds: newPlayerIds, host: newHost });
                }
                // Always delete player subdocument inside the same transaction
                const pRef = doc(roomRef, 'players', user.uid);
                transaction.delete(pRef);
            });
        } catch (error) { 
            console.error("Error leaving room: ", error); 
        }
        router.push('/lobby');
    };

    const handleToggleMute = () => {
        if (!user || !room) return;

        const desiredMuted = !isMuted;
        setIsMuted(desiredMuted);
        lastDesiredMuteRef.current = desiredMuted;
        lastLocalMicChangeRef.current = Date.now();
        localMicWantedRef.current = !desiredMuted;
        try { localStorage.setItem('micWanted', String(!desiredMuted)); } catch {}

        // Apply locally immediately for responsive UX
        if (audioStreamRef.current) {
            audioStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !desiredMuted; });
        }

        // Debounce Firestore write (coalesce rapid toggles)
        if (muteWriteTimerRef.current) { clearTimeout(muteWriteTimerRef.current); }
        muteWriteTimerRef.current = window.setTimeout(async () => {
            const roomRef = doc(db, "rooms", roomId);
            try {
                await setDoc(doc(roomRef, 'players', user.uid), { isMuted: lastDesiredMuteRef.current } as Partial<Player>, { merge: true });
            } catch (e2) {
                console.error("Mute toggle failed in Firestore:", e2);
                toast.error("Failed to sync mute status.");
                const revertMuted = !lastDesiredMuteRef.current;
                setIsMuted(revertMuted);
                localMicWantedRef.current = !revertMuted;
                if (audioStreamRef.current) {
                    audioStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !revertMuted; });
                }
            } finally {
                muteWriteTimerRef.current = null;
            }
        }, 200);
    };
    
    const handleSendMessage = async () => {
        if (!user || !room || !chatMessage.trim()) return;
        const sender = room.players[user.uid];
        if (!sender) return;
        const display = sender.displayName ?? roomStateRef.current?.players?.[user.uid]?.displayName ?? user.displayName ?? 'Guest';
        const newMessage: ChatMessage = { sender: display, senderUID: user.uid, text: chatMessage.trim(), timestamp: Timestamp.now() };
        try {
            await updateDoc(doc(db, "rooms", roomId), { chatMessages: arrayUnion(newMessage), updatedAt: serverTimestamp() });
            setChatMessage("");
            try { chatInputRef.current?.focus(); } catch {}
        } catch (err) {
            console.error('Failed to send message', err);
            toast.error('Failed to send message');
        }
    };

    // Leave game when browser Back button is pressed, and replace history so forward won't re-enter
    useEffect(() => {
        const onPopState = () => { try { handleLeaveGamePermanently(); } catch {} ; try { setTimeout(() => { router.replace('/lobby'); try { window.history.pushState({}, '', '/lobby'); } catch {} }, 0); } catch {} };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [user?.uid, roomId]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!user || !roomId) return;
            const roomRef = doc(db, "rooms", roomId);
            const pRef = doc(roomRef, 'players', user.uid);
            setDoc(pRef, { status: 'disconnected' } as Partial<Player>, { merge: true }).catch(() => {});
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [user, roomId]);

    // Best-effort: unlock/resume audio on first user gesture across browsers (iOS Safari, Firefox mobile, etc.)
    useEffect(() => {
        const resumeAll = (_e?: Event) => {
            try { remoteAudioContextRef.current?.resume?.(); } catch {}
            remoteAudioElementsRef.current.forEach((el) => {
                try { el.muted = false; } catch {}
                try { el.play(); } catch {}
            });
        };
        const opts: AddEventListenerOptions = { once: true };
        window.addEventListener('pointerdown', resumeAll, opts);
        window.addEventListener('keydown', resumeAll, opts);
        window.addEventListener('touchstart', resumeAll, opts);
        window.addEventListener('pointermove', resumeAll, opts);
        window.addEventListener('wheel', resumeAll, opts);
        const onVis = () => { if (document.visibilityState === 'visible') resumeAll(); };
        document.addEventListener('visibilitychange', onVis);
        return () => {
            window.removeEventListener('pointerdown', resumeAll);
            window.removeEventListener('keydown', resumeAll);
            window.removeEventListener('touchstart', resumeAll);
            window.removeEventListener('pointermove', resumeAll);
            window.removeEventListener('wheel', resumeAll);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    // Cross-browser: recover from input device changes (e.g., Bluetooth headset switch on Safari/Chrome)
    useEffect(() => {
        const onDeviceChange = () => {
            const t = micTrackRef.current;
            if (!t || t.readyState !== 'live') {
                navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                    const track = stream.getAudioTracks()[0];
                    micTrackRef.current = track;
                    try { track.enabled = localMicWantedRef.current; } catch {}
                    audioStreamRef.current = stream;
                    Object.values(peerConnectionsRef.current).forEach((pc) => {
                        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                        if (sender) { try { sender.replaceTrack(track); } catch {} }
                        else { try { pc.addTrack(track, stream); } catch {} }
                    });
                }).catch(() => {});
            }
        };
        try { navigator.mediaDevices.addEventListener('devicechange', onDeviceChange); } catch {}
        return () => { try { navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange); } catch {} };
    }, []);

    // Removed master volume control; rely on system/browser volume

    if (!room || isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 text-white">
                <LoaderCircle className="h-12 w-12 animate-spin text-primary mb-4" />
                <h1 className="text-2xl font-bold">Loading Game...</h1>
                <p className="text-muted-foreground mt-2">Waiting for all players to connect.</p>
            </div>
        );
    }

    // Add explicit Player types to sort callback parameters to fix properties not existing on 'unknown'.
    const sortedPlayers = (Object.values(room.players || {}) as Player[]).sort((a: Player, b: Player) => {
        const statsA = playerStats.find(s => s.uid === a.uid);
        const statsB = playerStats.find(s => s.uid === b.uid);
        if (!statsA || !statsB) return 0;
        return statsB.score - statsA.score;
    });

    return (
        <div className="w-screen h-screen bg-zinc-900 relative font-sans text-white overflow-hidden">
            <GameBoard room={room} speakingPeers={speakingPeers} userNames={userNames} />
             {Object.entries(remoteStreams).map(([uid, stream]) => (
                  <audio
                    key={uid}
                    data-peer-audio
                    autoPlay
                    playsInline
                    // ensure not muted by default; we apply local mute/volume below
                    muted={Boolean(peerMuted?.[uid])}
                    ref={audioEl => {
                     if (!audioEl) return;
                     remoteAudioElementsRef.current.set(uid, audioEl);
                     if (audioEl.srcObject !== stream) {
                       audioEl.srcObject = stream;
                     }
                      try { audioEl.volume = Math.max(0, Math.min(1, (peerVolumes?.[uid] ?? 1))); } catch {}
                      audioEl.play?.().catch(() => {});
                    }}
                     onCanPlay={e => { try { (e.currentTarget as HTMLAudioElement).play(); } catch {} }}
                  />
             ))}

            {/* Leaderboard UI */}
            <div className="absolute top-4 left-4 w-full max-w-xs space-y-1 z-10">
                {sortedPlayers.map((player, index) => {
                    const stats = playerStats.find(s => s.uid === player.uid);
                    if (!stats) return null;
                    const color = toHex(PLAYER_COLORS[index % PLAYER_COLORS.length]);
                    return (
                        <div key={player.uid} className="flex items-center gap-2 bg-black/50 backdrop-blur-sm p-1.5 rounded-lg text-sm transition-opacity duration-300" style={{ opacity: player.status === 'disconnected' ? 0.5 : 1 }}>
                            <div className="w-8 text-center font-black text-lg text-zinc-300 relative">
                               <span>{index + 1}</span>
                               <span className="text-xs absolute top-0 -right-1">{getOrdinal(index + 1)}</span>
                            </div>
                            <div style={{ backgroundColor: color }} className="w-1.5 h-10 rounded-full"></div>
                            <div className="flex-grow">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-white truncate pr-2">{player.displayName || userNames[player.uid] || '---'}</span>
                                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                                        <span className="flex items-center gap-1"><Trophy className="h-4 w-4 text-yellow-400" /> {stats.score}</span>
                                        <span className="flex items-center gap-1"><Skull className="h-4 w-4 text-zinc-400" /> {stats.lives}</span>
                                    </div>
                                </div>
                                <div className="w-full bg-zinc-900/70 h-[18px] rounded-sm mt-1 overflow-hidden border border-black/50">
                                    <div className="bg-green-500 h-full flex items-center justify-end px-1 text-xs font-bold text-zinc-900 transition-all duration-300" style={{ width: `${(stats.health / 30) * 100}%` }}>
                                        {stats.health}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {/* Game Info & Controls */}
            <div className="absolute top-2 right-2 md:top-4 md:right-4 flex items-start gap-2 md:gap-4 z-10">
                <div className="bg-zinc-900/70 backdrop-blur-md p-3 rounded-lg text-white text-sm w-44 md:w-52 space-y-2 border border-zinc-700/60 shadow-lg">
                    <div className="flex justify-between items-center">
                        <span>First to</span>
                        <span className="font-bold flex items-center">{gameInfo.firstTo} <Trophy className="h-4 w-4 ml-1 text-yellow-400" /></span>
                    </div>
                     <div className="w-full h-px bg-zinc-700/50"></div>
                    <div className="flex justify-between items-center">
                        <span>Turn</span>
                        <span className="font-bold">{gameInfo.turn} / {gameInfo.maxTurns}</span>
                    </div>
                     <div className="w-full h-px bg-zinc-700/50"></div>
                    <div className="text-center pt-1">
                        <Button variant="secondary" size="sm" className="w-full bg-zinc-700/80 hover:bg-zinc-600/80">Turn Order</Button>
                    </div>
                </div>
                 <div className="flex flex-col gap-2 p-2 bg-zinc-900/70 backdrop-blur-md rounded-lg border border-zinc-700/60 shadow-lg items-center">
                     {/* Enable Audio button removed per request; autoplay handled best-effort */}
                      <Button variant="ghost" onClick={() => setIsChatVisible(v => !v)} aria-label="Toggle Chat" title={isChatVisible ? "Hide Chat" : "Show Chat"} size="icon" className="h-10 w-10 hover:bg-zinc-700 text-white">
                         <MessageSquare className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" onClick={() => setIsVolumePanelVisible(v => !v)} aria-label="Volume Panel" title={isVolumePanelVisible ? "Hide Volume" : "Show Volume"} size="icon" className="h-10 w-10 hover:bg-zinc-700 text-white">
                         <Volume2 className="h-5 w-5" />
                      </Button>
                      <Button
                         variant="ghost"
                         onClick={handleToggleMute}
                         aria-label="Toggle Mic"
                         className={cn( "h-10 w-10 hover:bg-zinc-700 text-white rounded-full border border-zinc-600", !isMuted && "ring-2 ring-green-500 bg-green-500/20", (isSpeaking && !isMuted) && "animate-pulse")}
                         title={isMuted ? "Unmute" : "Mute"}
                     >
                         {isMuted ? <MicOff className="h-5 w-5 text-red-400" /> : <Mic className="h-5 w-5 text-white" />}
                     </Button>
                      <Button variant="ghost" onClick={handleLeaveGamePermanently} aria-label="Leave" title="Leave Game" size="icon" className="h-10 w-10 text-red-400 hover:bg-red-500/20 hover:text-red-400">
                          <LogOut className="h-5 w-5" />
                      </Button>
                      {/* Removed mic volume adjuster per request */}
                  </div>
            </div>

            {/* Event Log */}
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm p-2 rounded-lg text-sm text-white font-mono shadow-lg border border-zinc-700/50 z-10">
                {eventLog.length > 0 && <span>{eventLog[eventLog.length - 1].message}</span>}
            </div>
            
            {/* Chat Panel */}
            {isChatVisible && (
                <div className="absolute bottom-4 left-4 w-full max-w-sm bg-black/60 backdrop-blur-md rounded-lg p-3 flex flex-col h-[40vh] shadow-2xl border border-zinc-700/50 z-20">
                    <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-2 text-sm custom-scrollbar">
                        {room.chatMessages.map((msg, i) => (
                           <div key={`${msg.senderUID}-${msg.timestamp?.seconds ?? i}-${i}`} className={cn("flex flex-col w-full text-white", msg.senderUID === user?.uid ? "items-end" : "items-start")}>
                               <div className={cn("max-w-[90%] rounded-lg px-3 py-2", msg.senderUID === user?.uid ? "bg-primary text-primary-foreground" : "bg-zinc-700")}>
                                   {msg.senderUID !== user?.uid && <p className="text-xs font-bold text-blue-400 mb-1">{msg.sender}</p>}
                                   <p className="text-sm break-words">{msg.text}</p>
                               </div>
                               <span className="text-xs text-zinc-500 mt-1 px-1">
                                   {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                               </span>
                           </div>
                       ))}
                       <div ref={chatEndRef} />
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                        <input
                            ref={chatInputRef}
                            type="text"
                            placeholder="Type a message..." 
                            value={chatMessage} 
                            onChange={e => setChatMessage(e.target.value)} 
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSendMessage(); } }}
                            className="flex h-10 w-full rounded-md border border-input bg-zinc-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button onClick={handleSendMessage} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors h-10 w-10 bg-primary text-primary-foreground hover:bg-primary/80">
                            <Send className="w-4 h-4"/>
                        </button>
                    </div>
                </div>
            )}

            {/* Volume Panel */}
            {isVolumePanelVisible && (
                <div className="absolute bottom-4 left-4 w-full max-w-sm bg-black/60 backdrop-blur-md rounded-lg p-3 flex flex-col max-h-[40vh] overflow-y-auto shadow-2xl border border-zinc-700/50 z-20 custom-scrollbar">
                   <div className="font-semibold mb-2">Volume Controls</div>
                   {Object.values(room.players || {}).filter(p => p.uid !== user?.uid).map(p => (
                       <div key={p.uid} className="flex items-center gap-2 py-1">
                          <span className="flex-1 truncate">{p.displayName || p.uid}</span>
                          <button onClick={() => setPeerMuted(prev => ({...prev, [p.uid]: !prev?.[p.uid]}))} className="h-8 w-8 rounded-md hover:bg-zinc-700 flex items-center justify-center">
                              {(peerMuted?.[p.uid]) ? <VolumeX className="h-4 w-4 text-red-400"/> : <Volume2 className="h-4 w-4"/>}
                          </button>
                          <input type="range" min={0} max={1} step={0.05} className="w-32" value={(peerVolumes?.[p.uid]) ?? 1} onChange={(e) => setPeerVolumes(prev => ({...prev, [p.uid]: parseFloat((e.target as HTMLInputElement).value)}))} />
                       </div>
                   ))}
                </div>
            )}
        </div>
    );
}
