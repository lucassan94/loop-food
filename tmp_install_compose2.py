"""Instala o plugin docker compose v2 na VPS (fix do KeyError do compose v1)."""
import sys

sys.path.insert(0, "others")
import deploy as d  # noqa: E402

client = d.connect()
try:
    code, out, err = d.run(client, "uname -m")
    print("arch:", out.strip())

    code, out, err = d.run(client, "ls /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null && docker compose version 2>&1 || echo NAO_INSTALADO")
    if "Docker Compose version" in out:
        print("JA INSTALADO:", out.strip())
        sys.exit(0)

    # Verifica curl/wget
    code, out, err = d.run(client, "command -v curl >/dev/null && echo HAS_CURL || echo NO_CURL")
    has_curl = "HAS_CURL" in out
    print("curl:", "sim" if has_curl else "nao (usa wget)")

    dl = (
        "curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 "
        "-o /usr/local/lib/docker/cli-plugins/docker-compose"
        if has_curl else
        "wget -q -O /usr/local/lib/docker/cli-plugins/docker-compose "
        "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64"
    )
    code, out, err = d.run(
        client,
        f"mkdir -p /usr/local/lib/docker/cli-plugins && {dl} && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose && docker compose version",
        timeout=300,
    )
    print("--- saida ---")
    print(out)
    if err.strip():
        print("--- stderr ---")
        print(err)
    if "Docker Compose version" not in out:
        print("FALHA: plugin nao instalado")
        sys.exit(1)
    print("OK: docker compose v2 instalado")
finally:
    client.close()
