/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, InputHTMLAttributes, ButtonHTMLAttributes, useRef, HTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, Timestamp, runTransaction, arrayRemove, collection, query, where, writeBatch, getDocs, addDoc, serverTimestamp, getDoc, setDoc } from 'firebase/firestore';
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LoaderCircle, User as UserIcon, Users, MessageSquare, Send, Crown, Mic, MicOff, MoreVertical, UserX, Star, Volume2, Pencil, Check, X as XIcon, UserPlus, Hourglass } from 'lucide-react';
import { toast } from "sonner";


// --- TYPES ---
interface Player {
    uid: string;
    displayName: string | null;
    tag: string | null;
    isReady: boolean;
    isMuted: boolean;
    isSpeaking: boolean;
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
    host: { uid: string; displayName: string | null; };
    players: Player[];
    playerIds: string[];
    chatMessages: ChatMessage[];
    createdAt: Timestamp;
    status: 'waiting' | 'loading' | 'playing' | 'finished';
}

interface FriendRequest {
  id: string;
  from: { uid: string; displayName: string | null; tag: string | null; };
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
            "flex w-full rounded-md border border-input bg-zinc-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none",
            "min-h-[40px] max-h-32 overflow-y-auto",
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
const DialogTitle = forwardRef< React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName
const DialogDescription = forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;


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
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const roomStateRef = useRef<GameRoom | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Audio processing and WebRTC refs
    const audioStreamRef = useRef<MediaStream | null>(null);
    const isSpeakingRef = useRef(false);
    const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
    const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
    const micGainRef = useRef<GainNode | null>(null);
    const [micGain, setMicGain] = useState<number>(1);
    const [masterVolume, setMasterVolume] = useState<number>(1);
    const iceCandidateQueues = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
    const lastDbUpdateRef = useRef(0);
    
    const localMonitorRef = useRef<HTMLAudioElement | null>(null);
    const [monitorOn, setMonitorOn] = useState<boolean>(false);

