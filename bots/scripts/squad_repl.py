#!/usr/bin/env python3
# squad_repl.py: Standalone interactive REPL console for JoJo Stand Squad orchestration.
# ponytail: Python stdlib with readline; zero curses/prompt_toolkit dependencies.

import glob
import json
import os
import readline
import sys
import time

C_RESET = '\033[0m'
C_BOLD = '\033[1m'
C_CYAN = '\033[1;36m'
C_GREEN = '\033[1;32m'
C_YELLOW = '\033[1;33m'
C_MAGENTA = '\033[1;35m'
C_RED = '\033[1;31m'
C_GRAY = '\033[90m'

LOGS_DIR = os.environ.get('MC_LOGS_DIR', '/dev/shm/mc-bot')
ROSTER = ['Jotaro', 'Joseph', 'Polnareff', 'Avdol', 'Kakyoin', 'Iggy']

def get_squad_status():
    agents = []
    home_pids = os.path.expanduser('~/.local/share/mc-bot/pids')
    for name in ROSTER:
        pid = 0
        is_on = False
        for p in [f'{home_pids}/{name}.pid', f'{LOGS_DIR}/{name}.pid', f'/dev/shm/mc-bot-{name}.pid']:
            if os.path.isfile(p):
                try:
                    with open(p, 'r') as f:
                        content = f.read().strip()
                    if content.isdigit():
                        pid = int(content)
                        os.kill(pid, 0)
                        is_on = True
                        break
                except (OSError, ValueError):
                    continue
        agents.append((name, is_on, pid))
    return agents

def render_banner():
    agents = get_squad_status()
    print(f'{C_BOLD}{C_MAGENTA}================================================================================{C_RESET}')
    print(f'{C_BOLD}             ✦ JOJO STAND SQUAD INTERACTIVE CONTROL CONSOLE ✦{C_RESET}')
    print(f'{C_BOLD}{C_MAGENTA}================================================================================{C_RESET}')
    badges = []
    for name, is_on, pid in agents:
        color = C_GREEN if is_on else C_RED
        status_txt = f'ONLINE:{pid}' if is_on else 'OFFLINE'
        badges.append(f'{C_BOLD}[{name}: {color}{status_txt}{C_RESET}{C_BOLD}]{C_RESET}')
    print(' ' + ' '.join(badges))
    print(f'{C_CYAN}Commands:{C_RESET} <bot> <cmd> | all <cmd> | !<cmd> | status | logs | clear | exit')
    print(f'{C_BOLD}{C_MAGENTA}--------------------------------------------------------------------------------{C_RESET}')

def dispatch_to_file(path, text):
    try:
        with open(path, 'a') as f:
            f.write(text + '\n')
        return True
    except OSError as err:
        sys.stderr.write(f"Warning: Failed to write to {path}: {err}\n")
        return False

def main():
    render_banner()

    while True:
        agents = get_squad_status()
        on_cnt = len([a for a in agents if a[1]])
        prompt = f'{C_MAGENTA}✦ jojo-squad{C_RESET} [{C_GREEN}{on_cnt}/{len(agents)} Online{C_RESET}] ❯ '
        try:
            line = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print('\nExiting console.')
            break
        if not line:
            continue
        if line in ('exit', 'quit'):
            break
        if line == 'clear':
            os.system('clear')
            render_banner()
            continue
        if line == 'status':
            render_banner()
            continue
        if line == 'logs':
            logs = glob.glob(f'{LOGS_DIR}/*.log')
            for l in logs:
                bname = os.path.basename(l).replace('.log', '')
                try:
                    with open(l, 'r') as f:
                        for row in f.readlines()[-4:]:
                            print(f'  {C_BOLD}{C_GREEN}[{bname}]{C_RESET} {row.strip()}')
                except OSError:
                    continue
            continue

        parts = line.split(maxsplit=1)
        target, cmd = parts[0], (parts[1] if len(parts) > 1 else '')

        if target.lower() == 'all':
            for bname in ROSTER:
                for p in (f'{LOGS_DIR}/{bname}.cmd', f'/dev/shm/mc-bot-{bname}.cmd'):
                    dispatch_to_file(p, cmd)
            print(f'{C_YELLOW}[BROADCAST]{C_RESET} Dispatched "{cmd}" to all active agents.')
        elif any(b.lower() == target.lower() for b in ROSTER):
            bname = next(b for b in ROSTER if b.lower() == target.lower())
            for p in (f'{LOGS_DIR}/{bname}.cmd', f'/dev/shm/mc-bot-{bname}.cmd'):
                dispatch_to_file(p, cmd)
            print(f'{C_GREEN}[DIRECT -> {bname}]{C_RESET} Dispatched: "{cmd}"')
        else:
            for p in (f'{LOGS_DIR}/Jotaro.cmd', f'/dev/shm/mc-bot-Jotaro.cmd'):
                dispatch_to_file(p, line)
            print(f'{C_CYAN}[MASTERMIND -> Jotaro]{C_RESET} Dispatched: "{line}"')

        time.sleep(0.4)
        logs = glob.glob(f'{LOGS_DIR}/*.log')
        recent = []
        for l in logs:
            try:
                with open(l, 'r') as f:
                    lines = f.readlines()[-6:]
                    for row in lines:
                        if any(k in row for k in ('[CHAT IN]', '[CHAT OUT]', '[AI EXEC]', '[IPC CMD]', '[STAND ACTIVATION]')):
                            bname = os.path.basename(l).replace('.log', '')
                            recent.append((row.strip(), bname))
            except OSError:
                continue
        for r, bname in recent[-4:]:
            print(f'  {C_BOLD}{C_GREEN}[{bname}]{C_RESET} {r}')

if __name__ == '__main__':
    main()
