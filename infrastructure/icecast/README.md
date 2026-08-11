# Icecast / VPS — StreamServer

## Arquitectura recomendada (InterServer)

Backend + Icecast + Dashboard na **mesma VPS**:

```
BUTT --TCP 8000--> Icecast --auth--> Backend (Docker)
Browser --:80--> Nginx --> Dashboard + /api + /stream
```

Guia: **[INTERSERVER.md](./INTERSERVER.md)** · script: `scripts/interserver-bootstrap.sh`

## Alternativa (Icecast só na VM, API no Render)

```
BUTT --TCP 8000--> Icecast (VM) --auth--> Backend (Render)
Ouvinte --HTTPS--> Vercel --/stream--> Render --> Icecast
```
O Icecast precisa de estar **sempre ligado** na porta TCP 8000.

## Ficheiros
- `INTERSERVER.md` — **guia passo a passo** para VPS InterServer (BUTT + Icecast).
- `DIGITALOCEAN.md` — guia Droplet DigitalOcean (~$6/mês).
- `ORACLE-CLOUD-FREE.md` — guia VM Always Free na Oracle Cloud ($0/mês).
- `icecast.prod.xml` — configuração de produção (mounts dinâmicos por estação + auth por URL para o backend público).
- `docker-compose.vm.yml` — sobe só o Icecast na VM (AutoDJ/Liquidsoap opcional, comentado).

## Começar aqui

| Provider | Guia | Notas |
|----------|------|--------|
| **InterServer (full stack)** | **[INTERSERVER.md](./INTERSERVER.md)** | Backend+Icecast+Frontend na VPS |
| DigitalOcean (só Icecast) | [DIGITALOCEAN.md](./DIGITALOCEAN.md) | API no Render |
| Oracle Cloud Free (só Icecast) | [ORACLE-CLOUD-FREE.md](./ORACLE-CLOUD-FREE.md) | API no Render |

Na VM, depois de copiar o repo ou `infrastructure/icecast`:

```bash
chmod +x scripts/vm-icecast-bootstrap.sh
./scripts/vm-icecast-bootstrap.sh
```

## Passos

0. **Script rápido (na VM, com Docker instalado)** — a partir do clone do repo ou copiando os ficheiros:
   ```bash
   chmod +x scripts/setup-icecast-vm.sh
   ./scripts/setup-icecast-vm.sh SEU_HOST_PUBLICO https://streamserver-ivu7.onrender.com
   ```
   Gera passwords, arranca o container e imprime as variáveis para colar no Render.

1. **Criar VM** (ex.: InterServer, Oracle Cloud Always Free, Hetzner, Contabo, DigitalOcean). Instalar Docker. Abrir firewall TCP **22** e **8000**.

2. **Copiar** `icecast.prod.xml` e `docker-compose.vm.yml` para a VM.

3. **Editar `icecast.prod.xml`** (procura por `CHANGE_ME`):
   - `<hostname>` → host público da VM (IP ou subdomínio).
   - `source-password`, `relay-password`, `admin-password` → valores fortes.
   - O `stream_auth` já aponta para `https://streamserver-ivu7.onrender.com/api/internal/icecast/auth` (ajusta se o backend mudar de URL).

4. **Arrancar**:
   ```bash
   docker compose -f docker-compose.vm.yml up -d
   docker compose -f docker-compose.vm.yml logs -f icecast
   ```

5. **Testar** (do teu PC):
   ```bash
   curl http://SEU_HOST_PUBLICO:8000/status-json.xsl
   ```

6. **Render → Environment**:
   ```
   ICECAST_DISABLED=false
   ICECAST_HOST=SEU_HOST_PUBLICO
   PUBLIC_ICECAST_HOST=SEU_HOST_PUBLICO
   ICECAST_PORT=8000
   ICECAST_ADMIN_USER=admin
   ICECAST_ADMIN_PASSWORD=<igual ao admin-password do xml>
   ```
   **Não** definas `INTERNAL_API_KEY` — o `verifyInternal` rejeita o callback de auth em produção se a chave não bater, e o Icecast não envia esse header. Deixá-la por definir permite o callback.

7. **Vercel → Environment Variables** (se ainda não estiver):
   ```
   VITE_BACKEND_URL=https://streamserver-ivu7.onrender.com
   ```
   Depois **Redeploy** (corrige o 502 e as rewrites `/api`, `/ws`, `/stream`).

## Validação
- Do PC: `./scripts/verify-icecast-butt.sh SEU_HOST_PUBLICO`
- `https://streamserver-ivu7.onrender.com/api/health` → `icecast: "ok"`.
- Modal da estação → `Servidor: SEU_HOST_PUBLICO`, `Porta: 8000`.
- BUTT liga com `source` + a `source_password` da estação → fonte conecta.
- Ouvir online: `https://stream-server-rouge.vercel.app/stream/<slug>/live`.

## Notas
- O Icecast pode ficar em HTTP:8000; o ouvinte só vê HTTPS (via proxy do backend).
- AutoDJ (Liquidsoap) é opcional — descomenta o serviço em `docker-compose.vm.yml` e usa a mesma `source-password`.
- TLS direto no Icecast só é necessário se quiseres servir `listen_url_direct` por HTTPS sem passar pelo backend.
