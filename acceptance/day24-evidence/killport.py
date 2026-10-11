# -*- coding: utf-8 -*-
"""把某个端口上的监听进程干掉（Windows）。用法: python killport.py 8903"""
import subprocess
import sys

port = sys.argv[1] if len(sys.argv) > 1 else "8903"
out = subprocess.run(["netstat", "-ano"], capture_output=True).stdout.decode("utf-8", errors="replace")
pids = set()
for line in out.splitlines():
    if (":" + port + " ") in line and "LISTENING" in line.upper():
        pids.add(line.split()[-1])
for p in pids:
    subprocess.run(["taskkill", "/F", "/PID", p], capture_output=True)
print("killed=" + str(sorted(pids)) + " port=" + port)
