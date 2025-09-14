"use client";

import React, { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { SPAWN_POINTS } from "@/lib/game/map";

interface Player {
  uid: string;
  displayName: string | null;
  status: "connected" | "disconnected";
}

interface GameRoom {
  id: string;
  players: Player[];
}

interface GameBoardProps {
  room: GameRoom;
}

const PLAYER_COLORS = [
  0xff0000, 0x0000ff, 0x00ff00, 0xffff00,
  0xff00ff, 0x00ffff, 0xffffff, 0x808080,
];

const BASE_W = 1920;
const BASE_H = 1600;

const GameBoard: React.FC<GameBoardProps> = ({ room }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const playerObjects = useRef<Map<string, PIXI.Container>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);

  // สร้าง + ทำลาย Pixi อย่างปลอดภัย (กัน StrictMode/Unmount ระหว่าง init)
  useEffect(() => {
    if (!canvasRef.current) return;

    let cancelled = false;
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
        return; // init fail → ออกเลย
      }

      if (cancelled) {
        try { app.ticker?.stop(); } catch {}
        try { app.stage?.removeChildren(); } catch {}
        try { app.destroy(true); } catch {}
        return;
      }

      // set ref หลัง init เสร็จเท่านั้น
      pixiAppRef.current = app;

      // mount canvas แค่ครั้งเดียว
      if (canvasRef.current && canvasRef.current.childElementCount === 0) {
        canvasRef.current.appendChild(app.canvas);
      }

      // จัดการขนาด
      resizeHandler = () => {
        if (!canvasRef.current || !app.stage) return;
        const parent = canvasRef.current.parentElement;
        if (!parent) return;
        const parentWidth = parent.clientWidth;
        const parentHeight = parent.clientHeight;
        const scale = Math.min(parentWidth / BASE_W, parentHeight / BASE_H);
        app.stage.scale.set(scale);
        app.renderer.resize(BASE_W * scale, BASE_H * scale);
      };
      window.addEventListener("resize", resizeHandler);
      resizeHandler();

      // พื้นหลังเป็นกริด (เลี่ยงโหลด texture)
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
      try { if (resizeHandler) window.removeEventListener("resize", resizeHandler); } catch {}

      const current = pixiAppRef.current;

      // ถ้า ref ยังชี้ instance นี้ → หยุด ticker & ล้าง stage → destroy
      if (current === app) {
        try { current.ticker?.stop(); } catch {}
        try { current.stage?.removeChildren(); } catch {}
        try { current.destroy(true); } catch {}
        pixiAppRef.current = null;
      } else {
        // init ยังไม่ทัน set ref → ทำลายจาก local instance
        try { app.ticker?.stop(); } catch {}
        try { app.stage?.removeChildren(); } catch {}
        try { app.destroy(true); } catch {}
      }

      // เคลียร์ DOM
      const mount = canvasRef.current;
      if (mount) {
        try { while (mount.firstChild) mount.removeChild(mount.firstChild); } catch {}
      }
      // ล้าง cache
      playerObjects.current.clear();
      setIsInitialized(false);
    };
  }, []);

  // sync player sprites กับ room.players
  useEffect(() => {
    const app = pixiAppRef.current;
    if (!app || !app.stage || !isInitialized) return;

    const currentPlayersOnMap = new Set(playerObjects.current.keys());
    const roomPlayers = new Set(room.players.map((p) => p.uid));

    // ลบคนที่ออก
    currentPlayersOnMap.forEach((uid) => {
      if (!roomPlayers.has(uid)) {
        const container = playerObjects.current.get(uid);
        if (container) {
          try { app.stage.removeChild(container); } catch {}
          try { container.destroy({ children: true }); } catch {}
        }
        playerObjects.current.delete(uid);
      }
    });

    // เพิ่ม/อัปเดตคนในห้อง
    room.players.forEach((player, index) => {
      let container = playerObjects.current.get(player.uid);

      if (!container) {
        const spawnPoint = SPAWN_POINTS[index % SPAWN_POINTS.length];
        const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

        container = new PIXI.Container();

        const pawn = new PIXI.Graphics()
          .circle(0, 0, 15)
          .fill(color)
          .stroke({ width: 2, color: 0xffffff });
        container.addChild(pawn);

        const nameText = new PIXI.Text({
          text: player.displayName || "Player",
          style: new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 14,
            fill: "#ffffff",
            stroke: { color: "#000000", width: 3, join: "round" },
          }),
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = 18;
        container.addChild(nameText);

        container.x = spawnPoint.x;
        container.y = spawnPoint.y;

        app.stage.addChild(container);
        playerObjects.current.set(player.uid, container);
      }

      // Update visual state
      container.alpha = player.status === "disconnected" ? 0.5 : 1.0;
    });
  }, [isInitialized, room.players]);

  return <div ref={canvasRef} className="w-full h-full flex items-center justify-center" />;
};

export default GameBoard;
