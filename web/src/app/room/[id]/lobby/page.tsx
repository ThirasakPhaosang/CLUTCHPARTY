/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, InputHTMLAttributes, ButtonHTMLAttributes, useRef, TextareaHTMLAttributes } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, Timestamp, runTransaction, collection, query, where, writeBatch, getDocs, addDoc, serverTimestamp, getDoc, setDoc, deleteField } from 'firebase/firestore';
import { getMicStream, setStreamMuted } from '@/lib/mic';
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { LoaderCircle, User as UserIcon, Users, MessageSquare, Send, Crown, Mic, MicOff, MoreVertical, UserX, Star, Volume2, Pencil, Check, X as XIcon, UserPlus, Hourglass, VolumeX } from 'lucide-react';
import { toast } from "sonner";


// --- TYPES ---
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
}
}
interface Player {
    uid: string;
    displayName: string | null;
    tag: string | null;
    isReady: boolean;
    isMuted: boolean;
isSpeaking: boolean; // Keep for local state, but don't sync frequently
    isLoaded: boolean;
    status: 'connected' | 'disconnected';
}

interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  tag: string | null;
  createdAt: Timestamp;
friends: string[];
  status?: 'online' | 'offline';
  lastSeen?: Timestamp;
}

interface ChatMessage {
    sender: string | null;
    senderUID: string;
text: string;
    timestamp: Timestamp;
}

interface GameRoom {
    id: string;
    name: string;
    maxPlayers: number;
    host: { uid: string;
displayName: string | null; };
    playerIds: { [key: string]: boolean };
    players: Record<string, Player>;
    chatMessages: ChatMessage[];
    createdAt: Timestamp;
    status: 'waiting' |
'loading' | 'playing' | 'finished';
}

interface FriendRequest {
  id: string;
  from: { uid: string; displayName: string | null;
tag: string | null; };
  to: { uid: string; displayName: string | null; tag: string | null; };
status: 'pending' | 'accepted' | 'declined';
  createdAt: Timestamp;
}

