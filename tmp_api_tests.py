"""Suíte de testes da API (módulo Backend) contra http://86.48.18.22:8090/api.

v2 — corrige bugs do script anterior:
  * Cookie jars SEPARADOS por perfil (admin / cliente / anônimo).
    Antes o cookie do admin vazava para o POST /pedidos (optionalAuth autenticava
    como admin → cliente_id = id do admin → FK violation 409) e para o PUT perfil
    (404 "Cliente não encontrado").
  * Usa produto_id REAL do cardápio (GET /produtos) em vez do fallback 1.
  * Login do cliente com fallback de SIGNUP (cria usuário de teste se o seed
    não existir no tenant).
"""
import http.cookiejar
import json
import sys
import time
import urllib.request
import urllib.error

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://86.48.18.22:8090/api"
results = []

# ── Openers com cookie jars independentes por perfil ──
def novo_opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

opener_admin = novo_opener()   # login admin + rotas admin
opener_cliente = novo_opener() # login/signup cliente + rotas de cliente
opener_anon = novo_opener()    # rotas públicas / sem sessão


def req(opener, method, path, body=None, token=None, origin=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if origin:
        headers["Origin"] = origin
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = opener.open(r, timeout=30)
        raw = resp.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw
        return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw
        return e.code, payload, dict(e.headers)
    except Exception as e:
        return None, {"error": str(e)}, {}


def check(tid, desc, ok, detail=""):
    results.append((tid, desc, ok, detail))
    print(f"{'[OK]' if ok else '[FALHA]'} {tid} {desc} {detail}")


# ══════════ API-01 health ══════════
s, p, _ = req(opener_anon, "GET", "/health")
check("API-01", "health 200", s == 200, f"(status={s})")

# ══════════ API-02/03 cardápio + categorias ══════════
s, p, _ = req(opener_anon, "GET", "/produtos")
check("API-02", "cardápio 200 array", s == 200 and isinstance(p, list), f"(status={s}, tipo={type(p).__name__})")
produto_id = None
if isinstance(p, list) and p:
    first = p[0]
    if isinstance(first, dict) and "produtos" in first:
        prods = [pp for cat in p for pp in (cat.get("produtos") or [])]
    else:
        prods = p
    if prods:
        produto_id = prods[0].get("id")
print(f"[setup] produto_id real = {produto_id}")

s, p, _ = req(opener_anon, "GET", "/produtos/categorias")
check("API-03", "categorias 200", s == 200, f"(status={s})")

# ══════════ API-04/05 CEP ══════════
s, p, _ = req(opener_anon, "POST", "/cep", {"cep": "01001000"})
check("API-04", "CEP válido 200 + endereco", s == 200 and isinstance(p, dict) and p.get("cidade"), f"(status={s})")

s, p, _ = req(opener_anon, "POST", "/cep", {"cep": "00000000"})
check("API-05", "CEP inválido → 400/404", s in (400, 404, 422), f"(status={s}, {json.dumps(p)[:80]})")

# ══════════ API-06/07 frete dentro/fora do raio ══════════
OSASCO = (-23.5329, -46.7917)
s, p, _ = req(opener_anon, "POST", "/pedidos/calcular-frete", {"latitude": OSASCO[0], "longitude": OSASCO[1], "estado": "SP"})
custo_sp = p.get("custo") if isinstance(p, dict) else None
check("API-06", "frete Osasco (dentro raio) 200", s == 200 and custo_sp is not None, f"(status={s}, custo={custo_sp})")

s, p, _ = req(opener_anon, "POST", "/pedidos/calcular-frete", {"latitude": -22.9068, "longitude": -43.1729, "estado": "RJ"})
check("API-07", "frete RJ (fora raio) 400", s == 400, f"(status={s}, {json.dumps(p)[:90]})")

# ══════════ API-08/09 login admin ══════════
s, p, _ = req(opener_admin, "POST", "/auth/restaurante/login", {"apelido": "admin", "password": "admin123"})
admin_token = p.get("token") if isinstance(p, dict) else None
check("API-08", "login admin 200 + token", s == 200 and bool(admin_token), f"(status={s})")

s, p, _ = req(opener_admin, "POST", "/auth/restaurante/login", {"apelido": "admin", "password": "senhaerrada1"})
check("API-09", "login senha errada 401", s == 401, f"(status={s})")

# ══════════ Login/signup cliente (jar próprio) ══════════
# Seed 'cliente' ausente no tenant deployado → usuário de teste persistente primeiro
# (criado via signup; tmp_ui_tests/.cliente-teste.json — telefone fixo (11) 97000-7777)
s, p, _ = req(opener_cliente, "POST", "/auth/cliente/login", {"telefone": "(11) 97000-7777", "password": "cliente123"})
cliente_token = p.get("token") if isinstance(p, dict) else None
print(f"[setup] cliente login telefone persistente status={s}")
if not cliente_token:
    # Fallback: apelido do seed do doc
    s1, p1, _ = req(opener_cliente, "POST", "/auth/cliente/login", {"apelido": "cliente", "password": "cliente123"})
    cliente_token = p1.get("token") if isinstance(p1, dict) else None
    print(f"[setup] cliente login apelido status={s1}")
if not cliente_token:
    # Fallback final: signup com telefone único (pode esbarrar no signupLimiter 5/hora)
    import random as _r
    telefone = "(11) 9" + str(_r.randint(10000000, 99999999))
    s2, p2, _ = req(opener_cliente, "POST", "/auth/cliente/signup", {
        "nome": "Cliente Teste", "sobrenome": "API", "telefone": telefone,
        "password": "cliente123",
    })
    cliente_token = p2.get("token") if isinstance(p2, dict) else None
    print(f"[setup] signup fallback status={s2} (telefone {telefone})")

# ══════════ API-10 pedido fora do raio ══════════
def build_pedido(lat, lng, cidade, estado, cep, frete, subtotal=30.0):
    return {
        "nome_cliente": "Teste API", "telefone_cliente": "11999999999",
        "endereco_cliente": "Av Paulista, 1000", "numero_cliente": "1000",
        "bairro_cliente": "Bela Vista", "cep_cliente": cep,
        "cidade_cliente": cidade, "estado_cliente": estado,
        "latitude_cliente": lat, "longitude_cliente": lng,
        "subtotal": subtotal, "valor_frete": frete, "total": subtotal + frete,
        "metodo_pagamento": "dinheiro", "observacoes": "teste automatizado",
        "itens": [{"produto_id": produto_id or 1, "nome_produto": "Item Teste API",
                   "quantidade": 1, "preco_unitario": subtotal, "extras": [], "subtotal": subtotal}],
    }

s, p, _ = req(opener_anon, "POST", "/pedidos", build_pedido(-22.9068, -43.1729, "Rio de Janeiro", "RJ", "22000000", 0))
check("API-10", "pedido fora do raio → 400", s == 400, f"(status={s}, {json.dumps(p)[:90]})")

# ══════════ API-11 frete adulterado ══════════
time.sleep(1)
s, p, _ = req(opener_anon, "POST", "/pedidos", build_pedido(OSASCO[0], OSASCO[1], "Osasco", "SP", "06010000", 0.01))
check("API-11", "frete adulterado → 400", s == 400, f"(status={s}, {json.dumps(p)[:90]})")

# ══════════ API-12 pedido COD válido (jar ANÔNIMO — sem cookies de admin) ══════════
time.sleep(1)
frete_correto = custo_sp if custo_sp is not None else 5.0
s, p, _ = req(opener_anon, "POST", "/pedidos", build_pedido(OSASCO[0], OSASCO[1], "Osasco", "SP", "06010000", frete_correto))
check("API-12", "pedido válido → 201", s == 201, f"(status={s}, {json.dumps(p)[:80]})")
pedido_id = p.get("id") if isinstance(p, dict) else None

# ══════════ API-13/14 pedidos (admin) ══════════
s, p, _ = req(opener_admin, "GET", "/pedidos", token=admin_token)
check("API-13", "listar pedidos 200 array", s == 200 and isinstance(p, list), f"(status={s})")

s, p, _ = req(opener_admin, "GET", "/pedidos/99999999", token=admin_token)
check("API-14", "pedido inexistente 404", s == 404, f"(status={s})")

# ══════════ API-15 pagamento sem CPF válido (cliente) ══════════
s, p, _ = req(opener_cliente, "POST", "/pagamentos/criar", {
    "tipo": "PIX",
    "cliente": {"cpfCnpj": "123", "nome": "Teste", "telefone": "11999999999"},
    "pedido": {"endereco": "Rua A", "numero": "1", "bairro": "Centro", "cep": "01310100",
               "cidade": "São Paulo", "estado": "SP", "latitude": -23.5505, "longitude": -46.6333},
    "subtotal": 30, "valor_frete": frete_correto, "total": 30 + frete_correto,
    "itens": [{"produto_id": produto_id or 1, "nome_produto": "Item", "quantidade": 1,
               "preco_unitario": 30, "extras": [], "subtotal": 30}],
}, token=cliente_token)
check("API-15", "pagamento CPF inválido → 400", s == 400, f"(status={s})")

# ══════════ API-16/17 perfil (cliente, jar próprio) ══════════
s, p, _ = req(opener_cliente, "GET", "/auth/me", token=cliente_token)
check("API-16", "GET /auth/me (cliente) 200", s == 200 and isinstance(p, dict) and p.get("user"), f"(status={s})")

import random as _r2
telefone_unico = "(11) 9" + str(_r2.randint(10000000, 99999999))
s, p, _ = req(opener_cliente, "PUT", "/clientes/perfil", {
    "nome": "Teste API", "telefone": telefone_unico,
    "cidade": "São Paulo", "estado": "SP",
}, token=cliente_token)
check("API-17", "PUT perfil 200", s == 200, f"(status={s}, {json.dumps(p)[:80]})")

# ══════════ API-18 sem token ══════════
fresh = novo_opener()
try:
    resp = fresh.open(urllib.request.Request(BASE + "/pedidos", method="GET"), timeout=30)
    s = resp.status
except urllib.error.HTTPError as e:
    s = e.code
except Exception:
    s = None
check("API-18", "GET /pedidos sem token 401", s == 401, f"(status={s})")

# ══════════ API-19 rota inexistente ══════════
s, p, _ = req(opener_anon, "GET", "/nao-existe")
check("API-19", "rota inexistente 404", s == 404, f"(status={s})")

# ══════════ API-20 CORS ══════════
s, p, h = req(opener_anon, "GET", "/produtos", origin="http://86.48.18.22:8091")
acao = h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")
check("API-20", "CORS header presente", bool(acao), f"(acao={acao})")

print("\n=== RESUMO ===")
ok = sum(1 for r in results if r[2])
print(f"{ok}/{len(results)} testes passaram")
if ok < len(results):
    print("FALHAS:", [r[1] for r in results if not r[2]])
    sys.exit(1)
print("API SUITE OK")
