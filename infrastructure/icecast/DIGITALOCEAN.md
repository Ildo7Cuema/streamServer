# DigitalOcean — Droplet para Icecast (StreamServer)

Guia para criar um **Droplet** na DigitalOcean, instalar Icecast e ligar ao BUTT + Render + Vercel.

Tempo estimado: **15–25 minutos**.

---

## Arquitectura (o que fica onde)

```
BUTT (teu PC) ──TCP:8000──► Icecast (DigitalOcean Droplet)
                                    │
                                    ▼ auth password
                              Render (API) ──► Postgres/Supabase

Ouvinte ──HTTPS──► Vercel ──proxy /stream──► Render ──► Icecast
```

| Plataforma | Papel | Já tens? |
|------------|-------|----------|
| **DigitalOcean** | Icecast (BUTT transmite aqui) | A criar |
| **Render** | API + proxy de escuta | ✅ `streamserver-ivu7.onrender.com` |
| **Vercel** | Dashboard + URL pública | ✅ `stream-server-rouge.vercel.app` |

---

## Parte 1 — Conta DigitalOcean

1. Regista em [https://www.cloud.digitalocean.com/registrations/new](https://www.cloud.digitalocean.com/registrations/new)
2. Confirma email. Método de pagamento obrigatório (Droplet básico ~**$4–6/mês**).
3. (Opcional) Crédito promocional $200/60 dias se tiveres código de referral.

---

## Parte 2 — Chave SSH (no teu Mac)

Se ainda não tens chave SSH:

```bash
ssh-keygen -t ed25519 -C "streamserver" -f ~/.ssh/digitalocean_streamserver
```

Copia a chave **pública**:

```bash
cat ~/.ssh/digitalocean_streamserver.pub
```

No DigitalOcean: **Settings** → **Security** → **SSH Keys** → **Add SSH Key** → cola o conteúdo.

---

## Parte 3 — Criar o Droplet

1. [Create Droplets](https://cloud.digitalocean.com/droplets/new)

| Campo | Valor recomendado |
|-------|-------------------|
| **Region** | Frankfurt ou Amsterdam (perto de Angola/Europa) |
| **Image** | **Ubuntu 22.04 (LTS) x64** |
| **Size** | **Basic** → **Regular** → **$6/mo** (1 GB RAM, 1 vCPU) — mínimo confortável para Docker |
| **Authentication** | A tua **SSH key** |
| **Hostname** | `streamserver-icecast` |

2. **Advanced Options** (opcional): Monitoring ✅  
3. **Create Droplet**

4. Anota o **IP público** (ex: `164.92.xxx.xxx`) na lista de Droplets.

---

## Parte 4 — Firewall DigitalOcean (porta 8000)

Por defeito o Droplet pode bloquear tráfego. Cria um **Cloud Firewall**:

1. **Networking** → **Firewalls** → **Create Firewall**
2. **Inbound rules**:

| Type | Protocol | Port | Sources |
|------|----------|------|---------|
| SSH | TCP | 22 | All IPv4, All IPv6 (ou só o teu IP) |
| Custom | TCP | **8000** | All IPv4, All IPv6 |

3. **Apply to Droplets** → selecciona `streamserver-icecast`
4. **Create Firewall**

> Sem a regra **8000**, o BUTT dá timeout ou erro de ligação.

---

## Parte 5 — Ligar por SSH

```bash
ssh -i ~/.ssh/digitalocean_streamserver root@SEU_IP_PUBLICO
```

(DigitalOcean usa `root` por defeito em Ubuntu droplets.)

Primeira vez: `yes` ao fingerprint.

---

## Parte 6 — Instalar Icecast na Droplet

### Opção A — Copiar ficheiros do teu PC (recomendado)

No **teu Mac**, na pasta do projecto StreamServer:

```bash
scp -i ~/.ssh/digitalocean_streamserver -r \
  infrastructure/icecast \
  scripts/setup-icecast-vm.sh \
  scripts/vm-icecast-bootstrap.sh \
  root@SEU_IP_PUBLICO:~/streamserver/
```

Na **Droplet**:

```bash
cd ~/streamserver
chmod +x vm-icecast-bootstrap.sh setup-icecast-vm.sh
./vm-icecast-bootstrap.sh
```

O script:
- Instala Docker
- Configura Icecast
- Imprime variáveis para o **Render**

### Opção B — Git clone (se o repo estiver no GitHub)

```bash
apt-get update -y && apt-get install -y git
git clone https://github.com/TEU_USER/StreamServer.git
cd StreamServer
chmod +x scripts/vm-icecast-bootstrap.sh
./scripts/vm-icecast-bootstrap.sh
```

---

## Parte 7 — Testar Icecast

No **teu PC**:

```bash
curl http://SEU_IP_PUBLICO:8000/status-json.xsl
```

Resposta esperada: JSON com `"icestats"`.

Se falhar:

```bash
# Na Droplet — Icecast local?
curl http://localhost:8000/status-json.xsl

# Container a correr?
docker ps
```

| Sintoma | Causa provável |
|---------|----------------|
| Timeout externo, OK em localhost | Firewall DO sem porta 8000 |
| Container parado | `cd ~/streamserver-icecast && docker compose up -d` |
| Erro Docker | `docker compose logs -f` |

---

## Parte 8 — Configurar o Render

[Render Dashboard](https://dashboard.render.com/) → serviço **streamserver-api** → **Environment**:

```env
ICECAST_DISABLED=false
PUBLIC_ICECAST_HOST=SEU_IP_PUBLICO
ICECAST_HOST=SEU_IP_PUBLICO
ICECAST_PORT=8000
ICECAST_ADMIN_USER=admin
ICECAST_ADMIN_PASSWORD=<admin-password do script na Droplet>
```

**Não** defines `INTERNAL_API_KEY` (bloqueia auth do Icecast).

Clica **Save Changes** → **Manual Deploy** (redeploy).

Valida:

```bash
curl https://streamserver-ivu7.onrender.com/api/health
```

Esperado:
- `"icecast": "ok"`
- `"icecastConfigured": true`
- `"icecastConnectHost": "SEU_IP_PUBLICO"`

Testa escuta online:

```bash
curl -I "https://stream-server-rouge.vercel.app/stream/radio-chipcity/live"
```

Deve deixar de dar **502** (com BUTT ou fonte activa).

---

## Parte 9 — Configurar o BUTT

Abre o dashboard → **Estações** → **Credenciais** (ou usa estes valores):

| Campo | Valor |
|-------|-------|
| Tipo | **Icecast** |
| **Servidor** | `SEU_IP_PUBLICO` (só IP ou domínio — **sem** `https://`) |
| Porta | `8000` |
| Mount | `/radio-chipcity/live` (ou o da tua estação) |
| Utilizador | `source` |
| Password | password da estação no dashboard |
| Codec | MP3 |
| Bitrate | 128 kbps |
| **SSL/TLS** | **Desligado** |

**URL para ouvir** (partilhar com ouvintes):

`https://stream-server-rouge.vercel.app/stream/radio-chipcity/live`

---

## Parte 10 — (Opcional) Domínio para o Icecast

Em vez do IP no BUTT:

1. DNS do teu domínio → registo **A**: `icecast.teudominio.com` → IP do Droplet  
2. Render: `PUBLIC_ICECAST_HOST=icecast.teudominio.com`  
3. BUTT: Servidor = `icecast.teudominio.com`

---

## Comandos úteis na Droplet

```bash
# Logs Icecast
cd ~/streamserver-icecast && docker compose logs -f icecast

# Reiniciar
docker compose restart

# Parar / arrancar
docker compose down && docker compose up -d

# IP público
curl -s ifconfig.me && echo
```

---

## Checklist final

- [ ] Droplet Ubuntu a correr com IP público
- [ ] Cloud Firewall: TCP 22 + **8000**
- [ ] `curl http://IP:8000/status-json.xsl` OK no PC
- [ ] Render: `PUBLIC_ICECAST_HOST` + redeploy
- [ ] `/api/health` → icecast ok
- [ ] BUTT conecta (servidor = IP, SSL off)
- [ ] Ouvintes ouvem em `https://stream-server-rouge.vercel.app/stream/...`

---

## Custos estimados

| Serviço | Custo |
|---------|-------|
| DigitalOcean Droplet 1 GB | ~$6/mês |
| Render (free) | $0 |
| Vercel (free) | $0 |
| **Total Icecast + stack** | **~$6/mês** |

---

## Problemas comuns

| Erro BUTT | Solução |
|-----------|---------|
| Error resolving server address | Servidor = só IP, sem `https://` ou `/` |
| Connection timeout | Firewall DO porta 8000 |
| Connected then rejected | Password/mount errados ou subscrição inactiva |
| Stream 502 na Vercel | Render sem `ICECAST_HOST` ou Icecast parado |

Guia Render/Vercel geral: [README.md](./README.md) · Oracle Free (alternativa $0): [ORACLE-CLOUD-FREE.md](./ORACLE-CLOUD-FREE.md)
