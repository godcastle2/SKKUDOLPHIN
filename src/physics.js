export function createBody(options) {
  return {
    x: options.x,
    y: options.y,
    vx: options.vx || 0,
    vy: options.vy || 0,
    angle: options.angle || 0,
    angularVelocity: options.angularVelocity || 0,
    mass: options.mass || 1,
    invMass: 1 / (options.mass || 1),
    inertia: options.inertia || 1,
    invInertia: 1 / (options.inertia || 1),
    radius: options.radius || 24,
    linearDamping: options.linearDamping ?? 0.985,
    angularDamping: options.angularDamping ?? 0.9,
    maxAngularVelocity: options.maxAngularVelocity || 0,
    forceX: 0,
    forceY: 0,
    torque: 0
  };
}

export function createPhysicsWorld(options) {
  return {
    gravityY: options.gravityY,
    bounds: options.bounds,
    maxRiseSpeed: options.maxRiseSpeed,
    maxFallSpeed: options.maxFallSpeed
  };
}

export function addForce(body, x, y) {
  body.forceX += x;
  body.forceY += y;
}

export function addTorque(body, torque) {
  body.torque += torque;
}

export function applyImpulse(body, impulseX, impulseY, contactX = 0, contactY = 0) {
  body.vx += impulseX * body.invMass;
  body.vy += impulseY * body.invMass;
  body.angularVelocity += (contactX * impulseY - contactY * impulseX) * body.invInertia;
  if (body.maxAngularVelocity) {
    body.angularVelocity = clamp(body.angularVelocity, -body.maxAngularVelocity, body.maxAngularVelocity);
  }
}

export function stepBody(world, body, dt) {
  body.vx += body.forceX * body.invMass * dt;
  body.vy += (world.gravityY + body.forceY * body.invMass) * dt;
  body.vx *= body.linearDamping;
  body.vy *= body.linearDamping;
  body.vy = clamp(body.vy, world.maxRiseSpeed, world.maxFallSpeed);
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  body.angularVelocity += body.torque * body.invInertia * dt;
  body.angularVelocity *= body.angularDamping;
  body.angle += body.angularVelocity * dt;

  body.forceX = 0;
  body.forceY = 0;
  body.torque = 0;
}

export function constrainToBounds(body, bounds, restitution = 0.24) {
  let hit = false;
  if (body.y < bounds.top) {
    body.y = bounds.top;
    body.vy = Math.abs(body.vy) * restitution;
    hit = true;
  }
  if (body.y > bounds.bottom) {
    body.y = bounds.bottom;
    body.vy = -Math.abs(body.vy) * restitution;
    hit = true;
  }
  if (body.x < bounds.left) {
    body.x = bounds.left;
    body.vx = Math.abs(body.vx) * restitution;
    hit = true;
  }
  if (body.x > bounds.right) {
    body.x = bounds.right;
    body.vx = -Math.abs(body.vx) * restitution;
    hit = true;
  }
  return hit;
}

export function collideBodyWithTiltedRing(body, ring, options) {
  if (ring.passed || ring.hitCooldown > 0) return null;

  const c = getRingContact(body, ring, options.depthTilt, options.visualWidthScale, options.visualHeightScale);
  const collisionRadius = options.collisionRadius ?? body.radius;
  const normalizedBody = collisionRadius / Math.max(options.visualWidthScale, options.visualHeightScale);
  const insideTubeBand = c.normalized > ring.inner - normalizedBody && c.normalized < ring.outer + normalizedBody;
  const crossingRingPlane = Math.abs(c.localX) < options.passageDepth + body.radius * 0.45;
  if (!insideTubeBand || !crossingRingPlane) return null;

  const target = c.normalized < (ring.inner + ring.outer) * 0.5
    ? ring.inner - normalizedBody
    : ring.outer + normalizedBody;
  const correction = target - c.normalized;
  body.x += c.normalX * correction * options.positionCorrection;
  body.y += c.normalY * correction * options.positionCorrection;

  const rvx = body.vx - ring.vx;
  const rvy = body.vy - ring.vy;
  const direction = Math.sign(correction) || 1;
  const pushX = c.normalX * direction;
  const pushY = c.normalY * direction;
  const approachSpeed = Math.max(0, -(rvx * pushX + rvy * pushY));
  const impulseSize = Math.max(options.minImpulse * 0.18, approachSpeed * (1 + options.restitution));
  const impulseX = pushX * impulseSize;
  const impulseY = pushY * impulseSize;
  body.vx *= 0.88;
  body.vy *= 0.88;
  applyImpulse(
    body,
    impulseX,
    impulseY,
    c.localX * options.angularImpulseScale,
    c.localY * options.angularImpulseScale
  );

  return {
    ...c,
    impulseX,
    impulseY,
    impulseSize,
    correction
  };
}

export function collideBodyWithRingColliders(body, ring, options) {
  if (ring.passed || ring.hitCooldown > 0) return null;

  const contact = getRingColliderContact(body, ring, options);
  if (!contact) return null;

  return resolveRingColliderContact(body, ring, contact, options);
}

