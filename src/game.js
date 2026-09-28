import { CONFIG } from "./config.js?v=20260929-2";
import {
  addForce,
  addTorque,
  applyImpulse,
  collideBodyWithSweptRingColliders,
  constrainToBounds,
  createBody,
  createPhysicsWorld,
  getRingContact,
  getRingVerticalClearance,
  isBodyInsideRingPassTrigger,
  stepBody
} from "./physics.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const dolphinSprite = new Image();
dolphinSprite.src = "./LOWPOLY_DOLPHIN.png?v=20260928-2";
const DOLPHIN_SPRITE_CROP = { x: 0, y: 0, width: 1536, height: 1024 };
const backgroundSprite = new Image();
backgroundSprite.src = "./ACADEMY_BACKGROUND.png?v=20260928-2";
const ringSprites = {
  back: new Image(),
  front: new Image()
};
ringSprites.back.src = "./RING_LOWPOLY_THIN.png?v=20260928-1";
ringSprites.front.src = "./RING_LOWPOLY_THIN.png?v=20260928-1";
const ui = {
  score: document.querySelector("#score"),
  combo: document.querySelector("#combo"),
  toast: document.querySelector("#toast"),
  startPanel: document.querySelector("#startPanel"),
  gameOverPanel: document.querySelector("#gameOverPanel"),
  startButton: document.querySelector("#startButton"),
  restartButton: document.querySelector("#restartButton"),
  finalScore: document.querySelector("#finalScore"),
  bestScore: document.querySelector("#bestScore")
};

let scale = 1;
let width = CONFIG.world.baseWidth;
let height = CONFIG.world.baseHeight;
let state = createState("ready");
const physicsWorld = createPhysicsWorld({
  gravityY: CONFIG.physics.gravity,
  maxRiseSpeed: CONFIG.physics.maxRiseSpeed,
  maxFallSpeed: CONFIG.physics.maxFallSpeed,
  bounds: {
    left: CONFIG.world.dolphinX - 90,
    right: CONFIG.world.dolphinX + 64,
    top: CONFIG.world.surfacePadding,
    bottom: CONFIG.world.baseHeight - CONFIG.world.seaFloorPadding
  }
});
let lastTime = performance.now();
let tapPulse = 0;
let toastUntil = 0;
let nextRingId = 1;

const GameOverReason = Object.freeze({
  RING_HARD_COLLISION: "RING_HARD_COLLISION",
  RING_STUCK: "RING_STUCK",
  RING_EXCESSIVE_PENETRATION: "RING_EXCESSIVE_PENETRATION",
  RING_CORRIDOR_DEVIATION: "RING_CORRIDOR_DEVIATION",
  RING_MISSED_TRIGGER: "RING_MISSED_TRIGGER",
  RING_MISSED: "RING_MISSED",
  OTHER: "OTHER"
});

function createState(mode = "playing") {
  return {
    mode,
    score: 0,
    combo: 0,
    best: Number(localStorage.getItem("dolphin.best") || 0),
    dolphin: {
      body: createBody({
        x: CONFIG.world.dolphinX,
        y: CONFIG.world.baseHeight * 0.5,
        mass: CONFIG.physics.mass,
        inertia: CONFIG.physics.inertia,
        radius: CONFIG.dolphin.bodyRadius,
        linearDamping: CONFIG.physics.drag,
        angularDamping: CONFIG.physics.angularDamping,
        maxAngularVelocity: CONFIG.physics.maxAngularVelocity
      }),
      x: CONFIG.world.dolphinX,
      y: CONFIG.world.baseHeight * 0.5,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVelocity: 0,
      swim: 0
    },
    rings: [],
    obstacles: [],
    comboBursts: [],
    spawnTimer: 0,
    globalStallTimer: 0,
    worldTime: 0,
    frameNumber: 0,
    lastRingY: CONFIG.world.baseHeight * 0.5,
    gameOverReason: null,
    gameOverDetails: null
  };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = document.body.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  width = rect.width;
  height = rect.height;
  scale = Math.min(width / CONFIG.world.baseWidth, height / CONFIG.world.baseHeight);
}

function toScreen(v) {
  return v * scale;
}

function worldY(y) {
  return (height - CONFIG.world.baseHeight * scale) / 2 + y * scale;
}

function startGame() {
  state = createState("playing");
  ui.startPanel.classList.add("hidden");
  ui.gameOverPanel.classList.add("hidden");
}

function inputDown(event) {
  if (event.target.closest("button")) return;
  event.preventDefault();
  if (state.mode === "ready") startGame();
  if (state.mode === "playing") flapDolphin();
}

function inputUp() {
}

function flapDolphin() {
  const body = state.dolphin.body;
  const targetVy = CONFIG.physics.tapRiseVelocity;
  const impulseY = Math.min(0, targetVy - body.vy) * body.mass;
  applyImpulse(body, 0, impulseY, 0, 0);
  if (Math.abs(body.angle) > 0.04 || Math.abs(body.angularVelocity) > 0.08) {
    body.angle *= CONFIG.physics.tapLeveling;
    body.angularVelocity *= CONFIG.physics.tapLeveling;
  }
  tapPulse = 0.18;
}

function spawnRing() {
  const cfg = CONFIG.rings;
  const heightDifficulty = clamp(
    state.score / CONFIG.difficulty.heightDifficultyFullScore,
    0,
    1
  );
  const heightBlend = lerp(
    CONFIG.difficulty.spawnHeightBlendStart,
    CONFIG.difficulty.spawnHeightBlendEnd,
    heightDifficulty
  );
  const verticalNoise = lerp(
    CONFIG.difficulty.verticalNoiseStart,
    CONFIG.difficulty.verticalNoiseEnd,
    heightDifficulty
  );
  const visibleWorldRight = Math.max(
    CONFIG.world.baseWidth,
    width / Math.max(scale, 0.001)
  );
  const targetY = cfg.minY + Math.random() * (cfg.maxY - cfg.minY);
  const blendedY = state.lastRingY + (targetY - state.lastRingY) * heightBlend;
  const drift = (Math.random() * 2 - 1) * verticalNoise;
  const visualTilt = cfg.minVisualTilt + Math.random() * (cfg.maxVisualTilt - cfg.minVisualTilt);
  state.lastRingY = clamp(blendedY + drift, cfg.minY, cfg.maxY);
  state.rings.push({
    id: nextRingId++,
    x: visibleWorldRight + cfg.outerRadius + cfg.spawnLeadDistance,
    y: state.lastRingY,
    outer: cfg.outerRadius,
    inner: Math.max(42, cfg.innerRadius - Math.min(12, state.score * 0.16)),
    wobble: Math.random() * Math.PI * 2,
    tilt: visualTilt,
    visualTilt,
    hitCooldown: 0,
    stallTimer: 0,
    touched: false,
    hit: false,
    softContact: false,
    contactDuration: 0,
    contactGraceTimer: 0,
    contactRecoveryTimer: 0,
    noProgressDuration: 0,
    corridorOutsideDuration: 0,
    previousPassProgress: 0,
    progressDelta: 0,
    previousPenetration: 0,
    lastPenetration: 0,
    lastImpactSpeed: 0,
    lastCollisionNormal: null,
    currentCollider: null,
    currentContactId: null,
    lastContactProbe: null,
    debugFrames: [],
    failSource: null,
    failReason: null,
    maxPenetration: 0,
    stuckDuration: 0,
    pendingFail: false,
    failTimer: 0,
    hasPassedTrigger: false,
    hasExitedRing: false,
    hasHardCollision: false,
    hasFailed: false,
    contactState: "APPROACHING",
    corridorDeviation: 0,
    corridorDeviationSum: 0,
    corridorSamples: 0,
    corridorInsideTime: 0,
    maxCorridorDeviation: 0,
    totalContactDuration: 0,
    excessiveOverlap: false,
    isDolphinInside: false,
    passProgress: 0,
    visualPassProgress: 0,
    hasScored: false,
    passed: false
  });
}

