import math
import unittest


CONFIG = {
    "physics": {
        "gravity": 1180,
        "maxRiseSpeed": -520,
        "maxFallSpeed": 520,
        "mass": 1.05,
        "inertia": 1150,
        "drag": 0.985,
        "angularDamping": 0.88,
        "maxAngularVelocity": 7.5,
    },
    "dolphin": {
        "bodyRadius": 23,
        "ringCollisionRadius": 10,
        "colliderHalfLength": 23,
    },
    "rings": {
        "innerRadius": 52,
        "outerRadius": 73,
        "depthTilt": 1,
        "visualWidthScale": 0.58,
        "visualHeightScale": 1.08,
        "collisionRestitution": 0.12,
        "collisionImpulse": 72,
        "positionCorrection": 0.22,
        "angularImpulseScale": 0.34,
        "passageDepth": 12,
        "colliderInset": 3,
        "sideColliderHeightScale": 0.72,
        "capColliderWidthScale": 0.72,
        "passTriggerHalfWidth": 20,
    },
}


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def create_body(x=0, y=0, vx=0, vy=0):
    mass = CONFIG["physics"]["mass"]
    inertia = CONFIG["physics"]["inertia"]
    return {
        "x": x,
        "y": y,
        "vx": vx,
        "vy": vy,
        "angle": 0,
        "angularVelocity": 0,
        "mass": mass,
        "invMass": 1 / mass,
        "inertia": inertia,
        "invInertia": 1 / inertia,
        "radius": CONFIG["dolphin"]["bodyRadius"],
        "linearDamping": CONFIG["physics"]["drag"],
        "angularDamping": CONFIG["physics"]["angularDamping"],
        "maxAngularVelocity": CONFIG["physics"]["maxAngularVelocity"],
        "forceX": 0,
        "forceY": 0,
        "torque": 0,
    }


def create_ring(x=0, y=0):
    return {
        "x": x,
        "y": y,
        "vx": -255,
        "vy": 0,
        "tilt": 0,
        "inner": CONFIG["rings"]["innerRadius"],
        "outer": CONFIG["rings"]["outerRadius"],
        "passed": False,
        "hitCooldown": 0,
    }


def apply_impulse(body, impulse_x, impulse_y, contact_x=0, contact_y=0):
    body["vx"] += impulse_x * body["invMass"]
    body["vy"] += impulse_y * body["invMass"]
    body["angularVelocity"] += (contact_x * impulse_y - contact_y * impulse_x) * body["invInertia"]
    if body["maxAngularVelocity"]:
        body["angularVelocity"] = clamp(
            body["angularVelocity"],
            -body["maxAngularVelocity"],
            body["maxAngularVelocity"],
        )


def get_ring_contact(body, ring, depth_tilt, visual_width_scale=1, visual_height_scale=1):
    cos = math.cos(-ring["tilt"])
    sin = math.sin(-ring["tilt"])
    dx = body["x"] - ring["x"]
    dy = body["y"] - ring["y"]
    local_x = dx * cos - dy * sin
    local_y = dx * sin + dy * cos
    scaled_x = local_x / visual_width_scale
    scaled_y = local_y / (visual_height_scale * depth_tilt)
    normalized = math.hypot(scaled_x, scaled_y)
    angle = math.atan2(scaled_y, scaled_x)
    local_normal_x = math.cos(angle) / visual_width_scale
    local_normal_y = math.sin(angle) / (visual_height_scale * depth_tilt)
    normal_length = math.hypot(local_normal_x, local_normal_y) or 1
    unit_local_normal_x = local_normal_x / normal_length
    unit_local_normal_y = local_normal_y / normal_length
    normal_x = unit_local_normal_x * math.cos(ring["tilt"]) - unit_local_normal_y * math.sin(ring["tilt"])
    normal_y = unit_local_normal_x * math.sin(ring["tilt"]) + unit_local_normal_y * math.cos(ring["tilt"])
    return {
        "normalized": normalized,
        "localX": local_x,
        "localY": local_y,
        "normalX": normal_x,
        "normalY": normal_y,
    }