    useEffect(() => {
        const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (!currentUser) { router.push('/'); return; }
            setUser(currentUser);
            const userDocRef = doc(db, "users", currentUser.uid);
            const userUnsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) setUserProfile(docSnap.data() as UserProfile);
            });
            return () => userUnsubscribe();
        });
        return () => authUnsubscribe();
    }, [router]);

    useEffect(() => {
        if (!roomId || !user) return;
        const roomRef = doc(db, "rooms", roomId);
        const roomUnsubscribe = onSnapshot(roomRef, (docSnap) => {
            if (docSnap.exists()) {
                const roomData = { id: docSnap.id, ...docSnap.data() } as GameRoom;
                if (!roomData.playerIds.includes(user.uid)) {
                    toast.error("You are not a member of this room."); router.push('/lobby'); return;
                }
                setRoom(roomData); roomStateRef.current = roomData; setLoading(false);
                if (!isEditingName) setNewRoomName(roomData.name);
            } else {
                toast.error("Room not found."); router.push('/lobby');
            }
        });
        return () => roomUnsubscribe();
    }, [roomId, user, router, isEditingName]);
    
    useEffect(() => {
        if (!user?.uid || !roomId) return;
        let animationFrameId: number; let localStream: MediaStream; let audioContext: AudioContext; let analyser: AnalyserNode; let source: MediaStreamAudioSourceNode; let dataArray: Uint8Array;
    
        const DB_UPDATE_INTERVAL = 300; // ms

        const updateSpeakingStatus = (isSpeaking: boolean) => {
            if (!user || !roomId) return;
            const roomRef = doc(db, "rooms", roomId);
            runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) return;
                const players = (roomDoc.data().players || []) as Player[];
                const playerIndex = players.findIndex(p => p.uid === user.uid);
                if (playerIndex !== -1 && players[playerIndex].isSpeaking !== isSpeaking) {
                    const newPlayers = [...players];
                    newPlayers[playerIndex].isSpeaking = isSpeaking;
                    transaction.update(roomRef, { players: newPlayers });
                }
            }).catch(err => {
                if (err.code !== 'aborted') { // Don't log expected contention errors
                    console.warn('Could not update speaking status in lobby', err);
                }
            });
        };
    
        const setupMic = async () => {
            try {
                const constraints = {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    }
                };
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
                audioStreamRef.current = localStream;
                const currentPlayer = roomStateRef.current?.players.find(p => p.uid === user.uid);

                if (monitorOn && localMonitorRef.current) {
                    const a = localMonitorRef.current;
                    a.srcObject = localStream;
                    a.muted = false;
                    a.volume = 1.0;
                    a.play().catch(() => {});
                }

                localStream.getAudioTracks().forEach(track => { track.enabled = !!currentPlayer && !currentPlayer.isMuted; });
                
                interface AudioContextWindow extends Window { webkitAudioContext?: typeof AudioContext }
                const StdAudioContext: typeof AudioContext | undefined = (window as Window & typeof globalThis).AudioContext;
                const WebkitAudioContext = (window as unknown as AudioContextWindow).webkitAudioContext;
                const AudioCtx = StdAudioContext ?? WebkitAudioContext;
                if (!AudioCtx) throw new Error("AudioContext not supported");
                
                audioContext = new AudioCtx();
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                analyser.minDecibels = -90;
                analyser.maxDecibels = -10;
                analyser.smoothingTimeConstant = 0.85;

                source = audioContext.createMediaStreamSource(localStream);
                source.connect(analyser);
                dataArray = new Uint8Array(analyser.frequencyBinCount);

                const detectSpeaking = () => {
                    (analyser.getByteFrequencyData as (arr: Uint8Array) => void)(dataArray as unknown as Uint8Array);
                    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
                    const speaking = average > 15;

                    if (speaking !== isSpeakingRef.current) {
                        isSpeakingRef.current = speaking;
                        const now = Date.now();
                        if (now - lastDbUpdateRef.current > DB_UPDATE_INTERVAL) {
                            lastDbUpdateRef.current = now;
                            updateSpeakingStatus(speaking);
                        }
                    }
                    animationFrameId = requestAnimationFrame(detectSpeaking);
                };

                detectSpeaking();
            } catch (err) {
                console.error("Mic access error:", err);
                toast.error("Could not access microphone.");
            }
        };
        setupMic();
        return () => { cancelAnimationFrame(animationFrameId); localStream?.getTracks().forEach(track => track.stop()); audioContext?.close().catch(() => {}); };
    }, [user?.uid, roomId, monitorOn]);

    // WebRTC connection management
    useEffect(() => {
        if (!user || !roomId || !audioStreamRef.current || !room?.players) return;

        const myId = user.uid;
        const roomRef = doc(db, "rooms", roomId);
        const signalingCollection = collection(roomRef, 'signaling');
        const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 8 };
        const localPeerConnections = { ...peerConnectionsRef.current };

        const createPeerConnection = (peerId: string, initiator: boolean) => {
            if (localPeerConnections[peerId]) return localPeerConnections[peerId];

            const pc = new RTCPeerConnection(pcConfig);
            localPeerConnections[peerId] = pc;

            audioStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
            pc.getSenders().forEach(s => {
                try {
                    if (s.track && s.track.kind === 'audio') {
                        const p = s.getParameters();
                        p.encodings = [{ maxBitrate: 32000 }];
                        s.setParameters(p).catch(() => {});
                    }
                } catch {}
            });
        

            pc.ontrack = (event) => {
                setRemoteStreams(prev => {
                    if (prev[peerId] !== event.streams[0]) {
                        return { ...prev, [peerId]: event.streams[0] };
                    }
                    return prev;
                });
            };

            pc.onicecandidate = event => {
                if (event.candidate) {
                    addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
                }
            };

            if (initiator) {
                let makingOffer = false;
                pc.onnegotiationneeded = async () => {
                    if (makingOffer) {
                        return;
                    }
                    try {
                        makingOffer = true;
                        if (pc.signalingState === 'stable') {
                            const offer = await pc.createOffer();
                            await pc.setLocalDescription(offer);
                            await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } });
                        }
                    } catch (err) { 
                        console.error(`[${myId}] Create offer error to ${peerId}:`, err); 
                    } finally {
                        makingOffer = false;
                    }
                };
            }
            return pc;
        };

        const playerIds = room.playerIds.filter(id => id !== myId);

        playerIds.forEach(peerId => {
            const isInitiator = myId < peerId;
            createPeerConnection(peerId, isInitiator);
        });

        Object.keys(localPeerConnections).forEach(peerId => {
            if (!playerIds.includes(peerId)) {
                localPeerConnections[peerId].close();
                delete localPeerConnections[peerId];
            }
        });

        peerConnectionsRef.current = localPeerConnections;

        const q = query(signalingCollection, where("to", "==", myId));
        const signalingUnsubscribe = onSnapshot(q, async (snapshot) => {
            for (const change of snapshot.docChanges()) {
                if (change.type === "added") {
                    const signalDoc = change.doc;
                    const { from: fromId, signal } = signalDoc.data();
                    const pc = peerConnectionsRef.current[fromId];

                    if (!pc) {
                        await deleteDoc(signalDoc.ref);
                        continue;
                    }

                    try {
                        if (signal.type === 'offer') {
                            if (pc.signalingState !== 'stable') {
                               console.warn(`[${myId}] Ignoring offer from ${fromId} due to non-stable state: ${pc.signalingState}`);
                            } else {
                                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                                const queue = iceCandidateQueues.current[fromId] || [];
                                for(const candidate of queue) { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
                                iceCandidateQueues.current[fromId] = [];
                                const answer = await pc.createAnswer();
                                await pc.setLocalDescription(answer);
                                await addDoc(signalingCollection, { from: myId, to: fromId, signal: { type: 'answer', sdp: pc.localDescription?.sdp } });
                            }
                        } else if (signal.type === 'answer') {
                            if (pc.signalingState === 'have-local-offer') {
                                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                                 const queue = iceCandidateQueues.current[fromId] || [];
                                for(const candidate of queue) { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
                                iceCandidateQueues.current[fromId] = [];
                            } else {
                                console.warn(`[${myId}] Received answer from ${fromId} in wrong state: ${pc.signalingState}`);
                            }
                        } else if (signal.candidate) {
                           if (pc.remoteDescription) {
                               await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                           } else {
                               if (!iceCandidateQueues.current[fromId]) iceCandidateQueues.current[fromId] = [];
                               iceCandidateQueues.current[fromId].push(signal.candidate);
                           }
                        }
                    } catch (err) {
                        console.error(`Error processing signal type ${signal.type} from ${fromId}:`, err);
                    }
                    
                    await deleteDoc(signalDoc.ref);
                }
            }
        });

        return () => {
            signalingUnsubscribe();
            Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
            peerConnectionsRef.current = {};
        };
    }, [roomId, user, room?.playerIds.sort().join(','), audioStreamRef.current]);
    
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [room?.chatMessages]);

    // Respond to monitor toggle
    useEffect(() => {
        const a = localMonitorRef.current;
        if (!a) return;
        if (monitorOn && audioStreamRef.current) {
            a.srcObject = audioStreamRef.current;
            a.muted = false;
            a.volume = 1.0;
            a.play().catch(() => {});
        } else {
            a.pause();
            a.srcObject = null
        }
    }, [monitorOn, audioStreamRef.current]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setPlayerMenuOpen(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!userProfile?.friends || userProfile.friends.length === 0) { setOnlineFriends([]); return; }
        const friendsQuery = query(collection(db, "users"), where('uid', 'in', userProfile.friends));
        const unsubscribe = onSnapshot(friendsQuery, (snapshot) => {
            const friendsData = snapshot.docs.map(d => d.data() as UserProfile);
            const availableFriends = friendsData.filter(f => f.status === 'online' && !room?.playerIds.includes(f.uid));
            setOnlineFriends(availableFriends);
        });
        return () => unsubscribe();
    }, [userProfile, room?.playerIds]);

    useEffect(() => {
        if (room?.status === 'loading') {
            router.push(`/room/${roomId}/game`);
        }
    }, [room?.status, roomId, router]);
    
    const handleLeaveRoom = async () => {
        if (!user || !roomId) return;
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) return;

                const roomData = roomDoc.data() as GameRoom;
                
                if (roomData.players.length <= 1) {
                    transaction.delete(roomRef);
                    return;
                }

                const newPlayers = roomData.players.filter(p => p.uid !== user.uid);
                const newPlayerIds = roomData.playerIds.filter(id => id !== user.uid);
                let newHost = roomData.host;

                if (user.uid === roomData.host.uid && newPlayers.length > 0) {
                    const nextPlayer = newPlayers[0];
                    if (nextPlayer) newHost = { uid: nextPlayer.uid, displayName: nextPlayer.displayName };
                }
                transaction.update(roomRef, { players: newPlayers, playerIds: newPlayerIds, host: newHost });
            });
        } catch (error) { 
            console.error("Error performing leave room operation: ", error); 
        }
        router.push('/lobby');
    };
    
    const handleToggleReady = async () => {
        if (!user || !roomId) return;
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) throw new Error("Room does not exist.");
                const currentPlayers = (roomDoc.data().players || []) as Player[];
                const playerIndex = currentPlayers.findIndex(p => p.uid === user.uid);

                if (playerIndex > -1) {
                    const newPlayers = [...currentPlayers];
                    newPlayers[playerIndex] = { ...newPlayers[playerIndex], isReady: !newPlayers[playerIndex].isReady };
                    transaction.update(roomRef, { players: newPlayers });
                }
            });
        } catch(e) {
            console.error("Failed to toggle ready state:", e);
            toast.error("Could not update ready status.");
        }
    };
    
    const handleToggleMute = async () => {
        if (!user || !room) return;
        const player = room.players.find(p => p.uid === user.uid);
        if (player) {
            const newMutedState = !player.isMuted;
            if (audioStreamRef.current) {
                audioStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !newMutedState; });
            }
            
            const roomRef = doc(db, "rooms", roomId);
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) throw new Error("Room does not exist.");
                const currentPlayers = roomDoc.data().players as Player[];
                const updatedPlayers = currentPlayers.map(p => p.uid === user.uid ? { ...p, isMuted: newMutedState } : p);
                transaction.update(roomRef, { players: updatedPlayers });
            }).catch(e => {
                console.error("Mute toggle failed:", e);
                toast.error("Failed to update mute status.");
            });
        }
    };

    const handleSendMessage = async () => {
        if (!user || !room || !chatMessage.trim()) return;
        const senderProfile = room.players.find(p => p.uid === user.uid);
        if (!senderProfile) return;

        const newMessage: ChatMessage = { sender: senderProfile.displayName, senderUID: user.uid, text: chatMessage, timestamp: Timestamp.now() };
        await updateDoc(doc(db, "rooms", roomId), { chatMessages: arrayUnion(newMessage) });
        setChatMessage("");
    };

    const handleKickPlayer = async (playerId: string) => {
        if (!room || !user) {
            toast.error("Room or user data not available");
            return;
        }
        if (user.uid !== room.host.uid) {
            toast.error("Only the host can kick players");
            return;
        }
        if (playerId === user.uid) {
            toast.error("You cannot kick yourself");
            return;
        }
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) throw new Error("Room does not exist.");
                
                const roomData = roomDoc.data() as GameRoom;
                const playerToKick = roomData.players.find(p => p.uid === playerId);
                const newPlayers = roomData.players.filter(p => p.uid !== playerId);
                const newPlayerIds = roomData.playerIds.filter(id => id !== playerId);

                if (newPlayers.length === roomData.players.length) return; // Player not found
                
                transaction.update(roomRef, { players: newPlayers, playerIds: newPlayerIds });
                toast.success(`${playerToKick?.displayName} was kicked.`);
            });
        } catch (error) {
            console.error("Error kicking player:", error);
            toast.error("Failed to kick player.");
        }
    };

    const handleMakeHost = async (playerId: string) => {
        if (user?.uid !== room?.host.uid || !room) return;
        const newHost = room.players.find(p => p.uid === playerId);
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
        } catch (error) { toast.error("Failed to send invite."); }
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
        if(!room) return;
        if (room.players.every(p => p.isReady)) {
            toast.info("Starting game...");
            try {
                await updateDoc(doc(db, "rooms", roomId), { status: 'loading' });
            } catch (error) {
                console.error("Error starting game:", error);
                toast.error("Could not start the game.");
            }
        }
        else { 
            toast.error("Not all players are ready."); 
        }
    };
    
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
        return sentRequests.some(req => req.to.uid === targetUid && req.status === 'pending') || 
               incomingRequests.some(req => req.from.uid === targetUid && req.status === 'pending');
    };
    
    const handleSendFriendRequest = async (targetPlayer: Player) => {
        if (!user || !userProfile) return;
        if (isFriend(targetPlayer.uid) || isRequestPendingWith(targetPlayer.uid)) {
            toast.info("You are already friends or have a pending request.");
            return;
        }
    
        const requestId = [user.uid, targetPlayer.uid].sort().join('_');
        const requestRef = doc(db, "friendRequests", requestId);
    
        try {
            await setDoc(requestRef, {
                from: { uid: user.uid, displayName: userProfile.displayName, tag: userProfile.tag },
                to: { uid: targetPlayer.uid, displayName: targetPlayer.displayName, tag: targetPlayer.tag },
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

    useEffect(() => {
        if (!isHost || !room || !user) return;
    
        const otherPlayerIds = room.playerIds.filter(id => id !== user.uid);
        if (otherPlayerIds.length === 0) return;
    
        const q = query(collection(db, "users"), where('uid', 'in', otherPlayerIds));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.forEach(async (playerDoc) => {
                const playerData = playerDoc.data() as UserProfile;
                const DISCONNECT_THRESHOLD_MS = 20000; // 20 seconds
    
                if (
                    roomStateRef.current?.playerIds.includes(playerData.uid) &&
                    playerData.lastSeen &&
                    (Date.now() - playerData.lastSeen.toDate().getTime() > DISCONNECT_THRESHOLD_MS)
                ) {
                    const roomRef = doc(db, "rooms", roomId);
                    try {
                        await runTransaction(db, async (transaction) => {
                            const roomDoc = await transaction.get(roomRef);
                            if (!roomDoc.exists()) return;
    
                            const currentRoomData = roomDoc.data() as GameRoom;
                            if (!currentRoomData.playerIds.includes(playerData.uid)) return;
    
                            const playerToRemove = currentRoomData.players.find(p => p.uid === playerData.uid);
                            if (!playerToRemove) return;
    
                            const newPlayers = currentRoomData.players.filter(p => p.uid !== playerData.uid);
                            const newPlayerIds = currentRoomData.playerIds.filter((id: string) => id !== playerData.uid);
    
                            transaction.update(roomRef, { players: newPlayers, playerIds: newPlayerIds });
                            toast.info(`${playerToRemove.displayName} left (disconnected).`);
                        });
                    } catch(err) {
                        console.error("Failed to remove offline player:", err);
                    }
                }
            });
        });
    
        return () => unsubscribe();
    }, [isHost, room?.playerIds.join(','), user?.uid, roomId]);


    if (loading || !room || !user) {
        return <div className="flex items-center justify-center min-h-screen bg-zinc-900"><LoaderCircle className="h-8 w-8 animate-spin text-green-400" /></div>;
    }

    const myUid = user!.uid;


    const renderPlayerSlots = () => Array.from({ length: room.maxPlayers }).map((_, i) => {
        const player = room.players[i];
        if (player) {
            const isCurrentUser = player.uid === myUid;
            const isPlayerHost = player.uid === room.host.uid;
            return (
                <div key={player.uid} className={cn('relative bg-zinc-800 rounded-lg p-3 flex flex-col items-center justify-between border-2 transition-all duration-200', player.isSpeaking && !player.isMuted ? 'border-blue-400 shadow-lg shadow-blue-400/20 animate-pulse' : player.isReady ? 'border-green-500' : 'border-zinc-700')}>
            <audio ref={localMonitorRef} autoPlay playsInline style={{ display: 'none' }} />
                    {!isCurrentUser && (
                        <div className="absolute top-1 right-1" ref={menuRef}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-zinc-700" onClick={() => setPlayerMenuOpen(playerMenuOpen === player.uid ? null : player.uid)}>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                            {playerMenuOpen === player.uid && (
                                <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg z-10 overflow-hidden">
                                    {isHost && (
                                    <>
                                        <button onClick={() => { handleMakeHost(player.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><Star className="w-4 h-4" /> Make Host</button>
                                        <button onClick={() => { handleKickPlayer(player.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><UserX className="w-4 h-4" /> Kick Player</button>
                                    </>
                                    )}
                                    {!isFriend(player.uid) && !isRequestPendingWith(player.uid) && (
                                    <button onClick={() => { handleSendFriendRequest(player); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors">
                                        <UserPlus className="w-4 h-4" /> Add Friend
                                    </button>
                                    )}
                                    {isFriend(player.uid) && (
                                        <div className="px-3 py-2 text-sm text-zinc-400 flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Already Friends</div>
                                    )}
                                    {isRequestPendingWith(player.uid) && (
                                        <div className="px-3 py-2 text-sm text-zinc-400 flex items-center gap-2"><Hourglass className="w-4 h-4" /> Request Pending</div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="text-center w-full">
                        <div className="w-16 h-16 bg-zinc-700 rounded-md mb-2 flex items-center justify-center relative mx-auto">
                           <UserIcon className="w-10 h-10 text-zinc-500"/>
                           {player.isSpeaking && !player.isMuted && <Volume2 className="absolute bottom-1 right-1 w-5 h-5 text-blue-400" />}
                        </div>
                        <h4 className="font-bold text-sm flex items-center justify-center gap-1 truncate w-full">
                            {isPlayerHost && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                            <span className="truncate">{player.displayName}</span>
                        </h4>
                        <p className="text-xs text-zinc-400">{player.tag}</p>
                    </div>
                    <div className="w-full mt-2 space-y-1">
                       {isCurrentUser ? (
                         <>
                            <div className="flex gap-2 w-full">
                                <Button onClick={handleToggleReady} className={`w-full ${player.isReady ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'}`}>{player.isReady ? 'Unready' : 'Ready'}</Button>
                                <Button onClick={handleToggleMute} variant="outline" size="icon" className="w-9 h-9 flex-shrink-0">{player.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}</Button>
                            </div>
                            <Button variant="outline" className="w-full" disabled>Customise</Button>
                         </>
                       ) : (
                         <div className={`text-center font-semibold p-2 rounded-md text-xs ${player.isReady ? 'text-green-400 bg-green-900/50' : 'text-zinc-400 bg-zinc-700/50'}`}>{player.isReady ? 'Ready' : 'Not Ready'}</div>
                       )}
                    </div>
                </div>
            );
        } else {
            return (
                <div key={`empty-${i}`} className="bg-zinc-800/50 border-2 border-dashed border-zinc-700 rounded-lg p-3 flex flex-col items-center justify-center text-zinc-500">
                    <Users className="w-8 h-8 mb-2"/><p className="text-xs">Empty Slot</p>
                </div>
            );
        }
    });

    return (
        <div className="dark font-sans bg-zinc-900 text-zinc-100 min-h-screen flex flex-col p-4">
            {Object.entries(remoteStreams).map(([uid, stream]) => (
                 <audio key={uid} ref={audioEl => {
                    if (audioEl && audioEl.srcObject !== stream) {
                        audioEl.srcObject = stream;
                    }
                }} autoPlay playsInline />
            ))}
            
            <header className="flex-shrink-0 bg-black/50 backdrop-blur-sm p-2 rounded-md mb-4">
                <div className="flex justify-between items-center">
                    {isEditingName ? (
                        <div className="flex items-center gap-2 w-full">
                            <Input 
                                value={newRoomName}
                                onChange={(e) => setNewRoomName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateRoomName();
                                    if (e.key === 'Escape') {
                                        setIsEditingName(false);
                                        setNewRoomName(room.name);
                                    }
                                }}
                                className="h-9 text-lg font-bold"
                                autoFocus
                            />
                            <Button size="icon" className="h-9 w-9" onClick={handleUpdateRoomName}><Check className="h-5 w-5" /></Button>
                            <Button size="icon" variant="destructive" className="h-9 w-9" onClick={() => { setIsEditingName(false); setNewRoomName(room.name); }}><XIcon className="h-5 w-5" /></Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group">
                            <h2 className="text-lg font-bold truncate pr-4">{room.name}</h2>
                            {isHost && (
                                <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setIsEditingName(true)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </header>

            <main className="flex-grow flex flex-col lg:flex-row gap-4 min-h-0">
                <section className={cn(
                    "flex-grow grid gap-4",
                    isChatVisible ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
                )}>
                    {renderPlayerSlots()}
                </section>
                {isChatVisible && (
                    <aside className="w-full lg:max-w-sm bg-black/50 backdrop-blur-sm rounded-md flex flex-col p-4 min-h-0 overflow-hidden h-[70vh] lg:h-[calc(100vh-200px)]">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 flex-shrink-0"><MessageSquare /> Chat</h3>
                        <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2 text-sm custom-scrollbar min-h-0 overscroll-contain">
                        {room.chatMessages.map((msg, i) => (
                            <div key={i} className={cn("flex flex-col w-full", msg.senderUID === myUid ? "items-end" : "items-start")}>
                                <div className={cn("max-w-[90%] rounded-lg px-3 py-2", msg.senderUID === myUid ? "bg-primary text-primary-foreground" : "bg-zinc-700")}>
                                    {msg.senderUID !== user.uid && <p className="text-xs font-bold text-blue-400 mb-1">{msg.sender}</p>}
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
                            <Textarea 
                                placeholder="Type a message..." 
                                value={chatMessage} 
                                onChange={e => setChatMessage(e.target.value)} 
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }
                                }}
                                rows={1}
                            />
                            <Button onClick={handleSendMessage} size="icon"><Send className="w-4 h-4"/></Button>
                        </div>
                    </aside>
                )}
            </main>

            <footer className="flex-shrink-0 bg-black/50 backdrop-blur-sm p-3 rounded-md mt-4 flex flex-wrap justify-between items-center gap-2">
                <div className="flex items-center gap-2">
                    <Button variant="destructive" onClick={handleLeaveRoom}>Leave Room</Button>
                    <Button variant="outline" onClick={() => setIsChatVisible(v => !v)}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        {isChatVisible ? 'Hide Chat' : 'Show Chat'}
                    </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Button variant="outline" onClick={() => setMonitorOn(v => !v)}>
                        {monitorOn ? 'Mic Monitor: On' : 'Mic Monitor: Off'}
                    </Button>
                    {isHost && (
                        <>
                            <Button variant="secondary" onClick={() => setInviteDialogOpen(true)}>Invite Friends</Button>
                            <Button onClick={handleStartGame} className="bg-green-600 hover:bg-green-700">Start Game</Button>
                        </>
                    )}
                </div>
            </footer>
            
            <Dialog open={isInviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite Friends</DialogTitle>
                        <DialogDescription>Select an online friend to send a game invite to.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[400px] overflow-y-auto space-y-2 mt-4">
                        {onlineFriends.length > 0 ? onlineFriends.map(friend => (
                            <div key={friend.uid} className="flex items-center justify-between p-2 rounded-md hover:bg-accent">
                                <span>{friend.displayName}{friend.tag}</span>
                                <Button size="sm" onClick={() => handleSendInvite(friend)}>Invite</Button>
                            </div>
                        )) : <p className="text-muted-foreground text-center py-4">No online friends to invite.</p>}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}