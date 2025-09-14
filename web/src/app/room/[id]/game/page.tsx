/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth, db } from '../../../../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, Timestamp, runTransaction, arrayRemove } from 'firebase/firestore';
import { LoaderCircle, LogOut } from 'lucide-react';
import GameBoard from '@/components/game/GameBoard';

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

interface GameRoom {
    id: string;
    name: string;
    maxPlayers: number;
    host: { uid: string; displayName: string | null; };
    players: Player[];
    playerIds: string[];
    createdAt: Timestamp;
    status: 'waiting' | 'loading' | 'playing' | 'finished';
}

export default function GamePage() {
    const router = useRouter();
    const params = useParams();
    const roomId = params.id as string;

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [room, setRoom] = useState<GameRoom | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
        if (!roomId) return;
        const roomRef = doc(db, "rooms", roomId);
        const unsubscribe = onSnapshot(roomRef, (docSnap) => {
            if (docSnap.exists()) {
                const roomData = { id: docSnap.id, ...docSnap.data() } as GameRoom;
                if(roomData.status === 'waiting'){
                    // Game ended, redirect
                    router.push('/lobby');
                    return;
                }
                setRoom(roomData);
            } else {
                router.push('/lobby');
            }
        });
        return () => unsubscribe();
    }, [roomId, router]);

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
    
    const handleLeaveGamePermanently = async () => {
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

                const playerToRemove = roomData.players.find(p => p.uid === user.uid);
                if (playerToRemove) {
                    const newPlayers = roomData.players.filter(p => p.uid !== user.uid);
                    const newPlayerIds = roomData.playerIds.filter(id => id !== user.uid);
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

    // Handle graceful disconnect
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!user || !roomId) return;
            const roomRef = doc(db, "rooms", roomId);
            // This is a fire-and-forget operation on page close.
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

    return (
        <div className="w-screen h-screen bg-zinc-900 relative">
            <GameBoard room={room} />
             <div className="absolute top-4 right-4">
                <button 
                    onClick={handleLeaveGamePermanently}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
                >
                    <LogOut size={18} />
                    Leave Game
                </button>
            </div>
        </div>
    );
}