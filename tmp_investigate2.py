"""Investiga o 409 do pedido e o 500 do CEP inválido."""
import http.cookiejar
import json
import sys
import time
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
        return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


# ── API-05: CEP invalido ──
for cep in ["00000000", "11111111"]:
    s, body = req("POST", "/cep", {"cep": cep})
    print(f"CEP {cep} → status {s} | {body[:200]}")

# ── API-12: pedido valido em Osasco ──
s, p = req("POST", "/auth/restaurante/login", {"apelido": "admin", "password": "admin123"})
print("login admin:", s)
token = json.loads(p).get("token") if s == 200 else None

s, body = req("GET", "/produtos")
prods = json.loads(body)
pid = None
if isinstance(prods, list) and prods:
    first = prods[0]
    if isinstance(first, dict) and "produtos" in first:
        prods = [pp for c in prods for pp in (c.get("produtos") or [])]
    pid = prods[0]["id"] if prods else None
print("produto id:", pid)

pedido = {
    "nome_cliente": "Investiga 409", "telefone_cliente": "11977777777",
    "endereco_cliente": "Rua da Matriz, 100", "numero_cliente": "100",
    "bairro_cliente": "Centro", "cep_cliente": "06010000",
    "cidade_cliente": "Osasco", "estado_cliente": "SP",
    "latitude_cliente": -23.5329, "longitude_cliente": -46.7917,
    "subtotal": 30, "valor_frete": 5, "total": 35,
    "metodo_pagamento": "dinheiro", "observacoes": "investigacao",
    "itens": [{"produto_id": pid or 1, "nome_produto": "Item Investiga",
               "quantidade": 1, "preco_unitario": 30, "extras": [], "subtotal": 30}],
}
s, body = req("POST", "/pedidos", pedido)
print("POST /pedidos → status", s, "|", body[:400])
