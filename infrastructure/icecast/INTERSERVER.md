# Hospedar o StreamServer na InterServer.net — passo a passo

Este guia leva-te do zero até o sistema online: pessoas criam contas, criam estações e transmitem com o BUTT.

**Tempo estimado:** 45–90 minutos (primeira vez).

---

## Visão geral

Na VPS InterServer fica tudo:

| Serviço | Porta | Para quê |
|---------|-------|----------|
| Site + API (Nginx) | **80** (e depois **443**) | Contas, dashboard, ouvir rádio |
| Icecast | **8000** | BUTT transmite aqui |
| SSH | **22** | Administrar o servidor |

```
Browser  →  http://SEU_IP/  (dashboard + API)
BUTT     →  SEU_IP:8000     (transmissão)
Ouvintes →  http://SEU_IP/stream/<slug>/live
```

---

## PASSO 1 — Criar conta e VPS na InterServer

1. Vai a [https://www.interserver.net/](https://www.interserver.net/) e cria conta.
2. Compra / cria um **VPS** (não uses “shared hosting” / cPanel partilhado).
3. Escolhe:
   - **OS:** Ubuntu **22.04** ou **24.04** LTS  
   - **RAM:** mínimo **2 GB** (melhor **4 GB**)  
   - **Disco:** ≥ 40 GB  
4. Quando a VPS estiver pronta, anota:
   - **IP público** (ex.: `66.45.123.45`)
   - Utilizador SSH (muitas vezes `root`)
   - Password SSH ou chave

---

## PASSO 2 — Abrir as portas (firewall)

Sem isto o site ou o BUTT não funcionam.

No painel da InterServer (Firewall / Security / CSF), permite entrada:

| Porta | Protocolo | Motivo |
|-------|-----------|--------|
| 22 | TCP | SSH |
| 80 | TCP | Site / API |
| 443 | TCP | HTTPS (quando activares) |
| **8000** | TCP | **BUTT / Icecast** |

Guarda as alterações.

---

## PASSO 3 — Ligar à VPS por SSH (do teu Windows)

### Opção A — PowerShell

```powershell
ssh root@SEU_IP_INTERSERVER
```

Na primeira vez aceita o fingerprint (`yes`). Introduz a password.

### Opção B — PuTTY

1. Host: o IP da VPS  
2. Port: 22  
3. Open → login `root` + password  

Se entrares no prompt Linux (`root@...:~#`), estás dentro da VPS.

---

## PASSO 4 — Enviar o projecto para a VPS

### Opção A — Git (recomendado)

Na VPS:

```bash
apt-get update -y
apt-get install -y git curl
cd /opt
git clone https://github.com/TEU_USER/StreamServer.git
cd StreamServer
```

> Substitui pela URL real do teu repositório. Se o repo for privado, usa SSH key ou token.

### Opção B — Sem Git (ZIP do teu PC)

No **Windows** (PowerShell), na pasta do projecto:

```powershell
# Compacta (ou usa o Explorer → Enviar para → Pasta compactada)
# Depois, com SCP (OpenSSH no Windows):
scp -r "c:\Projectos\StreamServer" root@SEU_IP_INTERSERVER:/opt/StreamServer
```

Ou usa **WinSCP**: arrasta a pasta `StreamServer` para `/opt/StreamServer` na VPS.

Na VPS confirma:

```bash
cd /opt/StreamServer
ls
# Deves ver: docker-compose.interserver.yml  scripts  backend  frontend ...
```

---

## PASSO 5 — Instalar tudo com o script (um comando)

Ainda na VPS, dentro de `/opt/StreamServer`:

```bash
chmod +x scripts/interserver-bootstrap.sh
./scripts/interserver-bootstrap.sh SEU_IP_INTERSERVER
```

Exemplo real:

```bash
./scripts/interserver-bootstrap.sh 66.45.123.45
```

Se já tiveres domínio (ex. `radio.teuempresa.com`) apontando para o IP:

```bash
./scripts/interserver-bootstrap.sh radio.teuempresa.com
```

**O que o script faz:**
- Instala Docker (se faltar)
- Cria `.env` com passwords
- Configura Icecast
- Sobe Postgres + Redis + Icecast + Backend + Dashboard + Nginx

No fim, **copia e guarda** as passwords que o script imprimir (admin Icecast, Postgres, etc.).

A primeira build pode demorar vários minutos.

---

## PASSO 6 — Migrações + dados iniciais (admin / planos)

Na VPS:

```bash
cd /opt/StreamServer
docker compose -f docker-compose.interserver.yml exec backend npm run migrate
docker compose -f docker-compose.interserver.yml exec backend npm run seed
```

Isto aplica colunas SaaS (`account_status`, planos, etc.) e cria/actualiza o utilizador admin.  
Sem o `migrate`, o login pode gravar o token e voltar logo ao ecrã de login.  
Confirma no output do seed o utilizador de administração.

---

## PASSO 7 — Testar se está online

No teu PC (browser ou PowerShell):

```powershell
# Site / API
curl http://SEU_IP_INTERSERVER/health

# Icecast (BUTT)
curl http://SEU_IP_INTERSERVER:8000/status-json.xsl
```

No browser abre:

```
http://SEU_IP_INTERSERVER/
```

Deves ver o dashboard StreamServer.

Se `/health` falhar:
```bash
docker compose -f docker-compose.interserver.yml ps
docker compose -f docker-compose.interserver.yml logs -f backend
```

Se Icecast falhar mas o site abrir: confirma firewall porta **8000**.

---

## PASSO 8 — Domínio (recomendado)

1. No DNS do teu domínio, cria registo **A**:
   - Nome: `radio` (ou `@`)
   - Valor: IP da VPS InterServer  
2. Espera propagação (minutos a algumas horas).  
3. Na VPS, edita `.env`:

```bash
nano /opt/StreamServer/.env
```

Ajusta:

```env
PUBLIC_HOST=radio.teuempresa.com
APP_URL=http://radio.teuempresa.com
PUBLIC_STREAM_URL=http://radio.teuempresa.com
CORS_ORIGINS=http://radio.teuempresa.com
PUBLIC_ICECAST_HOST=radio.teuempresa.com
ICECAST_DISABLED=false
DEV_AUTO_SUBSCRIBE=false
```

4. Reinicia:

```bash
cd /opt/StreamServer
# Actualiza hostname no XML Icecast se mudaste de IP para domínio
sed -i "s/<hostname>.*<\/hostname>/<hostname>radio.teuempresa.com<\/hostname>/" infrastructure/icecast/icecast.interserver.xml
docker compose -f docker-compose.interserver.yml --env-file .env up -d --force-recreate
```

---

## PASSO 9 — HTTPS (quando o domínio já apontar)

Para o público, activa HTTPS (Let's Encrypt). Fluxo simples com Certbot no host:

```bash
apt-get install -y certbot
# Para obter certificado precisas do domínio a resolver para este IP.
# Opção prática: usar um proxy Caddy à frente, ou montar certificados no Nginx do Docker.
# Ver secção HTTPS no final deste ficheiro / pedido ao assistente quando o domínio estiver pronto.
```

Até lá, podes usar `http://IP` para testes.

---

## PASSO 10 — Usar o sistema (como os teus clientes)

1. Abre `http://SEU_IP/` (ou o domínio).  
2. **Criar conta** (signup).  
3. Activar **plano / assinatura** (em produção `DEV_AUTO_SUBSCRIBE=false`).  
4. **Criar estação** de rádio.  
5. No dashboard, copia as credenciais BUTT:

| Campo BUTT | Valor |
|------------|--------|
| Type | Icecast |
| Server | IP ou domínio da VPS |
| Port | **8000** |
| User | `source` |
| Password | password da estação (dashboard) |
| Mount | `/{slug}/live` |
| SSL | **Off** |

6. No BUTT: Connect / Start.  
7. Ouvir: `http://SEU_IP/stream/<slug>/live`

---

## Comandos do dia-a-dia

```bash
cd /opt/StreamServer

# Estado
docker compose -f docker-compose.interserver.yml ps

# Logs
docker compose -f docker-compose.interserver.yml logs -f backend
docker compose -f docker-compose.interserver.yml logs -f icecast

# Reiniciar tudo
docker compose -f docker-compose.interserver.yml restart

# Depois de actualizar código (git pull)
git pull
docker compose -f docker-compose.interserver.yml up -d --build
```

---

## Checklist final

- [ ] VPS Ubuntu na InterServer (≥ 2 GB)  
- [ ] Firewall: 22, 80, 443, **8000**  
- [ ] Projecto em `/opt/StreamServer`  
- [ ] `./scripts/interserver-bootstrap.sh SEU_IP` concluído  
- [ ] `npm run seed` no container backend  
- [ ] `http://IP/` abre o dashboard  
- [ ] `http://IP:8000/status-json.xsl` responde  
- [ ] Conta → estação → BUTT → áudio online  

---

## Problemas comuns

| Sintoma | Causa / solução |
|---------|------------------|
| `ssh` recusado | IP/password errados; porta 22 fechada |
| Site não abre | Porta 80; containers parados (`compose ps`) |
| BUTT timeout | Porta **8000** fechada no painel InterServer |
| Login falha | Backend em baixo; vê `logs -f backend` |
| Conta sem poder criar estação | Assinatura inactiva — activa plano (ou, só em teste, `DEV_AUTO_SUBSCRIBE=true`) |
| Auth denied no BUTT | Mount/password errados; usa os do dashboard |

---

## Ficheiros importantes no projecto

- `docker-compose.interserver.yml` — serviços de produção  
- `scripts/interserver-bootstrap.sh` — instalação automática  
- `.env.interserver.example` — modelo de variáveis  
- `infrastructure/icecast/icecast.interserver.xml` — Icecast  

Quando tiveres o **IP da VPS**, podes seguir só os passos 3 → 7 e o sistema já fica acessível em `http://IP/`.