function update(dt) {
  state.worldTime += dt;
  state.frameNumber += 1;
  updateAmbient(dt);
  if (state.mode !== "playing") return;
  state.globalStallTimer = Math.max(0, (state.globalStallTimer || 0) - dt);

  const p = CONFIG.physics;
  const dolphin = state.dolphin;
  const body = dolphin.body;
  const previousDolphinX = body.x;
  const previousDolphinY = body.y;
  addForce(body, (CONFIG.world.dolphinX - body.x) * p.horizontalReturn * body.mass, 0);
  const gravityRelief = ringGravityRelief(body);
  if (gravityRelief > 0) {
    addForce(body, 0, -p.gravity * body.mass * gravityRelief);
    if (body.vy > 0) body.vy *= 1 - 0.34 * gravityRelief;
  }
  body.vx *= p.horizontalDamping;
  const targetAngle = 0;
  addTorque(body, (targetAngle - body.angle) * p.rotationSmoothing * p.inertia);
  stepBody(physicsWorld, body, dt);
  const hitBounds = constrainToBounds(body, physicsWorld.bounds, p.worldRestitution);
  dolphin.x = body.x;
  dolphin.y = body.y;
  dolphin.vx = body.vx;
  dolphin.vy = body.vy;
  dolphin.angle = clamp(body.angle, -0.95, 0.95);
  body.angle = dolphin.angle;
  dolphin.angularVelocity = body.angularVelocity;
  tapPulse = Math.max(0, tapPulse - dt);
  dolphin.swim += dt * (tapPulse > 0 ? 13 : 7);

  if (hitBounds) {
    state.combo = 0;
    updateHud();
  }

  const speed = currentRingSpeed();
  const baseSpawnEvery = CONFIG.rings.spawnEvery
    - state.score * CONFIG.difficulty.spawnReductionPerScore;
  const speedRatio = speed / CONFIG.rings.startSpeed;
  const spatialGapScale = 1
    + (speedRatio - 1) * CONFIG.difficulty.speedToGapRatio;
  const spawnEvery = Math.max(
    CONFIG.difficulty.minSpawnEvery,
    baseSpawnEvery * spatialGapScale / speedRatio
  );
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnRing();
    state.spawnTimer = spawnEvery;
  }

  for (const ring of state.rings) {
    const stalled = ring.stallTimer > 0;
    ring.stallTimer = Math.max(0, (ring.stallTimer || 0) - dt);
    const globalStalled = state.globalStallTimer > 0;
    const ringSpeed = stalled || globalStalled ? speed * CONFIG.rings.collisionSpeedScale : speed;
    const previousRingX = ring.x;
    ring.x -= ringSpeed * dt;
    ring.vx = -ringSpeed;
    ring.vy = 0;
    updateRingPassVisualState(ring);
    advanceRingContactState(ring, dt);
    updateRingCorridorState(ring, dt);
    ring.hitCooldown = Math.max(0, ring.hitCooldown - dt);
    ring.currentCollider = null;
    ring.currentContactId = null;
    const contact = resolveRingCollision(ring, previousRingX, previousDolphinX, previousDolphinY);
    const reachedPassPlane = isRingPassTriggerActive(ring)
      || (ring.touched && isRingPassTriggerActive(
        ring,
        CONFIG.rings.passGrazeRadius,
        CONFIG.rings.passGrazeVerticalTolerance
      ));
    if (!ring.hasFailed && reachedPassPlane) {
      ring.hasPassedTrigger = true;
      clearRecoverableRingFailure(ring);
      ring.contactState = "PASSING";
    }
    if (ring.hasPassedTrigger && !ring.hasExitedRing && hasExitedRing(ring)) {
      ring.hasExitedRing = true;
      if (canScoreRing(ring)) {
        clearRecoverableRingFailure(ring);
        ring.hasScored = true;
        ring.passed = true;
        ring.softContact = false;
        ring.contactState = "PASSED";
        scoreRing(ring);
      } else if (!ring.pendingFail) {
        markRingHardCollision(ring, GameOverReason.RING_CORRIDOR_DEVIATION, "update:exit-validation");
      }
    }
    recordRingDebugFrame(ring, contact);
    if (!ring.passed && ring.pendingFail && ring.failTimer <= 0) {
      ring.hasFailed = true;
      ring.contactState = "FAILED";
      triggerGameOver(ring.failReason || GameOverReason.RING_HARD_COLLISION, ring);
      break;
    }
    if (!ring.passed && !ring.hasPassedTrigger && !ring.softContact
      && ring.x < getDolphinTorsoCenter().x - CONFIG.dolphin.radiusX * 0.35) {
      triggerGameOver(GameOverReason.RING_MISSED_TRIGGER, ring);
      break;
    }
    if (!ring.passed && ring.x + ring.outer < CONFIG.rings.missX) {
      triggerGameOver(GameOverReason.RING_MISSED, ring);
      break;
    }
  }
  state.rings = state.rings.filter((ring) => ring.x + ring.outer > -40);
}

