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
}
