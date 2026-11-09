use mc_path_core::{
    astar_search, astar_search_f32, check_motion, generate_deconstruction_plan, is_human_player,
    is_squad_bot, slice_trajectory, BotMode, FVec3, IVec3, SimpleVoxelWorld, SpatialLeaseTable,
    VoxelMovementClass, WorldHeader,
};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn handle_daemon_stream(
    stream: UnixStream,
    world: Arc<RwLock<SimpleVoxelWorld>>,
    leases: Arc<SpatialLeaseTable>,
) {
    let reader_stream = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);
    let mut writer = stream;
    let mut line = String::new();

    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let cmd = parts[0].to_uppercase();
        let resp = match cmd.as_str() {
            "PING" => "{\"ok\":true,\"pong\":true}\n".to_string(),
            "INIT_WORLD" if parts.len() >= 5 => {
                let min_y = parts[1].parse::<i16>().unwrap_or(-64);
                let num_sections = parts[2].parse::<u16>().unwrap_or(24);
                let proto = parts[3].parse::<i32>().unwrap_or(769);
                let epoch = parts[4].parse::<u32>().unwrap_or(1);
                if let Ok(mut w) = world.write() {
                    w.header = WorldHeader {
                        min_y,
                        num_sections,
                        protocol_version: proto,
                        world_epoch: epoch,
                    };
                }
                format!(
                    "{{\"ok\":true,\"minY\":{},\"numSections\":{},\"protocolVersion\":{},\"worldEpoch\":{}}}\n",
                    min_y, num_sections, proto, epoch
                )
            }
            "SET_CLASS" if parts.len() >= 5 => {
                let x = parts[1].parse::<i32>().unwrap_or(0);
                let y = parts[2].parse::<i32>().unwrap_or(0);
                let z = parts[3].parse::<i32>().unwrap_or(0);
                let nibble = parts[4].parse::<u8>().unwrap_or(2);
                if let Ok(mut w) = world.write() {
                    w.set_class(IVec3::new(x, y, z), VoxelMovementClass::from_nibble(nibble));
                }
                "{\"ok\":true}\n".to_string()
            }
            "SLICE" if parts.len() >= 7 => {
                let x1 = parts[1].parse::<i32>().unwrap_or(0);
                let y1 = parts[2].parse::<i32>().unwrap_or(0);
                let z1 = parts[3].parse::<i32>().unwrap_or(0);
                let x2 = parts[4].parse::<i32>().unwrap_or(0);
                let y2 = parts[5].parse::<i32>().unwrap_or(0);
                let z2 = parts[6].parse::<i32>().unwrap_or(0);
                let max_hop = if parts.len() >= 8 {
                    parts[7].parse::<f64>().unwrap_or(16.0)
                } else {
                    16.0
                };
                let hops = slice_trajectory(IVec3::new(x1, y1, z1), IVec3::new(x2, y2, z2), max_hop);
                let total = hops.len();
                let items: Vec<String> = hops
                    .iter()
                    .enumerate()
                    .map(|(idx, h)| {
                        format!(
                            "{{\"x\":{},\"y\":{},\"z\":{},\"hopIndex\":{},\"totalHops\":{}}}",
                            h.x,
                            h.y,
                            h.z,
                            idx + 1,
                            total
                        )
                    })
                    .collect();
                format!("[{}]\n", items.join(","))
            }
            "ASTAR_F32" if parts.len() >= 7 => {
                let x1 = parts[1].parse::<f64>().unwrap_or(0.0);
                let y1 = parts[2].parse::<f64>().unwrap_or(0.0);
                let z1 = parts[3].parse::<f64>().unwrap_or(0.0);
                let x2 = parts[4].parse::<f64>().unwrap_or(0.0);
                let y2 = parts[5].parse::<f64>().unwrap_or(0.0);
                let z2 = parts[6].parse::<f64>().unwrap_or(0.0);
                let max_eval = if parts.len() >= 8 {
                    parts[7].parse::<usize>().unwrap_or(10_000)
                } else {
                    10_000
                };
                let res = if let Ok(w) = world.read() {
                    astar_search_f32(&*w, FVec3::new(x1, y1, z1), FVec3::new(x2, y2, z2), max_eval)
                } else {
                    None
                };
                match res {
                    Some(pts) => {
                        let items: Vec<String> = pts
                            .iter()
                            .map(|p| format!("{{\"x\":{:.1},\"y\":{:.1},\"z\":{:.1}}}", p.x, p.y, p.z))
                            .collect();
                        format!("{{\"ok\":true,\"path\":[{}]}}\n", items.join(","))
                    }
                    None => "{\"ok\":false,\"path\":null}\n".to_string(),
                }
            }
            "LEASE_ACQUIRE" if parts.len() >= 6 => {
                let x = parts[1].parse::<i32>().unwrap_or(0);
                let y = parts[2].parse::<i32>().unwrap_or(0);
                let z = parts[3].parse::<i32>().unwrap_or(0);
                let agent = parts[4].parse::<u16>().unwrap_or(1);
                let ttl = parts[5].parse::<u32>().unwrap_or(30);
                let now_sec = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as u32)
                    .unwrap_or(1000);
                let ok = leases.acquire(IVec3::new(x, y, z), agent, now_sec, ttl);
                format!("{{\"ok\":{}}}\n", ok)
            }
            "LEASE_RELEASE" if parts.len() >= 5 => {
                let x = parts[1].parse::<i32>().unwrap_or(0);
                let y = parts[2].parse::<i32>().unwrap_or(0);
                let z = parts[3].parse::<i32>().unwrap_or(0);
                let agent = parts[4].parse::<u16>().unwrap_or(1);
                let ok = leases.release(IVec3::new(x, y, z), agent);
                format!("{{\"ok\":{}}}\n", ok)
            }
            _ => "{\"ok\":false,\"error\":\"invalid_command\"}\n".to_string(),
        };
        if writer.write_all(resp.as_bytes()).is_err() {
            break;
        }
        let _ = writer.flush();
        line.clear();
    }
}