function advanceRingContactState(ring, dt) {
  const cfg = CONFIG.rings;
  if (ring.softContact) {
    ring.contactDuration += dt;
    ring.totalContactDuration += dt;
    const escapeVelocity = state.dolphin.body.vx - ring.vx;
    if (escapeVelocity < cfg.ringMinimumEscapeVelocity) {
      ring.stuckDuration += dt;
    } else {
      ring.stuckDuration = Math.max(0, ring.stuckDuration - dt * 0.5);
    }
    ring.contactGraceTimer = Math.max(0, ring.contactGraceTimer - dt);
    ring.contactRecoveryTimer = Math.max(0, ring.contactRecoveryTimer - dt);
    const progressing = ring.progressDelta >= cfg.ringMinProgressDelta;
    ring.noProgressDuration = progressing ? 0 : ring.noProgressDuration + dt;
    if (progressing && ring.pendingFail) {
      clearRecoverableRingFailure(ring);
    }
    if (!ring.pendingFail && ring.contactGraceTimer <= 0 && ring.noProgressDuration >= cfg.ringNoProgressDuration) {
      if (ring.lastContactProbe !== "head" && ring.maxPenetration >= cfg.ringFailPenetrationThreshold) {
        markRingHardCollision(ring, GameOverReason.RING_EXCESSIVE_PENETRATION, "advanceRingContactState:penetration");
      } else if (ring.stuckDuration >= cfg.ringStuckDuration
        || ring.contactDuration >= cfg.ringSoftContactDuration) {
        markRingHardCollision(ring, GameOverReason.RING_STUCK, "advanceRingContactState:stuck");
      }
    }
    if (!ring.pendingFail && ring.contactRecoveryTimer <= 0) {
      ring.softContact = false;
      ring.contactDuration = 0;
      ring.maxPenetration = 0;
      ring.lastPenetration = 0;
      ring.stuckDuration = 0;
      ring.noProgressDuration = 0;
      if (!ring.hasPassedTrigger) ring.contactState = "APPROACHING";
    }
  }
  if (ring.pendingFail) ring.failTimer = Math.max(0, ring.failTimer - dt);
}

function markRingHardCollision(ring, reason = GameOverReason.RING_HARD_COLLISION, source = "unknown") {
  ring.hasHardCollision = true;
  ring.pendingFail = true;
  ring.hit = true;
  ring.contactState = "FAILED";
  ring.failReason = reason;
  ring.failSource = source;
  ring.failTimer = CONFIG.rings.ringFailDelay;
}

function clearRecoverableRingFailure(ring) {
  ring.hasHardCollision = false;
  ring.pendingFail = false;
  ring.failTimer = 0;
  ring.failReason = null;
  ring.failSource = null;
  ring.contactState = ring.hasPassedTrigger ? "PASSING" : "SOFT_CONTACT";
}

function hasExitedRing(ring) {
  return getDolphinTorsoCenter().x - ring.x >= CONFIG.rings.ringExitDistance;
}

function updateRingCorridorState(ring, dt) {
  if (ring.passed || ring.hasFailed) return;
  const cfg = CONFIG.rings;
  const torso = getDolphinTorsoCenter();
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = torso.x - ring.x;
  const dy = torso.y - ring.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const corridorHalfWidth = cfg.passTriggerHalfWidth * cfg.openingCorridorScaleX;
  const openingHalfHeight = ring.inner * cfg.visualHeightScale - CONFIG.dolphin.ringCollisionRadius;
  const corridorHalfHeight = Math.max(1, openingHalfHeight * cfg.openingCorridorScaleY);
  if (Math.abs(localX) > corridorHalfWidth) {
    ring.corridorOutsideDuration = Math.max(0, ring.corridorOutsideDuration - dt);
    return;
  }

  const deviation = Math.abs(localY) / corridorHalfHeight;
  ring.corridorDeviation = deviation;
  ring.corridorDeviationSum += deviation;
  ring.corridorSamples += 1;
  ring.maxCorridorDeviation = Math.max(ring.maxCorridorDeviation, deviation);
  if (deviation <= 1) ring.corridorInsideTime += dt;
  if (deviation > cfg.maxTorsoDeviation) {
    ring.corridorOutsideDuration += dt;
  } else {
    ring.corridorOutsideDuration = Math.max(0, ring.corridorOutsideDuration - dt * 2);
  }
  if (deviation > cfg.maxTorsoDeviation
    && ring.contactGraceTimer <= 0
    && ring.noProgressDuration >= cfg.ringNoProgressDuration
    && ring.corridorOutsideDuration >= cfg.ringNoProgressDuration
    && !ring.pendingFail) {
    markRingHardCollision(ring, GameOverReason.RING_CORRIDOR_DEVIATION, "updateRingCorridorState:deviation");
  }
}

function canScoreRing(ring) {
  const cfg = CONFIG.rings;
  return ring.hasPassedTrigger
    && ring.hasExitedRing
    && !ring.hasFailed
    && ring.passProgress >= cfg.minimumForwardProgress;
}

function isRingPassTriggerActive(
  ring,
  collisionRadius = CONFIG.dolphin.ringCollisionRadius,
  verticalTolerance = 0
) {
  const cfg = CONFIG.rings;
  return isBodyInsideRingPassTrigger(state.dolphin.body, ring, {
    collisionRadius,
    colliderOffsetX: CONFIG.dolphin.colliderOffsetX,
    colliderOffsetY: CONFIG.dolphin.colliderOffsetY,
    visualWidthScale: cfg.visualWidthScale,
    visualHeightScale: cfg.visualHeightScale,
    passTriggerHalfWidth: cfg.passTriggerHalfWidth,
    verticalTolerance
  });
}

function updateRingPassVisualState(ring) {
  const colliderHalfLength = CONFIG.dolphin.colliderHalfLength + CONFIG.dolphin.ringCollisionRadius;
  const spriteHalfWidth = CONFIG.dolphin.spriteWidth * 0.5;
  const transitionRange = CONFIG.dolphin.spriteWidth * 0.5 + CONFIG.rings.spriteWidth * 0.5;
  const distance = ring.x - getDolphinTorsoCenter().x;
  ring.isDolphinInside = distance >= -transitionRange && distance <= transitionRange;
  const nextProgress = clamp(
    (colliderHalfLength - distance) / (colliderHalfLength * 2),
    0,
    1
  );
  ring.previousPassProgress = ring.passProgress;
  ring.passProgress = nextProgress;
  ring.progressDelta = Math.max(0, ring.passProgress - ring.previousPassProgress);
  ring.visualPassProgress = clamp(
    (spriteHalfWidth - distance) / (spriteHalfWidth * 2),
    0,
    1
  );
}

function getDolphinTorsoCenter() {
  const body = state.dolphin.body;
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.x + cos * CONFIG.dolphin.colliderOffsetX - sin * CONFIG.dolphin.colliderOffsetY,
    y: body.y + sin * CONFIG.dolphin.colliderOffsetX + cos * CONFIG.dolphin.colliderOffsetY
  };
}

function ringGravityRelief(body) {
  let relief = 0;
  const cfg = CONFIG.rings;
  for (const ring of state.rings) {
    if (ring.passed) continue;
    const c = getRingContact(body, ring, cfg.depthTilt, cfg.visualWidthScale, cfg.visualHeightScale);
    const gateRange = cfg.outerRadius * cfg.visualWidthScale + CONFIG.dolphin.radiusX;
    const inGateDepth = Math.abs(c.localX) < gateRange;
    const inOpening = getRingClearance(ring).normalized < ring.inner - CONFIG.dolphin.radiusY * 0.15;
    if (!inGateDepth || !inOpening) continue;
    const depthFactor = 1 - Math.min(1, Math.abs(c.localX) / gateRange);
    relief = Math.max(relief, 0.72 + depthFactor * 0.28);
  }
  return relief;
}

