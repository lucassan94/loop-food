"""Investiga: coords do restaurante, raios cadastrados e resposta do CEP 99999999."""
import http.cookiejar
import json
import sys
import urllib.request
import urllib.error

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://86.48.18.22:8090/api"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        resp = opener.open(r, timeout=30)
        return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8", errors="replace"))


s, login = req("POST", "/auth/restaurante/login", {"apelido": "admin", "password": "admin123"})
token = login.get("token")
print(f"login admin: {s}")

s, conf = req("GET", "/restaurante", token=token)
if s == 200:
    print("=== /restaurante (config) ===")
    print("nome:", conf.get("nome"))
    print("cidade/estado:", conf.get("cidade"), "/", conf.get("estado"))
    print("latitude:", conf.get("latitude"), "| longitude:", conf.get("longitude"))
    raios = conf.get("raiosEntrega") or []
    print(f"raios ({len(raios)}):", [(r.get("raio_km"), r.get("custo")) for r in raios])
else:
    print("ERRO ao buscar config:", s, json.dumps(conf)[:200])

s, cep = req("POST", "/cep", {"cep": "99999999"})
print("\n=== POST /cep 99999999 ===")
print("status:", s)
print(json.dumps(cep, ensure_ascii=False)[:400])
