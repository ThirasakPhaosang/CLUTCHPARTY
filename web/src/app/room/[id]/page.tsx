/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, forwardRef, InputHTMLAttributes, ButtonHTMLAttributes, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, Timestamp } from 'firebase/firestore';
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LoaderCircle, User as UserIcon, Users, MessageSquare, Send, Crown, Mic, MicOff } from 'lucide-react';

// --- TYPES ---
interface Player {
    uid: string;
    displayName: string | null;
    tag: string | null;
    isReady: boolean;
    isMuted: boolean;
    isHost?: boolean;
}

interface ChatMessage {
    sender: string | null;
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

// --- GAME ROOM PAGE ---
export default function RoomPage() {
    const router = useRouter();
    const params = useParams();
    const roomId = params.id as string;

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [room, setRoom] = useState<GameRoom | null>(null);
    const [loading, setLoading] = useState(true);
    const [chatMessage, setChatMessage] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (!currentUser) {
                router.push('/');
                return;
            }
            setUser(currentUser);
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
                    // If user is not in the player list, redirect them.
                    alert("You are not a member of this room.");
                    router.push('/lobby');
                    return;
                }
                setRoom(roomData);
                setLoading(false);
            } else {
                alert("Room not found.");
                router.push('/lobby');
            }
        });

        return () => roomUnsubscribe();
    }, [roomId, user, router]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [room?.chatMessages]);

    const handleLeaveRoom = async () => {
        if (!user || !room) return;
    
        try {
            const roomRef = doc(db, "rooms", roomId);
    
            if (room.players.length <= 1) {
                await deleteDoc(roomRef);
            } else {
                const newPlayers = room.players.filter(p => p.uid !== user.uid);
                const newPlayerIds = room.playerIds.filter(id => id !== user.uid);
                
                let newHost = room.host;
                if (user.uid === room.host.uid && newPlayers.length > 0) {
                    newHost = {
                        uid: newPlayers[0].uid,
                        displayName: newPlayers[0].displayName
                    };
                }
    
                await updateDoc(roomRef, {
                    players: newPlayers,
                    playerIds: newPlayerIds,
                    host: newHost,
                });
            }
            router.push('/lobby');
        } catch (error) {
            console.error("Error leaving room: ", error);
            alert("Failed to leave the room.");
        }
    };

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
            newPlayers[playerIndex].isMuted = !newPlayers[playerIndex].isMuted;
            await updateDoc(doc(db, "rooms", roomId), { players: newPlayers });
        }
    };

    const handleSendMessage = async () => {
        if (!user || !room || !chatMessage.trim()) return;

        const senderProfile = room.players.find(p => p.uid === user.uid);
        if (!senderProfile) return;

        const newMessage = {
            sender: senderProfile.displayName,
            text: chatMessage,
            timestamp: Timestamp.now()
        };

        await updateDoc(doc(db, "rooms", roomId), {
            chatMessages: arrayUnion(newMessage)
        });
        setChatMessage("");
    };
    
    const handleStartGame = () => {
        if(!room) return;
        const allReady = room.players.every(p => p.isReady);
        if (allReady) {
            alert("Starting game! (This is a placeholder)");
        } else {
            alert("Not all players are ready.");
        }
    };

    if (loading || !room || !user) {
        return <div className="flex items-center justify-center min-h-screen bg-zinc-900"><LoaderCircle className="h-8 w-8 animate-spin text-green-400" /></div>;
    }

    const isHost = user.uid === room.host.uid;

    const renderPlayerSlots = () => {
        const slots = [];
        for (let i = 0; i < room.maxPlayers; i++) {
            const player = room.players[i];
            if (player) {
                slots.push(
                    <div key={player.uid} className={`bg-zinc-800 rounded-lg p-4 flex flex-col items-center justify-between border-2 ${player.isReady ? 'border-green-500' : 'border-zinc-700'}`}>
                        <div className="text-center">
                            <div className="w-24 h-24 bg-zinc-700 rounded-md mb-4 flex items-center justify-center">
                               <UserIcon className="w-16 h-16 text-zinc-500"/>
                            </div>
                            <h4 className="font-bold text-lg flex items-center gap-2">
                                {player.uid === room.host.uid && <Crown className="w-4 h-4 text-yellow-400" />}
                                {player.displayName}
                                {player.isMuted && <MicOff className="w-4 h-4 text-red-500" />}
                            </h4>
                            <p className="text-sm text-zinc-400">{player.tag}</p>
                        </div>
                        <div className="w-full mt-4 space-y-2">
                           {player.uid === user.uid ? (
                             <>
                                <div className="flex gap-2 w-full">
                                    <Button onClick={handleToggleReady} className={`w-full ${player.isReady ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'}`}>
                                        {player.isReady ? 'Unready' : 'Ready'}
                                    </Button>
                                    <Button onClick={handleToggleMute} variant="outline" size="icon">
                                        {player.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                    </Button>
                                </div>
                                <Button variant="outline" className="w-full" disabled>Customise</Button>
                             </>
                           ) : (
                             <div className={`text-center font-semibold p-2 rounded-md ${player.isReady ? 'text-green-400 bg-green-900/50' : 'text-zinc-400'}`}>
                                {player.isReady ? 'Ready' : 'Not Ready'}
                             </div>
                           )}
                        </div>
                    </div>
                );
            } else {
                slots.push(
                    <div key={`empty-${i}`} className="bg-zinc-800/50 border-2 border-dashed border-zinc-700 rounded-lg p-4 flex flex-col items-center justify-center text-zinc-500">
                        <Users className="w-12 h-12 mb-2"/>
                        <p>Empty Slot</p>
                    </div>
                );
            }
        }
        return slots;
    };


    return (
        <div className="dark font-sans bg-zinc-900 text-zinc-100 min-h-screen flex flex-col p-4" style={{ backgroundImage: 'url(https://i.imgur.com/gSj0x6j.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
            <header className="flex-shrink-0 bg-black/50 backdrop-blur-sm p-2 rounded-md mb-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {room.players.map(p => (
                            <div key={p.uid} className={`flex items-center gap-2 p-2 rounded ${p.uid === user.uid ? 'bg-green-600' : 'bg-zinc-700'}`}>
                                <UserIcon className="w-4 h-4" />
                                <span className="text-sm font-semibold">{p.displayName}</span>
                            </div>
                        ))}
                    </div>
                    <div className="text-sm text-zinc-400">FPS: 60 | GPU: 16% | CPU: 14% | LAT: 0ms</div>
                </div>
            </header>

            <main className="flex-grow flex gap-4 min-h-0">
                <section className="flex-grow grid grid-cols-2 md:grid-cols-4 gap-4">
                    {renderPlayerSlots()}
                </section>
                <aside className="w-full max-w-sm bg-black/50 backdrop-blur-sm rounded-md flex flex-col p-4">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><MessageSquare /> Chat</h3>
                    <div className="flex-grow overflow-y-auto mb-4 space-y-3 pr-2 text-sm">
                       {room.chatMessages.map((msg, i) => (
                           <div key={i}>
                               <span className="font-bold text-green-400">{msg.sender}: </span>
                               <span>{msg.text}</span>
                           </div>
                       ))}
                       <div ref={chatEndRef} />
                    </div>
                    <div className="flex gap-2">
                        <Input 
                            placeholder="Type a message..." 
                            value={chatMessage} 
                            onChange={e => setChatMessage(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                        />
                        <Button onClick={handleSendMessage} size="icon"><Send className="w-4 h-4"/></Button>
                    </div>
                </aside>
            </main>

            <footer className="flex-shrink-0 bg-black/50 backdrop-blur-sm p-3 rounded-md mt-4 flex justify-between items-center">
                <Button variant="destructive" onClick={handleLeaveRoom}>Leave</Button>
                <div className="flex items-center gap-2">
                    {isHost && (
                        <>
                            <Button variant="secondary" disabled>Invite Friends</Button>
                            <Button variant="secondary" disabled>Add AI</Button>
                            <Button onClick={handleStartGame} className="bg-green-600 hover:bg-green-700">Start Game</Button>
                        </>
                    )}
                </div>
            </footer>
        </div>
    );
}