function scoreRing(ring) {
  const clearance = getRingClearance(ring);
  const clean = !ring.touched && clearance.normalized + CONFIG.dolphin.cleanRadius < ring.inner;
  if (clean) {
    state.combo += 1;
    state.score += state.combo;
    showToast(`완벽 통과! +${state.combo}`);
    showComboBurst(ring, state.combo);
  } else {
    state.score += 1;
    state.combo = 0;
    showToast("통과! +1");
  }
  updateHud();
}

function resolveRingCollision(ring, previousRingX, previousDolphinX, previousDolphinY) {
  const cfg = CONFIG.rings;
  const contact = collideBodyWithSweptRingColliders(state.dolphin.body, ring, {
    previousRingX,
    previousBodyX: previousDolphinX,
    previousBodyY: previousDolphinY,
    ccdStep: cfg.ccdStep,
    minImpulse: cfg.collisionImpulse,
    restitution: cfg.collisionRestitution,
    positionCorrection: cfg.positionCorrection,
    angularImpulseScale: cfg.angularImpulseScale,
    passageDepth: cfg.passageDepth,
    collisionRadius: CONFIG.dolphin.ringCollisionRadius,
    colliderHalfLength: CONFIG.dolphin.colliderHalfLength,
    colliderOffsetX: CONFIG.dolphin.colliderOffsetX,
    colliderOffsetY: CONFIG.dolphin.colliderOffsetY,
    openCenterChannel: true,
    colliderInset: cfg.colliderInset,
    sideColliderHeightScale: cfg.sideColliderHeightScale,
    capColliderWidthScale: cfg.capColliderWidthScale,
    normalDamping: cfg.ringNormalDamping,
    surfaceSlideFactor: cfg.ringSurfaceSlideFactor,
    contactFriction: cfg.ringContactFriction,
    pushOutForce: cfg.ringPushOutForce,
    angularResponse: cfg.ringHitAngularResponse,
    visualWidthScale: cfg.visualWidthScale,
    visualHeightScale: cfg.visualHeightScale
  });
  if (!contact) return null;

  ring.touched = true;
  const firstContact = !ring.softContact;
  ring.softContact = true;
  if (!ring.hasPassedTrigger) ring.contactState = "SOFT_CONTACT";
  if (firstContact) ring.contactGraceTimer = cfg.ringCollisionGraceTime;
  ring.contactRecoveryTimer = cfg.ringContactRecovery;
  ring.previousPenetration = ring.lastPenetration;
  ring.lastPenetration = contact.penetration;
  ring.lastImpactSpeed = contact.normalImpactSpeed;
  ring.lastCollisionNormal = { x: contact.normalX, y: contact.normalY };
  ring.currentCollider = contact.collider || null;
  ring.currentContactId = contact.contactId || ring.currentCollider;
  ring.lastContactProbe = getContactProbeName(contact.contactId);
  ring.maxPenetration = Math.max(ring.maxPenetration, contact.penetration);
  if (ring.maxPenetration > cfg.maxGrazePenetration) ring.excessiveOverlap = true;
  if (!ring.pendingFail
    && ring.lastContactProbe !== "head"
    && contact.penetration >= cfg.ringImmediateFailPenetrationThreshold) {
    markRingHardCollision(ring, GameOverReason.RING_EXCESSIVE_PENETRATION, "resolveRingCollision:immediate-penetration");
  }
  ring.hitCooldown = cfg.collisionCooldown;
  const capContact = contact.collider === "top" || contact.collider === "bottom";
  if (capContact && !ring.hasPassedTrigger) {
    const releaseDirection = contact.collider === "top" ? -1 : 1;
    state.dolphin.body.y += releaseDirection * cfg.capReleaseDistance;
    state.dolphin.body.vy = releaseDirection * Math.max(
      Math.abs(state.dolphin.body.vy),
      cfg.capReleaseSpeed
    );
  } else {
    ring.stallTimer = Math.max(ring.stallTimer || 0, 0.09);
    state.globalStallTimer = Math.max(state.globalStallTimer || 0, 0.06);
  }
  state.dolphin.x = state.dolphin.body.x;
  state.dolphin.y = state.dolphin.body.y;
  state.dolphin.vx = state.dolphin.body.vx;
  state.dolphin.vy = state.dolphin.body.vy;
  state.dolphin.angularVelocity = state.dolphin.body.angularVelocity;
  return contact;
}

function getContactProbeName(contactId) {
  const probeIndex = Number(String(contactId || "").split(":")[1]);
  if (probeIndex === 0) return "tail";
  if (probeIndex === 1) return "torso";
  if (probeIndex === 2) return "head";
  return null;
}

function recordRingDebugFrame(ring, contact) {
  const body = state.dolphin.body;
  ring.debugFrames.push({
    frame: state.frameNumber,
    timestampMs: Math.round(performance.now()),
    state: ring.contactState,
    penetration: ring.lastPenetration,
    previousPenetration: ring.previousPenetration,
    passProgress: ring.passProgress,
    previousPassProgress: ring.previousPassProgress,
    passProgressDelta: ring.progressDelta,
    contactDuration: ring.contactDuration,
    hasPassedTrigger: ring.hasPassedTrigger,
    hasExitedRing: ring.hasExitedRing,
    hasHardCollision: ring.hasHardCollision,
    excessiveOverlap: ring.excessiveOverlap,
    pendingFail: ring.pendingFail,
    stuckDuration: ring.stuckDuration,
    corridorDeviation: ring.corridorDeviation,
    velocityX: body.vx,
    velocityY: body.vy,
    normalX: contact?.normalX ?? ring.lastCollisionNormal?.x ?? null,
    normalY: contact?.normalY ?? ring.lastCollisionNormal?.y ?? null,
    collider: contact?.collider ?? ring.currentCollider,
    contactId: contact?.contactId ?? ring.currentContactId,
    contactProbe: ring.lastContactProbe,
    failSource: ring.failSource
  });
  if (ring.debugFrames.length > 20) ring.debugFrames.shift();
}

function getRingClearance(ring) {
  return getRingVerticalClearance(state.dolphin.body, ring, CONFIG.rings.depthTilt);
}

