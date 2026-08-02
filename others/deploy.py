#!/usr/bin/env python3
# ============================================================================
# Deploy via SSH — SaborExpress V3 (sem GitHub)
# ============================================================================
# Sobe a pasta app/ (o código da aplicação) direto para a VPS via SFTP e
# gerencia os containers com docker compose, sem depender de git/Portainer.
#
# Estrutura do projeto:
#   app/      → código da aplicação (backend, cliente, restaurante, entregador,
#               router, docker-compose.yml) — É ISTO que vai para a VPS
#   migrations/ → SQL de schema (sincronizadas sob demanda no comando migrate)
#   others/   → ferramentas locais (deploy.py, god, README, run.bat, ...)
#   spec/     → documentação da spec
#   project-manager/ → registros do projeto
#   trash/    → arquivos descartados
#
# Pré-requisitos:  pip install paramiko
#
# Uso:
#   python deploy.py check          # inspeciona o servidor (read-only)
#   python deploy.py upload [--force] [--dry-run]
#                                   # sincroniza app/ → VPS (delta por hash)
#   python deploy.py images [--force] [--dry-run]
#                                   # sincroniza SOMENTE app/backend/uploads (cardápio)
#   python deploy.py env            # cria o .env de produção (1ª vez)
#   python deploy.py migrate        # sincroniza migrations/ e roda no container backend
#   python deploy.py up             # docker compose up -d --build no servidor
#   python deploy.py deploy         # upload + env + up (deploy completo)
#   python deploy.py logs [svc]     # logs do serviço (ex: backend)
#   python deploy.py ps             # status dos containers
#
# Sincronização incremental (controle de versão):
#   Na primeira subida (ou com --force) TODOS os arquivos são enviados e um
#   manifesto .deploy_manifest.json é gravado no servidor com o hash SHA-256
#   de cada arquivo. Nas execuções seguintes, apenas os arquivos cujo hash
#   mudou (ou que não existem mais no manifesto) são enviados — deploys
#   rotineiros enviam só o que foi alterado. Use --dry-run para ver o que
#   mudaria sem enviar nada.
#
#   ⚠️ Se um arquivo for removido MANUALMENTE no servidor com o manifesto
#   intacto, ele não é reenviado (o hash ainda bate). Recupere com
#   `python deploy.py upload --force` ou apagando o .deploy_manifest.json.
#
# Credenciais: lidas de deploy_config.json (NUNCA commitar) ou variáveis:
#   DEPLOY_HOST, DEPLOY_USER, DEPLOY_PASS, DEPLOY_DIR
# ============================================================================

import hashlib
import json
import os
import stat
import sys

import paramiko

# Console Windows (cp1252) não suporta emoji — forçar UTF-8 na saída
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
# A pasta que vai para a VPS é app/ (irmã de others/)
APP_ROOT = os.path.normpath(os.path.join(PROJECT_ROOT, "..", "app"))
# Migrations ficam fora de app/ (na raiz do projeto), sincronizadas sob demanda
MIGRATIONS_ROOT = os.path.normpath(os.path.join(PROJECT_ROOT, "..", "migrations"))

# ────────────────────────────────────────────────────────────────────────────
# CONFIG
# ────────────────────────────────────────────────────────────────────────────
def load_config():
    cfg = {
        "host": os.environ.get("DEPLOY_HOST", "86.48.18.22"),
        "user": os.environ.get("DEPLOY_USER", "root"),
        "password": os.environ.get("DEPLOY_PASS", ""),
        "dir": os.environ.get("DEPLOY_DIR", "/opt/restaurante-v3"),
    }
    # Arquivo local com credenciais (gitignored)
    cfg_path = os.path.join(PROJECT_ROOT, "deploy_config.json")
    if os.path.exists(cfg_path):
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg

CONFIG = load_config()

# Pastas que NUNCA sobem (evita node_modules, .git, builds, lixo)
EXCLUDE_DIRS = {
    "node_modules", ".git", "dist", "__pycache__", ".venv", "Cardápio",
    ".vite",  # cache do dev server (deps_temp_*) — nunca sobe
    # uploads NÃO sobem no deploy automático: o diretório é bind-mounted e
    # pertence ao servidor (uploads de produção podem existir lá). Para
    # sincronizar imagens do cardápio use: python deploy.py images
    "uploads",
}
EXCLUDE_EXT = {".pyc", ".log", ".tmp"}


