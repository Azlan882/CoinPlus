import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  Award,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowLeft,
  HelpCircle,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../../api.ts';
import { sound } from './sound.ts';
import {
  User,
  BalanceState,
  PulseMinerLevel,
  PulseMinerUserState,
  PulseMinerStateResponse,
} from '../../types.ts';

interface PulseMinerGameProps {
  user: User | null;
  balance: BalanceState | null;
  onBalanceUpdated: () => void;
  onBackToMining: () => void;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  scale: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface FallingItem {
  id: number;
  x: number;
  y: number;
  radius: number;
  speed: number;
  type: 'crystal' | 'hazard';
  tier?: 'cyan' | 'gold' | 'violet';
  hazardType?: 'rock' | 'mine';
  points?: number;
  rotation: number;
  rotationSpeed: number;
}

type GameMode = 'level-select' | 'playing' | 'paused' | 'level-completed' | 'game-over';

export const PulseMinerGame: React.FC<PulseMinerGameProps> = ({
  user,
  balance,
  onBalanceUpdated,
  onBackToMining,
}) => {
  const [gameState, setGameState] = useState<PulseMinerUserState | null>(null);
  const [levels, setLevels] = useState<PulseMinerLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<PulseMinerLevel | null>(null);
  const [mode, setMode] = useState<GameMode>('level-select');
  const [isMuted, setIsMuted] = useState<boolean>(sound.isMuted());
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // In-game live values for React HUD
  const [hudScore, setHudScore] = useState(0);
  const [hudLives, setHudLives] = useState(3);
  const [hudTimeLeft, setHudTimeLeft] = useState(45);

  // Victory / Claim status
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [claimedPointsAwarded, setClaimedPointsAwarded] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [gameOverReason, setGameOverReason] = useState<'lives' | 'timeout'>('lives');

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Game loop engine refs
  const animationFrameIdRef = useRef<number | null>(null);
  const shipPosRef = useRef<{ x: number; y: number; targetX: number; width: number; height: number }>({
    x: 200,
    y: 530,
    targetX: 200,
    width: 68,
    height: 34,
  });
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const timeLeftRef = useRef(45);
  const invulnerableUntilRef = useRef(0);
  const itemsRef = useRef<FallingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const starsRef = useRef<Array<{ x: number; y: number; speed: number; size: number; alpha: number }>>([]);
  const lastSpawnTimeRef = useRef(0);
  const gameStartTimeRef = useRef(0);
  const levelEndedRef = useRef(false);
  const nextItemIdRef = useRef(1);
  const screenShakeRef = useRef(0);
  const leftPressedRef = useRef(false);
  const rightPressedRef = useRef(false);

  // Load user game state from backend
  const loadGameState = useCallback(async () => {
    setIsLoadingState(true);
    setErrorMessage(null);
    try {
      const res: PulseMinerStateResponse = await api.getPulseMinerState();
      if (res.success) {
        setLevels(res.levels);
        setGameState(res.state);
      }
    } catch (err: any) {
      console.warn('[PulseMiner State Error]', err);
      setErrorMessage(err.message || 'Unable to sync game progress from server.');
    } finally {
      setIsLoadingState(false);
    }
  }, []);

  useEffect(() => {
    loadGameState();
  }, [loadGameState]);

  // Audio toggle
  const toggleMute = () => {
    const next = sound.toggleMute();
    setIsMuted(next);
  };

  // Keyboard navigation for desktop users
  useEffect(() => {
    if (mode !== 'playing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        leftPressedRef.current = true;
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        rightPressedRef.current = true;
      } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        setMode((prev) => (prev === 'playing' ? 'paused' : 'playing'));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        leftPressedRef.current = false;
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        rightPressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mode]);

  // Initialize stars for background canvas
  const initStars = (width: number, height: number) => {
    const stars = [];
    for (let i = 0; i < 45; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: 0.3 + Math.random() * 0.9,
        size: 1 + Math.random() * 2,
        alpha: 0.2 + Math.random() * 0.8,
      });
    }
    starsRef.current = stars;
  };

  // Start playing a specific level
  const startLevel = (lvl: PulseMinerLevel) => {
    sound.playButtonClick();
    setCurrentLevel(lvl);
    setMode('playing');

    // Reset game state
    scoreRef.current = 0;
    livesRef.current = 3;
    timeLeftRef.current = lvl.timeLimitSeconds;
    invulnerableUntilRef.current = 0;
    itemsRef.current = [];
    particlesRef.current = [];
    floatingTextsRef.current = [];
    levelEndedRef.current = false;
    gameStartTimeRef.current = Date.now();
    lastSpawnTimeRef.current = Date.now();
    screenShakeRef.current = 0;
    leftPressedRef.current = false;
    rightPressedRef.current = false;

    setHudScore(0);
    setHudLives(3);
    setHudTimeLeft(lvl.timeLimitSeconds);
    setClaimError(null);
    setClaimedPointsAwarded(null);
    setActiveClaimId(null);

    // Initial position
    shipPosRef.current = {
      x: 200,
      y: 520,
      targetX: 200,
      width: 68,
      height: 34,
    };

    initStars(400, 600);
  };

  // Trigger claim reward on server idempotently
  const handleClaimReward = async (level: PulseMinerLevel, finalScore: number, durationSec: number) => {
    if (!user) return;
    setIsClaimingReward(true);
    setClaimError(null);

    // Generate or reuse persistent claim ID
    const claimId =
      activeClaimId ||
      `pm_claim_${user.id}_lvl${level.levelId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setActiveClaimId(claimId);

    try {
      const res = await api.claimPulseMinerReward(level.levelId, claimId, finalScore, durationSec);
      if (res.success) {
        setClaimedPointsAwarded(res.rewardPoints);
        setGameState(res.state);
        onBalanceUpdated();
      }
    } catch (err: any) {
      console.warn('[Claim Reward Failed]', err);
      setClaimError(err.message || 'Network error claiming reward. You can safely retry.');
    } finally {
      setIsClaimingReward(false);
    }
  };

  // Particle creator helper
  const spawnExplosion = (x: number, y: number, color: string, count = 12) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        color,
        alpha: 1,
        life: 0,
        maxLife: 20 + Math.random() * 15,
      });
    }
  };

  const spawnFloatingText = (x: number, y: number, text: string, color: string) => {
    floatingTextsRef.current.push({
      id: Math.random(),
      x,
      y,
      text,
      color,
      opacity: 1,
      scale: 1.2,
    });
  };

  // Main canvas animation and physics loop
  useEffect(() => {
    if (mode !== 'playing' || !currentLevel) return;

    let isRunning = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastFrameTime = performance.now();

    const loop = (currentTime: number) => {
      if (!isRunning) return;

      const deltaMs = Math.min(100, currentTime - lastFrameTime);
      lastFrameTime = currentTime;

      const logicalWidth = 400;
      const logicalHeight = 600;

      // Handle countdown timer
      const elapsedTotalSec = Math.floor((Date.now() - gameStartTimeRef.current) / 1000);
      const remainingTime = Math.max(0, currentLevel.timeLimitSeconds - elapsedTotalSec);
      timeLeftRef.current = remainingTime;
      setHudTimeLeft(remainingTime);

      // Check timeout defeat
      if (remainingTime <= 0 && !levelEndedRef.current) {
        levelEndedRef.current = true;
        setGameOverReason('timeout');
        sound.playGameOver();
        setMode('game-over');
        return;
      }

      // Check victory
      if (scoreRef.current >= currentLevel.targetScore && !levelEndedRef.current) {
        levelEndedRef.current = true;
        sound.playVictory();
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6'],
        });
        setMode('level-completed');
        const duration = Math.max(1, elapsedTotalSec);
        handleClaimReward(currentLevel, scoreRef.current, duration);
        return;
      }

      // Ship movement: Arrow keys or direct drag interpolation
      const ship = shipPosRef.current;
      const moveSpeed = 7.5;
      if (leftPressedRef.current) {
        ship.targetX = Math.max(ship.width / 2, ship.targetX - moveSpeed);
      }
      if (rightPressedRef.current) {
        ship.targetX = Math.min(logicalWidth - ship.width / 2, ship.targetX + moveSpeed);
      }

      // Smooth lerp to target position
      ship.x += (ship.targetX - ship.x) * 0.28;
      ship.x = Math.max(ship.width / 2, Math.min(logicalWidth - ship.width / 2, ship.x));

      // Spawning crystals and hazards
      const now = Date.now();
      const spawnInterval = Math.max(450, currentLevel.spawnIntervalMs);
      if (now - lastSpawnTimeRef.current >= spawnInterval) {
        lastSpawnTimeRef.current = now;

        // 60% chance crystal, 40% chance hazard
        const isHazard = Math.random() < 0.42;

        if (isHazard) {
          const hazardType: 'rock' | 'mine' = Math.random() < 0.65 ? 'rock' : 'mine';
          itemsRef.current.push({
            id: nextItemIdRef.current++,
            x: 20 + Math.random() * (logicalWidth - 40),
            y: -20,
            radius: hazardType === 'rock' ? 16 : 14,
            speed: currentLevel.hazardSpeed * (0.9 + Math.random() * 0.25),
            type: 'hazard',
            hazardType,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
          });
        } else {
          // Crystal Tier based on level
          let tier: 'cyan' | 'gold' | 'violet' = 'cyan';
          let points = 10;
          const roll = Math.random();

          if (currentLevel.levelId >= 4 && roll > 0.8) {
            tier = 'violet';
            points = 50;
          } else if (currentLevel.levelId >= 2 && roll > 0.5) {
            tier = 'gold';
            points = 25;
          }

          itemsRef.current.push({
            id: nextItemIdRef.current++,
            x: 24 + Math.random() * (logicalWidth - 48),
            y: -20,
            radius: tier === 'violet' ? 15 : tier === 'gold' ? 13 : 11,
            speed: 2.2 + Math.random() * 1.5,
            type: 'crystal',
            tier,
            points,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.05,
          });
        }
      }

      // Collision detection & item updates
      const isInvulnerable = now < invulnerableUntilRef.current;
      const shipBox = {
        left: ship.x - ship.width / 2 + 6,
        right: ship.x + ship.width / 2 - 6,
        top: ship.y - ship.height / 2 + 4,
        bottom: ship.y + ship.height / 2,
      };

      for (let i = itemsRef.current.length - 1; i >= 0; i--) {
        const item = itemsRef.current[i];
        item.y += item.speed;
        item.rotation += item.rotationSpeed;

        // Check collision with ship
        const inXRange = item.x + item.radius >= shipBox.left && item.x - item.radius <= shipBox.right;
        const inYRange = item.y + item.radius >= shipBox.top && item.y - item.radius <= shipBox.bottom;

        if (inXRange && inYRange) {
          if (item.type === 'crystal') {
            const pts = item.points || 10;
            scoreRef.current += pts;
            setHudScore(scoreRef.current);
            sound.playCrystalChime(item.tier || 'cyan');

            const crystalColor =
              item.tier === 'violet' ? '#c084fc' : item.tier === 'gold' ? '#fbbf24' : '#22d3ee';
            spawnExplosion(item.x, item.y, crystalColor, 14);
            spawnFloatingText(item.x, item.y - 10, `+${pts}`, crystalColor);

            itemsRef.current.splice(i, 1);
            continue;
          } else if (item.type === 'hazard') {
            if (!isInvulnerable) {
              livesRef.current -= 1;
              setHudLives(livesRef.current);
              invulnerableUntilRef.current = now + 1400; // 1.4s invulnerability
              screenShakeRef.current = 14;
              sound.playHazardHit();
              spawnExplosion(ship.x, ship.y, '#ef4444', 20);
              spawnFloatingText(ship.x, ship.y - 20, '-1 SHIELD', '#ef4444');

              if (livesRef.current <= 0 && !levelEndedRef.current) {
                levelEndedRef.current = true;
                setGameOverReason('lives');
                sound.playGameOver();
                setMode('game-over');
                return;
              }
            }
            itemsRef.current.splice(i, 1);
            continue;
          }
        }

        // Remove off-screen items
        if (item.y > logicalHeight + 30) {
          itemsRef.current.splice(i, 1);
        }
      }

      // Update screen shake
      if (screenShakeRef.current > 0) {
        screenShakeRef.current *= 0.85;
        if (screenShakeRef.current < 0.5) screenShakeRef.current = 0;
      }

      // Update particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (p.life >= p.maxLife) {
          particlesRef.current.splice(i, 1);
        }
      }

      // Update floating texts
      for (let i = floatingTextsRef.current.length - 1; i >= 0; i--) {
        const ft = floatingTextsRef.current[i];
        ft.y -= 1.0;
        ft.opacity -= 0.024;
        if (ft.opacity <= 0) {
          floatingTextsRef.current.splice(i, 1);
        }
      }

      // RENDER CANVAS
      ctx.save();
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      // Screen shake translation
      if (screenShakeRef.current > 0) {
        const ox = (Math.random() - 0.5) * screenShakeRef.current;
        const oy = (Math.random() - 0.5) * screenShakeRef.current;
        ctx.translate(ox, oy);
      }

      // 1. Deep Space Cosmic Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, logicalHeight);
      bgGrad.addColorStop(0, '#060a12');
      bgGrad.addColorStop(0.5, '#0b1329');
      bgGrad.addColorStop(1, '#040711');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      // Subtle tech grid lines
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < logicalWidth; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, logicalHeight);
        ctx.stroke();
      }
      for (let y = 0; y < logicalHeight; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(logicalWidth, y);
        ctx.stroke();
      }

      // 2. Parallax Drifting Stars
      for (const s of starsRef.current) {
        s.y += s.speed;
        if (s.y > logicalHeight) {
          s.y = 0;
          s.x = Math.random() * logicalWidth;
        }
        ctx.fillStyle = `rgba(186, 230, 253, ${s.alpha})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }

      // 3. Falling Items (Crystals and Hazards)
      for (const item of itemsRef.current) {
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.rotation);

        if (item.type === 'crystal') {
          const tier = item.tier || 'cyan';
          const r = item.radius;

          if (tier === 'violet') {
            // Violet Hyper-Crystal (Star / Octagon)
            ctx.shadowColor = '#a855f7';
            ctx.shadowBlur = 15;
            ctx.fillStyle = '#c084fc';
            ctx.strokeStyle = '#f3e8ff';
            ctx.lineWidth = 2;

            ctx.beginPath();
            for (let a = 0; a < 8; a++) {
              const rad = (a * Math.PI) / 4;
              const dist = a % 2 === 0 ? r : r * 0.55;
              const px = Math.cos(rad) * dist;
              const py = Math.sin(rad) * dist;
              if (a === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (tier === 'gold') {
            // Amber / Gold Crystal (Rhombus diamond)
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = '#fef3c7';
            ctx.lineWidth = 1.8;

            ctx.beginPath();
            ctx.moveTo(0, -r * 1.3);
            ctx.lineTo(r, 0);
            ctx.lineTo(0, r * 1.3);
            ctx.lineTo(-r, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else {
            // Cyan Crystal (Hexagon)
            ctx.shadowColor = '#06b6d4';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#22d3ee';
            ctx.strokeStyle = '#cffafe';
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            for (let a = 0; a < 6; a++) {
              const rad = (a * Math.PI) / 3;
              const px = Math.cos(rad) * r;
              const py = Math.sin(rad) * r;
              if (a === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        } else {
          // Hazard
          const r = item.radius;
          if (item.hazardType === 'mine') {
            // Spiked danger mine
            ctx.shadowColor = '#ef4444';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#7f1d1d';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;

            // Spikes
            for (let a = 0; a < 6; a++) {
              const rad = (a * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(Math.cos(rad) * (r * 1.4), Math.sin(rad) * (r * 1.4));
              ctx.stroke();
            }

            // Core sphere
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Pulsing warning eye
            ctx.fillStyle = '#fca5a5';
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Space Debris / Asteroid
            ctx.shadowColor = '#f97316';
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#334155';
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            const points = 7;
            for (let p = 0; p < points; p++) {
              const angle = (p * Math.PI * 2) / points;
              const jitter = (p % 2 === 0 ? 0.8 : 1.15) * r;
              const px = Math.cos(angle) * jitter;
              const py = Math.sin(angle) * jitter;
              if (p === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 4. Collector Ship Rendering
      const shipW = ship.width;
      const shipH = ship.height;
      const flicker = isInvulnerable && Math.floor(now / 100) % 2 === 0;

      if (!flicker) {
        ctx.save();
        ctx.translate(ship.x, ship.y);

        // Thruster flame particles
        const flameLength = 12 + Math.random() * 8;
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(-12, shipH / 2 - 2);
        ctx.lineTo(0, shipH / 2 + flameLength);
        ctx.lineTo(12, shipH / 2 - 2);
        ctx.closePath();
        ctx.fill();

        // Ship hull
        const hullGrad = ctx.createLinearGradient(0, -shipH / 2, 0, shipH / 2);
        hullGrad.addColorStop(0, '#0284c7');
        hullGrad.addColorStop(0.5, '#0369a1');
        hullGrad.addColorStop(1, '#075985');
        ctx.fillStyle = hullGrad;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;

        ctx.beginPath();
        // Sleek futuristic catamaran collector dish
        ctx.moveTo(-shipW / 2, shipH / 2);
        ctx.lineTo(-shipW / 2 + 10, -shipH / 2);
        ctx.lineTo(-8, -shipH / 2 + 8);
        ctx.lineTo(0, -shipH / 2 + 12);
        ctx.lineTo(8, -shipH / 2 + 8);
        ctx.lineTo(shipW / 2 - 10, -shipH / 2);
        ctx.lineTo(shipW / 2, shipH / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Collector energy dish beam (central intake funnel)
        ctx.strokeStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -shipH / 2 + 8, 14, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        // Cockpit canopy glow
        ctx.fillStyle = '#bae6fd';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();

        // Shield aura
        if (livesRef.current > 1 && !isInvulnerable) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(0, 0, shipW * 0.62, shipH * 0.9, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      // 5. Particles Rendering
      for (const p of particlesRef.current) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. Floating Score Text
      for (const ft of floatingTextsRef.current) {
        ctx.save();
        ctx.globalAlpha = ft.opacity;
        ctx.fillStyle = ft.color;
        ctx.shadowColor = ft.color;
        ctx.shadowBlur = 8;
        ctx.font = 'bold 16px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore();

      animationFrameIdRef.current = requestAnimationFrame(loop);
    };

    animationFrameIdRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [mode, currentLevel]);

  // Handle direct pointer/touch drag on canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 400 / rect.width;
    const clientX = e.clientX - rect.left;
    shipPosRef.current.targetX = clientX * scaleX;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'playing') return;
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 400 / rect.width;
    const clientX = e.clientX - rect.left;
    shipPosRef.current.targetX = clientX * scaleX;
  };

  // Progress percentage for HUD
  const progressPercent = currentLevel
    ? Math.min(100, Math.round((hudScore / currentLevel.targetScore) * 100))
    : 0;

  return (
    <div className="w-full max-w-lg mx-auto px-3 py-2 flex flex-col items-center select-none">
      {/* Top Bar Navigation & Balance */}
      <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
        <button
          onClick={() => {
            sound.playButtonClick();
            if (mode === 'playing' || mode === 'paused') {
              setMode('level-select');
            } else {
              onBackToMining();
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors text-xs font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{mode === 'playing' || mode === 'paused' ? 'Levels' : 'Mining Hub'}</span>
        </button>

        {/* Unified Balance Display */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900/90 border border-cyan-900/50">
          <Zap className="w-3.5 h-3.5 text-cyan-400 fill-current" />
          <span className="text-xs text-slate-400 font-mono">Balance:</span>
          <span className="text-sm font-bold font-mono text-cyan-300 tabular-nums">
            {(balance?.balance ?? 0).toFixed(4)} CP
          </span>
        </div>

        {/* Audio & Help Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowTutorialModal(true)}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="How to Play"
            aria-label="How to Play"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={toggleMute}
            className={`p-1.5 rounded-lg border transition-colors ${
              isMuted
                ? 'bg-slate-900 border-slate-800 text-slate-500'
                : 'bg-cyan-950/70 border-cyan-800/70 text-cyan-400'
            }`}
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* VIEW: LEVEL SELECT */}
      {mode === 'level-select' && (
        <div className="w-full space-y-4 animate-fade-in">
          {/* Header Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-cyan-950/30 to-slate-950 border border-cyan-800/40 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-lg font-bold text-white tracking-tight">Pulse Miner Arcade</h2>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                  Pilot your collector ship, harvest glowing energy crystals, and earn bonus virtual CP for
                  clearing each sector!
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-mono text-cyan-400 tracking-wider">
                  Cleared
                </span>
                <div className="text-base font-bold font-mono text-white tabular-nums">
                  {gameState?.completedLevels.length ?? 0} / {levels.length || 10}
                </div>
              </div>
            </div>

            {/* Total Game Points Earned */}
            <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-slate-400">Total Arcade Points Awarded:</span>
              <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                +{gameState?.totalGamePointsEarned ?? 0} CP
              </span>
            </div>
          </div>

          {/* Error Banner if any */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-center justify-between">
              <span>{errorMessage}</span>
              <button
                onClick={loadGameState}
                className="px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-200 text-[11px] font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {/* Level Selection Grid (10 Levels) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                Mission Sectors
              </span>
              <span className="text-[11px] text-slate-500">10 Progressive Stages</span>
            </div>

            {isLoadingState ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono">Synchronizing Arcade Sectors...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {levels.map((lvl) => {
                  const isUnlocked =
                    (gameState?.highestUnlockedLevel ?? 1) >= lvl.levelId;
                  const isCompleted = gameState?.completedLevels.includes(lvl.levelId);
                  const isClaimed = Boolean(gameState?.claimedLevelRewards?.[lvl.levelId]);
                  const highScore = gameState?.highScores?.[lvl.levelId] ?? 0;

                  return (
                    <button
                      key={lvl.levelId}
                      disabled={!isUnlocked}
                      onClick={() => startLevel(lvl)}
                      className={`relative p-3.5 rounded-xl text-left border transition-all flex flex-col justify-between min-h-[110px] ${
                        isUnlocked
                          ? isCompleted
                            ? 'bg-slate-900/80 border-emerald-900/60 hover:border-emerald-500/60 hover:bg-slate-800/80'
                            : 'bg-slate-900/90 border-cyan-900/70 hover:border-cyan-400/70 hover:bg-slate-800/90 shadow-sm shadow-cyan-950'
                          : 'bg-slate-950/60 border-slate-900 text-slate-600 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-start justify-between w-full">
                        <div>
                          <div className="text-[10px] font-mono text-slate-400">
                            SECTOR {lvl.levelId}
                          </div>
                          <div className="text-sm font-bold text-white tracking-tight truncate max-w-[110px]">
                            {lvl.name}
                          </div>
                        </div>

                        {/* Status Icon */}
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : !isUnlocked ? (
                          <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                        )}
                      </div>

                      {/* Objectives & Rewards */}
                      <div className="mt-2 space-y-1 text-[11px] font-mono">
                        <div className="text-slate-400">
                          Target: <span className="text-slate-200">{lvl.targetScore} pts</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-cyan-400 font-semibold">
                            +{lvl.rewardPoints} CP
                          </span>
                          {highScore > 0 && (
                            <span className="text-slate-500 text-[10px]">
                              Best: {highScore}
                            </span>
                          )}
                        </div>
                      </div>

                      {isClaimed && (
                        <div className="text-[9px] font-mono text-emerald-400 mt-1">
                          ✓ Reward Claimed
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Policy & Transparency Notice */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
            <span className="font-semibold text-slate-300">Google Play Policy Notice: </span>
            Pulse Miner is an arcade mini-game simulation. All points earned are virtual in-app tokens
            with no monetary or cryptocurrency value, and cannot be traded, withdrawn, or exchanged for real currency.
          </div>
        </div>
      )}

      {/* VIEW: ACTIVE GAMEPLAY */}
      {(mode === 'playing' || mode === 'paused') && currentLevel && (
        <div className="w-full flex flex-col items-center">
          {/* Game HUD Bar */}
          <div className="w-full max-w-[400px] mb-2 p-2 rounded-xl bg-slate-900/90 border border-cyan-900/50 flex items-center justify-between text-xs font-mono">
            {/* Lives / Shields */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[10px]">SHIELDS:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((lifeIndex) => (
                  <Shield
                    key={lifeIndex}
                    className={`w-3.5 h-3.5 transition-colors ${
                      lifeIndex <= hudLives ? 'text-cyan-400 fill-cyan-400' : 'text-slate-700'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Score / Target */}
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-[10px]">GOAL:</span>
              <span className="text-white font-bold tabular-nums">
                {hudScore} / {currentLevel.targetScore}
              </span>
            </div>

            {/* Time Left */}
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span
                className={`font-bold tabular-nums ${
                  hudTimeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-slate-200'
                }`}
              >
                {hudTimeLeft}s
              </span>
            </div>

            {/* Pause Button */}
            <button
              onClick={() => {
                sound.playButtonClick();
                setMode((m) => (m === 'playing' ? 'paused' : 'playing'));
              }}
              className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
              title={mode === 'paused' ? 'Resume' : 'Pause'}
              aria-label={mode === 'paused' ? 'Resume' : 'Pause'}
            >
              {mode === 'paused' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Target Progress Bar */}
          <div className="w-full max-w-[400px] h-1.5 bg-slate-800 rounded-full mb-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* HTML5 Canvas Viewport */}
          <div
            ref={containerRef}
            className="relative w-full max-w-[400px] aspect-[2/3] rounded-2xl overflow-hidden border-2 border-cyan-900/60 shadow-2xl bg-slate-950 touch-none"
          >
            <canvas
              ref={canvasRef}
              width={400}
              height={600}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              className="w-full h-full block cursor-ew-resize select-none touch-none"
            />

            {/* Level 1 Tutorial Overlay Prompt */}
            {currentLevel.levelId === 1 && hudScore < 20 && (
              <div className="absolute top-3 left-3 right-3 p-2 rounded-xl bg-slate-950/80 backdrop-blur-sm border border-cyan-800/60 text-[11px] text-cyan-200 text-center animate-pulse pointer-events-none">
                👉 Touch & drag collector left/right to catch glowing crystals! Avoid red space debris!
              </div>
            )}

            {/* Pause Menu Modal Overlay */}
            {mode === 'paused' && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 gap-3 z-20">
                <h3 className="text-xl font-bold text-white mb-2">Game Paused</h3>
                <button
                  onClick={() => {
                    sound.playButtonClick();
                    setMode('playing');
                  }}
                  className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  <span>Resume Mission</span>
                </button>
                <button
                  onClick={() => startLevel(currentLevel)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart Sector</span>
                </button>
                <button
                  onClick={() => {
                    sound.playButtonClick();
                    setMode('level-select');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white font-medium text-xs transition-colors"
                >
                  Return to Level Select
                </button>
              </div>
            )}
          </div>

          {/* Tactile On-Screen Arrow Touch Controls for Android / Mobile */}
          <div className="w-full max-w-[400px] mt-3 flex items-center justify-between gap-4">
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                leftPressedRef.current = true;
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                leftPressedRef.current = false;
              }}
              onPointerLeave={() => {
                leftPressedRef.current = false;
              }}
              onPointerCancel={() => {
                leftPressedRef.current = false;
              }}
              className="flex-1 py-4 rounded-xl bg-slate-900 border border-slate-800 active:bg-cyan-950 active:border-cyan-500 text-slate-300 active:text-cyan-400 flex items-center justify-center select-none shadow-md"
              aria-label="Move Left"
            >
              <ChevronLeft className="w-7 h-7" />
            </button>

            <div className="text-[10px] font-mono text-slate-500 text-center uppercase tracking-wider">
              Touch or Drag
            </div>

            <button
              onPointerDown={(e) => {
                e.preventDefault();
                rightPressedRef.current = true;
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                rightPressedRef.current = false;
              }}
              onPointerLeave={() => {
                rightPressedRef.current = false;
              }}
              onPointerCancel={() => {
                rightPressedRef.current = false;
              }}
              className="flex-1 py-4 rounded-xl bg-slate-900 border border-slate-800 active:bg-cyan-950 active:border-cyan-500 text-slate-300 active:text-cyan-400 flex items-center justify-center select-none shadow-md"
              aria-label="Move Right"
            >
              <ChevronRight className="w-7 h-7" />
            </button>
          </div>
        </div>
      )}

      {/* VIEW: LEVEL COMPLETED MODAL */}
      {mode === 'level-completed' && currentLevel && (
        <div className="w-full max-w-sm p-6 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-cyan-800/80 shadow-2xl flex flex-col items-center text-center animate-fade-in space-y-4 my-auto">
          <div className="p-3 rounded-full bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 shadow-lg shadow-cyan-500/20">
            <Award className="w-8 h-8" />
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase text-cyan-400 tracking-wider">
              Sector Cleared!
            </span>
            <h3 className="text-xl font-bold text-white tracking-tight mt-0.5">
              Level {currentLevel.levelId}: {currentLevel.name}
            </h3>
          </div>

          {/* Reward Status Banner */}
          <div className="w-full p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Final Score:</span>
              <span className="text-white font-bold">{hudScore} pts</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Objective:</span>
              <span className="text-slate-300">≥ {currentLevel.targetScore} pts</span>
            </div>
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400">Reward Status:</span>
              {isClaimingReward ? (
                <span className="text-cyan-400 font-mono animate-pulse">Claiming...</span>
              ) : claimedPointsAwarded !== null ? (
                <span className="font-mono font-bold text-emerald-400">
                  {claimedPointsAwarded > 0 ? `+${claimedPointsAwarded} CP Credited!` : 'Replay (Saved)'}
                </span>
              ) : claimError ? (
                <span className="text-red-400 font-mono text-[11px]">Sync failed</span>
              ) : (
                <span className="text-slate-400 font-mono">Completed</span>
              )}
            </div>

            {claimError && (
              <div className="text-[11px] text-red-300 text-left mt-1">
                {claimError}
                <button
                  onClick={() =>
                    handleClaimReward(
                      currentLevel,
                      hudScore,
                      currentLevel.timeLimitSeconds - hudTimeLeft
                    )
                  }
                  className="block mt-1 text-cyan-400 underline font-semibold"
                >
                  Retry claiming reward
                </button>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="w-full space-y-2 pt-2">
            {currentLevel.levelId < 10 && (
              <button
                onClick={() => {
                  const nextLvl = levels.find((l) => l.levelId === currentLevel.levelId + 1);
                  if (nextLvl) startLevel(nextLvl);
                }}
                className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Proceed to Sector {currentLevel.levelId + 1}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => startLevel(currentLevel)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Replay Sector</span>
            </button>

            <button
              onClick={() => {
                sound.playButtonClick();
                setMode('level-select');
                loadGameState();
              }}
              className="w-full py-2 rounded-xl bg-transparent hover:bg-slate-900 text-slate-400 hover:text-white font-medium text-xs transition-colors"
            >
              Back to Sector Map
            </button>
          </div>
        </div>
      )}

      {/* VIEW: GAME OVER MODAL */}
      {mode === 'game-over' && currentLevel && (
        <div className="w-full max-w-sm p-6 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-red-900/60 shadow-2xl flex flex-col items-center text-center animate-fade-in space-y-4 my-auto">
          <div className="p-3 rounded-full bg-red-950/80 border border-red-500/50 text-red-400 shadow-lg shadow-red-500/20">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase text-red-400 tracking-wider">
              {gameOverReason === 'timeout' ? 'Time Expired' : 'Shields Depleted'}
            </span>
            <h3 className="text-xl font-bold text-white tracking-tight mt-0.5">Mission Failed</h3>
            <p className="text-xs text-slate-400 mt-1">
              {gameOverReason === 'timeout'
                ? `You reached ${hudScore} pts, but needed ${currentLevel.targetScore} pts before the countdown ended.`
                : 'Your collector suffered critical hazard damage from asteroid impacts.'}
            </p>
          </div>

          <div className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-around text-xs font-mono">
            <div>
              <span className="text-slate-500 block text-[10px]">SCORE</span>
              <span className="text-white font-bold">{hudScore}</span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-500 block text-[10px]">TARGET</span>
              <span className="text-cyan-400 font-bold">{currentLevel.targetScore}</span>
            </div>
          </div>

          <div className="w-full space-y-2 pt-2">
            <button
              onClick={() => startLevel(currentLevel)}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Sector</span>
            </button>

            <button
              onClick={() => {
                sound.playButtonClick();
                setMode('level-select');
              }}
              className="w-full py-2 rounded-xl bg-transparent hover:bg-slate-900 text-slate-400 hover:text-white font-medium text-xs transition-colors"
            >
              Back to Sector Map
            </button>
          </div>
        </div>
      )}

      {/* HOW TO PLAY TUTORIAL MODAL */}
      {showTutorialModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">How to Play Pulse Miner</h3>
              </div>
              <button
                onClick={() => setShowTutorialModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-400 shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Collect Energy Crystals</div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Cyan = 10 pts, Amber Gold = 25 pts, Violet Plasma = 50 pts. Reach the target score
                    before time runs out!
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-red-950/80 border border-red-800/60 text-red-400 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Dodge Falling Hazards</div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Avoid space debris and proximity mines. You have 3 shield cells per mission.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 shrink-0">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Earn Coin Pulse Rewards</div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Each cleared level awards bonus virtual CP points credited directly to your unified
                    balance.
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowTutorialModal(false)}
              className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