def collide_body_with_ring(body, ring):
    if ring["passed"] or ring["hitCooldown"] > 0:
        return None

    options = {
        "depthTilt": CONFIG["rings"]["depthTilt"],
        "minImpulse": CONFIG["rings"]["collisionImpulse"],
        "restitution": CONFIG["rings"]["collisionRestitution"],
        "positionCorrection": CONFIG["rings"]["positionCorrection"],
        "angularImpulseScale": CONFIG["rings"]["angularImpulseScale"],
        "passageDepth": CONFIG["rings"]["passageDepth"],
        "collisionRadius": CONFIG["dolphin"]["ringCollisionRadius"],
        "visualWidthScale": CONFIG["rings"]["visualWidthScale"],
        "visualHeightScale": CONFIG["rings"]["visualHeightScale"],
    }
    c = get_ring_contact(body, ring, options["depthTilt"], options["visualWidthScale"], options["visualHeightScale"])
    normalized_body = options["collisionRadius"] / max(options["visualWidthScale"], options["visualHeightScale"])
    inside_tube_band = c["normalized"] > ring["inner"] - normalized_body and c["normalized"] < ring["outer"] + normalized_body
    crossing_ring_plane = abs(c["localX"]) < options["passageDepth"] + body["radius"] * 0.45
    if not inside_tube_band or not crossing_ring_plane:
        return None

    target = ring["inner"] - normalized_body if c["normalized"] < (ring["inner"] + ring["outer"]) * 0.5 else ring["outer"] + normalized_body
    correction = target - c["normalized"]
    body["x"] += c["normalX"] * correction * options["positionCorrection"]
    body["y"] += c["normalY"] * correction * options["positionCorrection"]

    rvx = body["vx"] - ring["vx"]
    rvy = body["vy"] - ring["vy"]
    direction = math.copysign(1, correction) if correction else 1
    push_x = c["normalX"] * direction
    push_y = c["normalY"] * direction
    approach_speed = max(0, -(rvx * push_x + rvy * push_y))
    impulse_size = max(options["minImpulse"] * 0.18, approach_speed * (1 + options["restitution"]))
    impulse_x = push_x * impulse_size
    impulse_y = push_y * impulse_size
    body["vx"] *= 0.88
    body["vy"] *= 0.88
    apply_impulse(
        body,
        impulse_x,
        impulse_y,
        c["localX"] * options["angularImpulseScale"],
        c["localY"] * options["angularImpulseScale"],
    )
    return {**c, "impulseX": impulse_x, "impulseY": impulse_y, "impulseSize": impulse_size, "correction": correction}


def to_ring_local(body, ring):
    cos = math.cos(-ring["tilt"])
    sin = math.sin(-ring["tilt"])
    dx = body["x"] - ring["x"]
    dy = body["y"] - ring["y"]
    return dx * cos - dy * sin, dx * sin + dy * cos


def circle_hits_rectangle(x, y, radius, rectangle):
    left, right, top, bottom = rectangle
    closest_x = clamp(x, left, right)
    closest_y = clamp(y, top, bottom)
    return (x - closest_x) ** 2 + (y - closest_y) ** 2 <= radius ** 2


def get_ring_collider(body, ring, open_center_channel=False):
    x, y = to_ring_local(body, ring)
    cfg = CONFIG["rings"]
    radius = CONFIG["dolphin"]["ringCollisionRadius"]
    outer_x = ring["outer"] * cfg["visualWidthScale"] - cfg["colliderInset"]
    outer_y = ring["outer"] * cfg["visualHeightScale"] - cfg["colliderInset"]
    inner_x = ring["inner"] * cfg["visualWidthScale"] + cfg["colliderInset"]
    inner_y = ring["inner"] * cfg["visualHeightScale"] + cfg["colliderInset"]
    cap_x = outer_x * cfg["capColliderWidthScale"]
    side_y = inner_y * cfg["sideColliderHeightScale"]
    colliders = {
        "top": (-cap_x, cap_x, -outer_y, -inner_y),
        "bottom": (-cap_x, cap_x, inner_y, outer_y),
        "left": (-outer_x, -inner_x, -side_y, side_y),
        "right": (inner_x, outer_x, -side_y, side_y),
    }
    for name, rectangle in colliders.items():
        if open_center_channel and name in ("left", "right") and abs(y) + radius <= inner_y:
            continue
        if circle_hits_rectangle(x, y, radius, rectangle):
            return name
    return None


def is_in_pass_trigger(body, ring, collision_radius=None, vertical_tolerance=0):
    x, y = to_ring_local(body, ring)
    cfg = CONFIG["rings"]
    radius = CONFIG["dolphin"]["ringCollisionRadius"] if collision_radius is None else collision_radius
    inner_x = ring["inner"] * cfg["visualWidthScale"]
    inner_y = ring["inner"] * cfg["visualHeightScale"]
    return (
        abs(x) <= min(cfg["passTriggerHalfWidth"], inner_x - radius)
        and abs(y) + radius <= inner_y + vertical_tolerance
    )


def swept_ring_collider(body, ring, previous_ring_x, ccd_step=4):
    current_ring_x = ring["x"]
    travel = abs(current_ring_x - previous_ring_x)
    steps = max(1, math.ceil(travel / ccd_step))
    for step in range(steps + 1):
        t = step / steps
        probe_ring = dict(ring)
        probe_ring["x"] = previous_ring_x + (current_ring_x - previous_ring_x) * t
        collider = get_ring_collider(body, probe_ring, open_center_channel=True)
        if collider:
            return collider
    return None


