use mc_path_core::{astar_search, slice_trajectory, IVec3, SimpleVoxelWorld};
use std::env;
use std::time::Instant;

fn print_usage() {
    eprintln!("mc-path-fast: High-Performance Native 3D Voxel Pathfinding & Kinematics Engine");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  mc-path-fast slice <x1> <y1> <z1> <x2> <y2> <z2> [max_hop]");
    eprintln!("  mc-path-fast bench [iterations]");
    eprintln!("  mc-path-fast --version");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    match args[1].as_str() {
        "slice" => {
            if args.len() < 8 {
                eprintln!("Error: 'slice' requires <x1> <y1> <z1> <x2> <y2> <z2> [max_hop]");
                std::process::exit(1);
            }
            let x1: i32 = args[2].parse().unwrap_or(0);
            let y1: i32 = args[3].parse().unwrap_or(64);
            let z1: i32 = args[4].parse().unwrap_or(0);
            let x2: i32 = args[5].parse().unwrap_or(0);
            let y2: i32 = args[6].parse().unwrap_or(64);
            let z2: i32 = args[7].parse().unwrap_or(0);
            let max_hop: f64 = args.get(8).and_then(|s| s.parse().ok()).unwrap_or(16.0);

            let start = IVec3::new(x1, y1, z1);
            let target = IVec3::new(x2, y2, z2);

            let t0 = Instant::now();
            let hops = slice_trajectory(start, target, max_hop);
            let duration_us = t0.elapsed().as_micros();

            println!("Sliced {} hops (total dist: {:.1}m, took {}µs):", hops.len(), start.distance_to(&target), duration_us);
            for (idx, hop) in hops.iter().enumerate() {
                println!("  Hop {}/{}: ({}, {}, {})", idx + 1, hops.len(), hop.x, hop.y, hop.z);
            }
        }
        "bench" => {
            let iters: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(100);
            println!("[*] Initializing synthetic 50x50 voxel terrain with hills, valleys, and obstacles...");

            let mut world = SimpleVoxelWorld::new();
            // Generate synthetic wavy terrain
            for x in 0..50 {
                for z in 0..50 {
                    // Sinusoidal elevation between y=60 and y=65
                    let y = 62 + ((x as f64 * 0.2).sin() * 2.0) as i32;
                    for solid_y in 50..=y {
                        world.set_solid(IVec3::new(x, solid_y, z), true);
                    }
                    // Place obstacle walls
                    if x == 25 && (z > 5 && z < 45) {
                        world.set_solid(IVec3::new(x, y + 1, z), true);
                    }
                }
            }

            let start = IVec3::new(2, 63, 2);
            let goal = IVec3::new(45, 63, 45);

            println!("[*] Running {} iterations of 3D A* from {:?} to {:?}...", iters, start, goal);
            let t0 = Instant::now();
            let mut total_path_len = 0;
            let mut successful_runs = 0;

            for _ in 0..iters {
                if let Some(path) = astar_search(&world, start, goal, 50_000) {
                    total_path_len += path.len();
                    successful_runs += 1;
                }
            }

            let total_time = t0.elapsed();
            let avg_time_us = total_time.as_micros() as f64 / iters as f64;
            let searches_per_sec = (iters as f64 / total_time.as_secs_f64()) as u64;

            println!("[+] Benchmark Complete:");
            println!("  • Success Rate: {}/{} runs", successful_runs, iters);
            println!("  • Average Search Duration: {:.2} µs ({:.3} ms)", avg_time_us, avg_time_us / 1000.0);
            println!("  • Trajectory Searches / Sec: {} searches/sec", searches_per_sec);
            println!("  • Average Waypoints Generated: {} nodes", total_path_len / iters.max(1));
        }
        "--version" | "-v" => {
            println!("mc-path-fast 0.1.0 (native Rust 3D voxel kinematics engine)");
        }
        other => {
            eprintln!("Unknown command: '{}'", other);
            print_usage();
            std::process::exit(1);
        }
    }
}
