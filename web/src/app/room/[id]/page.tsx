/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, InputHTMLAttributes, ButtonHTMLAttributes, useRef, HTMLAttributes } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, Timestamp, runTransaction, arrayRemove, collection, query, where, writeBatch, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LoaderCircle, User as UserIcon, Users, MessageSquare, Send, Crown, Mic, MicOff, MoreVertical, UserX, Star, Volume2, Pencil, Check, X as XIcon } from 'lucide-react';
import { toast } from "sonner";


// --- TYPES ---
interface Player {
    uid: string;
    displayName: string | null;
    tag: string | null;
    isReady: boolean;
    isMuted: boolean;
    isSpeaking: boolean;
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
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const roomStateRef = useRef<GameRoom | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Audio processing and WebRTC refs
    const audioStreamRef = useRef<MediaStream | null>(null);
    const isSpeakingRef = useRef(false);
    const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
    const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});

    
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
        let animationFrameId: number; let localStream: MediaStream; let audioContext: AudioContext; let analyser: AnalyserNode; let source: MediaStreamAudioSourceNode; let dataArray: Uint8Array<ArrayBuffer>;
    
        const updateSpeakingStatus = (isSpeaking: boolean) => {
            if (!user || !roomId || !roomStateRef.current) return;
            const currentPlayer = roomStateRef.current.players.find(p => p.uid === user.uid);
            if (currentPlayer && currentPlayer.isSpeaking !== isSpeaking) {
                const updatedPlayers = roomStateRef.current.players.map(p => p.uid === user.uid ? { ...p, isSpeaking } : p);
                updateDoc(doc(db, "rooms", roomId), { players: updatedPlayers }).catch(console.error);
            }
        };
    
        const setupMic = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioStreamRef.current = localStream;
                const currentPlayer = roomStateRef.current?.players.find(p => p.uid === user.uid);
                // Mic monitor (optional)
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
                dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

                const detectSpeaking = () => {
                    analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);
                    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
                    const speaking = average > 10; // Speaking threshold

                    if (speaking !== isSpeakingRef.current) {
                        isSpeakingRef.current = speaking;
                        updateSpeakingStatus(speaking);
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
        const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    
        const createPeerConnection = (peerId: string, initiator: boolean) => {
            if (peerConnectionsRef.current[peerId]) return peerConnectionsRef.current[peerId];
    
            const pc = new RTCPeerConnection(pcConfig);
            peerConnectionsRef.current[peerId] = pc;
    
            audioStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, audioStreamRef.current!));
    
            pc.ontrack = (event) => setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
    
            pc.onicecandidate = event => {
                if (event.candidate) {
                    addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
                }
            };
    
            if (initiator) {
                pc.onnegotiationneeded = async () => {
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        await addDoc(signalingCollection, { from: myId, to: peerId, signal: { type: 'offer', sdp: pc.localDescription?.sdp } });
                    } catch (err) { console.error("Create offer error:", err); }
                };
            }
            return pc;
        };
    
        const playerIds = room.playerIds.filter(id => id !== myId);
    
        // Initiate connections to other players
        playerIds.forEach(peerId => createPeerConnection(peerId, true));
    
        // Listen for signaling messages
        const q = query(signalingCollection, where("to", "==", myId));
        const signalingUnsubscribe = onSnapshot(q, async (snapshot) => {
            for (const change of snapshot.docChanges()) {
                if (change.type === "added") {
                    const { from: fromId, signal } = change.doc.data();
                    const pc = createPeerConnection(fromId, false);
    
                    if (signal.type === 'offer' && pc.signalingState !== 'stable') {
                        try {
                            await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
                            const answer = await pc.createAnswer();
                            await pc.setLocalDescription(answer);
                            await addDoc(signalingCollection, { from: myId, to: fromId, signal: { type: 'answer', sdp: pc.localDescription?.sdp } });
                        } catch (err) { console.error('Error handling offer:', err); }
                    } else if (signal.type === 'answer') {
                        try {
                            await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
                        } catch (err) { console.error('Error handling answer:', err); }
                    } else if (signal.candidate) {
                        try {
                           if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                        } catch (err) { console.error('Error adding ICE candidate:', err); }
                    }
                    await deleteDoc(change.doc.ref); // Clean up signal
                }
            }
        });
    
        // Cleanup on component unmount or dependencies change
        return () => {
            signalingUnsubscribe();
            Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
            peerConnectionsRef.current = {};
        };
    }, [roomId, user, room?.playerIds.join(','), audioStreamRef.current]);
    
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

    const performLeaveRoom = async () => {
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
    };
    
    const handleLeaveRoom = async () => {
        await performLeaveRoom();
        router.push('/lobby');
    };

    useEffect(() => {
        const onBeforeUnload = () => { performLeaveRoom(); };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [user, roomId]); // Re-bind if user or room changes

    
    const handleToggleReady = async () => {
        if (!user || !room) return;
        const playerIndex = room.players.findIndex(p => p.uid === user.uid);
        if (playerIndex > -1) {
            const newPlayers = [...room.players];
            newPlayers[playerIndex].isReady = !newPlayers[playerIndex].isReady;
            await updateDoc(doc(db, "rooms", roomId), { players: newPlayers });
        }
    };
    
    const handleToggleMute = async () => {
        if (!user || !room) return;
        const playerIndex = room.players.findIndex(p => p.uid === user.uid);
        if (playerIndex > -1) {
            const newPlayers = [...room.players];
            const newMutedState = !newPlayers[playerIndex].isMuted;
            newPlayers[playerIndex].isMuted = newMutedState;
            if (audioStreamRef.current) {
                audioStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !newMutedState; });
            }
            const a = localMonitorRef.current; if (a) { a.muted = newMutedState; if (!newMutedState) { a.play().catch(() => {}); } }
            await updateDoc(doc(db, "rooms", roomId), { players: newPlayers });
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
        if (user?.uid !== room?.host.uid || !room || playerId === user.uid) return;
        const roomRef = doc(db, "rooms", roomId);
        try {
            await runTransaction(db, async (transaction) => {
                const roomDoc = await transaction.get(roomRef);
                if (!roomDoc.exists()) throw new Error("Room does not exist.");
                
                const roomData = roomDoc.data() as GameRoom;
                const newPlayers = roomData.players.filter(p => p.uid !== playerId);
                const newPlayerIds = roomData.playerIds.filter(id => id !== playerId);

                if (newPlayers.length === roomData.players.length) return; // Player not found
                
                transaction.update(roomRef, { players: newPlayers, playerIds: newPlayerIds });
            });
            toast.success("Player kicked.");
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

    const handleStartGame = () => {
        if(!room) return;
        if (room.players.every(p => p.isReady)) { toast.success("Starting game!"); }
        else { toast.error("Not all players are ready."); }
    };

    if (loading || !room || !user) {
        return <div className="flex items-center justify-center min-h-screen bg-zinc-900"><LoaderCircle className="h-8 w-8 animate-spin text-green-400" /></div>;
    }

    const myUid = user!.uid;

    const isHost = myUid === room.host.uid;

    const renderPlayerSlots = () => Array.from({ length: room.maxPlayers }).map((_, i) => {
        const player = room.players[i];
        if (player) {
            const isCurrentUser = player.uid === myUid;
            const isPlayerHost = player.uid === room.host.uid;
            return (
                <div key={player.uid} className={cn('relative bg-zinc-800 rounded-lg p-3 flex flex-col items-center justify-between border-2 transition-all duration-200', player.isSpeaking && !player.isMuted ? 'border-blue-400 shadow-lg shadow-blue-400/20 animate-pulse' : player.isReady ? 'border-green-500' : 'border-zinc-700')}>
            <audio ref={localMonitorRef} autoPlay playsInline style={{ display: 'none' }} />
                    {isHost && !isCurrentUser && (
                        <div className="absolute top-1 right-1" ref={menuRef}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-zinc-700" onClick={() => setPlayerMenuOpen(playerMenuOpen === player.uid ? null : player.uid)}>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                            {playerMenuOpen === player.uid && (
                                <div className="absolute right-0 mt-2 w-40 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg z-10 overflow-hidden">
                                    <button onClick={() => { handleMakeHost(player.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><Star className="w-4 h-4" /> Make Host</button>
                                    <button onClick={() => { handleKickPlayer(player.uid); setPlayerMenuOpen(null); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-2 transition-colors"><UserX className="w-4 h-4" /> Kick Player</button>
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
            {Object.entries(remoteStreams).map(([uid, stream]) => {
                const player = room?.players.find(p => p.uid === uid);
                return <audio key={uid} ref={audioEl => {
                    if (audioEl) {
                        if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
                        audioEl.muted = !!player?.isMuted;
                    }
                }} autoPlay playsInline />;
            })}
            
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
                <section className="flex-grow grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {renderPlayerSlots()}
                </section>
                <aside className="w-full lg:max-w-sm bg-black/50 backdrop-blur-sm rounded-md flex flex-col p-4">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 flex-shrink-0"><MessageSquare /> Chat</h3>
                    <div className="flex-grow overflow-y-auto mb-4 space-y-3 pr-2 text-sm">
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
                        <Input placeholder="Type a message..." value={chatMessage} onChange={e => setChatMessage(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSendMessage()}/>
                        <Button onClick={handleSendMessage} size="icon"><Send className="w-4 h-4"/></Button>
                    </div>
                </aside>
            </main>

            <footer className="flex-shrink-0 bg-black/50 backdrop-blur-sm p-3 rounded-md mt-4 flex justify-between items-center">
                <Button variant="destructive" onClick={handleLeaveRoom}>Leave Room</Button>
                <div className="flex items-center gap-2">
                    
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
                    <DialogHeader><DialogTitle>Invite Friends</DialogTitle></DialogHeader>
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