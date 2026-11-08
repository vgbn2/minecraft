#!/usr/bin/env python3
import socket
import struct
import sys
import subprocess

def get_container_ip():
    try:
        ip = subprocess.check_output(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "minecraft"]).decode().strip()
        if ip:
            return ip
    except Exception:
        pass
    return '127.0.0.1'

PORT = 25575
PASSWORD = 'mc_rcon_local_2026'

def send_rcon(command):
    host = get_container_ip()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5.0)
    try:
        sock.connect((host, PORT))
        
        # 1. Login packet (type 3)
        req_id = 1
        payload = PASSWORD.encode('utf-8')
        packet = struct.pack('<iii', len(payload) + 10, req_id, 3) + payload + b'\x00\x00'
        sock.sendall(packet)
        
        raw_header = sock.recv(12)
        if len(raw_header) < 12:
            raise Exception('Invalid response during auth')
        resp_len, resp_id, resp_type = struct.unpack('<iii', raw_header)
        sock.recv(resp_len - 8)
        
        if resp_id == -1:
            raise Exception('RCON Authentication failed')
            
        # 2. Command packet (type 2)
        req_id = 2
        cmd_payload = command.encode('utf-8')
        packet = struct.pack('<iii', len(cmd_payload) + 10, req_id, 2) + cmd_payload + b'\x00\x00'
        sock.sendall(packet)
        
        raw_header = sock.recv(12)
        if len(raw_header) < 12:
            raise Exception('Invalid response to command')
        resp_len, resp_id, resp_type = struct.unpack('<iii', raw_header)
        body = sock.recv(resp_len - 8).decode('utf-8', errors='replace').rstrip('\x00')
        return body
    finally:
        sock.close()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: rcon.py <command>')
        sys.exit(1)
    cmd = ' '.join(sys.argv[1:])
    try:
        res = send_rcon(cmd)
        print(res)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)
