"use client";

import React, { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { SPAWN_POINTS } from "@/lib/game/map";
import { GameRoom } from "@/lib/types";

interface GameBoardProps {
  room: GameRoom;
  speakingPeers: Record<string, boolean>;
}

const PLAYER_COLORS = [
  0xff0000, 0x0000ff, 0x00ff00, 0xffff00,
  0xff00ff, 0x00ffff, 0xffffff, 0x808080,
];

const BASE_W = 1920;
const BASE_H = 1600;

const GameBoard: React.FC<GameBoardProps> = ({ room, speakingPeers }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const playerObjects = useRef<Map<string, { container: PIXI.Container, speakingIndicator: PIXI.Graphics }>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    let cancelled = false;
    let didInit = false;
    let resizeHandler: (() => void) | undefined;

    const app = new PIXI.Application();

    (async () => {
      try {
        await app.init({
          width: BASE_W,
          height: BASE_H,
          backgroundColor: 0x1a1a1a,
          autoDensity: true,
          resolution:
            typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        });
      } catch {
        return;
      }

      if (cancelled) {
        try { app.ticker?.stop(); } catch {}
        try { app.stage?.removeChildren(); } catch {}
        try { app.destroy(true); } catch {}
        return;
      }
      
      pixiAppRef.current = app;
      didInit = true;

      if (canvasRef.current && canvasRef.current.childElementCount === 0) {
        canvasRef.current.appendChild(app.canvas);
      }

      resizeHandler = () => {
        if (!canvasRef.current || !app.stage) return;
        const parent = canvasRef.current;
        const parentWidth = parent.clientWidth;
        const parentHeight = parent.clientHeight;
        const scale = Math.min(parentWidth / BASE_W, parentHeight / BASE_H);
        // Fill parent, center stage
        app.renderer.resize(parentWidth, parentHeight);
        app.stage.scale.set(scale);
        app.stage.x = Math.floor((parentWidth - BASE_W * scale) / 2);
        app.stage.y = Math.floor((parentHeight - BASE_H * scale) / 2);
      };
      window.addEventListener("resize", resizeHandler);
      resizeHandler();

      const background = new PIXI.Graphics();
      background.rect(0, 0, BASE_W, BASE_H).fill(0x282c34);
      const gridSize = 50;
      background.stroke({ width: 1, color: 0x444444 });
      for (let i = 0; i < BASE_W / gridSize; i++) {
        background.moveTo(i * gridSize, 0).lineTo(i * gridSize, BASE_H);
      }
      for (let i = 0; i < BASE_H / gridSize; i++) {
        background.moveTo(0, i * gridSize).lineTo(BASE_W, i * gridSize);
      }
      app.stage.addChild(background);

      setIsInitialized(true);
    })();

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      const current = pixiAppRef.current;
      if (didInit) {
        try {
          if (current === app && current) {
            current.ticker?.stop();
            current.stage?.removeChildren();
            current.destroy(true);
            pixiAppRef.current = null;
          } else {
            app.ticker?.stop();
            app.stage?.removeChildren();
            app.destroy(true);
          }
        } catch {}
      }
      if (canvasRef.current) {
        while (canvasRef.current.firstChild) {
          canvasRef.current.removeChild(canvasRef.current.firstChild);
        }
      }
      playerObjects.current.clear();
      setIsInitialized(false);
    };
  }, []);

  useEffect(() => {
    const app = pixiAppRef.current;
    if (!app || !app.stage || !isInitialized) return;

    const currentPlayersOnMap = new Set(playerObjects.current.keys());
    const roomPlayers = new Set(room.players.map((p) => p.uid));

    currentPlayersOnMap.forEach((uid) => {
      if (!roomPlayers.has(uid)) {
        const playerObj = playerObjects.current.get(uid);
        if (playerObj) try { app.stage?.removeChild(playerObj.container); } catch {}
        playerObjects.current.delete(uid);
      }
    });

    room.players.forEach((player, index) => {
      let playerObj = playerObjects.current.get(player.uid);

      if (!playerObj) {
        const spawnPoint = SPAWN_POINTS[index % SPAWN_POINTS.length];
        const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

        const container = new PIXI.Container();
        
        const speakingIndicator = new PIXI.Graphics().circle(0, 0, 20).stroke({ width: 3, color: 0x3b82f6 });
        speakingIndicator.visible = false;
        container.addChild(speakingIndicator);
        
        const pawn = new PIXI.Graphics().circle(0, 0, 15).fill(color).stroke({ width: 2, color: 0xffffff });
        container.addChild(pawn);

        const nameText = new PIXI.Text({
          text: player.displayName || "Player",
          style: new PIXI.TextStyle({ fontFamily: "Arial", fontSize: 14, fill: "#ffffff", stroke: { color: "#000000", width: 3, join: "round" } }),
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = 22;
        container.addChild(nameText);

        container.x = spawnPoint.x;
        container.y = spawnPoint.y;

        app.stage.addChild(container);
        playerObj = { container, speakingIndicator };
        playerObjects.current.set(player.uid, playerObj);
      }
      
      playerObj.container.alpha = player.status === "disconnected" ? 0.5 : 1.0;
      playerObj.speakingIndicator.visible = !!speakingPeers[player.uid];
    });

  }, [isInitialized, room.players, speakingPeers]);
  
  // Animation loop for speaking indicators
  useEffect(() => {
    const app = pixiAppRef.current;
    if (!app) return;

    let time = 0;
    const ticker = (ticker: PIXI.Ticker) => {
        time += ticker.deltaTime;
        const scale = 1 + Math.sin(time * 0.2) * 0.05;
        playerObjects.current.forEach((obj, uid) => {
            if (obj.speakingIndicator.visible) {
              obj.speakingIndicator.scale.set(scale);
              obj.speakingIndicator.alpha = 0.5 + Math.sin(time * 0.2) * 0.5;
            }
        });
    };

    app.ticker.add(ticker);
    return () => {
      try { app.ticker?.remove(ticker); } catch {}
    };
  }, [isInitialized]);

  return (
    <div className="absolute inset-0">
      <div ref={canvasRef} className="w-full h-full bg-zinc-800" />
    </div>
  );
};

export default GameBoard;