fn print_usage() {
    eprintln!("mc-path-fast: High-Performance Native 3D Voxel Pathfinding & Kinematics Engine");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  mc-path-fast slice <x1> <y1> <z1> <x2> <y2> <z2> [max_hop]");
    eprintln!("  mc-path-fast slice-json <x1> <y1> <z1> <x2> <y2> <z2> [max_hop]");
    eprintln!("  mc-path-fast watchdog <x1> <y1> <z1> <x2> <y2> <z2> <elapsed_s> <threshold_s> <mode> [is_digging]");
    eprintln!("  mc-path-fast deconstruct <ox> <oy> <oz> <radius> <height>");
    eprintln!("  mc-path-fast classify <name> [entity_type] [self_name]");
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
        "slice-json" => {
            if args.len() < 8 {
                println!("[]");
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
            let hops = slice_trajectory(start, target, max_hop);

            let json_elements: Vec<String> = hops.iter().enumerate().map(|(i, h)| {
                format!("{{\"x\":{},\"y\":{},\"z\":{},\"hopIndex\":{},\"totalHops\":{}}}", h.x, h.y, h.z, i + 1, hops.len())
            }).collect();
            println!("[{}]", json_elements.join(","));
        }
        "watchdog" => {
            if args.len() < 11 {
                eprintln!("Error: 'watchdog' requires <x1> <y1> <z1> <x2> <y2> <z2> <elapsed_s> <threshold_s> <mode> [is_digging]");
                std::process::exit(1);
            }
            let x1: f64 = args[2].parse().unwrap_or(0.0);
            let y1: f64 = args[3].parse().unwrap_or(64.0);
            let z1: f64 = args[4].parse().unwrap_or(0.0);
            let x2: f64 = args[5].parse().unwrap_or(0.0);
            let y2: f64 = args[6].parse().unwrap_or(64.0);
            let z2: f64 = args[7].parse().unwrap_or(0.0);
            let elapsed_s: u64 = args[8].parse().unwrap_or(0);
            let threshold_s: u64 = args[9].parse().unwrap_or(10);
            let mode = BotMode::from_str(&args[10]);
            let is_digging = args.get(11).map(|s| s == "true" || s == "1").unwrap_or(false);

            let p1 = FVec3::new(x1, y1, z1);
            let p2 = FVec3::new(x2, y2, z2);

            let res = check_motion(Some(p1), p2, elapsed_s, threshold_s, mode, is_digging);
            println!(
                "{{\"isStationary\":{},\"hasMoved\":{},\"stationaryDurationSec\":{},\"isExempt\":{},\"isDigging\":{},\"isAlerting\":{},\"alertReason\":{}}}",
                res.is_stationary,
                res.has_moved,
                res.stationary_duration_s,
                res.is_exempt,
                res.is_digging,
                res.is_alerting,
                res.alert_reason.map(|r| format!("\"{}\"", r)).unwrap_or_else(|| "null".to_string())
            );
        }
        "deconstruct" => {
            if args.len() < 7 {
                eprintln!("Error: 'deconstruct' requires <ox> <oy> <oz> <radius> <height>");
                std::process::exit(1);
            }
            let ox: i32 = args[2].parse().unwrap_or(0);
            let oy: i32 = args[3].parse().unwrap_or(64);
            let oz: i32 = args[4].parse().unwrap_or(0);
            let radius: i32 = args[5].parse().unwrap_or(2);
            let height: i32 = args[6].parse().unwrap_or(3);

            let origin = IVec3::new(ox, oy, oz);
            let plan = generate_deconstruction_plan(origin, radius, height);
            let json_elements: Vec<String> = plan
                .iter()
                .map(|p| format!("{{\"x\":{},\"y\":{},\"z\":{}}}", p.x, p.y, p.z))
                .collect();
            println!("[{}]", json_elements.join(","));
        }
        "classify" => {
            if args.len() < 3 {
                eprintln!("Error: 'classify' requires <name> [entity_type] [self_name]");
                std::process::exit(1);
            }
            let name = &args[2];
            let entity_type = args.get(3).map(|s| s.as_str()).unwrap_or("player");
            let self_name = args.get(4).map(|s| s.as_str());

            let is_bot = is_squad_bot(name, self_name);
            let is_human = is_human_player(name, entity_type, self_name);

            println!(
                "{{\"name\":\"{}\",\"isSquadBot\":{},\"isHumanPlayer\":{}}}",
                name, is_bot, is_human
            );
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
        "--daemon" | "daemon" => {
            let sock_path = if args.len() >= 3 {
                args[2].clone()
            } else {
                env::var("MC_PATH_SOCK").unwrap_or_else(|_| "/dev/shm/mc-path.sock".to_string())
            };
            let _ = fs::remove_file(&sock_path);
            let listener = UnixListener::bind(&sock_path).unwrap_or_else(|e| {
                eprintln!("Failed to bind Unix socket {}: {}", sock_path, e);
                std::process::exit(1);
            });
            let world = Arc::new(RwLock::new(SimpleVoxelWorld::new()));
            let leases = Arc::new(SpatialLeaseTable::new());
            println!("{{\"ready\":true,\"socket\":\"{}\"}}", sock_path);
            let _ = std::io::stdout().flush();
            for stream in listener.incoming().flatten() {
                let w = Arc::clone(&world);
                let l = Arc::clone(&leases);
                std::thread::spawn(move || handle_daemon_stream(stream, w, l));
            }
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