# ────────────────────────────────────────────────────────────────────────────
# HELPERS
# ────────────────────────────────────────────────────────────────────────────
def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=CONFIG["host"],
        username=CONFIG["user"],
        password=CONFIG["password"],
        timeout=20,
        banner_timeout=20,
    )
    return client


def run(client, cmd, check=False, timeout=300):
    """Executa comando remoto e retorna (exit_status, stdout, stderr)."""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if check and code != 0:
        print(f"[ERRO] comando falhou ({code}): {cmd}\n{out}\n{err}")
        sys.exit(1)
    return code, out, err


def compose_cmd(client):
    """Detecta o comando compose NO SERVIDOR (plugin v2 ou legado v1)."""
    code, out, err = run(client, "docker compose version >/dev/null 2>&1 && echo V2 || echo V1")
    return "docker compose" if "V2" in out else "docker-compose"


def sftp_mkdirs(sftp, remote_path):
    """Cria diretório remoto recursivamente se não existir."""
    parts = remote_path.split("/")
    cur = ""
    for p in parts:
        if not p:
            continue
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


# ────────────────────────────────────────────────────────────────────────────
# SINCRONIZAÇÃO INCREMENTAL (controle de versão por hash SHA-256)
# ────────────────────────────────────────────────────────────────────────────
# Um manifesto .deploy_manifest.json fica no servidor mapeando cada arquivo
# enviado → hash SHA-256. A cada execução comparamos o hash local com o do
# manifesto e só enviamos o que mudou ou falta. Manifesto ausente/corrompido
# → upload completo (autocorreção). upload e images compartilham o MESMO
# manifesto (chaves = caminho relativo ao diretório de deploy).

MANIFEST_NAME = ".deploy_manifest.json"


def manifest_remote_path():
    return f"{CONFIG['dir']}/{MANIFEST_NAME}"