def soft_collision_velocity(vx, vy, normal_x, normal_y, normal_damping=0.16, slide=0.76, friction=0.92):
    tangent_x = -normal_y
    tangent_y = normal_x
    tangent_velocity = vx * tangent_x + vy * tangent_y
    retained_normal = max(0, vx * normal_x + vy * normal_y) * normal_damping
    retained_tangent = tangent_velocity * slide * friction
    return (
        tangent_x * retained_tangent + normal_x * retained_normal,
        tangent_y * retained_tangent + normal_y * retained_normal,
    )


def can_score_ring(passed_trigger, exited_ring, hard_collision=False, failed=False, scored=False):
    return passed_trigger and exited_ring and not hard_collision and not failed and not scored


def can_score_with_corridor(
    passed_trigger=True,
    exited_ring=True,
    hard_collision=False,
    excessive_overlap=False,
    corridor_time=0.08,
    average_deviation=0.5,
    max_deviation=0.8,
    progress=1,
):
    return (
        passed_trigger
        and exited_ring
        and not hard_collision
        and not excessive_overlap
        and corridor_time >= 0.045
        and average_deviation <= 0.92
        and max_deviation <= 1.08
        and progress >= 0.9
    )


def ring_failure_reason(
    grace_remaining,
    no_progress_duration,
    max_penetration,
    contact_duration,
    stuck_duration,
    immediate_threshold=14,
):
    if max_penetration >= immediate_threshold:
        return "RING_EXCESSIVE_PENETRATION"
    if grace_remaining > 0 or no_progress_duration < 0.2:
        return None
    if max_penetration >= 8:
        return "RING_EXCESSIVE_PENETRATION"
    if stuck_duration >= 0.18 or contact_duration >= 0.34:
        return "RING_STUCK"
    return None


def can_score_progressive_exit(passed_trigger, exited_ring, corridor_time, progress, pending_penetration=0):
    return (
        passed_trigger
        and exited_ring
        and corridor_time >= 0.045
        and progress >= 0.9
    )


def visual_pass_progress(ring_minus_torso_x, sprite_width=142):
    half_width = sprite_width * 0.5
    return clamp((half_width - ring_minus_torso_x) / (half_width * 2), 0, 1)


