/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, ButtonHTMLAttributes, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, Timestamp, runTransaction, collection, addDoc, query, where, deleteDoc, arrayUnion } from 'firebase/firestore';
import { LoaderCircle, LogOut, MessageSquare, Mic, MicOff, Send, Trophy, Skull } from 'lucide-react';
import GameBoard from '@/components/game/GameBoard';
import { cn } from "@/lib/utils";
import { toast } from "sonner";
// Fix: Import cva and VariantProps for styling variants.
import { cva, type VariantProps } from 'class-variance-authority';
import { Player, ChatMessage, GameRoom } from '@/lib/types';


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
// Fix: Removed redundant 'cn' function definition as it is already imported from "@/lib/utils".

const buttonVariants = cva("inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", {
    variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/80", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", outline: "border border-input bg-background hover:bg-accent", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80", ghost: "hover:bg-accent" }, size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", icon: "h-9 w-9" } },
    defaultVariants: { variant: "default", size: "default" },
});
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />);
Button.displayName = "Button";

// Fix: Corrected hex color value syntax.
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
    const [room, setRoom] = useState<GameRoom | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isChatVisible, setIsChatVisible] = useState(false);
    const [chatMessage, setChatMessage] = useState("");
    const [isMuted, setIsMuted] = useState(true);
    const [isSpeaking, setIsSpeaking] = useState(false);
    
    // Mocked game state for UI
    const [playerStats, setPlayerStats] = useState<PlayerStats[]>([]);
    const [eventLog, setEventLog] = useState<{ message: string; timestamp: number }[]>([]);
    const [gameInfo, setGameInfo] = useState({ firstTo: 3, turn: 0, maxTurns: 30 });

    const chatEndRef = useRef<HTMLDivElement>(null);
    const roomStateRef = useRef<GameRoom | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    // removed unused isSpeakingRef
    const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
    const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
    const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
    const remoteAudioContextRef = useRef<AudioContext | null>(null);
    const remoteAnalyzersRef = useRef<Map<string, { analyser: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>, rafId: number }>>(new Map());
    const makingOfferRef = useRef<Record<string, boolean>>({});
    const isNegotiatingRef = useRef<Record<string, boolean>>({});
    const iceCandidateQueues = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
    // removed unused lastDbUpdateRef


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                router.push('/');
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
                const rawPlayers = (raw as Record<string, unknown>).players as unknown;
                const normalizedPlayers: Player[] = Array.isArray(rawPlayers)
                    ? (rawPlayers as Player[])
                    : rawPlayers && typeof rawPlayers === 'object'
                        ? (Object.values(rawPlayers as Record<string, Player>))
                        : [];
                const roomData: GameRoom = { ...(raw as GameRoom), players: normalizedPlayers };
                if(roomData.status === 'waiting'){
                    router.push(`/room/${roomId}`);
                    toast.info("Game has ended, returning to lobby.");
                    return;
                }
                setRoom(roomData);
                roomStateRef.current = roomData;

                // Initialize or update mock stats when room data changes
                setPlayerStats(roomData.players.map(p => ({
                    uid: p.uid, score: 0, lives: 35, health: 30
                })));
                setEventLog([{ message: "Game Started!", timestamp: Date.now() }]);

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
useEffect(() => {
  if (room?.id) {
    try { localStorage.setItem('lastRoomId', room.id); } catch {}
  }
}, [room?.id]);
    useEffect(() => {
        const myPlayer = room?.players.find(p => p.uid === user?.uid);
        if (myPlayer) {
            setIsMuted(myPlayer.isMuted);
        }
    }, [room, user]);

    // Mark this player as loaded or reconnected
    useEffect(() => {
        if (!user || !room || room.status === 'playing') return;

        const currentPlayerInRoom = room.players.find(p => p.uid === user.uid);
        if (currentPlayerInRoom && (!currentPlayerInRoom.isLoaded || currentPlayerInRoom.status === 'disconnected')) {
            const roomRef = doc(db, "rooms", roomId);
            runTransaction(db, async (transaction) => {
                const sfDoc = await transaction.get(roomRef);
                if (!sfDoc.exists()) { throw "Document does not exist!"; }
                const currentRoom = sfDoc.data() as GameRoom;
                const updatedPlayers = currentRoom.players.map(p => 
                    p.uid === user.uid ? { ...p, isLoaded: true, status: 'connected' } : p
                );
                transaction.update(roomRef, { players: updatedPlayers });
            }).catch(error => {
                console.error("Transaction failed: ", error);
            });
        }
    }, [user, room, roomId]);
    
    // Host checks if all players are loaded
    useEffect(() => {
        if (!user || !room || room.host.uid !== user.uid || room.status !== 'loading') return;

        const allPlayersLoaded = room.players.every(p => p.isLoaded);
        if (allPlayersLoaded) {
            const roomRef = doc(db, "rooms", roomId);
            updateDoc(roomRef, { status: 'playing' }).catch(console.error);
        }
    }, [user, room, roomId]);
    
    useEffect(() => {
        if (room) {
            setIsLoading(room.status !== 'playing');
        }
    }, [room]);

    useEffect(() => {
        if (!user?.uid || !roomId) return;
        let animationFrameId: number; let localStream: MediaStream; let audioContext: AudioContext; let analyser: AnalyserNode; let source: MediaStreamAudioSourceNode; let dataArray: Uint8Array<ArrayBuffer>;
        
        // Remove Firestore writes for speaking status to avoid high-frequency contention

        const setupMic = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
                audioStreamRef.current = localStream;
                const currentPlayer = roomStateRef.current?.players.find(p => p.uid === user.uid);
                const isInitiallyMuted = currentPlayer ? currentPlayer.isMuted : true;
                setIsMuted(isInitiallyMuted);
                localStream.getAudioTracks().forEach(track => { track.enabled = !isInitiallyMuted; });
                
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) throw new Error("AudioContext not supported");
                
                audioContext = new AudioCtx();
                analyser = audioContext.createAnalyser();
                source = audioContext.createMediaStreamSource(localStream);
                source.connect(analyser);
                dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) as Uint8Array<ArrayBuffer>;

                const onThreshold = 18;
                const offThreshold = 12;
                let speaking = false;
                let lastFlip = 0;
                const minHoldMs = 150;

                const detectSpeaking = () => {
                    analyser.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                    const now = performance.now();
                    if (!speaking && average > onThreshold && now - lastFlip > minHoldMs) {
                        speaking = true; lastFlip = now;
                        setIsSpeaking(true); // Update local state
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: true }));
                    } else if (speaking && average < offThreshold && now - lastFlip > minHoldMs) {
                        speaking = false; lastFlip = now;
                        setIsSpeaking(false);
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: false }));
                    }

                    // no DB writes; purely local UI state
                    animationFrameId = requestAnimationFrame(detectSpeaking);
                };
                detectSpeaking();
            } catch (err) { console.error("Mic access error:", err); }
        };
        setupMic();
        return () => { cancelAnimationFrame(animationFrameId); localStream?.getTracks().forEach(track => track.stop()); audioContext?.close().catch(() => {}); };
  }, [user?.uid, roomId]);

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
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const onThreshold = 18, offThreshold = 12; let speaking = false; let lastFlip = 0; const minHoldMs = 150;
                const tick = () => {
                    analyser.getByteFrequencyData(dataArray);
                    const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                    const now = performance.now();
                    if (!speaking && avg > onThreshold && now - lastFlip > minHoldMs) { speaking = true; lastFlip = now; setSpeakingPeers(prev => ({ ...prev, [uid]: true })); }
                    else if (speaking && avg < offThreshold && now - lastFlip > minHoldMs) { speaking = false; lastFlip = now; setSpeakingPeers(prev => ({ ...prev, [uid]: false })); }
                    const rafId = requestAnimationFrame(tick);
                    remoteAnalyzersRef.current.set(uid, { analyser, dataArray, rafId });
                };
                const rafId = requestAnimationFrame(tick);
                remoteAnalyzersRef.current.set(uid, { analyser, dataArray, rafId });
            } catch {}
        };

        const current = new Set(Object.keys(remoteStreams));
        for (const [uid, stream] of Object.entries(remoteStreams)) attach(uid, stream);
        for (const [uid, entry] of Array.from(remoteAnalyzersRef.current.entries())) {
            if (!current.has(uid)) {
                cancelAnimationFrame(entry.rafId);
                remoteAnalyzersRef.current.delete(uid);
                setSpeakingPeers(prev => { const n = { ...prev }; delete n[uid]; return n; });
            }
        }

        return () => {
            // keep context for reuse
        };
    }, [remoteStreams]);

    useEffect(() => {
        if (!user || !roomId || !audioStreamRef.current || !room?.players) return;
        const myId = user.uid;
        const roomRef = doc(db, "rooms", roomId);
        const signalingCollection = collection(roomRef, 'signaling');
        const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        const localPeerConnections = { ...peerConnectionsRef.current };
        const createPeerConnection = (peerId: string, initiator: boolean) => {
            if (localPeerConnections[peerId]) return localPeerConnections[peerId];
            const pc = new RTCPeerConnection(pcConfig);
            localPeerConnections[peerId] = pc;
            audioStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
            pc.ontrack = (event) => setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
            pc.onicecandidate = e => e.candidate && addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidate', candidate: e.candidate.toJSON() } });
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
                        }
                    } catch { }
                    await deleteDoc(change.doc.ref);
                }
            }
        });
        return () => { unsub(); Object.values(peerConnectionsRef.current).forEach(pc => pc.close()); peerConnectionsRef.current = {}; };
    }, [roomId, user, Object.keys(room?.playerIds || {}).sort().join(','), audioStreamRef.current]);

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

                const roomData = roomDoc.data() as GameRoom;

                const playerToRemove = roomData.players.find(p => p.uid === user.uid);
                if (playerToRemove) {
                    const newPlayers = roomData.players.filter(p => p.uid !== user.uid);
                    const newPlayerIds = { ...(roomData.playerIds || {}) } as Record<string, boolean>;
                    delete newPlayerIds[user.uid];
                    let newHost = roomData.host;

                    if (user.uid === roomData.host.uid && newPlayers.length > 0) {
                        newHost = { uid: newPlayers[0].uid, displayName: newPlayers[0].displayName };
                    }
                    transaction.update(roomRef, { players: newPlayers, playerIds: newPlayerIds, host: newHost });
                }
            });
        } catch (error) { 
            console.error("Error leaving room: ", error); 
        }
        router.push('/lobby');
    };

    const handleToggleMute = () => {
        if (!user || !room) return;
    
        const newMutedState = !isMuted;
        setIsMuted(newMutedState);
    
        if (audioStreamRef.current) {
            audioStreamRef.current.getAudioTracks().forEach(track => {
                track.enabled = !newMutedState;
            });
        }
    
        const roomRef = doc(db, "rooms", roomId);
        runTransaction(db, async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            if (!roomDoc.exists()) return;
            const players = roomDoc.data().players as Player[];
            const updatedPlayers = players.map(p => 
                p.uid === user.uid ? { ...p, isMuted: newMutedState } : p
            );
            transaction.update(roomRef, { players: updatedPlayers });
        }).catch(e => {
            console.error("Mute toggle failed in Firestore:", e);
            toast.error("Failed to sync mute status.");
            setIsMuted(!newMutedState);
             if (audioStreamRef.current) {
                audioStreamRef.current.getAudioTracks().forEach(track => {
                    track.enabled = newMutedState;
                });
            }
        });
    };
    
    const handleSendMessage = async () => {
        if (!user || !room || !chatMessage.trim()) return;
        const sender = room.players.find(p => p.uid === user.uid);
        if (!sender) return;
        const newMessage: ChatMessage = { sender: sender.displayName, senderUID: user.uid, text: chatMessage, timestamp: Timestamp.now() };
        await updateDoc(doc(db, "rooms", roomId), { chatMessages: arrayUnion(newMessage) });
        setChatMessage("");
    };

    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!user || !roomId) return;
            const roomRef = doc(db, "rooms", roomId);
            runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) return;
                const currentPlayers = roomDoc.data().players as Player[];
                const updatedPlayers = currentPlayers.map(p =>
                    p.uid === user.uid ? { ...p, status: 'disconnected' } : p
                );
                transaction.update(roomRef, { players: updatedPlayers });
            }).catch(console.error);
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [user, roomId]);

    if (!room || isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 text-white">
                <LoaderCircle className="h-12 w-12 animate-spin text-primary mb-4" />
                <h1 className="text-2xl font-bold">Loading Game...</h1>
                <p className="text-muted-foreground mt-2">Waiting for all players to connect.</p>
            </div>
        );
    }
    
    // Sort players for leaderboard (mock logic, e.g., by score)
    const sortedPlayers = [...room.players].sort((a, b) => {
        const statsA = playerStats.find(s => s.uid === a.uid);
        const statsB = playerStats.find(s => s.uid === b.uid);
        if (!statsA || !statsB) return 0;
        return statsB.score - statsA.score;
    });

    return (
        <div className="w-screen h-screen bg-zinc-900 relative font-sans text-white overflow-hidden">
            <GameBoard room={room} speakingPeers={speakingPeers} />
             {Object.entries(remoteStreams).map(([uid, stream]) => (
                 <audio
                   key={uid}
                   data-peer-audio
                   autoPlay
                   playsInline
                   // ensure not muted and try to play on canplay for autoplay policies
                   muted={false}
                   ref={audioEl => {
                     if (audioEl && audioEl.srcObject !== stream) {
                       audioEl.srcObject = stream;
                       audioEl.play?.().catch(() => {});
                     }
                   }}
                   onCanPlay={e => { try { (e.currentTarget as HTMLAudioElement).play(); } catch {} }}
                 />
             ))}

            {/* Leaderboard UI */}
            <div className="absolute top-4 left-4 w-full max-w-xs space-y-1">
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
                                    <span className="font-bold text-white truncate pr-2">{player.displayName}</span>
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
            <div className="absolute top-2 right-2 md:top-4 md:right-4 flex items-start gap-2 md:gap-4">
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
                     <Button variant="ghost" onClick={() => setIsChatVisible(v => !v)} aria-label="Toggle Chat" title={isChatVisible ? "Hide Chat" : "Show Chat"} size="icon" className="h-10 w-10 hover:bg-zinc-700 text-white">
                        <MessageSquare className="h-5 w-5" />
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
                </div>
            </div>

            {/* Event Log */}
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm p-2 rounded-lg text-sm text-white font-mono shadow-lg border border-zinc-700/50">
                {eventLog.length > 0 && <span>{eventLog[eventLog.length - 1].message}</span>}
            </div>
            
            {/* Chat Panel */}
            {isChatVisible && (
                <div className="absolute bottom-4 left-4 w-full max-w-sm bg-black/60 backdrop-blur-md rounded-lg p-3 flex flex-col h-[40vh] shadow-2xl border border-zinc-700/50">
                    <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-2 text-sm custom-scrollbar">
                        {room.chatMessages.map((msg, i) => (
                           <div key={i} className={cn("flex flex-col w-full text-white", msg.senderUID === user?.uid ? "items-end" : "items-start")}>
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
        </div>
    );
}