export function collideBodyWithSweptRingColliders(body, ring, options) {
  if (ring.passed || ring.hitCooldown > 0) return null;

  const currentRingX = ring.x;
  const previousRingX = options.previousRingX ?? currentRingX;
  const currentBodyX = body.x;
  const currentBodyY = body.y;
  const previousBodyX = options.previousBodyX ?? currentBodyX;
  const previousBodyY = options.previousBodyY ?? currentBodyY;
  const relativeTravel = Math.hypot(
    (currentBodyX - previousBodyX) - (currentRingX - previousRingX),
    currentBodyY - previousBodyY
  );
  const steps = Math.max(1, Math.ceil(relativeTravel / Math.max(1, options.ccdStep ?? 4)));
  let contact = null;

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const probeBody = {
      ...body,
      x: previousBodyX + (currentBodyX - previousBodyX) * t,
      y: previousBodyY + (currentBodyY - previousBodyY) * t
    };
    const probeRing = {
      ...ring,
      x: previousRingX + (currentRingX - previousRingX) * t
    };
    contact = getRingColliderContact(probeBody, probeRing, options);
    if (contact) break;
  }
  if (!contact) return null;
  return resolveRingColliderContact(body, ring, contact, options);
}

function resolveRingColliderContact(body, ring, contact, options) {

  body.x += contact.normalX * contact.penetration * options.positionCorrection;
  body.y += contact.normalY * contact.penetration * options.positionCorrection;

  const tangentX = -contact.normalY;
  const tangentY = contact.normalX;
  const relativeVx = body.vx - ring.vx;
  const relativeVy = body.vy - ring.vy;
  const normalVelocity = relativeVx * contact.normalX + relativeVy * contact.normalY;
  const tangentVelocity = body.vx * tangentX + body.vy * tangentY;
  const normalImpactSpeed = Math.max(0, -normalVelocity);
  const retainedNormal = Math.max(0, body.vx * contact.normalX + body.vy * contact.normalY)
    * (options.normalDamping ?? 0.16);
  const retainedTangent = tangentVelocity
    * (options.surfaceSlideFactor ?? 0.76)
    * (options.contactFriction ?? 0.92);
  body.vx = tangentX * retainedTangent + contact.normalX * retainedNormal;
  body.vy = tangentY * retainedTangent + contact.normalY * retainedNormal;

  const impulseSize = options.pushOutForce ?? 18;
  const impulseX = contact.normalX * impulseSize;
  const impulseY = contact.normalY * impulseSize;
  applyImpulse(
    body,
    impulseX,
    impulseY,
    contact.bodyOffsetX * options.angularImpulseScale,
    contact.bodyOffsetY * options.angularImpulseScale
  );
  if (options.angularResponse) {
    const turnDirection = Math.sign(tangentVelocity) || Math.sign(contact.normalY) || 1;
    body.angularVelocity = clamp(
      body.angularVelocity + turnDirection * options.angularResponse,
      -body.maxAngularVelocity,
      body.maxAngularVelocity
    );
  }

  return {
    ...contact,
    impulseX,
    impulseY,
    impulseSize,
    normalImpactSpeed,
    tangentVelocity
  };
}

export function getRingColliderContact(body, ring, options) {
  const radius = options.collisionRadius ?? body.radius;
  const halfLength = options.colliderHalfLength ?? 0;
  const inset = options.colliderInset ?? 0;
  const outerX = ring.outer * options.visualWidthScale - inset;
  const outerY = ring.outer * options.visualHeightScale - inset;
  const innerX = ring.inner * options.visualWidthScale + inset;
  const innerY = ring.inner * options.visualHeightScale + inset;
  const capHalfWidth = outerX * options.capColliderWidthScale;
  const sideHalfHeight = innerY * options.sideColliderHeightScale;
  const colliders = [
    { name: "top", left: -capHalfWidth, right: capHalfWidth, top: -outerY, bottom: -innerY },
    { name: "bottom", left: -capHalfWidth, right: capHalfWidth, top: innerY, bottom: outerY },
    { name: "left", left: -outerX, right: -innerX, top: -sideHalfHeight, bottom: sideHalfHeight },
    { name: "right", left: innerX, right: outerX, top: -sideHalfHeight, bottom: sideHalfHeight }
  ];

  const bodyCos = Math.cos(body.angle || 0);
  const bodySin = Math.sin(body.angle || 0);
  const offsetX = options.colliderOffsetX ?? 0;
  const offsetY = options.colliderOffsetY ?? 0;
  const colliderCenterX = body.x + bodyCos * offsetX - bodySin * offsetY;
  const colliderCenterY = body.y + bodySin * offsetX + bodyCos * offsetY;
  const probes = halfLength > 0 ? [-halfLength, 0, halfLength] : [0];

  for (const [probeIndex, bodyOffset] of probes.entries()) {
    const probe = {
      x: colliderCenterX + bodyCos * bodyOffset,
      y: colliderCenterY + bodySin * bodyOffset
    };
    const local = toRingLocal(probe, ring);
    for (const collider of colliders) {
      const isSide = collider.name === "left" || collider.name === "right";
      const insideOpening = Math.abs(local.y) + radius <= innerY;
      if (options.openCenterChannel && isSide && insideOpening) continue;
      const contact = circleRectangleContact(local.x, local.y, radius, collider);
      if (!contact) continue;
      const radialX = local.x / Math.max(1, outerX * outerX);
      const radialY = local.y / Math.max(1, outerY * outerY);
      const radialLength = Math.hypot(radialX, radialY) || 1;
      let curvedNormalX = radialX / radialLength;
      let curvedNormalY = radialY / radialLength;
      if (curvedNormalX * contact.normalX + curvedNormalY * contact.normalY < 0) {
        curvedNormalX *= -1;
        curvedNormalY *= -1;
      }
      const cos = Math.cos(ring.tilt);
      const sin = Math.sin(ring.tilt);
      return {
        collider: collider.name,
        contactId: `${collider.name}:${probeIndex}`,
        localX: local.x,
        localY: local.y,
        bodyOffsetX: bodyCos * (offsetX + bodyOffset) - bodySin * offsetY,
        bodyOffsetY: bodySin * (offsetX + bodyOffset) + bodyCos * offsetY,
        normalX: curvedNormalX * cos - curvedNormalY * sin,
        normalY: curvedNormalX * sin + curvedNormalY * cos,
        penetration: contact.penetration
      };
    }
  }
  return null;
}