function drawColliderDebug() {
  const ringCfg = CONFIG.rings;
  const dolphinCfg = CONFIG.dolphin;
  const body = state.dolphin.body;

  ctx.save();
  ctx.strokeStyle = "rgba(95, 255, 154, .9)";
  ctx.fillStyle = "rgba(95, 255, 154, .12)";
  ctx.lineWidth = Math.max(1, toScreen(1.5));
  ctx.translate(toScreen(body.x), worldY(body.y));
  ctx.rotate(body.angle);
  ctx.translate(toScreen(dolphinCfg.colliderOffsetX), toScreen(dolphinCfg.colliderOffsetY));
  for (const offset of [-dolphinCfg.colliderHalfLength, 0, dolphinCfg.colliderHalfLength]) {
    ctx.beginPath();
    ctx.arc(toScreen(offset), 0, toScreen(dolphinCfg.ringCollisionRadius), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  for (const ring of state.rings) {
    const inset = ringCfg.colliderInset;
    const outerX = ring.outer * ringCfg.visualWidthScale - inset;
    const outerY = ring.outer * ringCfg.visualHeightScale - inset;
    const innerX = ring.inner * ringCfg.visualWidthScale + inset;
    const innerY = ring.inner * ringCfg.visualHeightScale + inset;
    const capX = outerX * ringCfg.capColliderWidthScale;
    const sideY = innerY * ringCfg.sideColliderHeightScale;
    const boxes = [
      [-capX, -outerY, capX * 2, outerY - innerY],
      [-capX, innerY, capX * 2, outerY - innerY],
      [-outerX, -sideY, outerX - innerX, sideY * 2],
      [innerX, -sideY, outerX - innerX, sideY * 2]
    ];

    ctx.save();
    ctx.translate(toScreen(ring.x), worldY(ring.y));
    ctx.rotate(ring.tilt);
    ctx.strokeStyle = "rgba(255, 214, 74, .95)";
    ctx.fillStyle = "rgba(255, 214, 74, .12)";
    for (const [x, y, widthValue, heightValue] of boxes) {
      ctx.beginPath();
      ctx.rect(toScreen(x), toScreen(y), toScreen(widthValue), toScreen(heightValue));
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(83, 238, 255, .95)";
    ctx.strokeRect(
      toScreen(-ringCfg.passTriggerHalfWidth),
      toScreen(-innerY),
      toScreen(ringCfg.passTriggerHalfWidth * 2),
      toScreen(innerY * 2)
    );
    const corridorHeight = Math.max(
      1,
      (ring.inner * ringCfg.visualHeightScale - dolphinCfg.ringCollisionRadius)
        * ringCfg.openingCorridorScaleY
    );
    ctx.strokeStyle = "rgba(255, 105, 220, .95)";
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      toScreen(ringCfg.passTriggerHalfWidth * ringCfg.openingCorridorScaleX),
      toScreen(corridorHeight),
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }
  drawCollisionDebugOverlay();
}

function drawCollisionDebugOverlay() {
  const torso = getDolphinTorsoCenter();
  const ring = state.rings.reduce((closest, item) => (
    !closest || Math.abs(item.x - torso.x) < Math.abs(closest.x - torso.x) ? item : closest
  ), null);
  const lines = ring ? [
    `Ring #${ring.id}  State: ${ring.contactState}`,
    `Progress: ${ring.passProgress.toFixed(2)}  Delta: ${ring.progressDelta.toFixed(3)}`,
    `Contact: ${ring.softContact ? "SOFT" : "NONE"}  Penetration: ${ring.lastPenetration.toFixed(2)}`,
    `Contact Time: ${ring.contactDuration.toFixed(2)}  No Progress: ${ring.noProgressDuration.toFixed(2)}`,
    `Deviation: ${ring.corridorDeviation.toFixed(2)}  Trigger: ${ring.hasPassedTrigger}`,
    `게임 종료: ${state.gameOverReason || "없음"}`
  ] : [`게임 종료: ${state.gameOverReason || "없음"}`];
  ctx.save();
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0, 18, 30, .78)";
  ctx.fillRect(12, 12, 350, lines.length * 18 + 16);
  ctx.fillStyle = "#eaffff";
  lines.forEach((line, index) => ctx.fillText(line, 20, 20 + index * 18));
  ctx.restore();
}

function currentRingSpeed() {
  const speedLevel = Math.floor(state.score / CONFIG.difficulty.speedStepScore);
  return CONFIG.rings.startSpeed
    * Math.pow(CONFIG.difficulty.speedMultiplierPerStep, speedLevel);
}

function triggerGameOver(reason = GameOverReason.OTHER, ring = null) {
  if (state.mode !== "playing") return;
  const body = state.dolphin.body;
  const details = {
    reason,
    ringId: ring?.id ?? null,
    penetration: ring?.lastPenetration ?? 0,
    maxPenetration: ring?.maxPenetration ?? 0,
    previousPenetration: ring?.previousPenetration ?? 0,
    contactDuration: ring?.contactDuration ?? 0,
    passProgress: ring?.passProgress ?? 0,
    previousPassProgress: ring?.previousPassProgress ?? 0,
    passProgressDelta: ring?.progressDelta ?? 0,
    corridorDeviation: ring?.corridorDeviation ?? 0,
    velocity: { x: body.vx, y: body.vy },
    hasPassedTrigger: ring?.hasPassedTrigger ?? false,
    hasExitedRing: ring?.hasExitedRing ?? false,
    hasHardCollision: ring?.hasHardCollision ?? false,
    excessiveOverlap: ring?.excessiveOverlap ?? false,
    pendingFail: ring?.pendingFail ?? false,
    stuckDuration: ring?.stuckDuration ?? 0,
    collisionNormal: ring?.lastCollisionNormal ?? null,
    collider: ring?.currentCollider ?? null,
    contactId: ring?.currentContactId ?? null,
    contactProbe: ring?.lastContactProbe ?? null,
    contactState: ring?.contactState ?? null,
    failSource: ring?.failSource ?? null,
    frame: state.frameNumber,
    timestampMs: Math.round(performance.now())
  };
  state.gameOverReason = reason;
  state.gameOverDetails = details;
  console.group("[게임 종료]");
  for (const [key, value] of Object.entries(details)) console.log(`${key} =`, value);
  if (ring?.debugFrames?.length) console.table(ring.debugFrames);
  console.groupEnd();
  state.mode = "over";
  state.best = Math.max(state.best, state.score);
  localStorage.setItem("dolphin.best", String(state.best));
  ui.finalScore.textContent = state.score;
  ui.bestScore.textContent = state.best;
  ui.gameOverPanel.classList.remove("hidden");
}

function updateHud() {
  ui.score.textContent = state.score;
  ui.combo.textContent = state.combo;
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  toastUntil = performance.now() + CONFIG.effects.toastMs;
}

function updateAmbient(dt) {
  for (const burst of state.comboBursts) {
    burst.age += dt;
  }
  state.comboBursts = state.comboBursts.filter((burst) => burst.age < burst.duration);
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  drawBackground();
  const dolphinPass = getDolphinPassState();
  const maskOverlap = 3;
  drawRings();
  if (dolphinPass) {
    drawCuteDolphin(-CONFIG.dolphin.spriteWidth * 0.5, dolphinPass.boundaryX + maskOverlap, false);
  } else {
    drawCuteDolphin();
  }
  drawFrontRings();
  if (dolphinPass) {
    drawCuteDolphin(dolphinPass.boundaryX - maskOverlap, CONFIG.dolphin.spriteWidth * 0.5, false);
  }
  if (CONFIG.effects.debugColliders) drawColliderDebug();
  drawComboBursts();
  if (performance.now() > toastUntil) ui.toast.classList.remove("show");
}

function getDolphinPassState() {
  const torsoCenter = getDolphinTorsoCenter();
  const halfWidth = CONFIG.dolphin.spriteWidth * 0.5;
  let activeRing = null;
  let closestDistance = Infinity;

  for (const ring of state.rings) {
    if (!ring.isDolphinInside) continue;
    const openingHalfHeight = ring.inner * CONFIG.rings.visualHeightScale
      - CONFIG.dolphin.ringCollisionRadius;
    const verticalDistance = Math.abs(torsoCenter.y - ring.y);
    if (verticalDistance > openingHalfHeight + CONFIG.rings.passGrazeVerticalTolerance) continue;
    const distance = ring.x - torsoCenter.x;
    if (Math.abs(distance) < closestDistance) {
      activeRing = ring;
      closestDistance = Math.abs(distance);
    }
  }
  if (!activeRing) return null;

  const passProgress = activeRing.visualPassProgress;
  return {
    ring: activeRing,
    passProgress,
    boundaryX: halfWidth - CONFIG.dolphin.spriteWidth * passProgress
  };
}

function drawBackground() {
  if (backgroundSprite.complete && backgroundSprite.naturalWidth) {
    const sourceRatio = backgroundSprite.naturalWidth / backgroundSprite.naturalHeight;
    const targetRatio = width / height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = backgroundSprite.naturalWidth;
    let sourceHeight = backgroundSprite.naturalHeight;
    if (sourceRatio > targetRatio) {
      sourceWidth = sourceHeight * targetRatio;
      sourceX = (backgroundSprite.naturalWidth - sourceWidth) * 0.5;
    } else {
      sourceHeight = sourceWidth / targetRatio;
      sourceY = (backgroundSprite.naturalHeight - sourceHeight) * 0.5;
    }
    ctx.drawImage(
      backgroundSprite,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height
    );
    return;
  }

}

function drawRings() {
  for (const ring of state.rings) {
    drawRingHalf(ring, "back");
  }
}

function drawFrontRings() {
  for (const ring of state.rings) {
    drawRingHalf(ring, "front");
  }
}

function drawRingHalf(ring, half) {
  const x = toScreen(ring.x);
  const y = worldY(ring.y);
  const rx = toScreen(ring.outer * CONFIG.rings.visualWidthScale);
  const ry = toScreen(ring.outer * CONFIG.rings.visualHeightScale);
  const innerRx = toScreen(ring.inner * CONFIG.rings.visualWidthScale);
  const innerRy = toScreen(ring.inner * CONFIG.rings.visualHeightScale);
  const depth = toScreen(CONFIG.rings.visualDepth * (ring.touched ? 0.7 : 1));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ring.visualTilt || 0);

  if (ringSprites[half].complete && ringSprites[half].naturalWidth) {
    drawRingSpriteLayer(half);
    ctx.restore();
    return;
  }
  ctx.restore();
}

function drawRingSpriteLayer(half) {
  const sprite = ringSprites[half];
  const drawWidth = toScreen(CONFIG.rings.spriteWidth);
  const drawHeight = toScreen(CONFIG.rings.spriteHeight);
  if (half === "front") {
    ctx.beginPath();
    ctx.rect(-drawWidth * 0.55, -drawHeight * 0.55, drawWidth * 0.62, drawHeight * 1.1);
    ctx.clip();
  }
  ctx.drawImage(
    sprite,
    0,
    0,
    sprite.naturalWidth,
    sprite.naturalHeight,
    -drawWidth * 0.5,
    -drawHeight * 0.5,
    drawWidth,
    drawHeight
  );
}

function drawRingOpening(ring, innerRx, innerRy, depth) {
  const dolphin = state.dolphin;
  const distanceX = Math.abs(ring.x - dolphin.x);
  const approach = 1 - Math.min(1, distanceX / 190);
  const clearance = getRingClearance(ring).normalized;
  const centered = 1 - Math.min(1, clearance / Math.max(1, ring.inner));
  const guideAlpha = approach * centered;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, innerRx, innerRy, 0, 0, Math.PI * 2);
  ctx.clip();

  const tunnelGradient = ctx.createLinearGradient(-depth, 0, depth * 1.4, 0);
  tunnelGradient.addColorStop(0, "rgba(70, 4, 5, .32)");
  tunnelGradient.addColorStop(0.46, "rgba(18, 55, 72, .2)");
  tunnelGradient.addColorStop(1, "rgba(255, 98, 54, .16)");
  ctx.fillStyle = tunnelGradient;
  ctx.fillRect(-innerRx, -innerRy, innerRx * 2, innerRy * 2);

  const layers = 5;
  for (let i = layers; i >= 1; i--) {
    const t = i / layers;
    ctx.strokeStyle = `rgba(62, 8, 8, ${0.08 + t * 0.11})`;
    ctx.lineWidth = Math.max(1, toScreen(2.2));
    ctx.beginPath();
    ctx.ellipse(depth * t, 0, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (guideAlpha > 0.02) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, innerRy * 0.72);
    glow.addColorStop(0, `rgba(196, 255, 244, ${0.34 * guideAlpha})`);
    glow.addColorStop(0.5, `rgba(70, 239, 224, ${0.16 * guideAlpha})`);
    glow.addColorStop(1, "rgba(70, 239, 224, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, innerRx * 0.72, innerRy * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(54, 6, 7, .78)";
  ctx.lineWidth = Math.max(toScreen(3), depth * 0.3);
  ctx.beginPath();
  ctx.ellipse(depth * 0.48, 0, innerRx, innerRy, 0, Math.PI * 1.5, Math.PI * 2.5);
  ctx.stroke();
}

function drawTorusRingHalf(rx, ry, innerRx, innerRy, depth, touched, half) {
  const segments = 40;
  const start = half === "back" ? Math.PI * 1.5 : Math.PI * 0.5;
  const end = half === "back" ? Math.PI * 2.5 : Math.PI * 1.5;
  const tube = Math.max(toScreen(8), (rx - innerRx + ry - innerRy) * 0.25 + depth * 0.28);
  const red = touched ? [220, 28, 22] : [244, 20, 12];

  if (half === "back") {
    ctx.save();
    ctx.translate(toScreen(4), toScreen(6));
    ctx.scale(1.04, 1.02);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#180202";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx + tube * 0.2, ry + tube * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < segments; i++) {
    const a0 = start + (end - start) * (i / segments);
    const a1 = start + (end - start) * ((i + 1) / segments);
    const mid = (a0 + a1) * 0.5;
    const frontness = (Math.sin(mid) + 1) * 0.5;
    const light = 0.46 + frontness * 0.42 + Math.max(0, -Math.cos(mid)) * 0.16;
    const shade = half === "front" ? light + 0.1 : light - 0.18;
    const depthShift = Math.cos(mid) * depth * 0.28;
    const color = shadedRed(red, shade);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(depthShift, 0, rx, ry, 0, a0, a1);
    ctx.ellipse(-depthShift * 0.32, 0, innerRx, innerRy, 0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }

  ctx.lineWidth = toScreen(2.4);
  ctx.strokeStyle = "rgba(19, 5, 4, .85)";
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, start, end);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, innerRx, innerRy, 0, start, end);
  ctx.stroke();

  if (half === "front") {
    ctx.strokeStyle = "rgba(255, 73, 43, .5)";
    ctx.lineWidth = Math.max(toScreen(3), depth * 0.36);
    ctx.beginPath();
    ctx.ellipse(-depth * 0.18, 0, innerRx, innerRy, 0, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, tube * 0.38);
    ctx.strokeStyle = "rgba(255, 134, 94, .64)";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - tube * 0.46, ry - tube * 0.58, 0, Math.PI * 0.82, Math.PI * 1.22);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, tube * 0.18);
    ctx.strokeStyle = "rgba(255, 242, 214, .78)";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - tube * 0.68, ry - tube * 0.78, 0, Math.PI * 0.9, Math.PI * 1.14);
    ctx.stroke();
    ctx.restore();
  }
}