// --- UTILS & COMPONENTS ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva("inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", {
    variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/80", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", outline: "border border-input bg-background hover:bg-accent", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80", ghost: "hover:bg-accent" }, size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", icon: "h-9 w-9" } },
    defaultVariants: { variant: "default", size: "default" },
});
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />);
Button.displayName = "Button";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => <input type={type} className={cn("flex h-10 w-full rounded-md border border-input bg-zinc-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} ref={ref} {...props} />);
Input.displayName = "Input";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
    <textarea
        className={cn(
            "flex w-full rounded-md border border-input bg-zinc-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none custom-scrollbar",
            "h-10 overflow-y-auto",
            className
        )}
        ref={ref}
        
{...props}
    />
));
Textarea.displayName = "Textarea";

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>,React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/80",className)} {...props}/>
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName
const DialogContent = forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ref={ref} className={cn("fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg", className)} {...props}>
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"
const 
DialogTitle = forwardRef< React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName
const DialogDescription = forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const Slider = forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(({ className, ...props }, ref) => (
    <SliderPrimitive.Root ref={ref} className={cn("relative flex w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;


// --- GAME ROOM PAGE ---
export default function RoomPage() {
    const router = useRouter();
const params = useParams();
    const roomId = params.id as string;

    const [user, setUser] = useState<FirebaseUser | null>(null);
const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [room, setRoom] = useState<GameRoom | null>(null);
    const [loading, setLoading] = useState(true);
const [chatMessage, setChatMessage] = useState("");
    const [playerMenuOpen, setPlayerMenuOpen] = useState<string | null>(null);
    const [isInviteDialogOpen, setInviteDialogOpen] = useState(false);
const [onlineFriends, setOnlineFriends] = useState<UserProfile[]>([]);
    const [isEditingName, setIsEditingName] = useState(false);
    const [newRoomName, setNewRoomName] = useState("");
    const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);
    const [isChatVisible, setIsChatVisible] = useState(true);
    const [localMuted, setLocalMuted] = useState(true);
const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
// Local-only audio controls for others
const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({});
// Map of uid -> displayName from users collection (fallback when subdoc missing)
const [userNames, setUserNames] = useState<Record<string, string>>({});
const micTrackRef = useRef<MediaStreamTrack | null>(null);
const localMicWantedRef = useRef<boolean>(false);
const lastLocalMicChangeRef = useRef<number>(0);
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const audioStreamRef = useRef<MediaStream | null>(null);
    const [micReady, setMicReady] = useState<boolean>(false);
const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
const remoteStreamAnalyzersRef = useRef<Map<string, { analyser: AnalyserNode, source: MediaStreamAudioSourceNode, dataArray: Uint8Array<ArrayBuffer>, animationFrameId: number }>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);
// Removed mic/volume adjuster
const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
    const iceCandidateQueues = useRef<Record<string, RTCIceCandidateInit[]>>({});
    // Outbound ICE candidate batching to reduce Firestore writes
    const outboundCandidateQueuesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
    const outboundFlushTimersRef = useRef<Record<string, number>>({});
    // Dedup keys for sent/received candidates to avoid resending the same
    const sentCandidateKeysRef = useRef<Record<string, Set<string>>>({});
    const receivedCandidateKeysRef = useRef<Record<string, Set<string>>>({});
    const signalingBackoffUntilRef = useRef<number>(0);
    
    // Refs for Perfect Negotiation Pattern
    const makingOfferRef = useRef<Record<string, boolean>>({});
    const isNegotiatingRef = useRef<Record<string, boolean>>({});
    // Track if user was ever a member to avoid premature "removed" redirect on first load
    const hasEverBeenMemberRef = useRef<boolean>(false);

    // Ensure autoplay resumes on first user gesture (mobile/strict browsers)
    useEffect(() => {
        const resumeAll = (_e?: Event) => {
            try { audioContextRef.current?.resume?.(); } catch {}
            remoteAudioElementsRef.current.forEach(a => { try { a.muted = false; a.play(); } catch {} });
        };
        const opts: AddEventListenerOptions = { once: true };
        window.addEventListener("pointerdown", resumeAll as EventListener, opts);
        window.addEventListener("keydown", resumeAll as EventListener, opts);
        window.addEventListener("touchstart", resumeAll as EventListener, opts);
        window.addEventListener("pointermove", resumeAll as EventListener, opts);
        window.addEventListener("wheel", resumeAll as EventListener, opts);
        const onVis = () => { if (document.visibilityState === 'visible') resumeAll(); };
        document.addEventListener('visibilitychange', onVis);
        return () => {
            window.removeEventListener("pointerdown", resumeAll as EventListener);
            window.removeEventListener("keydown", resumeAll as EventListener);
            window.removeEventListener("touchstart", resumeAll as EventListener);
            window.removeEventListener("pointermove", resumeAll as EventListener);
            window.removeEventListener("wheel", resumeAll as EventListener);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

useEffect(() => {
        const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (!currentUser) { router.replace('/login'); return; }
            setUser(currentUser);
            const userDocRef = doc(db, "users", currentUser.uid);
            const userUnsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) setUserProfile(docSnap.data() as 
UserProfile);
            });
            return () => userUnsubscribe();
        });
        return () => authUnsubscribe();
    }, [router]);
useEffect(() => {
        if (!roomId || !user) return;
        const roomRef = doc(db, "rooms", roomId);
        const roomUnsubscribe = onSnapshot(roomRef,
        (docSnap) => {
            if (docSnap.exists()) {
                type FirestoreRoomData = Partial<GameRoom> & Record<string, unknown> & { id: string };
                const raw = { id: docSnap.id, ...docSnap.data() } as unknown as FirestoreRoomData;

                // Determine membership using incoming data
                const incoming = raw as GameRoom;
                const isMember = !!incoming.playerIds && !!incoming.playerIds[user.uid];
                if (isMember) {
                    hasEverBeenMemberRef.current = true;
                } else if (hasEverBeenMemberRef.current) {
                    toast.error("You have been removed from the room.");
                    router.push('/lobby');
                    return;
                }

                // Preserve latest players map from state; do not overwrite with stale closure
                setRoom(prev => {
                    const merged: GameRoom = { ...(incoming), players: (prev?.players || {}) };
                    return merged;
                });
                setLoading(false);
                if (!isEditingName) setNewRoomName((incoming).name);
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
        return () => roomUnsubscribe();
    }, [roomId, user, router, isEditingName]);

    // Ensure membership automatically when viewing a joinable room (supports deep links)
    useEffect(() => {
        if (!user || !room) return;
        const isMember = !!room.playerIds?.[user.uid];
        const joinable = room.status === 'waiting' || room.status === 'loading';
        if (!isMember && joinable) {
            updateDoc(doc(db, 'rooms', roomId), { [`playerIds.${user.uid}`]: true }).catch(() => {});
        }
    }, [user?.uid, room?.id, room?.status, Object.keys(room?.playerIds || {}).sort().join(','), roomId]);
    // Listen players subcollection (authoritative) only if member to avoid permission errors
    useEffect(() => {
        if (!roomId || !user) return;
        const isMember = !!room?.playerIds && !!room.playerIds[user.uid];
        const isHost = user?.uid === room?.host.uid;
        if (!isMember && !isHost) return;
        const roomRef = doc(db, 'rooms', roomId);
        const playersCol = collection(roomRef, 'players');
        const unsub = onSnapshot(playersCol,
          async (snap) => {
            const map: Record<string, Player> = {};
            snap.forEach(d => {
              try {
                const data = d.data() as Partial<Player>;
                const base: Partial<Player> = {
                  displayName: null,
                  tag: null,
                  isReady: false,
                  isMuted: false,
                  isSpeaking: false,
                  isLoaded: false,
                  status: 'connected',
                };
                // Merge with fallbacks, then force uid from doc id to avoid undefined
                map[d.id] = { ...base, ...data, uid: d.id } as Player;
              } catch {}
            });
            setRoom(prev => prev ? { ...prev, players: map } : prev);
            try {
              if ((isMember || isHost) && !map[user.uid]) {
                await setDoc(doc(roomRef, 'players', user.uid), {
                  uid: user.uid,
                  displayName: userProfile?.displayName ?? user.displayName ?? null,
                  tag: userProfile?.tag ?? null,
                  isReady: false,
                  isMuted: localMuted,
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
    }, [roomId, user?.uid, room?.host.uid, Object.keys(room?.playerIds || {}).sort().join(',')]);

    // Fetch real usernames for participants missing displayName in players subdoc
    useEffect(() => {
      const ids = Object.keys(room?.playerIds || {});
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
            snap.forEach(d => { const u = d.data() as UserProfile; if (u?.uid) out[u.uid] = u.displayName || u.email || u.uid; });
          }
          if (Object.keys(out).length) setUserNames(prev => ({ ...prev, ...out }));
        } catch {}
      })();
    }, [Object.keys(room?.playerIds || {}).sort().join(','), Object.keys(room?.players || {}).sort().join(','), userNames]);
useEffect(() => {
        if (!user?.uid || !roomId) return;
        let localStream: MediaStream | undefined;
        let audioContext: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let dataArray: Uint8Array<ArrayBuffer> | null = null;
        let rafId: number | null = null;

        const setupMic = async () => {
    
        try {
                localStream = await getMicStream();
                audioStreamRef.current = localStream;
                setMicReady(true);
          // Initialize local mic state from remote only if not just changed locally
      const myPlayer = room?.players?.[user.uid];
                if (typeof myPlayer?.isMuted === 'boolean' && (Date.now() - lastLocalMicChangeRef.current > 2000)) {
                  localMicWantedRef.current = !myPlayer.isMuted;
                  setLocalMuted(myPlayer.isMuted);
                }
                micTrackRef.current = localStream.getAudioTracks()[0] || null;
                if (micTrackRef.current) {
                  try { micTrackRef.current.enabled = localMicWantedRef.current; } catch {}
                }

                const AudioCtx = window.AudioContext || window.webkitAudioContext;
if (!AudioCtx) return;
                audioContext = new AudioCtx();
                const source = audioContext.createMediaStreamSource(localStream);
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.85;
source.connect(analyser);
                // Allocate with ArrayBuffer to satisfy strict lib.dom typings
                dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

                let speaking = false;
                const onThreshold = 18;
// dB avg threshold to turn on
                const offThreshold = 12;
// lower threshold to turn off (hysteresis)
                let lastFlip = 0;
const minHoldMs = 150;

                const tick = () => {
                    if (!analyser || !dataArray) return;
                    analyser.getByteFrequencyData(dataArray);
                    const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                    const now = performance.now();
if (!speaking && avg > onThreshold && now - lastFlip > minHoldMs) {
                        speaking = true;
lastFlip = now;
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: true }));
} else if (speaking && avg < offThreshold && now - lastFlip > minHoldMs) {
                        speaking = false;
lastFlip = now;
                        setSpeakingPeers(prev => ({ ...prev, [user.uid]: false }));
}
                    rafId = requestAnimationFrame(tick);
};
                rafId = requestAnimationFrame(tick);
            } catch (err) {
                console.error("Mic access error:", err);
toast.error("Could not access microphone.");
            }
        };
        setupMic();
return () => {
            if (rafId) cancelAnimationFrame(rafId);
            try { audioContext?.close(); } catch {}
            // Keep mic stream alive across navigation for faster re-join.
            // Use releaseMicStream() from '@/lib/mic' if you want to fully stop it when leaving the app.
            setMicReady(false);
        };
    }, [user?.uid, roomId]);

    useEffect(() => {
      // Reflect remote mute to UI only; do not toggle track here
      const me = user ? room?.players?.[user.uid] : undefined;
      if (me && typeof me.isMuted === 'boolean') {
        if (Date.now() - lastLocalMicChangeRef.current > 2000) {
          setLocalMuted(me.isMuted);
        }
      }
    }, [room?.players, user?.uid]);

    const analyzeRemoteStream = (stream: MediaStream | undefined | null, peerId: string) => {
        if (!(stream instanceof MediaStream)) return;
        if (!audioContextRef.current) {
            const AudioCtx = window.AudioContext ||
window.webkitAudioContext;
            if (AudioCtx) audioContextRef.current = new AudioCtx();
            else { console.error("AudioContext not supported"); return;
}
        }
        const audioContext = audioContextRef.current;
        const source = audioContext.createMediaStreamSource(stream as MediaStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.85;
source.connect(analyser);
        // Allocate with ArrayBuffer to satisfy strict lib.dom typings
        const dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        
        const onThreshold = 18;
        const offThreshold = 12;
let speaking = false;
        let lastFlip = 0;
        const minHoldMs = 150;
const checkSpeaking = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
            const now = performance.now();
if (!speaking && average > onThreshold && now - lastFlip > minHoldMs) {
                speaking = true;
lastFlip = now;
                setSpeakingPeers(prev => ({ ...prev, [peerId]: true }));
} else if (speaking && average < offThreshold && now - lastFlip > minHoldMs) {
                speaking = false;
lastFlip = now;
                setSpeakingPeers(prev => ({ ...prev, [peerId]: false }));
}
            const animationFrameId = requestAnimationFrame(checkSpeaking);
            remoteStreamAnalyzersRef.current.set(peerId, { analyser, source, dataArray, animationFrameId });
        };
        checkSpeaking();
    };

    // FIXED: WebRTC connection management using Perfect Negotiation Pattern
    useEffect(() => {
        // Start signaling as soon as user is a room member (do not wait for mic)
        const isMember = !!room?.playerIds && !!room?.playerIds[user?.uid || ''];
        if (!user || !roomId || !room?.players || !isMember) return;
        
        const myId = user.uid;
        const roomRef = doc(db, "rooms", roomId);
        const signalingCollection = collection(roomRef, 'signaling');
        const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
        if (process.env.NEXT_PUBLIC_TURN_URL) {
            const urls = process.env.NEXT_PUBLIC_TURN_URL.split(',').map(u => u.trim()).filter(Boolean);
            iceServers.push({ urls, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL } as RTCIceServer);
        }
        const pcConfig = { iceServers } as RTCConfiguration;

        const createPeerConnection = (peerId: string, initiator: boolean) => {
            if (peerConnectionsRef.current.has(peerId)) return;
            const pc = new RTCPeerConnection(pcConfig);
            try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch {}
            peerConnectionsRef.current.set(peerId, pc);

            audioStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));

            pc.ontrack = (event) => {
                const stream = event.streams?.[0] ?? new MediaStream([event.track]);
                setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
                analyzeRemoteStream(stream, peerId);
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
                // When null => end-of-candidates: flush immediately
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
                const existing = outboundCandidateQueuesRef.current[peerId] || [];
                const first = existing.length === 0;
                existing.push(cand);
                outboundCandidateQueuesRef.current[peerId] = existing;
                // Send the very first candidate immediately to speed up connectivity
                if (first) {
                  (async () => {
                    const now = Date.now();
                    if (now < signalingBackoffUntilRef.current) return;
                    try {
                      await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: existing.splice(0, existing.length) } });
                      outboundCandidateQueuesRef.current[peerId] = [];
                    } catch (e) {
                      const code = (e as { code?: string })?.code || '';
                      if (code === 'resource-exhausted') signalingBackoffUntilRef.current = Date.now() + 30000;
                    }
                  })();
                }
                // Fallback timer with shorter batch window (faster trickle)
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
                    // Force a final flush at completion
                    const list = outboundCandidateQueuesRef.current[peerId] || [];
                    if (list.length > 0) {
                        const now = Date.now();
                        if (now >= signalingBackoffUntilRef.current) {
                            addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidates', candidates: list } })
                             .then(() => { outboundCandidateQueuesRef.current[peerId] = []; })
                             .catch((e: unknown) => { const code = (e as { code?: string })?.code || ''; if (code === 'resource-exhausted') signalingBackoffUntilRef.current = Date.now() + 30000; });
                        }
                    }
                }
            };
            pc.oniceconnectionstatechange = () => {
                const st = pc.iceConnectionState;
                // Cross-browser recovery: try ICE restart on 'failed'
                if (st === 'failed') {
                  try {
                    if (pc.signalingState === 'stable') {
                      pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
                      pc.createOffer({ iceRestart: true }).then(offer => {
                        pc.setLocalDescription(offer).then(() => {
                          addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } }).catch(() => {});
                        }).catch(() => {});
                      }).catch(() => {});
                    }
                  } catch {}
                }
            };
            
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
                  console.error("Negotiation needed error:", e);
                } finally {
                  makingOfferRef.current[peerId] = false;
                  isNegotiatingRef.current[peerId] = false;
                }
              };
            }
        };

        const playerIds = new Set(Object.keys(room.players || {}).filter(id => id !== myId));
        playerIds.forEach(peerId => createPeerConnection(peerId, myId < peerId));

        peerConnectionsRef.current.forEach((pc, peerId) => {
            if (!playerIds.has(peerId)) {
                pc.close();
                peerConnectionsRef.current.delete(peerId);
                const audioEl = remoteAudioElementsRef.current.get(peerId);
                if (audioEl) audioEl.srcObject = null;
                remoteAudioElementsRef.current.delete(peerId);
                const analyzer = remoteStreamAnalyzersRef.current.get(peerId);
                if (analyzer) {
                    cancelAnimationFrame(analyzer.animationFrameId);
                    try { analyzer.source.disconnect(); } catch {}
                    try { analyzer.analyser.disconnect(); } catch {}
                }
                remoteStreamAnalyzersRef.current.delete(peerId);
                setSpeakingPeers(prev => { const next = {...prev}; delete next[peerId]; return next; });
                setRemoteStreams(prev => { const next = { ...prev }; delete next[peerId]; return next; });
            }
        });

        const q = query(signalingCollection, where("to", "==", myId));
        const unsub = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach(async change => {
                if (change.type === 'added') {
                    const { from: fromId, signal } = change.doc.data();
                    const pc = peerConnectionsRef.current.get(fromId);
                    if (!pc) return;
                    
                    try {
                        if (signal.type === 'offer') {
                            const polite = myId > fromId;
                            const offerCollision = (makingOfferRef.current[fromId] === true) || pc.signalingState !== 'stable';
                          
                            if (offerCollision && !polite) {
                              // Ignore the impolite offer and let our offer win.
                            } else {
                                if (offerCollision && polite && pc.signalingState !== 'stable') {
                                    // We are polite, so we must back off and rollback.
                                    await pc.setLocalDescription({ type: 'rollback' });
                                }
                                await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
                                const queue = iceCandidateQueues.current[fromId] || [];
                                for (const c of queue) { await pc.addIceCandidate(new RTCIceCandidate(c)); }
                                iceCandidateQueues.current[fromId] = [];
                                
                                await pc.setLocalDescription(await pc.createAnswer());
                                await addDoc(signalingCollection, { from: myId, to: fromId, signal: { type: 'answer', sdp: pc.localDescription?.sdp } });
                            }
                        } else if (signal.type === 'answer') {
                            // Check the state before setting the remote answer.
                            if (pc.signalingState === 'have-local-offer') {
                                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                                const queue = iceCandidateQueues.current[fromId] || [];
                                for (const c of queue) { await pc.addIceCandidate(new RTCIceCandidate(c)); }
                                iceCandidateQueues.current[fromId] = [];
                            }
                        } else if (signal.candidate) {
                           if (pc.remoteDescription) {
                               await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                           } else {
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
                    } catch (err) { 
                        // Swallow benign InvalidState/Operation race errors from renegotiation
                        const name = (typeof err === 'object' && err && 'name' in (err as object))
                          ? ((err as { name?: string }).name ?? '')
                          : '';
                        if (name !== 'InvalidStateError' && name !== 'OperationError') {
                          console.warn("Signaling error:", err);
                        }
                    }
                    await deleteDoc(change.doc.ref);
                }
            });
        }, (err) => {
            console.warn('Signaling listen error', err);
        });

        return () => { 
            unsub();
            peerConnectionsRef.current.forEach(pc => pc.close());
            peerConnectionsRef.current.clear();
            remoteAudioElementsRef.current.forEach(audio => audio.srcObject = null);
            remoteAudioElementsRef.current.clear();
            remoteStreamAnalyzersRef.current.forEach(analyzer => cancelAnimationFrame(analyzer.animationFrameId));
            remoteStreamAnalyzersRef.current.clear();
        };
    }, [roomId, user, Object.keys(room?.players || {}).sort().join(',')]);

    // When mic becomes available, attach tracks to existing peer connections and let negotiation proceed
    useEffect(() => {
        if (!audioStreamRef.current) return;
        peerConnectionsRef.current.forEach((pc) => {
          // Avoid duplicate senders
          const haveSender = pc.getSenders().some(s => s.track && audioStreamRef.current!.getTracks().some(t => t.id === s.track!.id));
          if (!haveSender) {
            audioStreamRef.current!.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
          }
        });
    }, [micReady]);

useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [room?.chatMessages, isChatVisible]);
useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setPlayerMenuOpen(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Default mic state: respect last preference; if none, start muted
    useEffect(() => {
        if (!user?.uid || !roomId) return;
        const savedWanted = typeof window !== 'undefined' && localStorage.getItem('micWanted') === 'true';
        lastLocalMicChangeRef.current = Date.now();
        localMicWantedRef.current = savedWanted;
        setLocalMuted(!savedWanted);
        if (audioStreamRef.current) {
            try { audioStreamRef.current.getAudioTracks().forEach(t => t.enabled = savedWanted); } catch {}
        }
        try { setDoc(doc(db, 'rooms', roomId, 'players', user.uid), { isMuted: !savedWanted } as Partial<Player>, { merge: true }); } catch {}
    }, [user?.uid, roomId]);

    // Apply local volume/mute preferences to remote audio elements
    useEffect(() => {
        remoteAudioElementsRef.current.forEach((el, peerId) => {
            const volMap: Record<string, number> = (typeof peerVolumes === 'object' && peerVolumes) ? peerVolumes : {};
            const muteMap: Record<string, boolean> = (typeof peerMuted === 'object' && peerMuted) ? peerMuted : {};
            const vol = muteMap[peerId] ? 0 : (volMap[peerId] ?? 1);
            try { el.volume = vol; } catch {}
        });
    }, [peerVolumes, peerMuted, remoteStreams]);
useEffect(() => {
        if (!userProfile?.friends || userProfile.friends.length === 0) { setOnlineFriends([]); return; }
        const friendsQuery = query(collection(db, "users"), where('uid', 'in', userProfile.friends));
        const unsubscribe = onSnapshot(friendsQuery, (snapshot) => {
            const friendsData = snapshot.docs.map(d => d.data() as UserProfile);
            const availableFriends = friendsData.filter(f => f.status === 'online' && !Object.values(room?.players || {}).some(p => p.uid === f.uid));
        
    setOnlineFriends(availableFriends);
        });
        return () => unsubscribe();
    }, [userProfile, room?.players]);
useEffect(() => {
        if (room?.status === 'loading') {
            router.push(`/room/${roomId}/game`);
        }
    }, [room?.status, roomId, router]);
// Removed master volume sync effect
const handleEnableAudio = () => {
        try { audioContextRef.current?.resume(); } catch {}
        remoteAudioElementsRef.current.forEach((audio) => { try { audio.play(); } catch {} });
    };
    const leavingRef = useRef(false);
    const handleLeaveRoom = async (skipNavigate?: boolean) => {
        if (leavingRef.current) return;
        if (!user || !roomId) return;
        leavingRef.current = true;
        if (!skipNavigate) router.push('/lobby');
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) return;
                const raw = roomDoc.data() as unknown as { playerIds?: Record<string, boolean>; host: { uid: string; displayName: string | null } };
                const newPlayerIds = { ...(raw.playerIds || {}) } as Record<string, boolean>;
                delete newPlayerIds[user.uid];
                const remainingIds = Object.keys(newPlayerIds);
                if (remainingIds.length === 0) {
                    transaction.delete(roomRef);
                } else {
                    let newHost = raw.host;
                    if (user.uid === raw.host.uid) {
                        const nextUid = remainingIds[0];
                        newHost = { uid: nextUid, displayName: null };
                    }
                    transaction.update(roomRef, { playerIds: newPlayerIds, host: newHost });
                }
                const pRef = doc(roomRef, 'players', user.uid);
                transaction.delete(pRef);
            });
        } catch (error) {
            console.error("Error performing leave room operation: ", error);
        } finally {
            // Best-effort fallback to ensure removal even if transaction races
            try { await updateDoc(roomRef, { [`playerIds.${user.uid}`]: deleteField() }); } catch {}
            try { await deleteDoc(doc(roomRef, 'players', user.uid)); } catch {}
            leavingRef.current = false;
        }
    };

    // Leave room when user presses browser Back button
    useEffect(() => {
        const onPopState = () => { try { handleLeaveRoom(true); } catch {} ; try { setTimeout(() => { router.replace('/lobby'); try { window.history.pushState({}, '', '/lobby'); } catch {} }, 0); } catch {} };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [user?.uid, roomId, room?.host?.uid]);
    
    // Sync local user's profile to their player document in Firestore
    useEffect(() => {
        if (!user?.uid || !roomId || !userProfile?.displayName) return;
    
        const myPlayerDoc = room?.players?.[user.uid];
        
        // Check if an update is needed to avoid unnecessary writes
        const needsUpdate = !myPlayerDoc || 
                            myPlayerDoc.displayName !== userProfile.displayName || 
                            myPlayerDoc.tag !== userProfile.tag;
    
        if (needsUpdate) {
            const playerRef = doc(db, 'rooms', roomId, 'players', user.uid);
            // Use setDoc with merge to create or update
            setDoc(playerRef, {
                displayName: userProfile.displayName,
                tag: userProfile.tag
            }, { merge: true })
            .catch(err => console.error("Failed to sync profile to player doc:", err));
        }
    }, [user?.uid, roomId, userProfile?.displayName, userProfile?.tag, room?.players]);

    const [isTogglingReady, setIsTogglingReady] = useState(false);
    const [isTogglingMute, setIsTogglingMute] = useState(false);
    const [startCountdown, setStartCountdown] = useState<number | null>(null);
    const countdownTimerRef = useRef<number | null>(null);

    // Removed array retry helper after migrating to players map updates

    const handleToggleReady = () => {
        if (isTogglingReady) return;
        if (!user || !room) return;
        // Host does not toggle ready
        if (room.host?.uid === user.uid) return;
        const roomRef = doc(db, "rooms", roomId);

        const current = room.players[user.uid];
        if (!current) return;
        const newReady = !current.isReady;
        // Optimistic UI
        setRoom({ ...room, players: { ...room.players, [user.uid]: { ...current, isReady: newReady } } });
        setIsTogglingReady(true);
        (async () => {
            try {
                await setDoc(doc(roomRef, 'players', user.uid), { isReady: newReady } as Partial<Player>, { merge: true });
            } catch (err) {
                toast.error("Could not update ready status.");
                // Revert UI
                setRoom({ ...room, players: { ...room.players, [user.uid]: { ...current } } });
            } finally {
                setIsTogglingReady(false);
            }
        })();
    };
    
    const handleToggleMute = () => {
        if (isTogglingMute) return;
        if (!user || !room) return;
        const roomRef = doc(db, "rooms", roomId);

        const current = room.players[user.uid];
        const baseMuted = typeof current?.isMuted === 'boolean' ? current.isMuted : localMuted;
        const newMutedState = !baseMuted;
        lastLocalMicChangeRef.current = Date.now();
        localMicWantedRef.current = !newMutedState;

        if (audioStreamRef.current) {
            try { audioStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !newMutedState; }); } catch {}
        }

        // Optimistic UI: if current missing, synthesize a minimal player entry
        const nextPlayer: Player = current ? { ...current, isMuted: newMutedState } : {
          uid: user.uid,
          displayName: userProfile?.displayName ?? user.displayName ?? null,
          tag: userProfile?.tag ?? null,
          isReady: false,
          isMuted: newMutedState,
          isSpeaking: false,
          isLoaded: false,
          status: 'connected'
        } as Player;
        setRoom({ ...room, players: { ...room.players, [user.uid]: nextPlayer } });
        setLocalMuted(newMutedState);
        try { localStorage.setItem('micWanted', String(!newMutedState)); } catch {}

        setIsTogglingMute(true);
        (async () => {
            try {
                await setDoc(doc(roomRef, 'players', user.uid), { isMuted: newMutedState } as Partial<Player>, { merge: true });
            } finally {
                setIsTogglingMute(false);
            }
        })();
    };

    // Local-only mute/volume controls for individual peers
    const handleLocalMutePeer = (peerId: string) => {
        setPeerMuted(prev => ({ ...prev, [peerId]: !prev?.[peerId] }));
    };
    const handleLocalVolumePeer = (peerId: string, vol: number) => {
        const clamped = Math.max(0, Math.min(1, vol));
        setPeerVolumes(prev => ({ ...prev, [peerId]: clamped }));
    };

    useEffect(() => {
      const onDeviceChange = () => {
        const t = micTrackRef.current;
        if (!t || t.readyState !== 'live') {
          navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            const track = stream.getAudioTracks()[0];
            micTrackRef.current = track;
            try { track.enabled = localMicWantedRef.current; } catch {}
            audioStreamRef.current = stream;
            // Replace to existing senders
            peerConnectionsRef.current.forEach((pc) => {
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
const handleSendMessage = async () => {
        if (!user || !room || !chatMessage.trim()) return;
        const senderProfile = room.players?.[user.uid];
        const senderDisplay = senderProfile?.displayName ?? userProfile?.displayName ?? user.displayName ?? 'Guest';
        const newMessage: ChatMessage = { sender: senderDisplay, senderUID: user.uid, text: chatMessage.trim(), timestamp: Timestamp.now() };
        try {
            await updateDoc(doc(db, "rooms", roomId), { chatMessages: arrayUnion(newMessage), updatedAt: serverTimestamp() });
            setChatMessage("");
            // keep focus for continuous typing
            try { chatInputRef.current?.focus(); } catch {}
        } catch (err) {
            console.error('Failed to send message', err);
            toast.error('Failed to send message');
        }
    };
const handleKickPlayer = async (playerId: string) => {
        if (!room || !user || user.uid !== room.host.uid || playerId === user.uid) {
            toast.error("You don't have permission to do that.");
return;
        }
        
        const roomRef = doc(db, "rooms", roomId);
try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) throw new Error("Room does not exist.");
                const raw = roomDoc.data() as unknown as { playerIds?: Record<string, boolean> };
                const newPlayerIds = { ...(raw.playerIds || {}) };
                // fetch current player displayName from our room state map if available
                const playerToKick = room.players[playerId];
                delete newPlayerIds[playerId];
                transaction.update(roomRef, { playerIds: newPlayerIds });
                const pRef = doc(roomRef, 'players', playerId);
                transaction.delete(pRef);
                if (playerToKick) toast.success(`${playerToKick.displayName} was kicked.`);
            });
} catch (error) {
            console.error("Error kicking player:", error);
toast.error("Failed to kick player.");
        }
    };

    const handleMakeHost = async (playerId: string) => {
        if (user?.uid !== room?.host.uid || !room) return;
const newHost = room.players[playerId];
        if (newHost) await updateDoc(doc(db, "rooms", roomId), { host: { uid: newHost.uid, displayName: newHost.displayName } });
};

    const handleSendInvite = async (friend: UserProfile) => {
        if (!user || !room || !userProfile) return;
try {
            await addDoc(collection(db, "invitations"), {
                from: { uid: user.uid, displayName: userProfile.displayName },
                to: { uid: friend.uid },
                roomId: room.id, roomName: room.name, status: 'pending', createdAt: serverTimestamp()
            });
toast.success(`Invite sent to ${friend.displayName}`);
        } catch (error) { toast.error("Failed to send invite.");
}
    }
    
    const handleUpdateRoomName = async () => {
        if (!room || !isHost || !newRoomName.trim() || newRoomName === room.name) {
            setIsEditingName(false);
setNewRoomName(room?.name || '');
            return;
        }
        try {
            await updateDoc(doc(db, "rooms", roomId), { name: newRoomName });
toast.success("Room name updated.");
            setIsEditingName(false);
        } catch (error) {
            toast.error("Failed to update room name.");
console.error(error);
        }
    };

    const handleStartGame = async () => {
        if (!room) return;
        const players = (Object.values(room.players || {}) as Player[]);
        const nonHostPlayers: Player[] = players.filter((p: Player) => p.uid !== room.host.uid);
        const readyCount = nonHostPlayers.filter(p => p.isReady).length;
        const total = nonHostPlayers.length;
        const allReady = total > 0 && readyCount === total;
        const halfOrMore = total > 0 && readyCount >= Math.ceil(total / 2);

        if (players.length < 2) { toast.error('You need at least 2 players to start.'); return; }

        if (allReady) {
          toast.info('Starting game...');
          try { await updateDoc(doc(db, 'rooms', roomId), { status: 'loading' }); } catch (error) { console.error('Error starting game:', error); toast.error('Could not start the game.'); }
          return;
        }
        if (halfOrMore) {
          if (startCountdown != null) return; // already counting
          setStartCountdown(5);
          countdownTimerRef.current = window.setInterval(async () => {
            setStartCountdown(prev => {
              const next = (prev ?? 0) - 1;
              if (next <= 0) {
                if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
                (async () => { try { await updateDoc(doc(db, 'rooms', roomId), { status: 'loading' }); } catch (e) { console.error(e); } })();
                return null;
              }
              return next;
            });
          }, 1000);
          toast.info('Starting in 5 seconds...');
          return;
        }
        toast.error('Need at least half the players ready.');
    };

    const handleCancelStart = () => {
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      setStartCountdown(null);
      toast.info('Start cancelled');
    };

    // Auto-manage countdown based on readiness of non-host players
    useEffect(() => {
      if (!room || !user) return;
      const isHostLocal = user.uid === room.host.uid;
      if (!isHostLocal) return;
      const players = (Object.values(room.players || {}) as Player[]);
      if (players.length < 2) { if (startCountdown != null) handleCancelStart(); return; }
      const nonHostPlayers: Player[] = players.filter((p: Player) => p.uid !== room.host.uid);
      const readyCount = nonHostPlayers.filter((p: Player) => p.isReady).length;
      const total = nonHostPlayers.length;
      const allReady = total > 0 && readyCount === total;
      const halfOrMore = total > 0 && readyCount >= Math.ceil(total / 2);

      if (allReady) {
        // start immediately
        if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
        setStartCountdown(null);
        (async () => { try { await updateDoc(doc(db, 'rooms', roomId), { status: 'loading' }); } catch {} })();
        return;
      }
      if (halfOrMore) {
        if (startCountdown == null && !countdownTimerRef.current) {
          setStartCountdown(5);
          countdownTimerRef.current = window.setInterval(() => {
            setStartCountdown(prev => {
              const next = (prev ?? 0) - 1;
              if (next <= 0) {
                if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
                (async () => { try { await updateDoc(doc(db, 'rooms', roomId), { status: 'loading' }); } catch {} })();
                return null;
              }
              return next;
            });
          }, 1000);
          toast.info('Starting in 5 seconds...');
        }
      } else {
        // below threshold: cancel any active countdown
        if (startCountdown != null || countdownTimerRef.current) {
          handleCancelStart();
        }
      }
    }, [room?.players, user?.uid, room?.host?.uid, startCountdown, roomId]);
    
    useEffect(() => {
        if (!user) return;
    
        const sentQuery = query(collection(db, "friendRequests"), where("from.uid", "==", user.uid));
        const incomingQuery = query(collection(db, "friendRequests"), where("to.uid", "==", user.uid));
    
        const unsubSent = onSnapshot(sentQuery, (snapshot) => {
          const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
          
setSentRequests(requests);
        });
    
        const unsubIncoming = onSnapshot(incomingQuery, (snapshot) => {
          const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
          setIncomingRequests(requests);
        });
    
        return () => {
          unsubSent();
          
unsubIncoming();
        };
    }, [user]);
const isFriend = (targetUid: string) => userProfile?.friends?.includes(targetUid);
    const isRequestPendingWith = (targetUid: string) => {
        if (!user) return false;
        // Treat self as already pending to fully disable UI paths
        if (targetUid === user.uid) return true;
        return sentRequests.some(req => req.to.uid === targetUid && req.status === 'pending') ||
               incomingRequests.some(req => req.from.uid === targetUid && req.status === 'pending');
    };
    const handleSendFriendRequest = async (targetPlayer: Player) => {
        if (!user) return;
        const targetUid = targetPlayer?.uid;
        if (!targetUid) { toast.error("Invalid player."); return; }
        // Always block self-add, even if userProfile hasn't loaded yet
        if (targetUid === user.uid) { toast.error("You cannot add yourself as a friend."); return; }
        if (!userProfile) { toast.error("Profile not loaded yet. Try again."); return; }
        if (isFriend(targetUid) || isRequestPendingWith(targetUid)) {
            toast.info("You are already friends or have a pending request.");
            return;
        }
        const requestId = [user.uid, targetUid].sort().join('_');
        const requestRef = doc(db, "friendRequests", requestId);
    
        try {
            await setDoc(requestRef, {
                from: { uid: user.uid, displayName: userProfile.displayName ?? null, tag: userProfile.tag ?? null },
                to: { uid: targetUid, displayName: targetPlayer.displayName ?? null, tag: targetPlayer.tag ?? null },
                status: 'pending',
              
  createdAt: serverTimestamp()
            });
            toast.success(`Friend request sent to ${targetPlayer.displayName}`);
        } catch (error) {
            console.error("Error sending friend request:", error);
            toast.error("Failed to send friend request.");
        }
    };
    
    const isHost = user?.uid === room?.host.uid;

    const canStartGame = React.useMemo(() => {
        if (!room) return false;
        const players = (Object.values(room.players || {}) as Player[]);
        if (players.length < 2) return false;
        const nonHostPlayers = players.filter((p: Player) => p.uid !== room.host.uid);
        if (nonHostPlayers.length === 0 && players.length > 1) return true;
        const readyCount = nonHostPlayers.filter(p => p.isReady).length;
        const allReady = readyCount === nonHostPlayers.length && nonHostPlayers.length > 0;
        const halfOrMore = readyCount >= Math.ceil((nonHostPlayers.length || 1) / 2);
        return allReady || halfOrMore;
    }, [room]);

    if (loading || !room || !user) {
        return <div className="flex items-center justify-center min-h-screen bg-zinc-900"><LoaderCircle className="h-8 w-8 animate-spin text-green-400" /></div>;
    }

    const myUid = user!.uid;
    const myFallback: Partial<Player> = {
      displayName: userProfile?.displayName ?? user.displayName ?? null,
      tag: userProfile?.tag ?? null,
      isReady: false,
      isMuted: localMuted,
      isSpeaking: false,
      isLoaded: false,
      status: 'connected',
    };
    const myPlayer: Player = { ...myFallback, ...(room.players[myUid] as Player || {}), uid: myUid } as Player;
    // Build list from playerIds to keep stable seating; enrich from players subdocs
    const participantIds = Object.keys(room.playerIds || {});
    const playersList: Player[] = participantIds.map(id => {
      const fallback: Partial<Player> = {
        displayName: id === myUid ? (userProfile?.displayName ?? user.displayName ?? null) : (userNames[id] || null),
        tag: null,
        isReady: false,
        isMuted: false,
        isSpeaking: false,
        isLoaded: false,
        status: 'connected'
      };
      const fromDoc = room.players[id] as Partial<Player> | undefined;
      return { ...fallback, ...(fromDoc || {}), uid: id } as Player;
    });
const renderPlayerSlots = () => Array.from({ length: room.maxPlayers }).map((_, i) => {
        const p: Player | undefined = playersList[i];
        if (p) {
            const isCurrentUser = p.uid === myUid;
            const isPlayerHost = p.uid === room.host.uid;
            const isSpeaking = speakingPeers[p.uid] && !p.isMuted;
            
     
        return (
                <div key={p.uid} className={cn('relative bg-zinc-800 rounded-lg p-4 flex flex-col items-center justify-between border-2 transition-all duration-200 min-h-[320px]', isSpeaking ? 'border-blue-400 shadow-lg shadow-blue-400/20' : isPlayerHost ? 'border-yellow-500' : p.isReady ? 'border-green-500' : 'border-zinc-700', p.status === 'disconnected' && 'opacity-50')}>
                    {!isCurrentUser && (
                        <div 
className="absolute top-1 right-1" ref={menuRef}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-zinc-700" onClick={() => setPlayerMenuOpen(playerMenuOpen === p.uid ?
null : p.uid)}>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                            {playerMenuOpen === p.uid && (
   
                             <div className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg z-10 overflow-hidden p-1">
                                    {isHost && (
                      
              <>
                                        <button onClick={() => { handleMakeHost(p.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><Star className="w-4 h-4" /> Make Host</button>
                        
                <button onClick={() => { handleKickPlayer(p.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><UserX className="w-4 h-4" /> Kick Player</button>
                                    </>
                          
          )}
                                    {/* Local audio controls */}
                                    <div className="w-full border-t border-zinc-800 my-1" />
                                    <button onClick={() => { handleLocalMutePeer(p.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors">
                                        {(peerMuted && peerMuted[p.uid]) ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />} {(peerMuted && peerMuted[p.uid]) ? 'Unmute Locally' : 'Mute Locally'}
                                    </button>
                                    <div className="px-3 py-2 text-xs text-zinc-400">
                                        <div className="flex items-center justify-between mb-1"><span>Volume</span><span>{Math.round(((peerVolumes && peerVolumes[p.uid]) ?? 1) * 100)}%</span></div>
                                        <input type="range" min={0} max={1} step={0.05} value={(peerVolumes && peerVolumes[p.uid]) ?? 1} onChange={(e) => handleLocalVolumePeer(p.uid, parseFloat((e.target as HTMLInputElement).value))} className="w-full" />
                                    </div>
                                    {/* Do not allow adding yourself under any circumstance */}
                                    {!isCurrentUser && !isFriend(p.uid) && !isRequestPendingWith(p.uid) && (
                                        <button onClick={() => { handleSendFriendRequest(p);
setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors">
                                            <UserPlus className="w-4 h-4" /> Add Friend
                                        </button>
                                     
                                 )}
                                    {isFriend(p.uid) && (
                                 
       <div className="px-3 py-2 text-sm text-zinc-400 flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Already Friends</div>
                                    )}
                                    {isRequestPendingWith(p.uid) && (
      
                                  <div className="px-3 py-2 text-sm text-zinc-400 flex items-center gap-2"><Hourglass className="w-4 h-4" /> Request Pending</div>
                                    )}
                  
              </div>
                            )}
                        </div>
                    )}

                    <div className="text-center">
                        <div className="w-24 h-24 bg-zinc-700 rounded-md mb-2 flex items-center justify-center relative mx-auto">
                           <UserIcon className="w-16 h-16 text-zinc-500"/>
                           {isSpeaking && <Volume2 className="absolute bottom-1 right-1 w-5 h-5 text-blue-400" />}
                        </div>
                        <h4 className="font-bold text-lg flex items-center justify-center gap-2 truncate w-full mt-4">
                            {isPlayerHost && <Crown className="w-4 h-4 text-yellow-400" />}
                            {p.displayName || userNames[p.uid] || `---`}
                        </h4>
                        <p className="text-sm text-zinc-400">{p.tag}</p>
                    </div>

                    <div className="text-base font-bold h-6 flex items-center justify-center">
                        {isPlayerHost ? (
                            <span className="flex items-center gap-1.5 px-3 py-1 bg-yellow-900/50 border border-yellow-600/50 rounded-full text-yellow-400 text-sm font-semibold">
                                <Crown className="h-4 w-4" />
                                HOST
                            </span>
                        ) : p.status === 'disconnected' ? (
                            <span className="text-zinc-500 font-semibold">Disconnected</span>
                        ) : p.isReady ? (
                            <span className="text-green-400">Ready</span>
                        ) : (
                            <span className="text-yellow-400">Not Ready</span>
                        )}
                    </div>
                </div>
            );
        }
        return <div key={`slot-${i}`} className="bg-zinc-800/50 rounded-lg p-3 flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 text-zinc-500 min-h-[320px]"><p className="text-sm">Empty Slot</p></div>;
    });

    return (
        <div className="dark font-sans bg-zinc-900 text-white h-screen overflow-hidden flex flex-col">
            {/* Audio elements for remote streams, hidden */}
             {Object.entries(remoteStreams).map(([peerId, stream]) => (
                <audio
                    key={peerId}
                    autoPlay
                    playsInline
                    muted={false}
                    onCanPlay={e => { try { (e.currentTarget as HTMLAudioElement).play(); } catch {} }}
                    ref={el => {
                        if (!el) return;
                        remoteAudioElementsRef.current.set(peerId, el);
                        if (el.srcObject !== stream) el.srcObject = stream as MediaStream;
                        try { el.play(); } catch {}
                    }}
                />
            ))}
            <header className="p-4 flex items-center justify-between border-b border-zinc-800">
                <div className="flex items-center gap-2">
                    {isEditingName ? (
                        <div className="flex items-center gap-2">
                            <Input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateRoomName()} className="w-48 h-8" />
                            <Button size="icon" variant="ghost" onClick={handleUpdateRoomName} className="h-8 w-8"><Check className="h-4 w-4"/></Button>
                            <Button size="icon" variant="ghost" onClick={() => { setIsEditingName(false); setNewRoomName(room.name); }} className="h-8 w-8"><XIcon className="h-4 w-4"/></Button>
                        </div>
                    ) : (
                        <h1 className="text-xl font-bold">{room.name}</h1>
                    )}
                    {isHost && !isEditingName && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditingName(true)}><Pencil className="h-4 w-4" /></Button>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <Users className="w-4 h-4" />
                    <span>{playersList.length} / {room.maxPlayers}</span>
                </div>
            </header>
            <main className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 overflow-y-auto custom-scrollbar">
                    {renderPlayerSlots()}
                </div>
                <aside className={cn("w-full max-w-sm bg-zinc-950/50 border-l border-zinc-800 flex flex-col min-h-0 overflow-hidden transition-all duration-300", isChatVisible ? "translate-x-0" : "translate-x-full absolute right-0 h-full")}>
                    <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
                        <h3 className="font-semibold">Lobby Chat</h3>
                    </div>
                    <div className="flex-1 p-3 space-y-3 overflow-y-auto pr-2 custom-scrollbar text-sm">
                        {room.chatMessages.map((msg, i) => (
                           <div key={`${msg.senderUID}-${msg.timestamp?.seconds ?? i}`} className={cn("flex flex-col w-full", msg.senderUID === myUid ? "items-end" : "items-start")}>
                               <div className={cn("max-w-[90%] rounded-lg px-3 py-2", msg.senderUID === myUid ? "bg-primary text-primary-foreground" : "bg-zinc-800")}>
                                   {msg.senderUID !== myUid && <p className="text-xs font-bold text-blue-400 mb-1">{msg.sender}</p>}
                                   <p className="text-sm break-words">{msg.text}</p>
                               </div>
                               <span className="text-xs text-zinc-500 mt-1 px-1">
                                   {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                               </span>
                           </div>
                       ))}
                       <div ref={chatEndRef} />
                    </div>
                    <div className="p-3 border-t border-zinc-800 flex gap-2">
                        <Textarea 
                            ref={chatInputRef}
                            placeholder="Type a message..." 
                            value={chatMessage} 
                            onChange={e => setChatMessage(e.target.value)} 
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                            rows={1}
                        />
                        <Button onClick={handleSendMessage} disabled={!chatMessage.trim()}><Send className="w-4 h-4"/></Button>
                    </div>
                </aside>
            </main>
            <footer className="p-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => { void handleLeaveRoom(); }}>Leave Room</Button>
                    <Button variant="secondary" onClick={() => setInviteDialogOpen(true)}>Invite Friends</Button>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Button 
                            onClick={handleToggleMute}
                            variant={localMuted ? "destructive" : "secondary"}
                            className="w-28"
                            disabled={!micReady || isTogglingMute}
                        >
                            {localMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                            {localMuted ? 'Unmute' : 'Mute'}
                        </Button>
                    </div>
                    <Button 
                        onClick={handleToggleReady} 
                        variant={isHost || myPlayer.isReady ? "secondary" : "default"} 
                        className="w-32" 
                        disabled={isHost || isTogglingReady}
                    >
                        {isHost ? 'Host' : (myPlayer.isReady ? 'Not Ready' : 'Ready Up')}
                    </Button>
                    {isHost && (
                        startCountdown != null ? (
                          <Button onClick={handleCancelStart} className="w-32 bg-red-600 hover:bg-red-700 text-white">Cancel {startCountdown ?? ''}</Button>
                        ) : (
                          <Button 
                              onClick={handleStartGame} 
                              className="w-32 bg-green-600 hover:bg-green-700 text-white"
                              disabled={!canStartGame}
                          >
                              Start Game
                          </Button>
                        )
                    )}
                </div>
            </footer>
             <Dialog open={isInviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite Friends</DialogTitle>
                        <DialogDescription>Select online friends to invite to your room.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                        {onlineFriends.length > 0 ? onlineFriends.map(friend => (
                            <div key={friend.uid} className="flex items-center justify-between p-2 rounded-md hover:bg-zinc-800">
                                <span>{friend.displayName}{friend.tag}</span>
                                <Button size="sm" variant="secondary" onClick={() => handleSendInvite(friend)}>Invite</Button>
                            </div>
                        )) : (
                            <p className="text-center text-zinc-400">No online friends available to invite.</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
