"""Teste de regressão pós-fix do deploy.py (save/load REAIS + diff)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath("others"))
import deploy as d  # noqa: E402


class FakeSFTP:
    """SFTP falso (para sync_tree)."""

    def __init__(self):
        self.puts = []
        self._dirs = set()

    def put(self, local, remote):
        self.puts.append(remote)

    def stat(self, path):
        if path in self._dirs:
            return None
        raise FileNotFoundError(path)

    def mkdir(self, path):
        self._dirs.add(path)


def make_tree(root):
    os.makedirs(os.path.join(root, "backend", "src"), exist_ok=True)
    os.makedirs(os.path.join(root, "public"), exist_ok=True)
    for rel, content in [
        ("backend/index.js", "module.exports = 1;\n"),
        ("backend/src/app.js", "const x = 1;\n"),
        ("public/style.css", "body{}\n"),
    ]:
        with open(os.path.join(root, rel), "w", encoding="utf-8") as f:
            f.write(content)


ok = 0
fails = []


def check(label, cond):
    global ok
    if cond:
        ok += 1
        print(f"  ✅ {label}")
    else:
        fails.append(label)
        print(f"  ❌ {label}")


# ── TESTE A: save/load REAIS (o bug crítico do bytes) ──
print("\nA) save_remote_manifest/load_remote_manifest reais (sem monkeypatch)")
with tempfile.TemporaryDirectory() as td:
    d.CONFIG = {**d.CONFIG, "dir": td}

    class RealSFTP:
        """Simula o paramiko: SFTPFile é binário — "w" aceita bytes."""

        def __init__(self, base):
            self.base = base

        def open(self, path, mode="r"):
            bmode = mode.replace("b", "") + "b"  # 'w' -> 'wb', 'r' -> 'rb'
            return open(os.path.join(self.base, os.path.basename(path)), bmode)

    sftp = RealSFTP(td)
    manifest = {"a.js": "abc123", "backend/uploads/1/cardapio/x.jpg": "def456"}
    d.save_remote_manifest(sftp, manifest)  # usa str internamente → deve encodar
    got = d.load_remote_manifest(sftp)
    check("round-trip bytes OK (não lança TypeError)", got == manifest)
    with open(os.path.join(td, d.MANIFEST_NAME), "rb") as f:
        raw = f.read()
    check("arquivo no disco é bytes UTF-8", isinstance(raw, bytes) and b"abc123" in raw)

# ── TESTE B: sync_tree com monkeypatch de load (diff + merge + force) ──
print("\nB) sync_tree (diff, merge entre raízes, force, dry-run)")
with tempfile.TemporaryDirectory() as td:
    root = os.path.join(td, "app")
    os.makedirs(root)
    make_tree(root)
    d.CONFIG = {**d.CONFIG, "dir": os.path.join(td, "remote")}
    os.makedirs(d.CONFIG["dir"])

    remote_state = {}  # manifesto do "servidor"
    d.load_remote_manifest = lambda sftp: dict(remote_state)

    def fake_save(sftp, m):
        remote_state.clear()
        remote_state.update(m)

    d.save_remote_manifest = fake_save

    fake = FakeSFTP()

    # B1: primeiro deploy → tudo
    fake.puts.clear()
    up, unch, skip, merged = d.sync_tree(fake, root, "", dry_run=False)
    check("B1 primeiro deploy envia 3", up == 3 and len(fake.puts) == 3)
    remote_state.update(merged)

    # B2: nada mudou → 0
    fake.puts.clear()
    up, unch, skip, merged = d.sync_tree(fake, root, "", dry_run=False)
    check("B2 nada mudou → 0 enviados, 3 inalterados", up == 0 and unch == 3)

    # B3: images com --force NÃO apaga entradas de código
    img_root = os.path.join(td, "uploads")
    os.makedirs(os.path.join(img_root, "1"))
    with open(os.path.join(img_root, "1", "foto.jpg"), "wb") as f:
        f.write(b"\xff\xd8fake")
    fake.puts.clear()
    up, unch, skip, merged = d.sync_tree(fake, img_root, "backend/uploads", force=True, dry_run=False)
    check("B3 force envia 1 imagem", up == 1)
    check("B3 force preserva 3 entradas de código no manifesto", "backend/index.js" in merged and len(merged) == 4)

    # B4: force no upload reenvia tudo
    fake.puts.clear()
    up, unch, skip, merged = d.sync_tree(fake, root, "", force=True, dry_run=False)
    check("B4 force reenvia os 3", up == 3)

    # B5: dry-run não salva
    before = dict(remote_state)
    fake.puts.clear()
    up, unch, skip, merged = d.sync_tree(fake, root, "", dry_run=True)
    check("B5 dry-run não envia", len(fake.puts) == 0)
    check("B5 dry-run manifest intacto", remote_state == before)

print(f"\nResultado: {ok} passaram, {len(fails)} falharam")
if fails:
    print("Falhas:", fails)
    sys.exit(1)
print("TUDO OK")
