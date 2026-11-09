// ponytail: Zero-dependency native 3D voxel A* pathfinder and kinematics engine
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

pub const MAX_SAFE_HOP_DISTANCE: f64 = 16.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct IVec3 {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl IVec3 {
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    #[inline(always)]
    pub fn distance_to(&self, other: &Self) -> f64 {
        let dx = (self.x - other.x) as f64;
        let dy = (self.y - other.y) as f64;
        let dz = (self.z - other.z) as f64;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    #[inline(always)]
    pub fn distance_xz(&self, other: &Self) -> f64 {
        let dx = (self.x - other.x) as f64;
        let dz = (self.z - other.z) as f64;
        (dx * dx + dz * dz).sqrt()
    }
}

pub trait VoxelWorld {
    fn is_solid(&self, pos: &IVec3) -> bool;
    fn is_passable(&self, pos: &IVec3) -> bool;
    fn is_leaf(&self, pos: &IVec3) -> bool;
}

/// Simple in-memory world representation for tests and micro-benchmarks
pub struct SimpleVoxelWorld {
    pub solid_blocks: std::collections::HashSet<IVec3>,
    pub leaf_blocks: std::collections::HashSet<IVec3>,
}

impl SimpleVoxelWorld {
    pub fn new() -> Self {
        Self {
            solid_blocks: std::collections::HashSet::new(),
            leaf_blocks: std::collections::HashSet::new(),
        }
    }

    pub fn set_solid(&mut self, pos: IVec3, solid: bool) {
        if solid {
            self.solid_blocks.insert(pos);
        } else {
            self.solid_blocks.remove(&pos);
        }
    }

    pub fn set_leaf(&mut self, pos: IVec3, leaf: bool) {
        if leaf {
            self.leaf_blocks.insert(pos);
            self.solid_blocks.insert(pos);
        } else {
            self.leaf_blocks.remove(&pos);
        }
    }
}

impl VoxelWorld for SimpleVoxelWorld {
    #[inline(always)]
    fn is_solid(&self, pos: &IVec3) -> bool {
        self.solid_blocks.contains(pos)
    }

    #[inline(always)]
    fn is_passable(&self, pos: &IVec3) -> bool {
        !self.solid_blocks.contains(pos)
    }

    #[inline(always)]
    fn is_leaf(&self, pos: &IVec3) -> bool {
        self.leaf_blocks.contains(pos)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NodeEntry {
    pos: IVec3,
    f_cost: u32,
    g_cost: u32,
}

// Invert ordering so BinaryHeap acts as a min-heap (lowest f_cost popped first)
impl Ord for NodeEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other.f_cost.cmp(&self.f_cost)
            .then_with(|| other.g_cost.cmp(&self.g_cost))
    }
}

impl PartialOrd for NodeEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Slices a 3D vector between start and target into intermediate hops <= max_hop
pub fn slice_trajectory(start: IVec3, target: IVec3, max_hop: f64) -> Vec<IVec3> {
    let safe_hop = max_hop.clamp(1.0, 50.0);
    let total_dist = start.distance_to(&target);

    if total_dist <= safe_hop {
        return vec![target];
    }

    let num_hops = (total_dist / safe_hop).ceil() as usize;
    let dx = (target.x - start.x) as f64;
    let dy = (target.y - start.y) as f64;
    let dz = (target.z - start.z) as f64;

    let mut hops = Vec::with_capacity(num_hops);
    for i in 1..=num_hops {
        if i == num_hops {
            hops.push(target);
        } else {
            let frac = i as f64 / num_hops as f64;
            hops.push(IVec3::new(
                (start.x as f64 + frac * dx).floor() as i32,
                (start.y as f64 + frac * dy).floor() as i32,
                (start.z as f64 + frac * dz).floor() as i32,
            ));
        }
    }
    hops
}

/// Euclidean heuristic scaled to integer milliblocks (1.0 block = 1000 cost)
#[inline(always)]
fn heuristic(a: &IVec3, b: &IVec3) -> u32 {
    let dist = a.distance_to(b);
    (dist * 1000.0) as u32
}

/// 3D Voxel A* Pathfinding with jump dynamics and tree canopy penalty
pub fn astar_search<W: VoxelWorld>(
    world: &W,
    start: IVec3,
    goal: IVec3,
    max_evaluations: usize,
) -> Option<Vec<IVec3>> {
    if start == goal {
        return Some(vec![start]);
    }

    let mut open_set = BinaryHeap::new();
    let mut came_from: HashMap<IVec3, IVec3> = HashMap::new();
    let mut g_score: HashMap<IVec3, u32> = HashMap::new();

    g_score.insert(start, 0);
    open_set.push(NodeEntry {
        pos: start,
        g_cost: 0,
        f_cost: heuristic(&start, &goal),
    });

    let mut evaluations = 0;

    // Movement offsets: (dx, dz, cost_multiplier)
    const CARDINALS: [(i32, i32, u32); 4] = [
        (1, 0, 1000),
        (-1, 0, 1000),
        (0, 1, 1000),
        (0, -1, 1000),
    ];

    const DIAGONALS: [(i32, i32, u32); 4] = [
        (1, 1, 1414),
        (-1, 1, 1414),
        (1, -1, 1414),
        (-1, -1, 1414),
    ];

    while let Some(current) = open_set.pop() {
        evaluations += 1;
        if evaluations > max_evaluations {
            return None; // Exceeded search budget (prevents CPU freeze)
        }

        if current.pos == goal {
            // Reconstruct path
            let mut path = vec![goal];
            let mut curr = goal;
            while let Some(&prev) = came_from.get(&curr) {
                path.push(prev);
                curr = prev;
            }
            path.reverse();
            return Some(path);
        }

        let current_g = match g_score.get(&current.pos) {
            Some(&g) => g,
            None => continue,
        };

        if current.g_cost > current_g {
            continue; // Stale node
        }

        // Try cardinal transitions
        for &(dx, dz, move_cost) in CARDINALS.iter() {
            let tx = current.pos.x + dx;
            let tz = current.pos.z + dz;

            // 1. Same level walk (y)
            try_expand_step(world, current.pos, IVec3::new(tx, current.pos.y, tz), move_cost, &mut open_set, &mut g_score, &mut came_from, &goal);

            // 2. Step up 1 block (jump height = 1.25m, clears 1.0m step)
            // Requires headroom above current position (y + 2)
            if world.is_passable(&IVec3::new(current.pos.x, current.pos.y + 2, current.pos.z)) {
                try_expand_step(world, current.pos, IVec3::new(tx, current.pos.y + 1, tz), move_cost + 350, &mut open_set, &mut g_score, &mut came_from, &goal);
            }

            // 3. Step down 1 to 3 blocks (safe drop without fall damage)
            for drop in 1..=3 {
                let down_pos = IVec3::new(tx, current.pos.y - drop, tz);
                try_expand_step(world, current.pos, down_pos, move_cost + drop as u32 * 150, &mut open_set, &mut g_score, &mut came_from, &goal);
            }
        }

        // Try diagonal transitions
        for &(dx, dz, move_cost) in DIAGONALS.iter() {
            let tx = current.pos.x + dx;
            let tz = current.pos.z + dz;

            // Diagonal corner clearance: both adjacent cardinals must be passable
            let card1 = IVec3::new(current.pos.x + dx, current.pos.y, current.pos.z);
            let card2 = IVec3::new(current.pos.x, current.pos.y, current.pos.z + dz);
            if world.is_passable(&card1) && world.is_passable(&card2) {
                try_expand_step(world, current.pos, IVec3::new(tx, current.pos.y, tz), move_cost, &mut open_set, &mut g_score, &mut came_from, &goal);
            }
        }
    }

    None
}

#[inline(always)]
fn try_expand_step<W: VoxelWorld>(
    world: &W,
    from: IVec3,
    to: IVec3,
    base_cost: u32,
    open_set: &mut BinaryHeap<NodeEntry>,
    g_score: &mut HashMap<IVec3, u32>,
    came_from: &mut HashMap<IVec3, IVec3>,
    goal: &IVec3,
) {
    // Kinematic constraints:
    // 1. Ground below feet must be solid
    let ground = IVec3::new(to.x, to.y - 1, to.z);
    if !world.is_solid(&ground) {
        return;
    }

    // 2. Feet and head voxels must be passable (0.6x1.8m bounding box clearance)
    let feet = to;
    let head = IVec3::new(to.x, to.y + 1, to.z);
    if !world.is_passable(&feet) || !world.is_passable(&head) {
        return;
    }

    // 3. Tree Canopy Penalty: heavily disincentivize routing across leaves
    let mut total_cost = base_cost;
    if world.is_leaf(&ground) {
        total_cost += 5000;
    }

    let tentative_g = g_score.get(&from).unwrap_or(&0) + total_cost;
    if tentative_g < *g_score.get(&to).unwrap_or(&u32::MAX) {
        came_from.insert(to, from);
        g_score.insert(to, tentative_g);
        let f = tentative_g + heuristic(&to, goal);
        open_set.push(NodeEntry {
            pos: to,
            g_cost: tentative_g,
            f_cost: f,
        });
    }
}

// --- C-Compatible FFI Interface for In-Process Binding ---

#[repr(C)]
pub struct FFIVec3 {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FVec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl FVec3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    #[inline(always)]
    pub fn distance_to(&self, other: &Self) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        let dz = self.z - other.z;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    #[inline(always)]
    pub fn distance_xz(&self, other: &Self) -> f64 {
        let dx = self.x - other.x;
        let dz = self.z - other.z;
        (dx * dx + dz * dz).sqrt()
    }

    #[inline(always)]
    pub fn floored(&self) -> IVec3 {
        IVec3::new(self.x.floor() as i32, self.y.floor() as i32, self.z.floor() as i32)
    }
}

// ---------------------------------------------------------------------------
// 1. Spatial Entity & Player vs Squad Bot Registry
// ---------------------------------------------------------------------------

pub const SQUAD_BOT_NAMES: [&str; 5] = ["jotaro", "bob", "torin", "arthur", "willow"];

#[derive(Clone, Debug, PartialEq)]
pub struct EntitySnapshot {
    pub id: u32,
    pub name: String,
    pub username: Option<String>,
    pub entity_type: String,
    pub pos: FVec3,
}

impl EntitySnapshot {
    pub fn new(id: u32, name: &str, username: Option<&str>, entity_type: &str, pos: FVec3) -> Self {
        Self {
            id,
            name: name.to_string(),
            username: username.map(|s| s.to_string()),
            entity_type: entity_type.to_string(),
            pos,
        }
    }
}

pub fn is_squad_bot(name: &str, self_name: Option<&str>) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.is_empty() {
        return false;
    }
    if let Some(self_n) = self_name {
        if lower == self_n.trim().to_lowercase() {
            return true;
        }
    }
    SQUAD_BOT_NAMES.iter().any(|&b| b == lower)
}

pub fn is_human_player(name: &str, entity_type: &str, self_name: Option<&str>) -> bool {
    let is_player_like = entity_type == "player" || entity_type.is_empty();
    if !is_player_like {
        return false;
    }
    !is_squad_bot(name, self_name)
}

pub fn get_nearest_human<'a>(
    self_pos: FVec3,
    self_name: &str,
    entities: &'a [EntitySnapshot],
    max_dist: f64,
) -> Option<&'a EntitySnapshot> {
    let self_lower = self_name.trim().to_lowercase();
    let mut nearest = None;
    let mut min_dist = max_dist;

    for entity in entities {
        if let Some(ref u) = entity.username {
            if u.trim().to_lowercase() == self_lower {
                continue;
            }
        }
        if entity.name.trim().to_lowercase() == self_lower {
            continue;
        }

        let effective_name = entity.username.as_deref().unwrap_or(&entity.name);
        if !is_human_player(effective_name, &entity.entity_type, Some(self_name)) {
            continue;
        }

        let dist = self_pos.distance_to(&entity.pos);
        if dist < min_dist {
            min_dist = dist;
            nearest = Some(entity);
        }
    }

    nearest
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EntitySurveyResult {
    pub humans: Vec<String>,
    pub squad: Vec<String>,
    pub mobs: Vec<String>,
}

