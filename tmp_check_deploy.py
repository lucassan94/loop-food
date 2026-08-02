import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko

cfg = json.load(open('others/deploy_config.json', encoding='utf-8')) if os.path.exists('others/deploy_config.json') else {}
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=cfg.get('host','86.48.18.22'), username=cfg.get('user','root'),
               password=cfg.get('password',''), timeout=20)

def run(cmd):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out.strip(), err.strip()

base = '/opt/restaurante-v3'
checks = [
    ('ls -la do diretório', f'ls -la {base}'),
    ('docker-compose.yml existe?', f'test -f {base}/docker-compose.yml && echo SIM || echo NAO'),
    ('.env existe?', f'test -f {base}/.env && echo SIM || echo NAO'),
    ('migrations/ existe?', f'ls {base}/migrations 2>/dev/null | wc -l'),
    ('main.css com font-fix?', f"grep -c 'font-family: inherit' {base}/restaurante/dist/assets/*.css 2>/dev/null || echo 'sem dist ou sem fix'"),
    ('CheckoutPanel com salvarPerfil?', f"grep -rl 'salvarPerfilNoCheckout' {base}/cliente/dist/assets/*.js 2>/dev/null || echo 'sem dist ou sem funcao'"),
    ('uploads dir?', f'ls {base}/backend/uploads 2>/dev/null | head -3'),
    ('processos build rodando?', "ps aux | grep -E 'docker (build|compose)|docker-compose' | grep -v grep | head -5 || echo 'nenhum'"),
    ('docker-compose v1 binário?', 'which docker-compose || echo "docker-compose NAO instalado"'),
    ('docker compose v2 plugin?', 'docker compose version 2>&1 | head -2'),
]
for label, cmd in checks:
    out, err = run(cmd)
    print(f'\n── {label} ──')
    print(out or err or '(vazio)')

client.close()
print('\nFIM')