def hash_file(path, chunk_size=1024 * 1024):
    """SHA-256 hex de um arquivo local (lido em blocos)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def load_remote_manifest(sftp):
    """Lê o manifesto do servidor. Ausente/ilegível → {} (força upload completo)."""
    try:
        with sftp.open(manifest_remote_path(), "r") as f:
            data = json.loads(f.read().decode("utf-8"))
        if isinstance(data, dict):
            return data
    except Exception as exc:
        print(f"ℹ️  Manifesto remoto ausente ou ilegível ({exc}) — upload completo desta vez.")
    return {}


def save_remote_manifest(sftp, manifest):
    """Grava o manifesto no servidor. Escrita direta: se falhar no meio,
    o próximo run detecta corrupção e refaz o upload completo."""
    # bytes UTF-8 explícito: paramiko 5.x aceita str (encoda sozinho), mas
    # bytes funciona em TODAS as versões — mais robusto.
    with sftp.open(manifest_remote_path(), "w") as f:
        f.write(json.dumps(manifest, indent=1).encode("utf-8"))


def sync_tree(sftp, local_root, key_prefix, force=False, dry_run=False):
    """Sincroniza local_root → {dir}/{key_prefix}/... com delta por hash.

    Retorna (uploaded, unchanged, skipped, merged_manifest).
    merged_manifest preserva entradas de outras raízes: upload e images
    compartilham o MESMO manifesto, então rodar um comando só não apaga as
    entradas do outro.
    """
    remote_base = CONFIG["dir"]
    # Sempre carrega o manifesto (mesmo com --force) para NÃO apagar as
    # entradas da outra raiz: upload e images compartilham o mesmo manifesto.
    old_manifest = load_remote_manifest(sftp)
    merged = dict(old_manifest)
    uploaded = unchanged = skipped = 0

    for root, dirs, files in os.walk(local_root):
        # Filtra diretórios excluídos (in-place)
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        rel_root = os.path.relpath(root, local_root).replace("\\", "/")
        if rel_root == ".":
            rel_root = ""

        for name in files:
            rel_path = (rel_root + "/" + name) if rel_root else name
            if should_skip(rel_path, name):
                skipped += 1
                continue

            local_path = os.path.join(root, name)
            key = f"{key_prefix}/{rel_path}" if key_prefix else rel_path
            digest = hash_file(local_path)
            merged[key] = digest

            if not force and old_manifest.get(key) == digest:
                unchanged += 1
                continue

            uploaded += 1
            if dry_run:
                print(f"   [dry-run] enviaria: {key}")
                continue
            remote_path = f"{remote_base}/{key}"
            sftp_mkdirs(sftp, os.path.dirname(remote_path))
            sftp.put(local_path, remote_path)
            print(f"   ↑ {key}")

    return uploaded, unchanged, skipped, merged


# ────────────────────────────────────────────────────────────────────────────
# COMANDO: check
# ────────────────────────────────────────────────────────────────────────────
def cmd_check():
    client = connect()
    try:
        print(f"🌐 Conectado a {CONFIG['host']} como {CONFIG['user']}")
        for label, c in [
            ("Hostname", "hostname"),
            ("Sistema", "uname -a"),
            ("Docker", "docker --version 2>&1"),
            ("Docker Compose", "docker compose version 2>&1"),
            ("Diretório", f"ls -la {CONFIG['dir']} 2>&1 || echo 'NÃO EXISTE'"),
            ("Containers", "docker ps --format 'table {{.Names}}\\t{{.Ports}}\\t{{.Status}}' 2>&1 || echo 'docker ps falhou'"),
            ("Portas 8090-8094", "ss -tlnp 2>/dev/null | grep -E ':(8090|8091|8092|8093|8094)' || echo 'portas livres'"),
            ("Disco", "df -h /opt | tail -1"),
        ]:
            code, out, err = run(client, c)
            print(f"\n── {label} ──")
            print(out.strip() or err.strip())
    finally:
        client.close()


# ────────────────────────────────────────────────────────────────────────────
# COMANDO: upload
# ────────────────────────────────────────────────────────────────────────────
def should_skip(rel_path, name):
    if name in EXCLUDE_DIRS:
        return True
    if any(name.endswith(e) for e in EXCLUDE_EXT):
        return True
    # Não sobe configs de credenciais de deploy nem .env locais com segredos de dev
    if name in {"deploy_config.json", "deploy_config.json.example", ".env", "stack.env"}:
        return True
    if name.endswith(".env.local") or name.startswith(".env."):
        return True
    return False


def cmd_upload(force=False, dry_run=False):
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        print(f"📦 Sincronizando app/ → {remote_base} (delta por hash SHA-256) ...")
        code, out, err = run(client, f"mkdir -p {remote_base}", check=True)

        sftp = client.open_sftp()
        sftp_mkdirs(sftp, remote_base)

        uploaded, unchanged, skipped, merged = sync_tree(
            sftp, APP_ROOT, "", force=force, dry_run=dry_run
        )

        # Só reescreve o manifesto quando algo mudou (evita write + round-trip)
        if not dry_run and uploaded:
            save_remote_manifest(sftp, merged)

        sftp.close()
        mode = " (DRY-RUN — nada enviado)" if dry_run else (" (forçado)" if force else "")
        print(f"✅ Upload concluído{mode}: {uploaded} enviado(s), {unchanged} inalterado(s), {skipped} ignorado(s).")
    finally:
        client.close()


def cmd_images(force=False, dry_run=False):
    """Sincroniza SOMENTE app/backend/uploads (imagens do cardápio/banners)."""
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        local_uploads = os.path.join(APP_ROOT, "backend", "uploads")
        if not os.path.isdir(local_uploads):
            print("ℹ️  app/backend/uploads não existe localmente — nada a enviar.")
            return
        print(f"🖼️  Sincronizando imagens → {remote_base}/backend/uploads (delta por hash) ...")

        sftp = client.open_sftp()
        uploaded, unchanged, skipped, merged = sync_tree(
            sftp, local_uploads, "backend/uploads", force=force, dry_run=dry_run
        )

        # Só reescreve o manifesto quando algo mudou (evita write + round-trip)
        if not dry_run and uploaded:
            save_remote_manifest(sftp, merged)

        sftp.close()
        mode = " (DRY-RUN — nada enviado)" if dry_run else (" (forçado)" if force else "")
        print(f"✅ Imagens sincronizadas{mode}: {uploaded} enviada(s), {unchanged} inalterada(s), {skipped} ignorada(s).")
    finally:
        client.close()


# ────────────────────────────────────────────────────────────────────────────
# COMANDO: up / deploy
# ────────────────────────────────────────────────────────────────────────────
def cmd_migrate():
    """Sincroniza a pasta migrations/ para a VPS e roda no container backend."""
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        compose = compose_cmd(client)

        # 1. Sincroniza migrations/ para {dir}/migrations (o container monta
        #    ./migrations:/app/migrations — ver docker-compose.yml)
        print("🗄️  Sincronizando migrations/ ...")
        if os.path.isdir(MIGRATIONS_ROOT):
            sftp = client.open_sftp()
            remote_mig = f"{remote_base}/migrations"
            sftp_mkdirs(sftp, remote_mig)
            count = 0
            for name in sorted(os.listdir(MIGRATIONS_ROOT)):
                if not name.endswith(".sql"):
                    continue
                sftp.put(os.path.join(MIGRATIONS_ROOT, name), f"{remote_mig}/{name}")
                count += 1
            sftp.close()
            print(f"   → {count} arquivos .sql sincronizados.")
        else:
            print("   ⚠️  Pasta migrations/ não encontrada localmente.")

        # 2. Roda o migrate.js dentro do container
        print("🗄️  Rodando migrations no backend ...")
        code, out, err = run(
            client,
            f"cd {remote_base} && {compose} exec -T backend node src/migrate.js",
            timeout=600,
        )
        print(out)
        if err.strip():
            print(err)
        if code != 0:
            print("⚠️  Migrations retornaram erro — verifique acima.")
    finally:
        client.close()


def cmd_up():
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        compose = compose_cmd(client)
        print(f"🚀 Subindo containers em {remote_base} ({compose}) ...")
        # Build dos 3 SPAs pode demorar vários minutos em VPS pequena
        code, out, err = run(
            client,
            f"cd {remote_base} && {compose} up -d --build",
            check=True,
            timeout=1800,
        )
        print(out)
        if err.strip():
            print(err)
    finally:
        client.close()


# Conteúdo padrão do .env de produção (criado UMA vez no servidor;
# não sobrescreve edições posteriores do usuário).
DEFAULT_ENV = """NODE_ENV=production
DB_HOST=86.48.18.22
DB_PORT=5432
DB_NAME=delivery
DB_USER=default
DB_PASS=default
JWT_SECRET=dev-secret-change-in-production
RESTAURANT_ID=1
CORS_ORIGIN=http://86.48.18.22:8091,http://86.48.18.22:8092,http://86.48.18.22:8093,http://86.48.18.22:8094,*.loopautomacoes.com.br
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880
"""


def cmd_env():
    """Cria o .env de produção no servidor SE ainda não existir."""
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        env_path = f"{remote_base}/.env"
        code, out, err = run(client, f"test -f {env_path} && echo EXISTE || echo NAO_EXISTE")
        if "EXISTE" in out and "NAO_EXISTE" not in out:
            print(f"ℹ️  .env já existe no servidor ({env_path}) — mantido como está.")
            return
        # Cria via SFTP
        sftp = client.open_sftp()
        with sftp.open(env_path, "w") as f:
            f.write(DEFAULT_ENV)
        sftp.close()
        print(f"✅ .env criado em {env_path}")
    finally:
        client.close()


def cmd_deploy():
    cmd_upload()
    cmd_env()
    cmd_up()


# ────────────────────────────────────────────────────────────────────────────
# COMANDO: logs / ps
# ────────────────────────────────────────────────────────────────────────────
def cmd_logs(service=None):
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        compose = compose_cmd(client)
        svc = service or "backend"
        cmd = f"cd {remote_base} && {compose} logs --tail=100 {svc}"
        code, out, err = run(client, cmd)
        print(out)
        if err.strip():
            print(err)
    finally:
        client.close()


def cmd_ps():
    client = connect()
    try:
        remote_base = CONFIG["dir"]
        compose = compose_cmd(client)
        code, out, err = run(client, f"cd {remote_base} && {compose} ps")
        print(out)
    finally:
        client.close()


# ────────────────────────────────────────────────────────────────────────────
# MAIN
# ────────────────────────────────────────────────────────────────────────────
def parse_flags(args):
    """Extrai flags comuns dos comandos: --force e --dry-run."""
    return "--force" in args, "--dry-run" in args


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "check":
        cmd_check()
    elif command == "upload":
        cmd_upload(*parse_flags(sys.argv[2:]))
    elif command == "images":
        cmd_images(*parse_flags(sys.argv[2:]))
    elif command == "env":
        cmd_env()
    elif command == "migrate":
        cmd_migrate()
    elif command == "up":
        cmd_up()
    elif command == "deploy":
        cmd_deploy()
    elif command == "logs":
        cmd_logs(sys.argv[2] if len(sys.argv) > 2 else None)
    elif command == "ps":
        cmd_ps()
    else:
        print(f"Comando desconhecido: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