function shadedRed(base, light) {
  const clampLight = clamp(light, 0.18, 1.18);
  const r = Math.round(base[0] * clampLight);
  const g = Math.round(base[1] * clampLight);
  const b = Math.round(base[2] * clampLight);
  return `rgb(${clamp(r, 0, 255)}, ${clamp(g, 0, 255)}, ${clamp(b, 0, 255)})`;
}

function showComboBurst(ring, combo) {
  state.comboBursts.push({
    x: ring.x,
    y: ring.y,
    combo,
    age: 0,
    duration: 0.7
  });
}

function drawComboBursts() {
  for (const burst of state.comboBursts) {
    const t = Math.min(1, burst.age / burst.duration);
    const ease = 1 - Math.pow(1 - t, 3);
    const x = toScreen(burst.x);
    const y = worldY(burst.y);
    const alpha = 1 - t;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = toScreen(3);
    ctx.strokeStyle = "rgba(255, 245, 120, .9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, toScreen(34 + 46 * ease), toScreen(60 + 58 * ease), 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, .85)";
    ctx.lineWidth = toScreen(2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 0.25 + burst.age * 3;
      const r0 = toScreen(48 + 20 * ease);
      const r1 = toScreen(70 + 34 * ease);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff26d";
    ctx.font = `900 ${Math.round(toScreen(22 + burst.combo * 1.2))}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 44, 82, .5)";
    ctx.shadowBlur = toScreen(8);
    ctx.fillText(`연속 ${burst.combo}회`, 0, toScreen(-92 - 20 * ease));
    ctx.restore();
  }
}

function drawOvalDolphin(rotationScale = 1) {
  const d = state.dolphin;
  const x = toScreen(d.x);
  const y = worldY(d.y);

  ctx.save();
  ctx.translate(x, y + Math.sin(d.swim * 0.55) * toScreen(1.7));
  ctx.rotate(d.angle * rotationScale);
  ctx.scale(CONFIG.dolphin.visualScale, CONFIG.dolphin.visualScale);

  ctx.shadowColor = "rgba(0, 31, 65, .34)";
  ctx.shadowBlur = toScreen(12);
  ctx.shadowOffsetY = toScreen(4);

  const bodyGradient = ctx.createLinearGradient(toScreen(-72), toScreen(-18), toScreen(78), toScreen(20));
  bodyGradient.addColorStop(0, "#d9fbff");
  bodyGradient.addColorStop(0.34, "#62dcff");
  bodyGradient.addColorStop(1, "#1577ca");

  ctx.fillStyle = bodyGradient;
  ctx.strokeStyle = "rgba(5, 55, 105, .82)";
  ctx.lineWidth = toScreen(4);
  ctx.beginPath();
  ctx.ellipse(0, 0, toScreen(82), toScreen(24), -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = "rgba(255, 255, 255, .55)";
  ctx.lineWidth = toScreen(3);
  ctx.beginPath();
  ctx.ellipse(toScreen(8), toScreen(-8), toScreen(48), toScreen(6), -0.08, Math.PI * 1.05, Math.PI * 1.9);
  ctx.stroke();

  ctx.restore();
}

function drawCuteDolphin(clipLeft = null, clipRight = null, drawShadow = true) {
  if (!dolphinSprite.complete || !dolphinSprite.naturalWidth) {
    return;
  }

  const d = state.dolphin;
  const drawWidth = toScreen(CONFIG.dolphin.spriteWidth);
  const drawHeight = toScreen(CONFIG.dolphin.spriteHeight);

  ctx.save();
  ctx.translate(
    toScreen(d.x),
    worldY(d.y) + Math.sin(d.swim * 0.55) * toScreen(1.7)
  );
  ctx.rotate(d.angle * 0.45);
  if (clipLeft !== null && clipRight !== null) {
    const clipTop = -drawHeight * 0.8;
    ctx.beginPath();
    ctx.rect(
      toScreen(clipLeft),
      clipTop,
      toScreen(Math.max(0, clipRight - clipLeft)),
      drawHeight * 1.6
    );
    ctx.clip();
  }
  if (drawShadow) {
    ctx.shadowColor = "rgba(0, 31, 65, .34)";
    ctx.shadowBlur = toScreen(10);
    ctx.shadowOffsetY = toScreen(4);
  }
  ctx.drawImage(
    dolphinSprite,
    DOLPHIN_SPRITE_CROP.x,
    DOLPHIN_SPRITE_CROP.y,
    DOLPHIN_SPRITE_CROP.width,
    DOLPHIN_SPRITE_CROP.height,
    -drawWidth * 0.5,
    -drawHeight * 0.5,
    drawWidth,
    drawHeight
  );
  ctx.restore();
}

function drawDolphin() {
  drawOvalDolphin();
  return;
  const d = state.dolphin;
  const x = toScreen(d.x);
  const y = worldY(d.y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(d.angle);
  ctx.scale(CONFIG.dolphin.visualScale, CONFIG.dolphin.visualScale);
  const swim = Math.sin(d.swim);
  const tail = swim * toScreen(9);
  const fin = Math.sin(d.swim + 1.1) * toScreen(4);
  const bodyBob = Math.sin(d.swim * 0.5) * toScreen(1.8);
  ctx.translate(0, bodyBob);
  ctx.shadowColor = "rgba(1, 23, 52, .5)";
  ctx.shadowBlur = toScreen(18);
  ctx.shadowOffsetY = toScreen(3);

  const bodyGradient = ctx.createRadialGradient(toScreen(12), toScreen(-16), toScreen(8), toScreen(0), toScreen(0), toScreen(62));
  bodyGradient.addColorStop(0, "#f7fbff");
  bodyGradient.addColorStop(0.28, "#b9d1df");
  bodyGradient.addColorStop(0.68, "#6f96ad");
  bodyGradient.addColorStop(1, "#426c86");

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(13, 45, 68, .82)";
  ctx.lineWidth = toScreen(4);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#071f34";
  ctx.beginPath();
  ctx.ellipse(toScreen(2), toScreen(5), toScreen(61), toScreen(30), -0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#6d93aa";
  ctx.beginPath();
  ctx.moveTo(toScreen(-38), toScreen(3));
  ctx.bezierCurveTo(toScreen(-55), toScreen(-12), toScreen(-76), toScreen(-8) + tail, toScreen(-88), toScreen(0) + tail);
  ctx.bezierCurveTo(toScreen(-72), toScreen(3), toScreen(-55), toScreen(12) - tail, toScreen(-38), toScreen(10));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#486f88";
  ctx.beginPath();
  ctx.moveTo(toScreen(-82), toScreen(0) + tail);
  ctx.lineTo(toScreen(-104), toScreen(-17) + tail);
  ctx.quadraticCurveTo(toScreen(-96), toScreen(-4) + tail, toScreen(-81), toScreen(0) + tail);
  ctx.lineTo(toScreen(-104), toScreen(18) + tail);
  ctx.quadraticCurveTo(toScreen(-95), toScreen(6) + tail, toScreen(-82), toScreen(0) + tail);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(toScreen(-45), toScreen(2));
  ctx.bezierCurveTo(toScreen(-29), toScreen(-31), toScreen(21), toScreen(-43), toScreen(55), toScreen(-19));
  ctx.bezierCurveTo(toScreen(76), toScreen(-4), toScreen(65), toScreen(22), toScreen(38), toScreen(31));
  ctx.bezierCurveTo(toScreen(10), toScreen(41), toScreen(-26), toScreen(29), toScreen(-45), toScreen(11));
  ctx.bezierCurveTo(toScreen(-52), toScreen(6), toScreen(-52), toScreen(3), toScreen(-45), toScreen(2));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .9)";
  ctx.lineWidth = toScreen(3.8);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const bellyGradient = ctx.createLinearGradient(toScreen(-25), toScreen(2), toScreen(45), toScreen(32));
  bellyGradient.addColorStop(0, "rgba(255, 255, 250, .96)");
  bellyGradient.addColorStop(1, "rgba(215, 231, 238, .62)");
  ctx.fillStyle = bellyGradient;
  ctx.beginPath();
  ctx.moveTo(toScreen(-25), toScreen(9));
  ctx.bezierCurveTo(toScreen(-3), toScreen(20), toScreen(27), toScreen(26), toScreen(53), toScreen(5));
  ctx.bezierCurveTo(toScreen(45), toScreen(30), toScreen(6), toScreen(38), toScreen(-30), toScreen(19));
  ctx.bezierCurveTo(toScreen(-36), toScreen(15), toScreen(-34), toScreen(10), toScreen(-25), toScreen(9));
  ctx.closePath();
  ctx.fill();

  const shine = ctx.createLinearGradient(toScreen(-22), toScreen(-25), toScreen(40), toScreen(0));
  shine.addColorStop(0, "rgba(255,255,255,.58)");
  shine.addColorStop(0.7, "rgba(255,255,255,.12)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(toScreen(8), toScreen(-13), toScreen(34), toScreen(7), -0.13, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, .34)";
  ctx.lineWidth = toScreen(2.2);
  ctx.beginPath();
  ctx.moveTo(toScreen(-24), toScreen(-16));
  ctx.bezierCurveTo(toScreen(0), toScreen(-31), toScreen(31), toScreen(-29), toScreen(53), toScreen(-14));
  ctx.stroke();

  ctx.fillStyle = "#567d94";
  ctx.beginPath();
  ctx.moveTo(toScreen(-6), toScreen(-24));
  ctx.bezierCurveTo(toScreen(7), toScreen(-50), toScreen(28), toScreen(-42), toScreen(25), toScreen(-17));
  ctx.bezierCurveTo(toScreen(12), toScreen(-24), toScreen(2), toScreen(-24), toScreen(-6), toScreen(-24));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .72)";
  ctx.lineWidth = toScreen(2.5);
  ctx.stroke();

  ctx.fillStyle = "#3f657d";
  ctx.beginPath();
  ctx.moveTo(toScreen(-2), toScreen(14));
  ctx.bezierCurveTo(toScreen(10), toScreen(31) + fin, toScreen(21), toScreen(42) + fin, toScreen(37), toScreen(41) + fin);
  ctx.bezierCurveTo(toScreen(31), toScreen(25) + fin, toScreen(16), toScreen(14), toScreen(2), toScreen(9));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#d7edf4";
  ctx.beginPath();
  ctx.moveTo(toScreen(39), toScreen(-16));
  ctx.bezierCurveTo(toScreen(59), toScreen(-24), toScreen(84), toScreen(-15), toScreen(101), toScreen(-5));
  ctx.bezierCurveTo(toScreen(88), toScreen(3), toScreen(64), toScreen(8), toScreen(47), toScreen(0));
  ctx.bezierCurveTo(toScreen(43), toScreen(-5), toScreen(40), toScreen(-11), toScreen(39), toScreen(-16));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .68)";
  ctx.lineWidth = toScreen(2.4);
  ctx.stroke();

  ctx.fillStyle = "#102842";
  ctx.beginPath();
  ctx.arc(toScreen(42), toScreen(-13), toScreen(3.5), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.86)";
  ctx.beginPath();
  ctx.arc(toScreen(43), toScreen(-14), toScreen(1.1), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(4, 83, 123, .45)";
  ctx.lineWidth = toScreen(1.8);
  ctx.beginPath();
  ctx.arc(toScreen(58), toScreen(-2), toScreen(8), 0.45, 1.32);
  ctx.stroke();

  ctx.strokeStyle = "rgba(5, 80, 119, .18)";
  ctx.lineWidth = toScreen(1.2);
  ctx.beginPath();
  ctx.moveTo(toScreen(-38), toScreen(7));
  ctx.bezierCurveTo(toScreen(-12), toScreen(16), toScreen(24), toScreen(15), toScreen(51), toScreen(5));
  ctx.stroke();
  ctx.restore();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

window.addEventListener("resize", resize);
window.addEventListener("pointerdown", inputDown, { passive: false });
window.addEventListener("pointerup", inputUp);
window.addEventListener("pointercancel", inputUp);
ui.startButton.addEventListener("click", startGame);
ui.restartButton.addEventListener("click", startGame);

resize();
updateHud();
requestAnimationFrame(loop);
