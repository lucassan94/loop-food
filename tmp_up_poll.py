# -*- coding: utf-8 -*-
# Inicia `docker-compose up -d --build` em background na VPS (nohup) e
# faz polling até os containers serem recriados (build concluído).
import json, os, sys, time, datetime
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
cfg_path = os.path.join(PROJECT_ROOT, "others", "deploy_config.json")
cfg = {"host": "86.48.18.22", "user": "root", "password": "", "dir": "/opt/restaurante-v3"}
if os.path.exists(cfg_path):
    cfg.update(json.load(open(cfg_path, encoding="utf-8")))

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=cfg["host"], username=cfg["user"], password=cfg["password"], timeout=20, banner_timeout=20)

def run(cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 1) Já existe build rodando? (evita duplicar)
code, out, err = run("pgrep -f 'docker-compose up' >/dev/null && echo RUNNING || echo IDLE")
print("[1] estado do build:", out.strip())
if "RUNNING" not in out:
    # 2) Inicia em background com nohup (sobrevive ao fechamento do SSH)
    print("[2] iniciando build em background...")
    code, out, err = run(
        f"cd {cfg['dir']} && (nohup docker-compose up -d --build > /tmp/deploy_up.log 2>&1 &) ; sleep 2; "
        f"pgrep -f 'docker-compose up' >/dev/null && echo BG_STARTED || echo BG_FAILED"
    )
    print("    ", out.strip(), err.strip() if err.strip() else "")
else:
    print("[2] build já está em execução — somente acompanhando.")

# 3) Polling até concluir (até 50 min)
start = time.time()
timeout_s = 50 * 60
last_tail = ""
while time.time() - start < timeout_s:
    code, out, err = run("tail -3 /tmp/deploy_up.log 2>/dev/null | tr '\\r' '\\n' | tail -3")
    tail = out.strip()
    code2, out2, _ = run("docker inspect -f '{{.State.StartedAt}}' restaurante-v3_backend_1 2>/dev/null || echo NAO")
    started = out2.strip()
    now = datetime.datetime.utcnow()
    is_new = False
    if started != "NAO":
        try:
            st = datetime.datetime.fromisoformat(started.replace("Z", "+00:00")).replace(tzinfo=None)
            age = (now - st).total_seconds()
            is_new = age < 6 * 60  # recriado nos últimos 6 min
        except Exception:
            pass
    status3 = ""
    code3, out3, _ = run("docker ps --format '{{.Names}}|{{.Status}}' | grep restaurante-v3 | tr '\\n' '; '")
    status3 = out3.strip()
    if tail != last_tail:
        print(f"[{int((time.time()-start)/60)}min] log: {tail!r}")
        last_tail = tail
    if is_new:
        print(f"[DONE] backend recriado em {started} ({age:.0f}s atrás). Status: {status3}")
        break
    time.sleep(20)
else:
    print("[TIMEOUT] build não concluiu em 50min. Status atual:")
    code, out, _ = run("tail -20 /tmp/deploy_up.log 2>/dev/null")
    print(out)

# 4) Resumo final
print("\n=== RESUMO FINAL ===")
code, out, _ = run("docker ps --format '{{.Names}} | {{.Status}}' | grep restaurante-v3")
print(out.strip())
code, out, _ = run("tail -15 /tmp/deploy_up.log 2>/dev/null")
print("\n--- log tail ---")
print(out.strip()[-2000:])
client.close()