pub fn format_entity_survey(
    self_pos: FVec3,
    self_name: &str,
    entities: &[EntitySnapshot],
    max_dist: f64,
) -> EntitySurveyResult {
    let self_lower = self_name.trim().to_lowercase();
    let mut result = EntitySurveyResult::default();

    for entity in entities {
        if let Some(ref u) = entity.username {
            if u.trim().to_lowercase() == self_lower {
                continue;
            }
        }
        if entity.name.trim().to_lowercase() == self_lower {
            continue;
        }

        let dist = self_pos.distance_to(&entity.pos);
        if dist > max_dist {
            continue;
        }

        let dist_int = dist.round() as i32;
        let effective_name = entity.username.as_deref().unwrap_or(&entity.name);

        if is_human_player(effective_name, &entity.entity_type, Some(self_name)) {
            result.humans.push(format!("{}({}m)", effective_name, dist_int));
        } else if is_squad_bot(effective_name, Some(self_name)) {
            result.squad.push(format!("{}({}m)", effective_name, dist_int));
        } else {
            result.mobs.push(format!("{}({}m)", effective_name, dist_int));
        }
    }

    result
}

// ---------------------------------------------------------------------------
// 2. Motion Watchdog & Stillness Coordinate Checker
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BotMode {
    Standby,
    AfkFarm,
    TaskActive,
    Idle,
}