class PhysicsTest(unittest.TestCase):
    def test_clean_center_pass_has_no_collision(self):
        body = create_body(x=0, y=0, vx=0, vy=0)
        ring = create_ring()
        self.assertIsNone(collide_body_with_ring(body, ring))

    def test_ring_only_collides_at_crossing_plane(self):
        body = create_body(x=-70, y=-56, vx=0, vy=0)
        ring = create_ring()
        self.assertIsNone(collide_body_with_ring(body, ring))

    def test_upper_inner_edge_pushes_dolphin_downward(self):
        body = create_body(x=0, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertGreater(body["vy"], 0)
        self.assertGreater(body["y"], -56)

    def test_lower_inner_edge_pushes_dolphin_upward(self):
        body = create_body(x=0, y=56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertLess(body["vy"], 0)
        self.assertLess(body["y"], 56)

    def test_off_center_collision_creates_rotation(self):
        body = create_body(x=20, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertNotAlmostEqual(body["angularVelocity"], 0, places=4)
        self.assertLessEqual(abs(body["angularVelocity"]), CONFIG["physics"]["maxAngularVelocity"])

    def test_centered_ring_hit_does_not_create_rotation(self):
        body = create_body(x=0, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertAlmostEqual(body["angularVelocity"], 0, places=4)

    def test_outer_edge_pushes_away_from_ring(self):
        body = create_body(x=0, y=-82, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertLess(body["vy"], 0)
        self.assertLess(body["y"], -82)

    def test_four_ring_colliders_leave_center_open(self):
        ring = create_ring()
        self.assertIsNone(get_ring_collider(create_body(x=0, y=0), ring))
        self.assertEqual(get_ring_collider(create_body(x=0, y=-62), ring), "top")
        self.assertEqual(get_ring_collider(create_body(x=0, y=62), ring), "bottom")
        self.assertEqual(get_ring_collider(create_body(x=-36, y=0), ring), "left")
        self.assertEqual(get_ring_collider(create_body(x=36, y=0), ring), "right")

    def test_pass_trigger_only_activates_in_opening(self):
        ring = create_ring()
        self.assertTrue(is_in_pass_trigger(create_body(x=0, y=0), ring))
        self.assertFalse(is_in_pass_trigger(create_body(x=21, y=0), ring))
        self.assertFalse(is_in_pass_trigger(create_body(x=0, y=52), ring))

    def test_top_rim_graze_can_reach_relaxed_pass_plane(self):
        ring = create_ring()
        body = create_body(x=0, y=50)
        self.assertFalse(is_in_pass_trigger(body, ring))
        self.assertTrue(is_in_pass_trigger(body, ring, collision_radius=3))

    def test_visible_top_rim_pass_uses_contact_only_vertical_tolerance(self):
        ring = create_ring()
        body = create_body(x=0, y=60)
        self.assertFalse(is_in_pass_trigger(body, ring, collision_radius=3))
        self.assertTrue(is_in_pass_trigger(body, ring, collision_radius=3, vertical_tolerance=10))

    def test_center_channel_does_not_hit_side_colliders(self):
        ring = create_ring()
        body = create_body(x=36, y=0)
        self.assertEqual(get_ring_collider(body, ring), "right")
        self.assertIsNone(get_ring_collider(body, ring, open_center_channel=True))

    def test_swept_collision_catches_fast_ring_at_top_rim(self):
        ring = create_ring(x=-50)
        body = create_body(x=0, y=-62)
        self.assertIsNone(get_ring_collider(body, ring, open_center_channel=True))
        self.assertEqual(swept_ring_collider(body, ring, previous_ring_x=50), "top")

    def test_swept_collision_keeps_center_open(self):
        ring = create_ring(x=-50)
        body = create_body(x=0, y=0)
        self.assertIsNone(swept_ring_collider(body, ring, previous_ring_x=50))

    def test_ring_collision_and_pass_trigger_do_not_overlap(self):
        ring = create_ring()
        edge_body = create_body(x=0, y=-62)
        center_body = create_body(x=0, y=0)
        self.assertEqual(get_ring_collider(edge_body, ring, open_center_channel=True), "top")
        self.assertFalse(is_in_pass_trigger(edge_body, ring))
        self.assertIsNone(get_ring_collider(center_body, ring, open_center_channel=True))
        self.assertTrue(is_in_pass_trigger(center_body, ring))

    def test_soft_collision_preserves_surface_slide(self):
        vx, vy = soft_collision_velocity(80, 140, 0, -1)
        self.assertGreater(vx, 50)
        self.assertAlmostEqual(vy, 0, places=4)

    def test_soft_collision_damps_normal_motion(self):
        vx, vy = soft_collision_velocity(30, -120, 0, -1)
        self.assertLess(abs(vy), 25)
        self.assertLess(math.hypot(vx, vy), math.hypot(30, -120))

    def test_graze_can_score_after_exiting_ring(self):
        self.assertTrue(can_score_ring(True, True, hard_collision=False))

    def test_trigger_alone_does_not_score(self):
        self.assertFalse(can_score_ring(True, False))

    def test_hard_collision_blocks_score_after_exit(self):
        self.assertFalse(can_score_ring(True, True, hard_collision=True))

    def test_clean_and_graze_paths_fit_corridor(self):
        self.assertTrue(can_score_with_corridor(average_deviation=0.2, max_deviation=0.35))
        self.assertTrue(can_score_with_corridor(average_deviation=0.82, max_deviation=1.03))

    def test_excessive_torso_deviation_fails_corridor(self):
        self.assertFalse(can_score_with_corridor(average_deviation=0.85, max_deviation=1.14))

    def test_excessive_overlap_blocks_graze_score(self):
        self.assertFalse(can_score_with_corridor(excessive_overlap=True))

    def test_contact_during_grace_does_not_fail(self):
        self.assertIsNone(ring_failure_reason(0.08, 0.25, 9, 0.4, 0.2))

    def test_progress_resets_no_progress_failure_window(self):
        self.assertIsNone(ring_failure_reason(0, 0, 9, 0.4, 0.2))

    def test_deep_impact_can_fail_immediately(self):
        self.assertEqual(
            ring_failure_reason(0.15, 0, 14.2, 0, 0),
            "RING_EXCESSIVE_PENETRATION",
        )

    def test_stuck_contact_fails_after_grace_and_no_progress(self):
        self.assertEqual(
            ring_failure_reason(0, 0.22, 3, 0.36, 0.2),
            "RING_STUCK",
        )

    def test_successful_exit_overrides_recoverable_graze_history(self):
        self.assertTrue(can_score_progressive_exit(True, True, 0.08, 1, pending_penetration=8.5))

    def test_completed_exit_wins_over_single_frame_penetration_spike(self):
        self.assertTrue(can_score_progressive_exit(True, True, 0.08, 1, pending_penetration=14))

    def test_visual_layer_keeps_tail_behind_until_it_clears_ring(self):
        self.assertAlmostEqual(visual_pass_progress(0), 0.5)
        self.assertLess(visual_pass_progress(-54), 1)
        self.assertEqual(visual_pass_progress(-71), 1)


if __name__ == "__main__":
    unittest.main()