export function isBodyInsideRingPassTrigger(body, ring, options) {
  const bodyCos = Math.cos(body.angle || 0);
  const bodySin = Math.sin(body.angle || 0);
  const offsetX = options.colliderOffsetX ?? 0;
  const offsetY = options.colliderOffsetY ?? 0;
  const colliderCenter = {
    x: body.x + bodyCos * offsetX - bodySin * offsetY,
    y: body.y + bodySin * offsetX + bodyCos * offsetY
  };
  const local = toRingLocal(colliderCenter, ring);
  const radius = options.collisionRadius ?? body.radius;
  const innerX = ring.inner * options.visualWidthScale;
  const innerY = ring.inner * options.visualHeightScale;
  const verticalTolerance = options.verticalTolerance ?? 0;
  return Math.abs(local.x) <= Math.min(options.passTriggerHalfWidth, innerX - radius)
    && Math.abs(local.y) + radius <= innerY + verticalTolerance;
}

function toRingLocal(body, ring) {
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = body.x - ring.x;
  const dy = body.y - ring.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

function circleRectangleContact(x, y, radius, rectangle) {
  const closestX = clamp(x, rectangle.left, rectangle.right);
  const closestY = clamp(y, rectangle.top, rectangle.bottom);
  const dx = x - closestX;
  const dy = y - closestY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > radius * radius) return null;

  const distance = Math.sqrt(distanceSquared);
  if (distance > 0.0001) {
    return {
      normalX: dx / distance,
      normalY: dy / distance,
      penetration: radius - distance
    };
  }

  const edges = [
    { distance: x - rectangle.left, normalX: -1, normalY: 0 },
    { distance: rectangle.right - x, normalX: 1, normalY: 0 },
    { distance: y - rectangle.top, normalX: 0, normalY: -1 },
    { distance: rectangle.bottom - y, normalX: 0, normalY: 1 }
  ];
  let nearest = edges[0];
  for (const edge of edges) {
    if (edge.distance < nearest.distance) nearest = edge;
  }
  return {
    normalX: nearest.normalX,
    normalY: nearest.normalY,
    penetration: radius + nearest.distance
  };
}

export function getRingContact(body, ring, depthTilt, visualWidthScale = 1, visualHeightScale = 1) {
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = body.x - ring.x;
  const dy = body.y - ring.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const scaledX = localX / visualWidthScale;
  const scaledY = localY / (visualHeightScale * depthTilt);
  const normalized = Math.hypot(scaledX, scaledY);
  const angle = Math.atan2(scaledY, scaledX);
  const localNormalX = Math.cos(angle) / visualWidthScale;
  const localNormalY = Math.sin(angle) / (visualHeightScale * depthTilt);
  const normalLength = Math.hypot(localNormalX, localNormalY) || 1;
  const unitLocalNormalX = localNormalX / normalLength;
  const unitLocalNormalY = localNormalY / normalLength;
  const normalX = unitLocalNormalX * Math.cos(ring.tilt) - unitLocalNormalY * Math.sin(ring.tilt);
  const normalY = unitLocalNormalX * Math.sin(ring.tilt) + unitLocalNormalY * Math.cos(ring.tilt);
  return { normalized, localX, localY, normalX, normalY };
}

export function getRingVerticalClearance(body, ring, depthTilt) {
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = body.x - ring.x;
  const dy = body.y - ring.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const normalized = Math.abs(localY) / depthTilt;
  const localNormalY = localY < 0 ? -1 : 1;
  const normalX = -localNormalY * Math.sin(ring.tilt);
  const normalY = localNormalY * Math.cos(ring.tilt);
  return { normalized, localX, localY, normalX, normalY };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