impl BotMode {
    pub fn is_exempt(&self) -> bool {
        matches!(self, BotMode::Standby | BotMode::AfkFarm)
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "standby" => BotMode::Standby,
            "afk_farm" | "afk" => BotMode::AfkFarm,
            "task_active" | "task" => BotMode::TaskActive,
            _ => BotMode::Idle,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MotionCheckResult {
    pub is_stationary: bool,
    pub has_moved: bool,
    pub stationary_duration_s: u64,
    pub is_exempt: bool,
    pub is_digging: bool,
    pub is_alerting: bool,
    pub alert_reason: Option<String>,
}

pub fn check_motion(
    prev_pos: Option<FVec3>,
    curr_pos: FVec3,
    stationary_elapsed_s: u64,
    idle_threshold_s: u64,
    mode: BotMode,
    is_digging: bool,
) -> MotionCheckResult {
    let (has_moved, is_stationary) = match prev_pos {
        Some(p) => {
            let dist_xz = curr_pos.distance_xz(&p);
            let moved = dist_xz >= 0.15;
            (moved, !moved)
        }
        None => (false, true),
    };

    let is_exempt = mode.is_exempt();
    let effective_still_s = if has_moved { 0 } else { stationary_elapsed_s };
    let is_alerting = !is_exempt && !is_digging && effective_still_s >= idle_threshold_s;

    let alert_reason = if is_alerting {
        Some(format!(
            "Stationary for {}s (threshold: {}s) in mode {:?} without standby/afk exemption",
            effective_still_s, idle_threshold_s, mode
        ))
    } else {
        None
    };

    MotionCheckResult {
        is_stationary,
        has_moved,
        stationary_duration_s: effective_still_s,
        is_exempt,
        is_digging,
        is_alerting,
        alert_reason,
    }
}

// ---------------------------------------------------------------------------
// 3. Volumetric Deconstruction Coordinate Planner
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeconstructTarget {
    pub pos: IVec3,
    pub dist_sq: i32,
}

pub fn generate_deconstruction_plan(origin: IVec3, radius: i32, height: i32) -> Vec<IVec3> {
    let r = radius.max(1);
    let h = height.max(1);
    let total_blocks = (2 * r + 1) * (2 * r + 1) * h;
    let mut targets = Vec::with_capacity(total_blocks as usize);

    for dy in (0..h).rev() {
        let y = origin.y + dy;
        for dx in -r..=r {
            for dz in -r..=r {
                let x = origin.x + dx;
                let z = origin.z + dz;
                let dist_sq = dx * dx + dz * dz;
                targets.push(DeconstructTarget {
                    pos: IVec3::new(x, y, z),
                    dist_sq,
                });
            }
        }
    }

    // Sort strictly Y descending first (top-down), then closest to center column
    targets.sort_by(|a, b| {
        b.pos.y.cmp(&a.pos.y)
            .then_with(|| a.dist_sq.cmp(&b.dist_sq))
    });

    targets.into_iter().map(|t| t.pos).collect()
}

// ---------------------------------------------------------------------------
// 4. Combat Golden Spacing Coordinate Planner
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CombatSpacingAction {
    Hold,
    Advance(FVec3),
    Backpedal(FVec3),
    Flee(FVec3),
}

pub fn compute_combat_spacing(
    bot_pos: FVec3,
    target_pos: FVec3,
    is_creeper: bool,
    golden_min: f64,
    golden_max: f64,
) -> CombatSpacingAction {
    let dist = bot_pos.distance_xz(&target_pos);
    if dist < 0.001 {
        return CombatSpacingAction::Backpedal(FVec3::new(bot_pos.x, bot_pos.y, bot_pos.z + 1.0));
    }

    let ux = (bot_pos.x - target_pos.x) / dist;
    let uz = (bot_pos.z - target_pos.z) / dist;

    if is_creeper {
        if dist < 6.5 {
            return CombatSpacingAction::Flee(FVec3::new(
                target_pos.x + ux * 8.0,
                bot_pos.y,
                target_pos.z + uz * 8.0,
            ));
        } else {
            return CombatSpacingAction::Hold;
        }
    }

    if dist < golden_min {
        let target_dist = (golden_min + golden_max) * 0.5;
        CombatSpacingAction::Backpedal(FVec3::new(
            target_pos.x + ux * target_dist,
            bot_pos.y,
            target_pos.z + uz * target_dist,
        ))
    } else if dist > golden_max {
        let target_dist = (golden_min + golden_max) * 0.5;
        CombatSpacingAction::Advance(FVec3::new(
            target_pos.x + ux * target_dist,
            bot_pos.y,
            target_pos.z + uz * target_dist,
        ))
    } else {
        CombatSpacingAction::Hold
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn mc_path_slice_trajectory(
    start: FFIVec3,
    target: FFIVec3,
    max_hop: f64,
    out_buf: *mut FFIVec3,
    max_out_len: usize,
) -> usize {
    let s = IVec3::new(start.x, start.y, start.z);
    let t = IVec3::new(target.x, target.y, target.z);
    let hops = slice_trajectory(s, t, max_hop);

    let count = hops.len().min(max_out_len);
    if !out_buf.is_null() {
        for (i, h) in hops.iter().take(count).enumerate() {
            unsafe {
                *out_buf.add(i) = FFIVec3 { x: h.x, y: h.y, z: h.z };
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trajectory_hop_slicing() {
        let start = IVec3::new(0, 64, 0);
        let target = IVec3::new(64, 64, 0);
        let hops = slice_trajectory(start, target, 16.0);

        assert_eq!(hops.len(), 4, "64m / 16m ceiling must produce exactly 4 hops");
        assert_eq!(*hops.last().unwrap(), target, "Final hop must reach target");

        for i in 0..hops.len() {
            let prev = if i == 0 { start } else { hops[i - 1] };
            let dist = prev.distance_to(&hops[i]);
            assert!(dist <= 16.01, "Hop distance {} exceeds 16m ceiling", dist);
        }
    }

    #[test]
    fn test_step_elevation_and_obstacles() {
        let mut world = SimpleVoxelWorld::new();

        // Build a flat 10x10 stone platform at y=63
        for x in 0..10 {
            for z in 0..10 {
                world.set_solid(IVec3::new(x, 63, z), true);
            }
        }

        // Build a 1-block step at x=5, y=64 (valid jump)
        world.set_solid(IVec3::new(5, 64, 5), true);
        world.set_solid(IVec3::new(6, 64, 5), true);

        let start = IVec3::new(2, 64, 5);
        let goal = IVec3::new(6, 65, 5);

        let path = astar_search(&world, start, goal, 10_000);
        assert!(path.is_some(), "Pathfinder must clear 1-block vertical step");
        assert_eq!(*path.unwrap().last().unwrap(), goal);

        // Build an impassable 2-block high wall at x=4
        for z in 0..10 {
            world.set_solid(IVec3::new(4, 64, z), true);
            world.set_solid(IVec3::new(4, 65, z), true);
        }

        let blocked_path = astar_search(&world, start, goal, 1_000);
        assert!(blocked_path.is_none(), "2-block wall must be impassable");
    }

    #[test]
    fn test_tree_canopy_avoidance() {
        let mut world = SimpleVoxelWorld::new();

        // Ground at y=63
        for x in 0..10 {
            for z in 0..10 {
                world.set_solid(IVec3::new(x, 63, z), true);
            }
        }

        // Leaves at y=64 along z=5 (ground route available at z=4 or z=6)
        for x in 2..8 {
            world.set_leaf(IVec3::new(x, 64, 5), true);
        }

        let start = IVec3::new(1, 64, 5);
        let goal = IVec3::new(9, 64, 5);

        let path = astar_search(&world, start, goal, 10_000).expect("Should find path");
        // Verify path does NOT walk across the leaf canopy at y=65 for x in 2..8
        for pt in path.iter() {
            if pt.x >= 2 && pt.x <= 7 {
                assert_ne!(
                    (pt.y, pt.z),
                    (65, 5),
                    "Pathfinder should avoid walking across tree leaves when ground route exists"
                );
            }
        }
    }

    #[test]
    fn test_player_bot_classification() {
        assert!(is_squad_bot("Jotaro", None));
        assert!(is_squad_bot("bob", None));
        assert!(is_squad_bot("TORIN", None));
        assert!(is_squad_bot("Arthur", None));
        assert!(is_squad_bot("Willow", None));
        assert!(!is_squad_bot("vgbn", None));
        assert!(!is_squad_bot("Steve", None));

        // Self-identification
        assert!(is_squad_bot("OperatorBot", Some("OperatorBot")));

        assert!(is_human_player("vgbn", "player", None));
        assert!(is_human_player("Steve", "player", None));
        assert!(!is_human_player("Bob", "player", None));
        assert!(!is_human_player("zombie", "mob", None));
    }

    #[test]
    fn test_nearest_human_selection() {
        let self_pos = FVec3::new(0.0, 64.0, 0.0);
        let entities = vec![
            EntitySnapshot::new(1, "Jotaro", Some("Jotaro"), "player", FVec3::new(0.0, 64.0, 0.0)),
            EntitySnapshot::new(2, "Bob", Some("Bob"), "player", FVec3::new(2.0, 64.0, 0.0)),
            EntitySnapshot::new(3, "Torin", Some("Torin"), "player", FVec3::new(4.0, 64.0, 0.0)),
            EntitySnapshot::new(4, "vgbn", Some("vgbn"), "player", FVec3::new(12.0, 64.0, 0.0)),
            EntitySnapshot::new(5, "zombie", None, "mob", FVec3::new(6.0, 64.0, 0.0)),
        ];

        let nearest = get_nearest_human(self_pos, "Jotaro", &entities, 50.0);
        assert!(nearest.is_some(), "Must locate nearest human player");
        assert_eq!(nearest.unwrap().username.as_deref(), Some("vgbn"));
    }

    #[test]
    fn test_entity_survey_partitioning() {
        let self_pos = FVec3::new(0.0, 64.0, 0.0);
        let entities = vec![
            EntitySnapshot::new(1, "Jotaro", Some("Jotaro"), "player", FVec3::new(0.0, 64.0, 0.0)),
            EntitySnapshot::new(2, "bOb", Some("bOb"), "player", FVec3::new(3.0, 64.0, 0.0)),
            EntitySnapshot::new(3, "vgbn", Some("vgbn"), "player", FVec3::new(10.0, 64.0, 0.0)),
            EntitySnapshot::new(4, "creeper", None, "mob", FVec3::new(7.0, 64.0, 0.0)),
            EntitySnapshot::new(5, "far_player", Some("far_player"), "player", FVec3::new(50.0, 64.0, 0.0)),
        ];

        let survey = format_entity_survey(self_pos, "Jotaro", &entities, 20.0);
        assert_eq!(survey.humans.len(), 1, "Exactly 1 human within 20m");
        assert_eq!(survey.humans[0], "vgbn(10m)");
        assert_eq!(survey.squad.len(), 1, "Self excluded, only bOb in squad");
        assert_eq!(survey.squad[0], "bOb(3m)");
        assert_eq!(survey.mobs.len(), 1);
        assert_eq!(survey.mobs[0], "creeper(7m)");
        assert!(!survey.humans.iter().any(|h| h.contains("far_player")));
    }

    #[test]
    fn test_motion_watchdog_checker() {
        let p1 = FVec3::new(10.0, 64.0, 20.0);

        // 1. Commanded Standby is exempt
        let res_standby = check_motion(Some(p1), p1, 30, 10, BotMode::Standby, false);
        assert!(!res_standby.is_alerting, "Standby must be exempt from alerts");
        assert!(res_standby.is_exempt);
        assert!(res_standby.is_stationary);

        // 2. Commanded AFK farm is exempt
        let res_afk = check_motion(Some(p1), p1, 60, 10, BotMode::AfkFarm, false);
        assert!(!res_afk.is_alerting, "AFK farm must be exempt");
        assert!(res_afk.is_exempt);

        // 3. Active task under threshold does NOT alert
        let res_under = check_motion(Some(p1), p1, 5, 10, BotMode::TaskActive, false);
        assert!(!res_under.is_alerting);

        // 4. Active task over threshold triggers alert
        let res_over = check_motion(Some(p1), p1, 15, 10, BotMode::TaskActive, false);
        assert!(res_over.is_alerting, "Stationary for 15s >= 10s must alert");
        assert_eq!(res_over.stationary_duration_s, 15);

        // 5. Legitimate digging is exempt
        let res_dig = check_motion(Some(p1), p1, 20, 10, BotMode::TaskActive, true);
        assert!(!res_dig.is_alerting, "Digging blocks is exempt");

        // 6. Movement resets stationary duration and clears alert
        let p2 = FVec3::new(15.0, 64.0, 20.0);
        let res_move = check_motion(Some(p1), p2, 15, 10, BotMode::TaskActive, false);
        assert!(!res_move.is_alerting);
        assert!(res_move.has_moved);
        assert_eq!(res_move.stationary_duration_s, 0);
    }

    #[test]
    fn test_volumetric_deconstruction_plan() {
        let origin = IVec3::new(100, 64, 200);
        let plan = generate_deconstruction_plan(origin, 2, 3);

        // (2*2+1)^2 * 3 = 25 * 3 = 75 blocks
        assert_eq!(plan.len(), 75);

        // First block must be highest Y (64 + 3 - 1 = 66) and center (100, 66, 200)
        assert_eq!(plan[0], IVec3::new(100, 66, 200));

        // Verify strictly non-increasing Y order
        for i in 1..plan.len() {
            assert!(plan[i].y <= plan[i - 1].y, "Plan must sort top-down (Y descending)");
        }
    }

    #[test]
    fn test_combat_golden_spacing() {
        let bot = FVec3::new(0.0, 64.0, 0.0);

        // In golden range [2.6, 2.95] -> Hold
        let zombie_ok = FVec3::new(0.0, 64.0, 2.8);
        assert_eq!(compute_combat_spacing(bot, zombie_ok, false, 2.6, 2.95), CombatSpacingAction::Hold);

        // Too close (< 2.6) -> Backpedal
        let zombie_close = FVec3::new(0.0, 64.0, 1.5);
        match compute_combat_spacing(bot, zombie_close, false, 2.6, 2.95) {
            CombatSpacingAction::Backpedal(dest) => {
                assert!(dest.z < 0.0, "Must step backwards away from enemy");
            }
            other => panic!("Expected Backpedal, got {:?}", other),
        }

        // Creeper close (< 6.5) -> Flee
        let creeper_near = FVec3::new(0.0, 64.0, 4.0);
        match compute_combat_spacing(bot, creeper_near, true, 2.6, 2.95) {
            CombatSpacingAction::Flee(dest) => {
                assert!(dest.z < 0.0, "Must flee away from creeper");
            }
            other => panic!("Expected Flee, got {:?}", other),
        }
    }
}
