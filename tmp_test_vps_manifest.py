"""Validação REAL na VPS: round-trip de manifesto temporário via paramiko.

Somente leitura/escrita de UM arquivo temporário (.deploy_manifest.test.json)
que é apagado ao final. Prova que sftp.open + write(bytes) + read funciona
no SFTP real do servidor (o bug crítico do save_remote_manifest).
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath("others"))
import deploy as d  # noqa: E402

TEST_NAME = ".deploy_manifest.test.json"
test_path = f"{d.CONFIG['dir']}/{TEST_NAME}"
manifest = {"backend/index.js": "abc123", "backend/uploads/1/cardapio/x.jpg": "def456"}

client = d.connect()
try:
    sftp = client.open_sftp()
    try:
        # save (mesma lógica de save_remote_manifest: bytes!)
        with sftp.open(test_path, "w") as f:
            f.write(json.dumps(manifest, indent=1).encode("utf-8"))
        print("✅ write(bytes) OK")

        # load (mesma lógica de load_remote_manifest)
        with sftp.open(test_path, "r") as f:
            got = json.loads(f.read().decode("utf-8"))
        print("✅ read/decode OK")
        if got == manifest:
            print("✅ round-trip idêntico")
        else:
            print("❌ round-trip divergiu:", got)
            sys.exit(1)
    finally:
        sftp.remove(test_path)
        print("✅ arquivo temporário removido")
        sftp.close()
finally:
    client.close()
print("\nVALIDAÇÃO VPS OK")
